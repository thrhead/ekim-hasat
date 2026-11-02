import assert from "node:assert/strict";
import { test } from "node:test";
import * as mutations from "../../src/seasons/plan-task-mutations.ts";

const api = mutations as typeof mutations & {
  validateManualActiveTask: (input: { title: unknown; description?: unknown; plannedLocalDate: unknown }, planting: unknown) => { title: string; description: string | null; plannedLocalDate: string };
  resolveTaskOrigin: (origin: string | null | undefined, planSource: "MANUAL" | "VALIDATED_TEMPLATE", templateVersionId: string | null) => { source: string; templateVersionId: string | null };
};

test("manual task validates existing title, description and calendar date rules", () => {
  assert.equal(typeof api.validateManualActiveTask, "function");
  const valid = (title: unknown, plannedLocalDate: unknown, description?: unknown) => api.validateManualActiveTask({ title, description, plannedLocalDate }, "2024-02-29");
  assert.deepEqual(valid("  İş  ", "2024-02-29"), { title: "İş", description: null, plannedLocalDate: "2024-02-29" });
  for (const date of ["2024-03-01", "2026-10-31", "2099-01-01"]) assert.equal(valid("x", date).plannedLocalDate, date);
  assert.equal(valid("x".repeat(200), "2024-03-01", "d".repeat(2000)).description?.length, 2000);
  for (const title of [" ", "x".repeat(201), null]) assert.throws(() => valid(title, "2024-03-01"));
  assert.throws(() => valid("x", "2024-03-01", "d".repeat(2001)));
  for (const date of ["2024-02-28", "2024-02-30", "2024-03-01T00:00:00Z", null]) assert.throws(() => valid("x", date));
});

test("origin distinguishes later manual tasks from legacy plan provenance", () => {
  assert.equal(typeof api.resolveTaskOrigin, "function");
  assert.deepEqual(api.resolveTaskOrigin("POST_ACTIVATION_MANUAL", "VALIDATED_TEMPLATE", "v1"), { source: "MANUAL", templateVersionId: null });
  for (const origin of [null, undefined, "PLAN_DERIVED"]) {
    assert.deepEqual(api.resolveTaskOrigin(origin, "VALIDATED_TEMPLATE", "v1"), { source: "VALIDATED_TEMPLATE", templateVersionId: "v1" });
    assert.deepEqual(api.resolveTaskOrigin(origin, "MANUAL", null), { source: "MANUAL", templateVersionId: null });
  }
});
