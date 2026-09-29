import assert from "node:assert/strict";
import test from "node:test";
import { assertActivationEligible, ActivationEligibilityError } from "../../src/seasons/activation.js";
import type { PlannedTask } from "../../src/seasons/types.js";

const task: PlannedTask = { id: "task-1", seasonPlanId: "plan-1", title: "Check the field", description: null,
  plannedLocalDate: "2026-04-10", sourceTemplateTaskKey: null, version: 1 };
const base = { seasonStatus: "DRAFT" as const, planStatus: "DRAFT" as const, planId: "plan-1",
  actualPlantingDate: "2026-04-10", tasks: [task] };

test("manual and validated-template plans are eligible with one valid task and keep provenance", () => {
  const manual = { ...base, source: "MANUAL" as const, templateProvenance: null };
  assert.equal(assertActivationEligible(manual), undefined);
  const provenance = { templateKey: "tomato", templateVersionId: "template-1", version: "1",
    cropDefinitionVersionId: "crop-1", regionSelector: null };
  assert.equal(assertActivationEligible({ ...base, source: "VALIDATED_TEMPLATE", templateProvenance: provenance }), undefined);
  assert.equal(provenance.templateVersionId, "template-1");
});

test("zero-task manual and validated-template plans are rejected without manufacturing a task", () => {
  for (const plan of [
    { ...base, tasks: [], source: "MANUAL" as const, templateProvenance: null },
    { ...base, tasks: [], source: "VALIDATED_TEMPLATE" as const, templateProvenance: {
      templateKey: "tomato", templateVersionId: "template-1", version: "1", cropDefinitionVersionId: "crop-1", regionSelector: null,
    } },
  ]) {
    assert.throws(() => assertActivationEligible(plan), (error) => error instanceof ActivationEligibilityError && error.code === "PLAN_HAS_NO_VALID_TASKS");
    assert.equal(plan.tasks.length, 0);
  }
});

test("invalid and wrong-plan tasks do not satisfy activation eligibility", () => {
  const invalidTasks = [
    { ...task, title: "  " },
    { ...task, plannedLocalDate: "2026-04-09" },
    { ...task, seasonPlanId: "other-plan" },
  ];
  for (const invalidTask of invalidTasks) assert.throws(() => assertActivationEligible({ ...base, tasks: [invalidTask], source: "MANUAL", templateProvenance: null }),
    (error) => error instanceof ActivationEligibilityError && error.code === "PLAN_HAS_NO_VALID_TASKS");
});

test("already active season is rejected", () => {
  assert.throws(() => assertActivationEligible({ ...base, seasonStatus: "ACTIVE", source: "MANUAL", templateProvenance: null }),
    (error) => error instanceof ActivationEligibilityError && error.code === "SEASON_NOT_DRAFT");
});
