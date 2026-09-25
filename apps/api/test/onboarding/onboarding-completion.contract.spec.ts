import assert from "node:assert/strict";
import test from "node:test";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import {
  createOnboardingCompletionApp,
  type OnboardingCompletionDependencies,
} from "../../src/onboarding/onboarding.controller.js";
import { DefaultBusinessContextUnauthorizedError } from "../../src/onboarding/onboarding.repository.js";

type FieldSummary = {
  id: string;
  name: string;
  representativePoint: { type: "Point"; coordinates: [number, number] };
  createdAt: Date;
};

const point = { type: "Point" as const, coordinates: [29.0, 41.0] as [number, number] };
const field: FieldSummary = {
  id: "field-1",
  name: "Tarla 1",
  representativePoint: point,
  createdAt: new Date("2026-09-25T12:00:00.000Z"),
};

async function createApp(overrides: Partial<OnboardingCompletionDependencies> = {}) {
  const calls: Array<{ identity: unknown; request: unknown }> = [];
  const dependencies: OnboardingCompletionDependencies = {
    verify: async (token) => token === "valid-token" ? { provider: "supabase", subject: "farmer-1" } : null,
    complete: async (identity, request) => {
      calls.push({ identity, request });
      return { kind: "created", field };
    },
    ...overrides,
  };
  const app: NestFastifyApplication = await createOnboardingCompletionApp(dependencies);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return { app, calls };
}

test("completion returns committed summary and preserves created/replayed status semantics", async () => {
  for (const [kind, status] of [["created", 201], ["replayed", 200], ["already_completed", 200]] as const) {
    const { app, calls } = await createApp({
      complete: async (identity, request) => {
        calls.push({ identity, request });
        return { kind, field };
      },
    });
    try {
      const response = await app.inject({
        method: "POST",
        url: "/v1/onboarding/complete",
        headers: {
          authorization: "Bearer valid-token",
          "idempotency-key": "first-field-key",
          "x-correlation-id": "onboarding_2026-09",
        },
        payload: { name: "  Tarla 1  ", location: point },
      });
      assert.equal(response.statusCode, status);
      assert.equal(response.headers["x-correlation-id"], "onboarding_2026-09");
      assert.deepEqual(response.json(), {
        field: { ...field, createdAt: "2026-09-25T12:00:00.000Z" },
      });
      assert.deepEqual(calls[0], {
        identity: { provider: "supabase", subject: "farmer-1" },
        request: { idempotencyKey: "first-field-key", name: "  Tarla 1  ", location: point },
      });
    } finally {
      await app.close();
    }
  }
});

test("completion maps authentication, key, input, location, context and conflict errors", async () => {
  const { app } = await createApp({
    complete: async (_identity, request) => {
      if (request.idempotencyKey === "conflict-key") return { kind: "conflict" };
      if (request.idempotencyKey === "context-key") throw new DefaultBusinessContextUnauthorizedError();
      if (request.idempotencyKey === "bad-geometry-key") {
        const error = new Error("coordinates must not leak");
        error.name = "FieldLocationValidationError";
        throw error;
      }
      return { kind: "created", field };
    },
  });
  try {
    const base = { method: "POST" as const, url: "/v1/onboarding/complete" };
    for (const request of [
      { headers: {}, payload: { location: point } },
      { headers: { authorization: "Bearer invalid" }, payload: { location: point } },
    ]) {
      const response = await app.inject({ ...base, ...request });
      assert.equal(response.statusCode, 401);
      assert.equal(response.json().code, "AUTHENTICATION_REQUIRED");
    }
    const missingKey = await app.inject({
      ...base,
      headers: { authorization: "Bearer valid-token" },
      payload: { location: point },
    });
    assert.equal(missingKey.statusCode, 400);
    assert.equal(missingKey.json().code, "INVALID_REQUEST");

    const invalidBody = await app.inject({
      ...base,
      headers: { authorization: "Bearer valid-token", "idempotency-key": "input-key" },
      payload: { location: point, businessId: "forged" },
    });
    assert.equal(invalidBody.statusCode, 400);

    for (const [key, status, code] of [
      ["conflict-key", 409, "CONFLICT"],
      ["bad-geometry-key", 422, "VALIDATION_FAILED"],
      ["context-key", 400, "INVALID_REQUEST"],
    ] as const) {
      const response = await app.inject({
        ...base,
        headers: { authorization: "Bearer valid-token", "idempotency-key": key },
        payload: { location: point },
      });
      assert.equal(response.statusCode, status);
      assert.equal(response.json().code, code);
      assert.equal(/coordinates|business|membership|pointer/i.test(response.body), false);
    }
  } finally {
    await app.close();
  }
});
