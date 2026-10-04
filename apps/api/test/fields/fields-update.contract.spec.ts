import assert from "node:assert/strict";
import test from "node:test";
import { createFieldUpdateApp } from "../../src/fields/fields-update.controller.js";
import { FieldCommandError } from "../../src/fields/fields-command.error.js";
import { NotFoundException } from "@nestjs/common";
import { validateFieldUpdateCommand } from "../../src/fields/fields-update.service.js";

const identity = { provider: "supabase", subject: "field-editor" };
const fieldId = "00000000-0000-4000-8000-000000000001";
const field = {
  id: fieldId, name: "North field", version: 2,
  representativePoint: { type: "Point" as const, coordinates: [29.02, 41.01] as [number, number] },
  hasCurrentBoundary: false, boundary: null,
  regionContext: {
    administrativeLocation: { state: "UNRESOLVED" as const, code: null, label: null, sourceId: null, confidence: null, dataVersion: null, resolvedAt: null },
    agriculturalRegion: { state: "UNRESOLVED" as const, code: null, label: null, sourceId: null, confidence: null, dataVersion: null, resolvedAt: null },
    agriculturalRegionOverride: null,
  },
  activeSeason: null,
};

test("location envelope and embedded geometry types must agree", () => {
  const point = { type: "Point", coordinates: [29.02, 41.01] };
  const polygon = { type: "Polygon", coordinates: [[[29, 41], [30, 41], [30, 42], [29, 41]]] };

  assert.throws(() => validateFieldUpdateCommand({ location: { type: "POINT", point: polygon } }));
  assert.throws(() => validateFieldUpdateCommand({ location: { type: "POLYGON", polygon: point } }));
  assert.deepEqual(validateFieldUpdateCommand({ location: { type: "POINT", point } }).location, point);
  assert.deepEqual(validateFieldUpdateCommand({ location: { type: "POLYGON", polygon } }).location, polygon);
});

async function setup(overrides: Partial<Parameters<typeof createFieldUpdateApp>[0]> = {}) {
  const app = await createFieldUpdateApp({
    verify: async (token) => token === "valid-token" ? identity : null,
    updateField: async () => field,
    ...overrides,
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

test("update requires If-Match and rejects blank names before persistence", async () => {
  let writes = 0;
  const app = await setup({ updateField: async () => { writes++; return field; } });
  try {
    for (const payload of [{ name: "" }, { name: "   " }, {}]) {
      const missing = await app.inject({ method: "PATCH", url: `/v1/fields/${fieldId}`, headers: { authorization: "Bearer valid-token" }, payload });
      assert.equal(missing.statusCode, 400);
      assert.equal(missing.json().error.code, "INVALID_REQUEST");
    }
    for (const name of ["", "   "]) {
      const response = await app.inject({ method: "PATCH", url: `/v1/fields/${fieldId}`, headers: { authorization: "Bearer valid-token", "if-match": '"1"' }, payload: { name } });
      assert.equal(response.statusCode, 400);
      assert.equal(response.json().error.code, "INVALID_REQUEST");
    }
    assert.equal(writes, 0);
  } finally { await app.close(); }
});

test("update preserves omitted values, trims a supplied name, and returns the incremented ETag", async () => {
  const calls: unknown[] = [];
  const app = await setup({ updateField: async (...args) => { calls.push(args); return field; } });
  try {
    const response = await app.inject({ method: "PATCH", url: `/v1/fields/${fieldId}`, headers: { authorization: "Bearer valid-token", "if-match": '"1"' }, payload: { name: "  North field  " } });
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers.etag, '"2"');
    assert.deepEqual(response.json(), field);
    assert.deepEqual(calls, [[identity, fieldId, 1, { name: "  North field  " }]]);
  } finally { await app.close(); }
});

test("stale ETag uses the shared machine-readable 409 response and privacy-safe absence", async () => {
  const stale = await setup({ updateField: async () => { throw new FieldCommandError(409, "STALE_VERSION"); } });
  try {
    const response = await stale.inject({ method: "PATCH", url: `/v1/fields/${fieldId}`, headers: { authorization: "Bearer valid-token", "if-match": '"1"' }, payload: { name: "North field" } });
    assert.equal(response.statusCode, 409);
    assert.equal(response.json().error.code, "STALE_VERSION");
    assert.ok(response.json().error.requestId);
  } finally { await stale.close(); }
  const absent = await setup({ updateField: async () => { throw new NotFoundException("private Business details"); } });
  try {
    const response = await absent.inject({ method: "PATCH", url: `/v1/fields/${fieldId}`, headers: { authorization: "Bearer valid-token", "if-match": '"1"' }, payload: { name: "North field" } });
    assert.equal(response.statusCode, 404);
    assert.equal(response.json().error.code, "NOT_FOUND");
    assert.doesNotMatch(response.body, /private|Business details/i);
  } finally { await absent.close(); }
});
