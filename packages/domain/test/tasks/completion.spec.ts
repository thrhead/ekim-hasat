import assert from "node:assert/strict";
import test from "node:test";
import {
  createCompletionCommand,
  transitionCompletionCommand,
  type CompletionCommand,
  type PlannedTaskSnapshot,
} from "../../src/tasks/completion.js";

const plannedTask: PlannedTaskSnapshot = {
  id: "11111111-1111-4111-8111-111111111111",
  seasonPlanId: "22222222-2222-4222-8222-222222222222",
  title: "Tarlayı kontrol et",
  plannedLocalDate: "2026-09-28",
  version: 3,
};

const command = (): CompletionCommand => createCompletionCommand({
  completionId: "33333333-3333-4333-8333-333333333333",
  task: plannedTask,
  occurredAt: "2026-09-29T07:45:00.000Z",
  baseTaskVersion: 3,
});

test("completion command validates identity, base version, and absolute occurrence time", () => {
  const valid = command();
  assert.equal(valid.state, "PENDING");
  assert.equal(valid.baseTaskVersion, plannedTask.version);
  assert.equal(valid.occurredAt, "2026-09-29T07:45:00.000Z");
  assert.throws(() => createCompletionCommand({ ...valid, completionId: "not-a-uuid" }));
  assert.throws(() => createCompletionCommand({ ...valid, baseTaskVersion: 0 }));
  assert.throws(() => createCompletionCommand({ ...valid, occurredAt: "2026-09-29 07:45" }));
  assert.throws(() => createCompletionCommand({ ...valid, occurredAt: "2026-02-31T07:45:00.000Z" }));
  assert.throws(() => createCompletionCommand({ ...valid, task: { ...plannedTask, plannedLocalDate: "2026-02-31" } }));
});

test("completion retains planned intent and separates occurrence from server recording time", () => {
  const valid = command();
  const original = structuredClone(plannedTask);
  assert.deepEqual(valid.task, original);
  assert.equal(valid.occurredAt, "2026-09-29T07:45:00.000Z");
  assert.equal("recordedAt" in valid, false);
  assert.deepEqual(plannedTask, original);
});

test("local command can settle only from pending to accepted or conflicted", () => {
  const valid = command();
  assert.equal(transitionCompletionCommand(valid, "ACCEPTED").state, "ACCEPTED");
  assert.equal(transitionCompletionCommand(valid, "CONFLICTED").state, "CONFLICTED");
  assert.throws(() => transitionCompletionCommand({ ...valid, state: "ACCEPTED" }, "CONFLICTED"));
  assert.throws(() => transitionCompletionCommand({ ...valid, state: "CONFLICTED" }, "ACCEPTED"));
});

test("a stale task version and a second completion identity cannot overwrite the captured intent", () => {
  const valid = command();
  assert.throws(() => createCompletionCommand({ ...valid, baseTaskVersion: valid.baseTaskVersion - 1 }), /match/);
  assert.throws(() => transitionCompletionCommand(transitionCompletionCommand(valid, "CONFLICTED"), "ACCEPTED"));
  assert.equal(valid.completionId, "33333333-3333-4333-8333-333333333333");
  assert.deepEqual(valid.task, plannedTask);
  assert.equal(valid.occurredAt, "2026-09-29T07:45:00.000Z");
});
