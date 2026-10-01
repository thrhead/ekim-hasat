import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { DefaultBusinessContextUnauthorizedError } from "../../src/onboarding/onboarding.repository.js";

type VerifiedSubject = { provider: "supabase"; subject: string };
type OnboardingStatus = { firstFieldOnboardingNeeded: boolean };
type StatusDependencies = {
  verify: (token: string) => Promise<VerifiedSubject>;
  readStatus: (subject: VerifiedSubject) => Promise<OnboardingStatus>;
};

/**
 * T020 must expose its real Nest/Fastify status route through this injectable
 * app factory. The factory uses the production controller, auth/error handling,
 * and route registration; these tests supply only auth and read-model ports.
 */
async function startStatusApp(dependencies: StatusDependencies): Promise<NestFastifyApplication> {
  const sourcePath = fileURLToPath(new URL("../../src/onboarding/onboarding.controller.ts", import.meta.url));
  if (!existsSync(sourcePath)) throw new Error("T020 onboarding status controller is absent");
  const module: {
    createOnboardingStatusApp: (ports: StatusDependencies) => Promise<NestFastifyApplication>;
  } = await import("../../src/onboarding/onboarding.controller.js");
  const app = await module.createOnboardingStatusApp(dependencies);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

function verifiedAuth(token: string): Promise<VerifiedSubject> {
  if (token !== "valid-access-token") throw new Error("Invalid test credential");
  return Promise.resolve({ provider: "supabase", subject: "farmer-1" });
}

test("authenticated new and returning farmers receive only the minimal status", async () => {
  for (const needed of [true, false]) {
    const reads: VerifiedSubject[] = [];
    const app = await startStatusApp({
      verify: verifiedAuth,
      readStatus: async (subject) => {
        reads.push(subject);
        return { firstFieldOnboardingNeeded: needed };
      },
    });
    try {
      const response = await app.inject({
        method: "GET",
        url: "/v1/onboarding/status",
        headers: { authorization: "Bearer valid-access-token" },
      });
      assert.equal(response.statusCode, 200);
      assert.deepEqual(response.json(), { firstFieldOnboardingNeeded: needed });
      assert.deepEqual(reads, [{ provider: "supabase", subject: "farmer-1" }]);
    } finally {
      await app.close();
    }
  }
});

test("missing, malformed, and rejected credentials return the normal 401 Error response", async () => {
  const reads: VerifiedSubject[] = [];
  const app = await startStatusApp({
    verify: verifiedAuth,
    readStatus: async (subject) => {
      reads.push(subject);
      return { firstFieldOnboardingNeeded: true };
    },
  });
  try {
    for (const authorization of [undefined, "Basic value", "Bearer invalid-access-token"]) {
      const response = await app.inject({
        method: "GET",
        url: "/v1/onboarding/status",
        headers: authorization ? { authorization } : {},
      });
      assert.equal(response.statusCode, 401);
      const body = response.json() as Record<string, unknown>;
      assert.deepEqual(Object.keys(body).sort(), ["code", "correlationId", "message", "retryable"]);
      assert.equal(body.code, "AUTHENTICATION_REQUIRED");
      assert.equal(typeof body.message, "string");
      assert.equal(typeof body.correlationId, "string");
      assert.equal(body.retryable, false);
      assert.equal(JSON.stringify(body).includes("invalid-access-token"), false);
    }
    assert.deepEqual(reads, []);
  } finally {
    await app.close();
  }
});

test("unusable default context returns privacy-safe 403 without a second context read", async () => {
  for (const contextCase of ["invalid pointer", "inactive membership"]) {
    const reads: VerifiedSubject[] = [];
    const app = await startStatusApp({
      verify: verifiedAuth,
      readStatus: async (subject) => {
        reads.push(subject);
        throw new DefaultBusinessContextUnauthorizedError();
      },
    });
    try {
      const response = await app.inject({
        method: "GET",
        url: "/v1/onboarding/status",
        headers: { authorization: "Bearer valid-access-token" },
      });
      assert.equal(response.statusCode, 403, contextCase);
      const body = response.json() as Record<string, unknown>;
      assert.deepEqual(Object.keys(body).sort(), ["code", "correlationId", "message", "retryable"]);
      assert.equal(body.code, "FORBIDDEN");
      assert.equal(typeof body.message, "string");
      assert.equal(typeof body.correlationId, "string");
      assert.equal(body.retryable, false);
      assert.equal(/business|membership|pointer|other/i.test(response.body), false);
      assert.deepEqual(reads, [{ provider: "supabase", subject: "farmer-1" }]);
    } finally {
      await app.close();
    }
  }
});
