import { validateLocalDate, validatePlannedTaskDate, type LocalDate } from "../seasons/local-date.js";

export type TaskDateAdjustmentErrorCode =
  | "TASK_NOT_ACTIONABLE"
  | "TASK_ALREADY_COMPLETED"
  | "TASK_VERSION_CONFLICT"
  | "NO_DATE_CHANGE";

export class TaskDateAdjustmentError extends Error {
  constructor(public readonly code: TaskDateAdjustmentErrorCode, message: string) {
    super(message);
    this.name = "TaskDateAdjustmentError";
  }
}

export type TaskDateAdjustmentInput = Readonly<{
  seasonStatus: string;
  planStatus: string;
  completed: boolean;
  currentPlannedLocalDate: unknown;
  actualPlantingDate: unknown;
  currentTaskVersion: number;
  expectedTaskVersion: number;
  newPlannedLocalDate: unknown;
}>;

export type ValidatedTaskDateAdjustment = Readonly<{
  previousPlannedLocalDate: LocalDate;
  newPlannedLocalDate: LocalDate;
  baseTaskVersion: number;
  acceptedTaskVersion: number;
}>;

/** Validates a new adjustment in the required eligibility → version → date order. */
export function validateTaskDateAdjustment(input: TaskDateAdjustmentInput): ValidatedTaskDateAdjustment {
  if (input.completed) {
    throw new TaskDateAdjustmentError("TASK_ALREADY_COMPLETED", "A completed task cannot be rescheduled.");
  }
  if (input.seasonStatus !== "ACTIVE" || input.planStatus !== "APPROVED") {
    throw new TaskDateAdjustmentError("TASK_NOT_ACTIONABLE", "This task is not available for rescheduling.");
  }
  if (input.currentTaskVersion !== input.expectedTaskVersion) {
    throw new TaskDateAdjustmentError("TASK_VERSION_CONFLICT", "The task changed. Reload it before choosing a new date.");
  }

  const previousPlannedLocalDate = validateLocalDate(input.currentPlannedLocalDate);
  const newPlannedLocalDate = validateLocalDate(input.newPlannedLocalDate);
  if (newPlannedLocalDate === previousPlannedLocalDate) {
    throw new TaskDateAdjustmentError("NO_DATE_CHANGE", "Choose a different date to reschedule this task.");
  }

  return {
    previousPlannedLocalDate,
    newPlannedLocalDate: validatePlannedTaskDate(newPlannedLocalDate, input.actualPlantingDate),
    baseTaskVersion: input.expectedTaskVersion,
    acceptedTaskVersion: input.currentTaskVersion + 1,
  };
}
