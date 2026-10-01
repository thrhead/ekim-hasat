import assert from "node:assert/strict";
import test from "node:test";
import { addPlanTask, editPlanTask, removePlanTask, PlanTaskMutationError } from "../../src/seasons/plan-task-mutations.ts";
import type { PlannedTask } from "../../src/seasons/types.ts";

const task = (id: string, date: string, sourceTemplateTaskKey: string | null = null): PlannedTask => ({
  id, seasonPlanId: "plan-1", title: `Task ${id}`, description: null,
  plannedLocalDate: date as PlannedTask["plannedLocalDate"], sourceTemplateTaskKey, version: 1,
});
const base = { seasonStatus: "DRAFT" as const, seasonPlanId: "plan-1", actualPlantingDate: "2026-09-28" };

test("adds a required-title task on or after planting without changing existing task provenance", () => {
  const original = task("seeded", "2026-10-01", "template-key");
  const added = addPlanTask({ ...base, tasks: [original], task: task("manual", "2026-09-28") });
  assert.deepEqual(added, [original, task("manual", "2026-09-28")]);
  assert.equal(added[0].sourceTemplateTaskKey, "template-key");
});

test("edits only supplied task fields, increments its version, and keeps source provenance", () => {
  const original = task("seeded", "2026-10-01", "template-key");
  const updated = editPlanTask({ ...base, tasks: [original], taskId: original.id, patch: { title: "  Check field  ", plannedLocalDate: "2026-09-28" } });
  assert.deepEqual(updated, [{ ...original, title: "Check field", plannedLocalDate: "2026-09-28", version: 2 }]);
});

test("removes only the selected task and preserves the rest", () => {
  const first = task("first", "2026-10-01", "template-a");
  const second = task("second", "2026-09-28", null);
  assert.deepEqual(removePlanTask({ ...base, tasks: [first, second], taskId: first.id }), [second]);
});

test("rejects blank titles, malformed dates, and dates before planting while allowing independent date ordering", () => {
  assert.throws(() => addPlanTask({ ...base, tasks: [], task: { ...task("bad", "2026-09-28"), title: "  " } }), { code: "INVALID_TASK_TITLE" });
  assert.throws(() => addPlanTask({ ...base, tasks: [], task: task("early", "2026-09-27") }), { code: "PLANNED_DATE_BEFORE_PLANTING" });
  assert.throws(() => editPlanTask({ ...base, tasks: [task("x", "2026-10-01")], taskId: "x", patch: { plannedLocalDate: "2026-02-30" } }), { code: "INVALID_LOCAL_DATE" });
  const ordered = addPlanTask({ ...base, tasks: [task("later", "2026-12-01")], task: task("earlier", "2026-09-28") });
  assert.deepEqual(ordered.map((item) => item.plannedLocalDate), ["2026-12-01", "2026-09-28"]);
});

test("every add, edit, and remove mutation is rejected for ACTIVE seasons", () => {
  const active = { ...base, seasonStatus: "ACTIVE" as const, tasks: [task("x", "2026-10-01")] };
  assert.throws(() => addPlanTask({ ...active, task: task("new", "2026-10-01") }), PlanTaskMutationError);
  assert.throws(() => editPlanTask({ ...active, taskId: "x", patch: { title: "Changed" } }), PlanTaskMutationError);
  assert.throws(() => removePlanTask({ ...active, taskId: "x" }), PlanTaskMutationError);
});

test("edit and remove require an owned task", () => {
  const tasks = [task("owned", "2026-10-01")];
  assert.throws(() => editPlanTask({ ...base, tasks, taskId: "foreign", patch: { title: "Changed" } }), { code: "TASK_NOT_FOUND" });
  assert.throws(() => removePlanTask({ ...base, tasks, taskId: "foreign" }), { code: "TASK_NOT_FOUND" });
});
