import assert from "node:assert/strict";
import test from "node:test";
import { createTodayApp } from "../../src/seasons/today.controller.js";
import { BusinessScopeForbiddenError } from "../../src/authorization/membership-scope.service.js";

const taskId = "00000000-0000-4000-8000-000000000001";
const identity = { provider: "supabase", subject: "farmer" };
const result = { localDate: "2026-08-02", tasks: [{ id: taskId, seasonId: taskId, fieldId: taskId, cropDisplayName: "Arpa", title: "Tarla kontrolü", plannedLocalDate: "2026-08-02", sourceKind: "MANUAL" as const }] };

async function setup(overrides: Partial<Parameters<typeof createTodayApp>[0]> = {}) {
  const app = await createTodayApp({ verify: async (token) => token === "valid-token" ? identity : null, readToday: async () => result, ...overrides });
  await app.init(); await app.getHttpAdapter().getInstance().ready(); return app;
}

test("today returns server-computed local date and planned-work contract", async () => {
  const app = await setup();
  try {
    const response = await app.inject({ method: "GET", url: "/v1/today", headers: { authorization: "Bearer valid-token", "x-timezone": "Pacific/Honolulu" } });
    assert.equal(response.statusCode, 200); assert.deepEqual(response.json(), result);
  } finally { await app.close(); }
});

test("today checks authentication before querying and returns stable auth errors", async () => {
  let reads = 0; const app = await setup({ readToday: async () => { reads++; return result; } });
  try {
    for (const authorization of [undefined, "Basic foo", "Bearer rejected"]) {
      const response = await app.inject({ method: "GET", url: "/v1/today", headers: authorization ? { authorization } : {} });
      assert.equal(response.statusCode, 401); assert.equal(response.json().error.code, "UNAUTHORIZED");
      assert.equal(typeof response.json().error.requestId, "string");
    }
    assert.equal(reads, 0);
  } finally { await app.close(); }
});

test("today hides missing or unauthorized business context behind the API error envelope", async () => {
  const app = await setup({ readToday: async () => { throw new BusinessScopeForbiddenError(); } });
  try {
    const response = await app.inject({ method: "GET", url: "/v1/today?businessId=forged", headers: { authorization: "Bearer valid-token" } });
    assert.equal(response.statusCode, 403); assert.equal(response.json().error.code, "FORBIDDEN");
    assert.doesNotMatch(response.body, /business context|membership/i);
  } finally { await app.close(); }
});
