import { validatePlannedTaskDate } from "./local-date.js";
import type { PlanSource, PlannedTask } from "./types.js";

export type ActivationEligibilityErrorCode = "SEASON_NOT_DRAFT" | "PLAN_HAS_NO_VALID_TASKS";

export class ActivationEligibilityError extends Error {
  constructor(public readonly code: ActivationEligibilityErrorCode) {
    super(code === "PLAN_HAS_NO_VALID_TASKS"
      ? "At least one valid planned task is required to activate this season."
      : "Only a draft season can be activated.");
    this.name = "ActivationEligibilityError";
  }
}

/** Shared authoritative eligibility rule for both manual and template plans. */
export function assertActivationEligible(input: Readonly<{
  seasonStatus: "DRAFT" | "ACTIVE";
  planStatus: "DRAFT" | "APPROVED";
  planId: string;
  actualPlantingDate: string;
  source: PlanSource["source"];
  templateProvenance: PlanSource["templateProvenance"];
  tasks: readonly PlannedTask[];
}>): asserts input is typeof input & Readonly<{ source: PlanSource["source"] }> {
  if (input.seasonStatus !== "DRAFT" || input.planStatus !== "DRAFT") {
    throw new ActivationEligibilityError("SEASON_NOT_DRAFT");
  }
  const sourceIsValid = input.source === "MANUAL"
    ? input.templateProvenance === null
    : input.source === "VALIDATED_TEMPLATE" && input.templateProvenance !== null;
  const hasValidTask = input.tasks.some((task) => {
    if (!sourceIsValid || task.seasonPlanId !== input.planId || typeof task.title !== "string"
      || task.title.trim().length < 1 || task.title.length > 200) return false;
    try {
      validatePlannedTaskDate(task.plannedLocalDate, input.actualPlantingDate);
      return true;
    } catch {
      return false;
    }
  });
  if (!sourceIsValid || !hasValidTask) throw new ActivationEligibilityError("PLAN_HAS_NO_VALID_TASKS");
}
