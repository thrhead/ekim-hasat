import assert from "node:assert/strict";
import test from "node:test";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { ApiError } from "../../src/observability/api-error.filter.js";
import { createHarvestsApp } from "../../src/harvest/harvests.module.js";

const fieldId = "11111111-1111-4111-8111-111111111111";
const harvestId = "22222222-2222-4222-8222-222222222222";
const seasonId = "33333333-3333-4333-8333-333333333333";
const request = { harvestId, seasonId, harvestDate: "2026-10-17", quantity: "12.375", unit: "KG" as const };
const harvest = { id: harvestId, fieldId, seasonId, harvestDate: "2026-10-17", quantity: "12.375", unit: "KG" as const,
  recordedAt: "2026-10-17T10:00:00.000Z" };

async function appWith(create: Parameters<typeof createHarvestsApp>[0]["create"]) {
  return createHarvestsApp({
    verify: async (token) => token === "valid" ? { provider: "test", subject: "farmer" } : null,
    create,
  });
}

async function ready(app: NestFastifyApplication): Promise<void> {
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
}

test("Harvest create route returns 201/200 and only the contract Harvest fields", async () => {
  const received: unknown[] = [];
  let kind: "accepted" | "replayed" = "accepted";
  const internalHarvest = { ...harvest, businessId: "private-business", actorUserId: "private-user",
    actorMembershipId: "private-membership" };
  const app = await appWith(async (identity, requestedFieldId, body) => {
    received.push([identity, requestedFieldId, body]);
    return { kind, harvest: internalHarvest };
  });
  await ready(app);
  try {
    for (const [outcome, status] of [["accepted", 201], ["replayed", 200]] as const) {
      kind = outcome;
      const response = await app.inject({ method: "POST", url: `/v1/fields/${fieldId}/harvests`,
        headers: { authorization: "Bearer valid" }, payload: request });
      assert.equal(response.statusCode, status);
      assert.deepEqual(response.json(), harvest);
    }
    assert.deepEqual(received, [
      [{ provider: "test", subject: "farmer" }, fieldId, request],
      [{ provider: "test", subject: "farmer" }, fieldId, request],
    ]);
  } finally { await app.close(); }
});

test("Harvest create route returns structured authentication, authorization, conflict, and unexpected errors", async () => {
  const app = await appWith(async () => { throw new ApiError(403, "FORBIDDEN", "This request is not available"); });
  await ready(app);
  try {
    const unauthorized = await app.inject({ method: "POST", url: `/v1/fields/${fieldId}/harvests`, payload: request });
    assert.equal(unauthorized.statusCode, 401);
    assert.equal(unauthorized.json().error.code, "UNAUTHORIZED");
    const forbidden = await app.inject({ method: "POST", url: `/v1/fields/${fieldId}/harvests`,
      headers: { authorization: "Bearer valid" }, payload: request });
    assert.equal(forbidden.statusCode, 403);
    assert.equal(forbidden.json().error.code, "FORBIDDEN");
  } finally { await app.close(); }

  const unavailableApp = await appWith(async () => { throw new ApiError(404, "NOT_FOUND", "The requested item is not available"); });
  await ready(unavailableApp);
  try {
    const response = await unavailableApp.inject({ method: "POST", url: `/v1/fields/${fieldId}/harvests`,
      headers: { authorization: "Bearer valid" }, payload: request });
    assert.equal(response.statusCode, 404);
    assert.equal(response.json().error.code, "NOT_FOUND");
    assert.equal(response.json().error.message, "The requested item is not available");
  } finally { await unavailableApp.close(); }

  const conflictApp = await appWith(async () => { throw new ApiError(409, "IDEMPOTENCY_KEY_REUSED", "Changed Harvest identity"); });
  await ready(conflictApp);
  try {
    const response = await conflictApp.inject({ method: "POST", url: `/v1/fields/${fieldId}/harvests`,
      headers: { authorization: "Bearer valid" }, payload: request });
    assert.equal(response.statusCode, 409);
    assert.equal(response.json().error.code, "IDEMPOTENCY_KEY_REUSED");
  } finally { await conflictApp.close(); }

  const failedApp = await appWith(async () => { throw new Error("database secret"); });
  await ready(failedApp);
  try {
    const response = await failedApp.inject({ method: "POST", url: `/v1/fields/${fieldId}/harvests`,
      headers: { authorization: "Bearer valid" }, payload: request });
    assert.equal(response.statusCode, 500);
    assert.equal(response.json().error.code, "UNEXPECTED");
    assert.equal(response.json().error.message, "Something went wrong");
    assert.doesNotMatch(JSON.stringify(response.json()), /database secret/);
  } finally { await failedApp.close(); }
});

test("Harvest create route rejects unsupported request properties before repository dispatch", async () => {
  let calls = 0;
  const app = await appWith(async () => {
    calls += 1;
    return { kind: "accepted", harvest };
  });
  await ready(app);
  try {
    const response = await app.inject({ method: "POST", url: `/v1/fields/${fieldId}/harvests`,
      headers: { authorization: "Bearer valid" }, payload: { ...request, note: "unsupported" } });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error.code, "INVALID_REQUEST");
    assert.equal(calls, 0);
  } finally { await app.close(); }
});
