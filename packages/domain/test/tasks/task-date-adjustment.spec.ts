import assert from "node:assert/strict";
import test from "node:test";
import {
  TaskDateAdjustmentError,
  validateTaskDateAdjustment,
} from "../../src/tasks/task-date-adjustment.ts";

const base = {
  seasonStatus: "ACTIVE" as const,
  planStatus: "APPROVED" as const,
  completed: false,
  currentPlannedLocalDate: "2026-10-10",
  actualPlantingDate: "2026-09-28",
  currentTaskVersion: 4,
  expectedTaskVersion: 4,
  newPlannedLocalDate: "2026-10-12",
};

test("accepts a changed valid date for an unfinished task in an approved ACTIVE plan", () => {
  assert.deepEqual(validateTaskDateAdjustment(base), {
    previousPlannedLocalDate: "2026-10-10",
    newPlannedLocalDate: "2026-10-12",
    baseTaskVersion: 4,
    acceptedTaskVersion: 5,
  });
});

test("rejects completed, inactive, or unapproved tasks before mutation", () => {
  for (const input of [
    { ...base, completed: true },
    { ...base, seasonStatus: "DRAFT" as const },
    { ...base, planStatus: "DRAFT" as const },
  ]) {
    assert.throws(() => validateTaskDateAdjustment(input), TaskDateAdjustmentError);
  }
});

test("rejects a changed date before actual planting", () => {
  assert.throws(() => validateTaskDateAdjustment({ ...base, newPlannedLocalDate: "2026-09-27" }), {
    name: "LocalDateValidationError",
    code: "PLANNED_DATE_BEFORE_PLANTING",
  });
});

test("reports a stale version before same-date validation", () => {
  assert.throws(() => validateTaskDateAdjustment({
    ...base,
    currentTaskVersion: 5,
    newPlannedLocalDate: base.currentPlannedLocalDate,
  }), { name: "TaskDateAdjustmentError", code: "TASK_VERSION_CONFLICT" });
});

test("returns NO_DATE_CHANGE only after a matching version and eligible state", () => {
  assert.throws(() => validateTaskDateAdjustment({ ...base, newPlannedLocalDate: base.currentPlannedLocalDate }), {
    name: "TaskDateAdjustmentError",
    code: "NO_DATE_CHANGE",
  });
  assert.throws(() => validateTaskDateAdjustment({ ...base, completed: true, newPlannedLocalDate: base.currentPlannedLocalDate }), {
    name: "TaskDateAdjustmentError",
    code: "TASK_ALREADY_COMPLETED",
  });
});
