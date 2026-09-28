import assert from "node:assert/strict";
import test from "node:test";
import type { CropReference } from "../../src/seasons/types.ts";
import {
  prepareInitialPlan,
  selectValidatedTemplate,
  type PublishedTemplateVersion,
  type TemplateQualityDiagnostic,
} from "../../src/seasons/template-selection.ts";

const central: CropReference = {
  kind: "CENTRAL", cropKey: "any-content-crop", cropDefinitionVersionId: "crop-v1", displayName: "Crop",
};
const template = (overrides: Partial<PublishedTemplateVersion> = {}): PublishedTemplateVersion => ({
  id: "template-v1", templateKey: "any-content-template", version: "1",
  cropDefinitionVersionId: "crop-v1", regionSelector: null, published: true, available: true,
  taskDefinitions: [{ key: "inspect", title: "Check the field", description: "Observe growth", offsetDays: 0 }],
  ...overrides,
});

test("selects a published available template for the immutable crop version without a pilot list", () => {
  const selected = selectValidatedTemplate(central, null, [template()]);
  assert.equal(selected.availability, "AVAILABLE");
  assert.equal(selected.template?.id, "template-v1");
});

test("filters unpublished, unavailable, other crop versions and nonmatching regions", () => {
  const result = selectValidatedTemplate(central, null, [
    template({ published: false }), template({ available: false }),
    template({ cropDefinitionVersionId: "other-version" }), template({ regionSelector: "other-region" }),
  ]);
  assert.deepEqual(result, { availability: "NOT_APPLICABLE", template: null });
});

test("resolves available field regional context without guessing an unknown region", () => {
  const regional = template({ regionSelector: "region-a" });
  assert.equal(selectValidatedTemplate(central, "region-a", [regional]).availability, "AVAILABLE");
  assert.equal(selectValidatedTemplate(central, "region-b", [regional]).availability, "NOT_APPLICABLE");
  assert.equal(selectValidatedTemplate(central, null, [regional]).availability, "NOT_APPLICABLE");
});

test("central crops without a template and custom crops can proceed only after explicit MANUAL choice", () => {
  const custom: CropReference = { kind: "CUSTOM", customCropId: "custom-id", businessId: "business", displayName: "Crop" };
  for (const crop of [central, custom]) {
    const selection = selectValidatedTemplate(crop, null, crop.kind === "CUSTOM" ? [template()] : []);
    assert.equal(selection.availability, "NOT_APPLICABLE");
    assert.throws(() => prepareInitialPlan(selection, false, "2026-09-28"), { code: "MANUAL_PLAN_CHOICE_REQUIRED" });
    assert.deepEqual(prepareInitialPlan(selection, true, "2026-09-28"), {
      source: "MANUAL", templateProvenance: null, tasks: [],
    });
  }
});

test("an empty applicable published template emits a quality diagnostic and requires explicit MANUAL", () => {
  const diagnostics: TemplateQualityDiagnostic[] = [];
  const selection = selectValidatedTemplate(central, null, [template({ taskDefinitions: [] })], (event) => diagnostics.push(event));
  assert.deepEqual(selection, { availability: "EMPTY_TASK_DEFINITIONS", template: null });
  assert.deepEqual(diagnostics, [{ code: "EMPTY_VALIDATED_TEMPLATE", templateVersionId: "template-v1", templateKey: "any-content-template" }]);
  assert.throws(() => prepareInitialPlan(selection, false, "2026-09-28"), { code: "MANUAL_PLAN_CHOICE_REQUIRED" });
  const manual = prepareInitialPlan(selection, true, "2026-09-28");
  assert.equal(manual.source, "MANUAL");
  assert.equal(manual.templateProvenance, null);
  assert.equal(manual.tasks.length, 0);
});

test("does not diagnose empty templates that are not applicable or published", () => {
  const diagnostics: TemplateQualityDiagnostic[] = [];
  selectValidatedTemplate(central, null, [template({ published: false, taskDefinitions: [] })], (event) => diagnostics.push(event));
  assert.deepEqual(diagnostics, []);
});

test("a usable validated template cannot be relabelled MANUAL", () => {
  const selected = selectValidatedTemplate(central, null, [template()]);
  assert.throws(() => prepareInitialPlan(selected, true, "2026-09-28"), { code: "VALIDATED_TEMPLATE_REQUIRED" });
});

