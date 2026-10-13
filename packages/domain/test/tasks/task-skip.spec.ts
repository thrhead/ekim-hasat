import assert from "node:assert/strict";
import test from "node:test";
import {
  TaskSkipError,
  validateTaskSkip,
} from "../../src/tasks/task-skip.ts";

const eligibleTask = {
  seasonStatus: "ACTIVE" as const,
  planStatus: "APPROVED" as const,
  hasActivationSnapshot: true,
  completed: false,
  skipped: false,
  plannedLocalDate: "2026-10-10",
  currentTaskVersion: 4,
  expectedTaskVersion: 4,
};

test("accepts Skip for an unfinished task in an active approved season and advances its terminal version", () => {
  assert.deepEqual(validateTaskSkip(eligibleTask), {
    kind: "TASK_SKIPPED",
    plannedLocalDateSnapshot: "2026-10-10",
    baseTaskVersion: 4,
    acceptedTaskVersion: 5,
  });
});

test("rejects completion and a prior Skip with their distinct terminal errors", () => {
  assert.throws(() => validateTaskSkip({ ...eligibleTask, completed: true }), {
    name: "TaskSkipError",
    code: "TASK_ALREADY_COMPLETED",
  } satisfies Partial<TaskSkipError>);
  assert.throws(() => validateTaskSkip({ ...eligibleTask, skipped: true }), {
    name: "TaskSkipError",
    code: "TASK_ALREADY_SKIPPED",
  } satisfies Partial<TaskSkipError>);
});

test("requires the activation snapshot for an otherwise eligible active plan", () => {
  assert.throws(() => validateTaskSkip({ ...eligibleTask, hasActivationSnapshot: false }), {
    name: "TaskSkipError",
    code: "TASK_NOT_ACTIONABLE",
  } satisfies Partial<TaskSkipError>);
});

test("requires an approved plan and active season", () => {
  for (const input of [
    { ...eligibleTask, planStatus: "DRAFT" as const },
    { ...eligibleTask, seasonStatus: "DRAFT" as const },
  ]) {
    assert.throws(() => validateTaskSkip(input), {
      name: "TaskSkipError",
      code: "TASK_NOT_ACTIONABLE",
    } satisfies Partial<TaskSkipError>);
  }
});

test("rejects a stale expected task version without accepting Skip", () => {
  assert.throws(() => validateTaskSkip({ ...eligibleTask, currentTaskVersion: 5 }), {
    name: "TaskSkipError",
    code: "TASK_VERSION_CONFLICT",
  } satisfies Partial<TaskSkipError>);
});
