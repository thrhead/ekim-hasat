import assert from "node:assert/strict";
import test from "node:test";
import { NotFoundException } from "@nestjs/common";
import { BusinessScopeForbiddenError } from "../../src/authorization/membership-scope.service.js";
import { createFieldCreateApp } from "../../src/fields/fields-create.controller.js";
import { FieldCommandError } from "../../src/fields/fields-command.error.js";

const identity = { provider: "supabase", subject: "farmer" };
const fieldId = "00000000-0000-4000-8000-000000000001";
const point = { type: "Point" as const, coordinates: [29.02, 41.01] as [number, number] };
const field = {
  id: fieldId,
  name: "Tarla 1",
  version: 1,
  representativePoint: point,
  hasCurrentBoundary: false,
  boundary: null,
  activeSeason: null,
  regionContext: {
    administrativeLocation: { state: "UNRESOLVED", code: null, label: null, sourceId: null, confidence: null, dataVersion: null, resolvedAt: null },
    agriculturalRegion: { state: "UNRESOLVED", code: null, label: null, sourceId: null, confidence: null, dataVersion: null, resolvedAt: null },
    agriculturalRegionOverride: null,
  },
};
const polygon = { type: "Polygon" as const, coordinates: [[[29, 41], [29.01, 41], [29.01, 41.01], [29, 41]]] };
const headers = { authorization: "Bearer valid", "idempotency-key": "create-key" };

async function setup(overrides: Partial<Parameters<typeof createFieldCreateApp>[0]> = {}) {
  const app = await createFieldCreateApp({
    verify: async (token) => token === "valid" ? identity : null,
    createField: async () => ({ kind: "created", field }),
    ...overrides,
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

test("Field create requires an idempotency key and validates Point or Polygon commands before persistence", async () => {
  let writes = 0;
  const app = await setup({ createField: async () => { writes++; return { kind: "created", field }; } });
  try {
    for (const key of [undefined, "", "x".repeat(201)]) {
      const response = await app.inject({
        method: "POST", url: "/v1/fields",
        headers: { authorization: "Bearer valid", ...(key === undefined ? {} : { "idempotency-key": key }) },
        payload: { location: { type: "POINT", point } },
      });
      assert.equal(response.statusCode, 400);
      assert.equal(response.json().error.code, "INVALID_REQUEST");
    }
    for (const payload of [
      {},
      { name: "North", businessId: "forged", location: { type: "POINT", point } },
      { location: { type: "POINT", point: { ...point, coordinates: [200, 91] } } },
      { location: { type: "POLYGON", polygon: { type: "MultiPolygon", coordinates: [] } } },
      { name: 7, location: { type: "POINT", point } },
    ]) {
      const response = await app.inject({ method: "POST", url: "/v1/fields", headers, payload });
      assert.equal(response.statusCode, 400);
      assert.equal(response.json().error.code, "INVALID_REQUEST");
    }
    assert.equal(writes, 0);
  } finally { await app.close(); }
});

test("Field create derives authority from verified identity and returns a versioned Point result", async () => {
  const calls: unknown[] = [];
  const app = await setup({ createField: async (...args) => { calls.push(args); return { kind: "created", field }; } });
  try {
    const response = await app.inject({ method: "POST", url: "/v1/fields?businessId=forged", headers, payload: { name: "  North  ", location: { type: "POINT", point } } });
    assert.equal(response.statusCode, 201);
    assert.deepEqual(response.json(), field);
    assert.equal(response.headers.etag, '"1"');
    assert.deepEqual(calls, [[identity, { name: "  North  ", location: { type: "POINT", point } }, "create-key"]]);
  } finally { await app.close(); }
});

test("Field create returns server-derived representative points for submitted Polygon boundaries", async () => {
  const polygonField = { ...field, representativePoint: point, hasCurrentBoundary: true, boundary: polygon };
  const app = await setup({ createField: async () => ({ kind: "created", field: polygonField }) });
  try {
    const response = await app.inject({ method: "POST", url: "/v1/fields", headers, payload: { location: { type: "POLYGON", polygon } } });
    assert.equal(response.statusCode, 201);
    assert.equal(response.json().hasCurrentBoundary, true);
    assert.deepEqual(response.json().boundary, polygon);
    assert.deepEqual(response.json().representativePoint, point);
  } finally { await app.close(); }
});

test("Field create replays the canonical result with 200 and returns conflicts for changed command context", async () => {
  for (const kind of ["replayed"] as const) {
    const app = await setup({ createField: async () => ({ kind, field }) });
    try {
      const response = await app.inject({ method: "POST", url: "/v1/fields", headers, payload: { location: { type: "POINT", point } } });
      assert.equal(response.statusCode, 200);
      assert.deepEqual(response.json(), field);
      assert.equal(response.headers.etag, '"1"');
    } finally { await app.close(); }
  }
  const app = await setup({ createField: async () => { throw new FieldCommandError(409, "IDEMPOTENCY_KEY_REUSED"); } });
  try {
    const response = await app.inject({ method: "POST", url: "/v1/fields", headers, payload: { location: { type: "POINT", point } } });
    assert.equal(response.statusCode, 409);
    assert.equal(response.json().error.code, "IDEMPOTENCY_KEY_REUSED");
    assert.ok(response.json().error.requestId);
  } finally { await app.close(); }
});

test("Field create authorization failures use privacy-safe ApiError responses and never call persistence", async () => {
  let writes = 0;
  const app = await setup({ createField: async () => { writes++; return { kind: "created", field }; } });
  try {
    for (const authorization of [undefined, "Basic secret", "Bearer rejected"]) {
      const response = await app.inject({ method: "POST", url: "/v1/fields", headers: { "idempotency-key": "key", ...(authorization ? { authorization } : {}) }, payload: { location: { type: "POINT", point } } });
      assert.equal(response.statusCode, 401);
      assert.equal(response.json().error.code, "UNAUTHORIZED");
      assert.ok(response.json().error.requestId);
    }
  } finally { await app.close(); }
  assert.equal(writes, 0);
  for (const failure of [new NotFoundException("private field/business detail"), new BusinessScopeForbiddenError()]) {
    const denied = await setup({ createField: async () => { throw failure; } });
    try {
      const response = await denied.inject({ method: "POST", url: "/v1/fields", headers, payload: { location: { type: "POINT", point } } });
      assert.equal(response.statusCode, failure instanceof NotFoundException ? 404 : 403);
      assert.equal(response.json().error.code, failure instanceof NotFoundException ? "NOT_FOUND" : "FORBIDDEN");
      assert.doesNotMatch(response.body, /private|business|membership/i);
    } finally { await denied.close(); }
  }
});
