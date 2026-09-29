import { validatePlannedTaskDate, type LocalDate } from "./local-date.js";
import type { PlannedTask } from "./types.js";

export type PlanTaskMutationErrorCode = "SEASON_NOT_DRAFT" | "INVALID_TASK_TITLE" | "INVALID_TASK_DESCRIPTION" | "TASK_NOT_FOUND" | "TASK_PLAN_MISMATCH";

export class PlanTaskMutationError extends Error {
  constructor(public readonly code: PlanTaskMutationErrorCode, message: string) {
    super(message);
    this.name = "PlanTaskMutationError";
  }
}

type MutationContext = Readonly<{
  seasonStatus: "DRAFT" | "ACTIVE";
  seasonPlanId: string;
  actualPlantingDate: LocalDate | string;
  tasks: readonly PlannedTask[];
}>;

export type PlanTaskDraftInput = Readonly<{
  id: string;
  title: string;
  description?: string | null;
  plannedLocalDate: string;
  sourceTemplateTaskKey?: string | null;
}>;

export type PlanTaskPatch = Readonly<{
  title?: string;
  description?: string | null;
  plannedLocalDate?: string;
}>;

function assertDraft(context: MutationContext): void {
  if (context.seasonStatus !== "DRAFT") {
    throw new PlanTaskMutationError("SEASON_NOT_DRAFT", "Plan tasks can only be changed while the season is a draft.");
  }
}

function assertTaskTitle(value: unknown): string {
  if (typeof value !== "string") throw new PlanTaskMutationError("INVALID_TASK_TITLE", "A task title is required.");
  const title = value.trim();
  if (title.length < 1 || title.length > 200) throw new PlanTaskMutationError("INVALID_TASK_TITLE", "A task title of 1 to 200 characters is required.");
  return title;
}

function assertTaskDescription(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value.length > 2000) {
    throw new PlanTaskMutationError("INVALID_TASK_DESCRIPTION", "Task details must be 2,000 characters or fewer.");
  }
  return value;
}

function assertPlanOwnership(context: MutationContext): void {
  if (context.tasks.some((task) => task.seasonPlanId !== context.seasonPlanId)) {
    throw new PlanTaskMutationError("TASK_PLAN_MISMATCH", "A plan task belongs to a different plan.");
  }
}

export function addPlanTask(context: MutationContext & Readonly<{ task: PlanTaskDraftInput }>): readonly PlannedTask[] {
  assertDraft(context);
  assertPlanOwnership(context);
  const title = assertTaskTitle(context.task.title);
  const description = assertTaskDescription(context.task.description);
  const plannedLocalDate = validatePlannedTaskDate(context.task.plannedLocalDate, context.actualPlantingDate);
  if (context.tasks.some((task) => task.id === context.task.id)) throw new PlanTaskMutationError("TASK_NOT_FOUND", "The task could not be added.");
  return [...context.tasks, {
    id: context.task.id,
    seasonPlanId: context.seasonPlanId,
    title,
    description,
    plannedLocalDate,
    sourceTemplateTaskKey: context.task.sourceTemplateTaskKey ?? null,
    version: 1,
  }];
}

export function editPlanTask(context: MutationContext & Readonly<{ taskId: string; patch: PlanTaskPatch }>): readonly PlannedTask[] {
  assertDraft(context);
  assertPlanOwnership(context);
  const task = context.tasks.find((candidate) => candidate.id === context.taskId);
  if (!task) throw new PlanTaskMutationError("TASK_NOT_FOUND", "The task is not available in this plan.");
  const updated = {
    ...task,
    ...(context.patch.title === undefined ? {} : { title: assertTaskTitle(context.patch.title) }),
    ...(context.patch.description === undefined ? {} : { description: assertTaskDescription(context.patch.description) }),
    ...(context.patch.plannedLocalDate === undefined ? {} : {
      plannedLocalDate: validatePlannedTaskDate(context.patch.plannedLocalDate, context.actualPlantingDate),
    }),
    version: task.version + 1,
  };
  return context.tasks.map((candidate) => candidate.id === context.taskId ? updated : candidate);
}

export function removePlanTask(context: MutationContext & Readonly<{ taskId: string }>): readonly PlannedTask[] {
  assertDraft(context);
  assertPlanOwnership(context);
  if (!context.tasks.some((task) => task.id === context.taskId)) {
    throw new PlanTaskMutationError("TASK_NOT_FOUND", "The task is not available in this plan.");
  }
  return context.tasks.filter((task) => task.id !== context.taskId);
}
