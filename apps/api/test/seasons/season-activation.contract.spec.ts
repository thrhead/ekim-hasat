import assert from "node:assert/strict";
import test from "node:test";
import { NotFoundException } from "@nestjs/common";
import { createSeasonActivationApp, type SeasonActivationDependencies } from "../../src/seasons/seasons-activation.controller.js";
import { SeasonCommandError } from "../../src/seasons/seasons-command.error.js";
import { BusinessScopeForbiddenError } from "../../src/authorization/membership-scope.service.js";

const seasonId = "00000000-0000-4000-8000-000000000001";
const identity = { provider: "supabase", subject: "farmer" };
const active = { id: seasonId, fieldId: "00000000-0000-4000-8000-000000000003", cropDisplayName: "Wheat", sowingPlantingDate: "2026-09-28", status: "ACTIVE" as const, activatedAt: "2026-09-29T10:00:00.000Z", version: 3,
  plan: { source: { kind: "MANUAL" as const, validationLabel: "NOT_CENTRALLY_VALIDATED" as const, templateVersionId: null }, tasks: [{ id: "00000000-0000-4000-8000-000000000002", title: "Check", plannedLocalDate: "2026-10-01", version: 1 }] } };
const url = `/v1/seasons/${seasonId}/activate`;
const headers = { authorization: "Bearer valid", "if-match": '"2"', "idempotency-key": "activate-key" };

async function setup(activate: SeasonActivationDependencies["activate"]) {
  const app = await createSeasonActivationApp({ verify: async (token) => token === "valid" ? identity : null, activate });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

test("activation passes verified identity, If-Match version and idempotency key and returns ActiveSeason with ETag", async () => {
  const calls: unknown[] = [];
  const app = await setup(async (...args) => { calls.push(args); return { kind: "activated", season: active }; });
  try {
    const response = await app.inject({ method: "POST", url: `${url}?businessId=forged`, headers });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), active);
    assert.equal(response.headers.etag, '"3"');
    assert.deepEqual(calls, [[identity, seasonId, 2, "activate-key"]]);
  } finally { await app.close(); }
});

test("malformed version/key and unauthorized requests never invoke activation", async () => {
  let calls = 0;
  const app = await setup(async () => { calls++; return { kind: "activated", season: active }; });
  try {
    for (const requestHeaders of [
      { authorization: "Bearer valid", "idempotency-key": "key" },
      { authorization: "Bearer valid", "if-match": "0", "idempotency-key": "key" },
      { authorization: "Bearer valid", "if-match": '"2"' },
      { ...headers, authorization: "Bearer rejected" },
    ]) {
      const response = await app.inject({ method: "POST", url, headers: requestHeaders });
      assert.ok([400, 401].includes(response.statusCode));
    }
    assert.equal(calls, 0);
  } finally { await app.close(); }
});

test("activation conflict, zero-task and private-scope outcomes preserve status and privacy-safe error shape", async () => {
  for (const [failure, expectedStatus] of [
    [new SeasonCommandError(409, "IDEMPOTENCY_KEY_REUSED"), 409],
    [new SeasonCommandError(409, "STALE_VERSION"), 409],
    [new SeasonCommandError(409, "SEASON_STATE_CONFLICT"), 409],
    [new SeasonCommandError(422, "PLAN_HAS_NO_VALID_TASKS"), 422],
    [new BusinessScopeForbiddenError(), 403],
    [new NotFoundException("private season belongs elsewhere"), 404],
  ] as const) {
    const app = await setup(async () => { throw failure; });
    try {
      const response = await app.inject({ method: "POST", url, headers });
      assert.equal(response.statusCode, expectedStatus);
      assert.ok(response.json().error.requestId);
      assert.doesNotMatch(response.body, /private|belongs elsewhere/i);
      if (failure instanceof SeasonCommandError) {
        assert.equal(response.json().error.code, failure.presentation.code);
        assert.ok(["IDEMPOTENCY_KEY_REUSED", "STALE_VERSION", "SEASON_STATE_CONFLICT", "PLAN_HAS_NO_VALID_TASKS"].includes(response.json().error.code));
      }
    } finally { await app.close(); }
  }
});
