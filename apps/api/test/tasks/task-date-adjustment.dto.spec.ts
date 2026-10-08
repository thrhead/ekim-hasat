import assert from "node:assert/strict";
import test from "node:test";
import {
  parseTaskDateAdjustmentRequest,
  parseTaskDateAdjustmentHistoryQuery,
  parseTaskDateAdjustmentVersion,
} from "../../src/tasks/task-date-adjustment.dto.js";
import { TaskDateAdjustmentError } from "../../src/tasks/task-date-adjustment.error.js";

test("strictly parses UUID command, positive If-Match, and bounded history filters", () => {
  const adjustmentId = "11111111-1111-4111-8111-111111111111";
  assert.deepEqual(parseTaskDateAdjustmentRequest({ adjustmentId, newPlannedLocalDate: "2026-10-10" }), {
    adjustmentId, newPlannedLocalDate: "2026-10-10",
  });
  assert.equal(parseTaskDateAdjustmentVersion('"12"'), 12);
  assert.deepEqual(parseTaskDateAdjustmentHistoryQuery({ limit: "10", cursor: "opaque" }), { limit: 10, cursor: "opaque" });
});

test("rejects extra authority, malformed identity/date/version, and invalid history bounds", () => {
  const valid = { adjustmentId: "11111111-1111-4111-8111-111111111111", newPlannedLocalDate: "2026-10-10" };
  for (const value of [{ ...valid, businessId: "22222222-2222-4222-8222-222222222222" }, { ...valid, newPlannedLocalDate: "2026-02-30" }, { ...valid, adjustmentId: "not-a-uuid" }]) {
    assert.throws(() => parseTaskDateAdjustmentRequest(value), (error: unknown) => error instanceof TaskDateAdjustmentError && error.presentation.code === "INVALID_REQUEST");
  }
  for (const value of [undefined, "0", "1.5", 'W/"2"', "9007199254740992"]) {
    assert.throws(() => parseTaskDateAdjustmentVersion(value), TaskDateAdjustmentError);
  }
  for (const value of [{ limit: "101" }, { cursor: "" }, { unexpected: "value" }]) {
    assert.throws(() => parseTaskDateAdjustmentHistoryQuery(value), TaskDateAdjustmentError);
  }
});
