import assert from "node:assert/strict";
import test from "node:test";
import { createIrrigationRecord } from "../../src/operations/irrigation-record.ts";

const validInput = {
  id: "60000000-0000-4000-8000-000000000001",
  businessId: "60000000-0000-4000-8000-000000000002",
  fieldId: "60000000-0000-4000-8000-000000000003",
  seasonId: "60000000-0000-4000-8000-000000000004",
  actorUserId: "60000000-0000-4000-8000-000000000005",
  actorMembershipId: "60000000-0000-4000-8000-000000000006",
  occurredAt: "2026-10-04T11:30:00+03:00",
  recordedAt: "2026-10-05T09:00:00.000Z",
};

test("canonicalizes accepted irrigation timestamps to immutable UTC records", () => {
  const record = createIrrigationRecord(validInput);

  assert.equal(record.occurredAt, "2026-10-04T08:30:00.000Z");
  assert.equal(record.recordedAt, "2026-10-05T09:00:00.000Z");
  assert.equal(record.seasonId, "60000000-0000-4000-8000-000000000004");
  assert.equal(record.method, null);
  assert.equal(record.durationMinutes, null);
  assert.equal(record.waterVolumeCubicMetres, null);
  assert.equal(record.note, null);
  assert.equal(Object.isFrozen(record), true);
});

test("requires UUID identities for the record and its supplied context", () => {
  for (const field of ["id", "businessId", "fieldId", "actorUserId", "actorMembershipId", "seasonId"] as const) {
    assert.throws(() => createIrrigationRecord({ ...validInput, [field]: "not-a-uuid" }), TypeError, field);
  }
  assert.equal(createIrrigationRecord({ ...validInput, seasonId: null }).seasonId, null);
});

test("accepts optional method text up to 120 characters", () => {
  const method = "a".repeat(120);
  assert.equal(createIrrigationRecord({ ...validInput, method }).method, method);
  assert.throws(() => createIrrigationRecord({ ...validInput, method: `${method}a` }), TypeError);
});

test("accepts only positive whole-minute durations", () => {
  assert.equal(createIrrigationRecord({ ...validInput, durationMinutes: 1 }).durationMinutes, 1);
  for (const durationMinutes of [0, -1, 1.5, Number.NaN]) {
    assert.throws(() => createIrrigationRecord({ ...validInput, durationMinutes }), TypeError);
  }
});

test("accepts positive cubic-metre volumes with at most one decimal place", () => {
  for (const waterVolumeCubicMetres of ["0.1", "2", "3.0"]) {
    assert.equal(createIrrigationRecord({ ...validInput, waterVolumeCubicMetres }).waterVolumeCubicMetres, waterVolumeCubicMetres);
  }
  for (const waterVolumeCubicMetres of ["0", "0.0", "-0.1", "1.23", "1.", "not-a-number", "100000000000.0"]) {
    assert.throws(() => createIrrigationRecord({ ...validInput, waterVolumeCubicMetres }), TypeError);
  }
});

test("trims optional notes and enforces a 2000-character limit", () => {
  assert.equal(createIrrigationRecord({ ...validInput, note: " \t Sulama tamamlandı. \n" }).note, "Sulama tamamlandı.");
  assert.equal(createIrrigationRecord({ ...validInput, note: "🌱".repeat(2000) }).note, "🌱".repeat(2000));
  assert.throws(() => createIrrigationRecord({ ...validInput, note: "🌱".repeat(2001) }), TypeError);
  assert.equal(createIrrigationRecord({ ...validInput, note: " \t\n " }).note, null);
});
