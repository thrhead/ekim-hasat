import assert from "node:assert/strict";
import test from "node:test";
import { NotFoundException } from "@nestjs/common";
import { createFieldsReadApp } from "../../src/fields/fields-read.controller.js";
import { BusinessScopeForbiddenError } from "../../src/authorization/membership-scope.service.js";

const fieldId = "00000000-0000-4000-8000-000000000001";
const cursor = Buffer.from(JSON.stringify({ v: 1, businessId: "00000000-0000-4000-8000-000000000003", name: "Bahçe", id: fieldId })).toString("base64url");
const identity = { provider: "supabase", subject: "farmer" };
const item = {
  id: fieldId,
  name: "Bahçe",
  version: 1,
  representativePoint: { type: "Point", coordinates: [29.02, 41.01] },
  hasCurrentBoundary: false,
};
const unresolved = {
  state: "UNRESOLVED",
  code: null,
  label: null,
  sourceId: null,
  confidence: null,
  dataVersion: null,
  resolvedAt: null,
};

async function setup(overrides: Partial<Parameters<typeof createFieldsReadApp>[0]> = {}) {
  const app = await createFieldsReadApp({
    verify: async (token) => token === "valid-token" ? identity : null,
    readPage: async () => ({ items: [], nextCursor: null }),
    readField: async () => ({
      ...item,
      regionContext: {
        administrativeLocation: unresolved,
        agriculturalRegion: unresolved,
        agriculturalRegionOverride: null,
      },
      boundary: null,
      activeSeason: null,
    }),
    ...overrides,
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

test("list uses default and maximum page sizes and returns the FieldPage contract", async () => {
  const seen: Array<{ limit: number; cursor?: string }> = [];
  const app = await setup({ readPage: async (_identity, query) => {
    seen.push(query);
    return { items: [item], nextCursor: "opaque-next" };
  } });
  try {
    const defaultPage = await app.inject({ method: "GET", url: "/v1/fields", headers: { authorization: "Bearer valid-token" } });
    const maxPage = await app.inject({ method: "GET", url: "/v1/fields?limit=100", headers: { authorization: "Bearer valid-token" } });
    assert.equal(defaultPage.statusCode, 200);
    assert.deepEqual(defaultPage.json(), { items: [item], nextCursor: "opaque-next" });
    assert.deepEqual(maxPage.json(), { items: [item], nextCursor: "opaque-next" });
    assert.deepEqual(seen, [{ limit: 50 }, { limit: 100 }]);
    assert.deepEqual(Object.keys(defaultPage.json()).sort(), ["items", "nextCursor"]);
  } finally { await app.close(); }
});

test("list continues with an opaque cursor and rejects malformed cursors and page sizes", async () => {
  const seen: Array<{ limit: number; cursor?: string }> = [];
  const app = await setup({ readPage: async (_identity, query) => {
    seen.push(query);
    return { items: [item], nextCursor: null };
  } });
  try {
    const next = await app.inject({ method: "GET", url: `/v1/fields?limit=7&cursor=${cursor}`, headers: { authorization: "Bearer valid-token" } });
    assert.equal(next.statusCode, 200);
    assert.deepEqual(seen, [{ limit: 7, cursor }]);
    for (const url of ["/v1/fields?limit=0", "/v1/fields?limit=101", "/v1/fields?limit=not-a-number", "/v1/fields?cursor=%%%not-an-opaque-cursor%%%"]) {
      const response = await app.inject({ method: "GET", url, headers: { authorization: "Bearer valid-token" } });
      assert.equal(response.statusCode, 400);
      assert.equal(response.json().error.code, "INVALID_REQUEST");
      assert.equal(Object.keys(response.json()).join(","), "error");
    }
  } finally { await app.close(); }
});

test("client-supplied Business scope is ignored and authorization remains privacy safe", async () => {
  const seen: unknown[] = [];
  const app = await setup({ readPage: async (...args) => { seen.push(args); return { items: [], nextCursor: null }; } });
  try {
    const authorized = await app.inject({ method: "GET", url: "/v1/fields?businessId=forged", headers: { authorization: "Bearer valid-token" } });
    assert.equal(authorized.statusCode, 200);
    assert.deepEqual(seen, [[identity, { limit: 50 }]]);

    for (const [failure, status, code] of [
      [new NotFoundException("private Business exists"), 404, "NOT_FOUND"],
      [new BusinessScopeForbiddenError(), 403, "FORBIDDEN"],
    ] as const) {
      const denied = await setup({ readPage: async () => { throw failure; } });
      try {
        const response = await denied.inject({ method: "GET", url: "/v1/fields", headers: { authorization: "Bearer valid-token" } });
        assert.equal(response.statusCode, status);
        assert.equal(response.json().error.code, code);
        assert.doesNotMatch(response.body, /private|membership|business exists/i);
      } finally { await denied.close(); }
    }
  } finally { await app.close(); }
});

test("detail projects a null legacy region context as unresolved and ACTIVE season as read only", async () => {
  const app = await setup({ readField: async () => ({
    ...item,
    regionContext: {
      administrativeLocation: unresolved,
      agriculturalRegion: unresolved,
      agriculturalRegionOverride: null,
    },
    boundary: null,
    activeSeason: { id: "season-1", status: "ACTIVE", cropLabel: "Arpa", plantingDate: "2026-09-01" },
  }) });
  try {
    const response = await app.inject({ method: "GET", url: `/v1/fields/${fieldId}`, headers: { authorization: "Bearer valid-token" } });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json().regionContext.administrativeLocation, unresolved);
    assert.deepEqual(response.json().regionContext.agriculturalRegion, unresolved);
    assert.equal(response.json().activeSeason.status, "ACTIVE");
    assert.deepEqual(Object.keys(response.json()).sort(), ["activeSeason", "boundary", "hasCurrentBoundary", "id", "name", "regionContext", "representativePoint", "version"].sort());
  } finally { await app.close(); }
});

test("authentication is required and detail access failures share safe error responses", async () => {
  let reads = 0;
  const app = await setup({ readField: async () => { reads++; return null; } });
  try {
    const unauthenticated = await app.inject({ method: "GET", url: "/v1/fields", headers: {} });
    assert.equal(unauthenticated.statusCode, 401);
    assert.equal(unauthenticated.json().error.code, "UNAUTHORIZED");
    const absent = await app.inject({ method: "GET", url: `/v1/fields/${fieldId}`, headers: { authorization: "Bearer valid-token" } });
    assert.equal(absent.statusCode, 404);
    assert.equal(absent.json().error.code, "NOT_FOUND");
    assert.equal(reads, 1);
  } finally { await app.close(); }
});
