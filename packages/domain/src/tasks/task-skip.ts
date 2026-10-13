import { validateLocalDate, type LocalDate } from "../seasons/local-date.js";

export type TaskSkipErrorCode =
  | "TASK_NOT_ACTIONABLE"
  | "TASK_ALREADY_COMPLETED"
  | "TASK_ALREADY_SKIPPED"
  | "TASK_VERSION_CONFLICT";

export class TaskSkipError extends Error {
  constructor(public readonly code: TaskSkipErrorCode, message: string) {
    super(message);
    this.name = "TaskSkipError";
  }
}

export type TaskSkipInput = Readonly<{
  seasonStatus: string;
  planStatus: string;
  hasActivationSnapshot: boolean;
  completed: boolean;
  skipped: boolean;
  plannedLocalDate: unknown;
  currentTaskVersion: number;
  expectedTaskVersion: number;
}>;

export type ValidatedTaskSkip = Readonly<{
  kind: "TASK_SKIPPED";
  plannedLocalDateSnapshot: LocalDate;
  baseTaskVersion: number;
  acceptedTaskVersion: number;
}>;

/** Validates a farmer Skip decision without treating it as task completion. */
export function validateTaskSkip(input: TaskSkipInput): ValidatedTaskSkip {
  if (input.completed) {
    throw new TaskSkipError("TASK_ALREADY_COMPLETED", "A completed task cannot be skipped.");
  }
  if (input.skipped) {
    throw new TaskSkipError("TASK_ALREADY_SKIPPED", "This task has already been skipped.");
  }
  if (input.seasonStatus !== "ACTIVE" || input.planStatus !== "APPROVED" || !input.hasActivationSnapshot) {
    throw new TaskSkipError("TASK_NOT_ACTIONABLE", "This task is not available to skip.");
  }
  if (input.currentTaskVersion !== input.expectedTaskVersion) {
    throw new TaskSkipError("TASK_VERSION_CONFLICT", "The task changed. Reload it before choosing Skip.");
  }

  return {
    kind: "TASK_SKIPPED",
    plannedLocalDateSnapshot: validateLocalDate(input.plannedLocalDate),
    baseTaskVersion: input.expectedTaskVersion,
    acceptedTaskVersion: input.currentTaskVersion + 1,
  };
}
