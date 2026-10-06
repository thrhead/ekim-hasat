import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "../../src/observability/api-error.filter.js";
import { createObservationApp } from "../../src/observations/observation.controller.js";
import { decodeDiaryCursor, encodeDiaryCursor } from "../../src/observations/diary-query.js";

type ObservationDependencies = Parameters<typeof createObservationApp>[0];

const fieldId = "11111111-1111-4111-8111-111111111111";
const observationId = "22222222-2222-4222-8222-222222222222";
const request = {
  observationId,
  description: "Checked the north row",
  occurredAtLocal: "2026-01-15T12:30",
  occurredAt: "2026-01-15T09:30:00Z",
};
const observation = { id: observationId, fieldId, seasonId: null, description: request.description, occurredAt: request.occurredAt, businessTimezone: "Europe/Istanbul" };

async function appWith(create: ObservationDependencies["create"], readDiary?: ObservationDependencies["readDiary"]) {
  return createObservationApp({
    verify: async (token: string) => token === "valid" ? { provider: "test", subject: "farmer" } : null,
    create,
    readDiary: readDiary ?? (async () => ({ items: [], businessTimezone: "Europe/Istanbul", nextCursor: null })),
  });
}

test("create route preserves shared coded errors and returns 201 for insert, 200 for exact replay", async () => {
  let next: "accepted" | "replayed" = "accepted";
  const app = await appWith(async () => ({ kind: next, observation }));
  await app.init(); await app.getHttpAdapter().getInstance().ready();
  try {
    for (const [kind, status] of [["accepted", 201], ["replayed", 200]] as const) {
      next = kind;
      const response = await app.inject({ method: "POST", url: `/v1/fields/${fieldId}/observations`, headers: { authorization: "Bearer valid" }, payload: request });
      assert.equal(response.statusCode, status);
      assert.deepEqual(response.json(), observation);
    }
    for (const changed in { payload: true, actor: true, context: true }) {
      const conflict = await appWith(async () => { throw new ApiError(409, "IDEMPOTENCY_KEY_REUSED", `conflict ${changed}`); });
      await conflict.init(); await conflict.getHttpAdapter().getInstance().ready();
      try {
        const response = await conflict.inject({ method: "POST", url: `/v1/fields/${fieldId}/observations`, headers: { authorization: "Bearer valid" }, payload: request });
        assert.equal(response.statusCode, 409);
        assert.equal(response.json().error.code, "IDEMPOTENCY_KEY_REUSED");
        assert.equal(typeof response.json().error.requestId, "string");
      } finally { await conflict.close(); }
    }
  } finally { await app.close(); }
});

test("create route keeps missing/cross-scope privacy and generic unexpected failures safe", async () => {
  const app = await appWith(async () => { throw new ApiError(404, "NOT_FOUND", "The requested item is not available"); });
  await app.init(); await app.getHttpAdapter().getInstance().ready();
  try {
    const missing = await app.inject({ method: "POST", url: `/v1/fields/${fieldId}/observations`, headers: { authorization: "Bearer valid" }, payload: request });
    assert.equal(missing.statusCode, 404);
    assert.equal(missing.json().error.message, "The requested item is not available");
  } finally { await app.close(); }

  const failed = await appWith(async () => { throw new Error("database secret"); });
  await failed.init(); await failed.getHttpAdapter().getInstance().ready();
  try {
    const response = await failed.inject({ method: "POST", url: `/v1/fields/${fieldId}/observations`, headers: { authorization: "Bearer valid" }, payload: request });
    assert.equal(response.statusCode, 500);
    assert.deepEqual(response.json().error.code, "UNEXPECTED");
    assert.equal(response.json().error.message, "Something went wrong");
    assert.doesNotMatch(JSON.stringify(response.json()), /database secret/);
  } finally { await failed.close(); }
});

test("create and diary authentication and validation failures use shared structured codes", async () => {
  const app = await appWith(async () => ({ kind: "accepted", observation }));
  await app.init(); await app.getHttpAdapter().getInstance().ready();
  try {
    const unauthorized = await app.inject({ method: "POST", url: `/v1/fields/${fieldId}/observations`, payload: request });
    assert.equal(unauthorized.statusCode, 401);
    assert.equal(unauthorized.json().error.code, "UNAUTHORIZED");
    const forged = await app.inject({ method: "POST", url: `/v1/fields/${fieldId}/observations`, headers: { authorization: "Bearer valid" }, payload: { ...request, businessId: "ignored-authority" } });
    assert.equal(forged.statusCode, 400);
    assert.equal(forged.json().error.code, "INVALID_REQUEST");
    const invalidLimit = await app.inject({ method: "GET", url: `/v1/fields/${fieldId}/diary?limit=101`, headers: { authorization: "Bearer valid" } });
    assert.equal(invalidLimit.statusCode, 400);
    assert.equal(invalidLimit.json().error.code, "INVALID_REQUEST");
  } finally { await app.close(); }
});

test("diary route presents malformed cursor decoding as structured 400 INVALID_REQUEST", async () => {
  const canonical = encodeDiaryCursor({ version: 1, fieldId, seasonId: null, occurredAt: request.occurredAt,
    kind: "OBSERVATION", id: observationId });
  const malformed = `${canonical}!!!!`;
  const app = await appWith(async () => ({ kind: "accepted", observation }), async (_identity, requestedFieldId, filters) => {
    decodeDiaryCursor(filters.cursor, requestedFieldId, filters.seasonId ?? null);
    return { items: [], businessTimezone: "Europe/Istanbul", nextCursor: null };
  });
  await app.init(); await app.getHttpAdapter().getInstance().ready();
  try {
    const response = await app.inject({ method: "GET", url: `/v1/fields/${fieldId}/diary?cursor=${malformed}`, headers: { authorization: "Bearer valid" } });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error.code, "INVALID_REQUEST");
    assert.equal(typeof response.json().error.requestId, "string");
  } finally { await app.close(); }
});
