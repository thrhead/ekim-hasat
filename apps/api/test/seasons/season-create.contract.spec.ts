import assert from "node:assert/strict";
import test from "node:test";
import { NotFoundException } from "@nestjs/common";
import { createSeasonCreateApp } from "../../src/seasons/seasons-create.controller.js";
import { SeasonCommandError } from "../../src/seasons/seasons-command.error.js";
import { BusinessScopeForbiddenError } from "../../src/authorization/membership-scope.service.js";
const fieldId = "00000000-0000-4000-8000-000000000001";
const cropId = "00000000-0000-4000-8000-000000000003";
const identity = { provider: "supabase", subject: "farmer" };
const command = { crop: { centralCropId: cropId }, sowingPlantingDate: "2026-08-01" };
const season = { id: cropId, fieldId, cropDisplayName: "Fixture", sowingPlantingDate: "2026-08-01", status: "DRAFT" as const, version: 1, plan: { source: { kind: "VALIDATED_TEMPLATE" as const, validationLabel: "CENTRALLY_VALIDATED" as const, templateVersionId: cropId }, tasks: [{ id: cropId, title: "Check", plannedLocalDate: "2026-08-01", version: 1 }] } };
async function setup(overrides: Partial<Parameters<typeof createSeasonCreateApp>[0]> = {}) {
  const app = await createSeasonCreateApp({ verify: async (token) => token === "valid" ? identity : null, createDraft: async () => ({ kind: "created", season }), ...overrides });
  await app.init(); await app.getHttpAdapter().getInstance().ready(); return app;
}
const headers = { authorization: "Bearer valid", "idempotency-key": "create-key" };
const url = `/v1/fields/${fieldId}/seasons`;
test("field-scoped create passes verified identity and exact command and returns 201 with ETag", async () => {
  const calls: unknown[] = []; const app = await setup({ createDraft: async (...args) => { calls.push(args); return { kind: "created", season }; } });
  try { const r = await app.inject({ method: "POST", url: `${url}?businessId=forged`, headers, payload: command });
    assert.equal(r.statusCode, 201); assert.deepEqual(r.json(), season); assert.equal(r.headers.etag, '"1"'); assert.deepEqual(calls, [[identity, fieldId, command, "create-key"]]);
  } finally { await app.close(); }
});
test("replays and logical dedupe return 200 unchanged for DRAFT or ACTIVE", async () => {
  for (const kind of ["replayed", "existing"] as const) for (const record of [season, { ...season, status: "ACTIVE" as const, activatedAt: "2026-09-01T00:00:00.000Z" }]) {
    const app = await setup({ createDraft: async () => ({ kind, season: record }) });
    try { const r = await app.inject({ method: "POST", url, headers, payload: command }); assert.equal(r.statusCode, 200); assert.deepEqual(r.json(), record); }
    finally { await app.close(); }
  }
});
test("create rejects client business/template authority and malformed commands before persistence", async () => {
  let writes = 0; const app = await setup({ createDraft: async () => { writes++; return { kind: "created", season }; } });
  try {
    for (const payload of [{ ...command, businessId: cropId }, { ...command, templateVersionId: cropId }, { ...command, planSource: "VALIDATED_TEMPLATE" }, { ...command, crop: { centralCropId: cropId, customCropName: "Name" } }, { ...command, crop: { customCropId: cropId } }, { ...command, sowingPlantingDate: "2026-02-30" }, { ...command, crop: { customCropName: "   " } }]) {
      const r = await app.inject({ method: "POST", url, headers, payload }); assert.equal(r.statusCode, 400); assert.equal(r.json().error.code, "INVALID_REQUEST");
    }
    for (const key of [undefined, "", "x".repeat(201)]) {
      const r = await app.inject({ method: "POST", url, headers: { authorization: "Bearer valid", ...(key === undefined ? {} : { "idempotency-key": key }) }, payload: command }); assert.equal(r.statusCode, 400);
    }
    assert.equal(writes, 0);
  } finally { await app.close(); }
});
test("authorization failures are privacy-safe and unauthenticated commands never reach persistence", async () => {
  let writes = 0; const app = await setup({ createDraft: async () => { writes++; return { kind: "created", season }; } });
  try { for (const authorization of [undefined, "Basic secret", "Bearer rejected"]) {
      const r = await app.inject({ method: "POST", url, headers: { "idempotency-key": "key", ...(authorization ? { authorization } : {}) }, payload: command }); assert.equal(r.statusCode, 401); assert.equal(r.json().error.code, "UNAUTHORIZED");
    } assert.equal(writes, 0);
  } finally { await app.close(); }
  for (const error of [new NotFoundException("private cross-business field"), new BusinessScopeForbiddenError()]) {
    const denied = await setup({ createDraft: async () => { throw error; } });
    try { const r = await denied.inject({ method: "POST", url, headers, payload: command }); assert.equal(r.statusCode, error instanceof NotFoundException ? 404 : 403); assert.doesNotMatch(r.body, /private|business|membership/); }
    finally { await denied.close(); }
  }
});
test("create emits stable conflict/date errors and protects unexpected failures", async () => {
  for (const [status, code] of [[409, "MANUAL_PLAN_CHOICE_REQUIRED"], [409, "IDEMPOTENCY_KEY_REUSED"], [400, "SEASON_DATE_IN_FUTURE"]] as const) {
    const app = await setup({ createDraft: async () => { throw new SeasonCommandError(status, code); } });
    try { const r = await app.inject({ method: "POST", url, headers, payload: command }); assert.equal(r.statusCode, status); assert.equal(r.json().error.code, code); assert.ok(r.json().error.requestId); }
    finally { await app.close(); }
  }
  const app = await setup({ createDraft: async () => { throw new Error("SQL password secret"); } });
  try { const r = await app.inject({ method: "POST", url, headers, payload: command }); assert.equal(r.statusCode, 500); assert.equal(r.json().error.code, "UNEXPECTED"); assert.doesNotMatch(r.body, /SQL|password|secret/); }
  finally { await app.close(); }
});
