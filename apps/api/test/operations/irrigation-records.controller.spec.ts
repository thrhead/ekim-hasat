import assert from "node:assert/strict";
import test from "node:test";
import { createIrrigationRecordsApp } from "../../src/operations/irrigation-records.module.js";

const identity = { provider: "supabase", subject: "farmer" };
const fieldId = "11111111-1111-4111-8111-111111111111";
const record = {
  id: "22222222-2222-4222-8222-222222222222", fieldId, seasonId: null,
  occurredAt: "2026-10-05T09:00:00.000Z", businessTimezone: "Europe/Istanbul",
  method: "Damla sulama", durationMinutes: 30, waterVolumeCubicMetres: null,
  note: null, recordedAt: "2026-10-05T10:00:00.000Z",
};
const request = {
  irrigationRecordId: record.id, occurredAtLocal: "2026-10-05T12:00",
  occurredAt: record.occurredAt, capturedBusinessTimezone: "Europe/Istanbul",
  method: record.method, durationMinutes: 30,
};

test("irrigation create route authenticates, delegates the command, and returns accepted and replay statuses", async () => {
  const calls: unknown[] = [];
  let next: "accepted" | "replayed" = "accepted";
  const app = await createIrrigationRecordsApp({
    verify: async (token) => token === "valid" ? identity : null,
    create: async (...args) => { calls.push(args); return { kind: next, record }; },
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  try {
    const first = await app.inject({ method: "POST", url: `/v1/fields/${fieldId}/irrigation-records`, headers: { authorization: "Bearer valid" }, payload: request });
    assert.equal(first.statusCode, 201);
    assert.deepEqual(first.json(), record);
    assert.deepEqual(calls, [[identity, fieldId, request]]);

    next = "replayed";
    const replay = await app.inject({ method: "POST", url: `/v1/fields/${fieldId}/irrigation-records`, headers: { authorization: "Bearer valid" }, payload: request });
    assert.equal(replay.statusCode, 200);
    assert.deepEqual(replay.json(), record);
  } finally { await app.close(); }
});

test("irrigation create route rejects missing authentication and malformed bodies before repository access", async () => {
  let writes = 0;
  const app = await createIrrigationRecordsApp({
    verify: async (token) => token === "valid" ? identity : null,
    create: async () => { writes++; return { kind: "accepted", record }; },
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  try {
    const unauthorized = await app.inject({ method: "POST", url: `/v1/fields/${fieldId}/irrigation-records`, payload: request });
    assert.equal(unauthorized.statusCode, 401);
    assert.equal(unauthorized.json().error.code, "UNAUTHORIZED");

    for (const payload of [
      {},
      { ...request, durationMinutes: 0 },
      { ...request, waterVolumeCubicMetres: "0" },
      { ...request, waterVolumeCubicMetres: "100000000000.0" },
      { ...request, unknown: true },
    ]) {
      const response = await app.inject({ method: "POST", url: `/v1/fields/${fieldId}/irrigation-records`, headers: { authorization: "Bearer valid" }, payload });
      assert.equal(response.statusCode, 400);
      assert.equal(response.json().error.code, "INVALID_REQUEST");
    }
    assert.equal(writes, 0);
  } finally { await app.close(); }
});
