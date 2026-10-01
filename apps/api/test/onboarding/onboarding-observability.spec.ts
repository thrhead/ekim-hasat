import assert from "node:assert/strict";
import test from "node:test";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import {
  createOnboardingCompletionApp,
  createOnboardingStatusApp,
  type OnboardingCompletionDependencies,
  type OnboardingStatusDependencies,
} from "../../src/onboarding/onboarding.controller.js";

type CapturedRecord = { level: "info" | "error"; fields: Record<string, unknown> };

const correlationId = "onboarding-observability-2026";
const location = { type: "Point", coordinates: [29.123456, 41.987654] };
const privateValues = [
  "Bearer super-secret-access-token",
  "super-secret-access-token",
  "private-refresh-token",
  "farmer@example.invalid",
  "Precise Tarla 17",
  "29.123456",
  "41.987654",
  "membership-private-id",
];

function installCapturedLogger(records: CapturedRecord[]): () => void {
  const originalInfo = console.info;
  const originalError = console.error;
  // The application composition currently creates its own logger. Capture its
  // structured JSON sink so the assertions cover emitted records end to end.
  console.info = (line?: unknown) => {
    capture(line, "info");
  };
  console.error = (line?: unknown) => {
    capture(line, "error");
  };
  function capture(line: unknown, level: "info" | "error") {
    if (typeof line !== "string") return;
    try {
      const fields = JSON.parse(line) as Record<string, unknown>;
      records.push({ level, fields });
    } catch {
      // Ignore unrelated console output; the feature logger emits JSON lines.
    }
  }
  return () => {
    console.info = originalInfo;
    console.error = originalError;
  };
}

async function ready(app: NestFastifyApplication): Promise<NestFastifyApplication> {
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

function assertSafeOnboardingEvents(records: CapturedRecord[], expectedEvents: string[]) {
  const events = records
    .map(({ fields }) => fields)
    .filter((fields) => typeof fields.event === "string" && fields.event.startsWith("onboarding."));
  assert.deepEqual(events.map(({ event }) => event), expectedEvents);
  assert.ok(events.length > 0);
  for (const event of events) assert.equal(event.correlationId, correlationId);

  const serialized = JSON.stringify(events);
  for (const privateValue of privateValues) assert.equal(serialized.includes(privateValue), false, `event leaked ${privateValue}`);
  for (const event of events) {
    assert.deepEqual(Object.keys(event).sort(), [
      "correlationId",
      "event",
      ...(event.outcome === undefined ? [] : ["outcome"]),
      ...(event.errorCategory === undefined ? [] : ["errorCategory"]),
      ...(event.durationMs === undefined ? [] : ["durationMs"]),
    ].sort());
  }
}

test("onboarding status emits correlated start and context-resolution events with safe fields", async () => {
  const records: CapturedRecord[] = [];
  const restoreConsole = installCapturedLogger(records);
  const dependencies: OnboardingStatusDependencies = {
    verify: async () => ({ provider: "supabase", subject: "farmer@example.invalid" }),
    readStatus: async () => ({ firstFieldOnboardingNeeded: true }),
  };
  const app = await ready(await createOnboardingStatusApp(dependencies));
  try {
    const response = await app.inject({
      method: "GET",
      url: "/v1/onboarding/status",
      headers: { authorization: "Bearer super-secret-access-token", "x-correlation-id": correlationId },
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["x-correlation-id"], correlationId);
    assertSafeOnboardingEvents(records, ["onboarding.started", "onboarding.default_business_context"]);
  } finally {
    await app.close();
    restoreConsole();
  }
});

test("onboarding completion emits correlated start and save events without tokens or field details", async () => {
  const records: CapturedRecord[] = [];
  const restoreConsole = installCapturedLogger(records);
  const dependencies: OnboardingCompletionDependencies = {
    verify: async () => ({ provider: "supabase", subject: "farmer@example.invalid" }),
    complete: async () => ({
      kind: "created",
      field: {
        id: "membership-private-id",
        name: "Precise Tarla 17",
        representativePoint: location,
        createdAt: new Date("2026-09-25T12:00:00.000Z"),
      },
    }),
  };
  const app = await ready(await createOnboardingCompletionApp(dependencies));
  try {
    const response = await app.inject({
      method: "POST",
      url: "/v1/onboarding/complete",
      headers: {
        authorization: "Bearer super-secret-access-token",
        "idempotency-key": "private-refresh-token",
        "x-correlation-id": correlationId,
      },
      payload: { name: "Precise Tarla 17", location },
    });
    assert.equal(response.statusCode, 201);
    assert.equal(response.headers["x-correlation-id"], correlationId);
    assertSafeOnboardingEvents(records, ["onboarding.started", "onboarding.field_save"]);
  } finally {
    await app.close();
    restoreConsole();
  }
});

test("onboarding recoverable failure carries request correlation and a safe error category", async () => {
  const records: CapturedRecord[] = [];
  const restoreConsole = installCapturedLogger(records);
  const dependencies: OnboardingStatusDependencies = {
    verify: async () => ({ provider: "supabase", subject: "farmer@example.invalid" }),
    readStatus: async () => {
      throw new Error("database failed for membership-private-id at 29.123456,41.987654");
    },
  };
  const app = await ready(await createOnboardingStatusApp(dependencies));
  try {
    const response = await app.inject({
      method: "GET",
      url: "/v1/onboarding/status",
      headers: { authorization: "Bearer super-secret-access-token", "x-correlation-id": correlationId },
    });
    assert.equal(response.statusCode, 500);
    assert.equal(response.headers["x-correlation-id"], correlationId);
    assertSafeOnboardingEvents(records, ["onboarding.started", "onboarding.default_business_context", "onboarding.recoverable_failure"]);
    const failure = records.find(({ fields }) => fields.event === "onboarding.recoverable_failure")?.fields;
    assert.equal(failure?.outcome, "retryable_failure");
    assert.equal(failure?.errorCategory, "INTERNAL_ERROR");
  } finally {
    await app.close();
    restoreConsole();
  }
});
