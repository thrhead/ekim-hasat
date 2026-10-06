import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalizeObservationDescription,
  createFieldObservation,
  type FieldObservation,
} from "../../src/observations/field-observation.ts";

const input: FieldObservation = {
  id: "60000000-0000-4000-8000-000000000001",
  businessId: "60000000-0000-4000-8000-000000000002",
  fieldId: "60000000-0000-4000-8000-000000000003",
  seasonId: "60000000-0000-4000-8000-000000000004",
  actorUserId: "60000000-0000-4000-8000-000000000005",
  actorMembershipId: "60000000-0000-4000-8000-000000000006",
  description: "Yapraklarda sararma var.",
  occurredAt: "2026-10-04T08:30:00.000Z",
  acceptedAt: "2026-10-05T09:00:00.000Z",
};

test("preserves the supplied stable UUID and original field/season association", () => {
  const observation = createFieldObservation(input);
  assert.equal(observation.id, "60000000-0000-4000-8000-000000000001");
  assert.equal(observation.fieldId, "60000000-0000-4000-8000-000000000003");
  assert.equal(observation.seasonId, "60000000-0000-4000-8000-000000000004");
  assert.deepEqual(createFieldObservation(input), observation);
  assert.equal(createFieldObservation({ ...input, seasonId: null }).seasonId, null);
});

test("rejects malformed observation UUID identity rather than replacing it", () => {
  for (const id of ["", "observation-1", "60000000-0000-0000-0000-000000000001"]) {
    assert.throws(() => createFieldObservation({ ...input, id }), TypeError);
  }
});

test("trims leading and trailing Unicode whitespace before validating the note", () => {
  const padding = "\t\r\n \u0085\u00a0\u1680\u2003\u2028\u2029\u202f\u205f\u3000\ufeff";
  assert.equal(canonicalizeObservationDescription(`${padding}🌱${padding}`), "🌱");
  assert.equal(createFieldObservation({ ...input, description: `${padding}Not${padding}` }).description, "Not");
});

test("rejects empty and Unicode-whitespace-only descriptions", () => {
  for (const description of ["", " \t\n", "\u0085\u00a0\u2003\u2028\u3000\ufeff"]) {
    assert.throws(() => canonicalizeObservationDescription(description), TypeError);
    assert.throws(() => createFieldObservation({ ...input, description }), TypeError);
  }
});

test("accepts one code point and exactly 2000 code points including supplementary characters", () => {
  assert.equal(canonicalizeObservationDescription("🌱"), "🌱");
  const description = "🌱".repeat(2000);
  assert.equal(canonicalizeObservationDescription(` ${description} `), description);
  assert.equal(createFieldObservation({ ...input, description }).description, description);
});

test("rejects 2001 Unicode code points for both BMP and supplementary content", () => {
  for (const description of ["a".repeat(2001), "🌱".repeat(2001), `${"a".repeat(2000)}🌱`]) {
    assert.throws(() => canonicalizeObservationDescription(description), TypeError);
  }
});

test("preserves internal whitespace, line breaks, and unnormalized Unicode content", () => {
  const description = "I\u0307  yaprak\t\u0085\u00a0\n🌱\u200b";
  assert.equal(canonicalizeObservationDescription(`\u3000${description}\u3000`), description);
  assert.equal(createFieldObservation({ ...input, description }).description, description);
});

test("counts decomposed combining marks as separate code points without normalization", () => {
  assert.equal(canonicalizeObservationDescription("e\u0301".repeat(1000)), "e\u0301".repeat(1000));
  assert.throws(() => canonicalizeObservationDescription("e\u0301".repeat(1001)), TypeError);
});

test("rejects non-text descriptions at the runtime boundary", () => {
  assert.throws(() => canonicalizeObservationDescription(null as unknown as string), TypeError);
  assert.throws(() => canonicalizeObservationDescription(42 as unknown as string), TypeError);
});

test("returns an immutable value detached from later input edits", () => {
  const mutableInput = { ...input };
  const observation = createFieldObservation(mutableInput);
  mutableInput.description = "Sonraki not";
  mutableInput.fieldId = "60000000-0000-4000-8000-000000000099";
  assert.equal(observation.description, "Yapraklarda sararma var.");
  assert.equal(observation.fieldId, "60000000-0000-4000-8000-000000000003");
  assert.equal(Object.isFrozen(observation), true);
  assert.throws(() => Object.assign(observation, { description: "Değiştir" }), TypeError);
});

test("preserves occurrence time separately from server acceptance time as UTC absolute instants", () => {
  const observation = createFieldObservation({ ...input, occurredAt: "2026-10-04T11:30:00+03:00" });
  assert.equal(observation.occurredAt, "2026-10-04T08:30:00.000Z");
  assert.equal(observation.acceptedAt, "2026-10-05T09:00:00.000Z");
  assert.notEqual(observation.occurredAt, observation.acceptedAt);
});

test("requires valid absolute instants for occurrence and acceptance", () => {
  for (const timestamp of ["", "2026-10-04", "2026-10-04T08:30:00", "not-a-date", "2026-02-30T08:30:00Z"]) {
    assert.throws(() => createFieldObservation({ ...input, occurredAt: timestamp }), TypeError);
    assert.throws(() => createFieldObservation({ ...input, acceptedAt: timestamp }), TypeError);
  }
});