test("pins immutable template provenance and copies plan-owned task data", () => {
  const original = template();
  const selected = selectValidatedTemplate(central, null, [original]);
  const plan = prepareInitialPlan(selected, false, "2026-09-28");
  assert.equal(plan.source, "VALIDATED_TEMPLATE");
  assert.deepEqual(plan.templateProvenance, {
    templateKey: "any-content-template", templateVersionId: "template-v1", version: "1",
    cropDefinitionVersionId: "crop-v1", regionSelector: null,
  });
  assert.deepEqual(plan.tasks, [{ title: "Check the field", description: "Observe growth", plannedLocalDate: "2026-09-28", sourceTemplateTaskKey: "inspect" }]);
  assert.notEqual(plan.tasks[0], original.taskDefinitions[0]);
  assert.ok(Object.isFrozen(plan.templateProvenance));
  assert.ok(Object.isFrozen(plan.tasks[0]));
  const mutable = original as { version: string; taskDefinitions: { title: string }[] };
  mutable.version = "changed";
  mutable.taskDefinitions[0].title = "changed";
  assert.equal(plan.templateProvenance?.version, "1");
  assert.equal(plan.tasks[0].title, "Check the field");
  assert.equal(prepareInitialPlan(selected, false, "2026-09-28").tasks[0].title, "Check the field");
});

test("copies dates by local calendar days across leap years without ordering task dates", () => {
  const selected = selectValidatedTemplate(central, null, [template({ taskDefinitions: [
    { key: "late", title: "Later", offsetDays: 2 }, { key: "start", title: "Start", offsetDays: 0 },
    { key: "middle", title: "Middle", offsetDays: 1 },
  ] })]);
  assert.deepEqual(prepareInitialPlan(selected, false, "2024-02-28").tasks.map((task) => task.plannedLocalDate), ["2024-03-01", "2024-02-28", "2024-02-29"]);
  assert.deepEqual(prepareInitialPlan(selected, false, "0001-01-01").tasks.map((task) => task.plannedLocalDate), ["0001-01-03", "0001-01-01", "0001-01-02"]);
});

test("rejects negative/fractional task offsets and calendar dates outside the supported calendar", () => {
  for (const offsetDays of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    const selected = selectValidatedTemplate(central, null, [template({ taskDefinitions: [{ key: "bad", title: "Invalid", offsetDays }] })]);
    assert.throws(() => prepareInitialPlan(selected, false, "2026-09-28"), { code: "INVALID_TEMPLATE_TASK_DEFINITION" });
  }
  const selected = selectValidatedTemplate(central, null, [template({ taskDefinitions: [{ key: "end", title: "End", offsetDays: 1 }] })]);
  assert.throws(() => prepareInitialPlan(selected, false, "9999-12-31"), { code: "INVALID_TEMPLATE_TASK_DEFINITION" });
});

test("rejects invalid task definitions rather than creating placeholder work", () => {
  for (const task of [
    { key: "empty-title", title: " ", offsetDays: 0 },
    { key: "", title: "Check", offsetDays: 0 },
  ]) {
    const selected = selectValidatedTemplate(central, null, [template({ taskDefinitions: [task] })]);
    assert.throws(() => prepareInitialPlan(selected, false, "2026-09-28"), { code: "INVALID_TEMPLATE_TASK_DEFINITION" });
  }
});

test("reports an ambiguous available publication set without inventing template priority", () => {
  const diagnostics: TemplateQualityDiagnostic[] = [];
  const selection = selectValidatedTemplate(central, null, [template(), template({ id: "template-v2", version: "2" })], (event) => diagnostics.push(event));
  assert.equal(selection.availability, "AMBIGUOUS_TEMPLATE_VERSIONS");
  for (const explicitManual of [false, true]) {
    assert.throws(() => prepareInitialPlan(selection, explicitManual, "2026-09-28"), { code: "AMBIGUOUS_VALIDATED_TEMPLATE" });
  }
  assert.equal(diagnostics[0]?.code, "AMBIGUOUS_VALIDATED_TEMPLATE");
});

test("prefers the field's exact region to generic content without falling back from an empty regional version", () => {
  const generic = template();
  const regional = template({ id: "region-version", regionSelector: "region-a" });
  assert.equal(selectValidatedTemplate(central, "region-a", [generic, regional]).template?.id, "region-version");
  assert.equal(selectValidatedTemplate(central, "region-b", [generic, regional]).template?.id, "template-v1");
  assert.equal(selectValidatedTemplate(central, "region-a", [generic, { ...regional, taskDefinitions: [] }]).availability, "EMPTY_TASK_DEFINITIONS");
});
