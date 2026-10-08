import { HttpException } from "@nestjs/common";

export type TaskDateAdjustmentErrorCode =
  | "INVALID_REQUEST"
  | "NO_DATE_CHANGE"
  | "IDEMPOTENCY_KEY_REUSED"
  | "TASK_VERSION_CONFLICT"
  | "TASK_ALREADY_COMPLETED"
  | "TASK_NOT_ACTIONABLE"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND";

const messages: Record<TaskDateAdjustmentErrorCode, string> = {
  INVALID_REQUEST: "Check the date and try again.",
  NO_DATE_CHANGE: "Choose a different date to reschedule this task.",
  IDEMPOTENCY_KEY_REUSED: "This adjustment could not be reused. Choose the date again.",
  TASK_VERSION_CONFLICT: "This task changed. Reload it and choose a new date.",
  TASK_ALREADY_COMPLETED: "A completed task cannot be rescheduled.",
  TASK_NOT_ACTIONABLE: "This task is not available for rescheduling.",
  UNAUTHORIZED: "Sign in to continue.",
  FORBIDDEN: "This request is not available.",
  NOT_FOUND: "The requested task is not available.",
};

export class TaskDateAdjustmentError extends HttpException {
  readonly presentation: { code: TaskDateAdjustmentErrorCode; message: string };

  constructor(code: TaskDateAdjustmentErrorCode) {
    const status = code === "INVALID_REQUEST" || code === "NO_DATE_CHANGE" ? 400
      : code === "UNAUTHORIZED" ? 401
        : code === "FORBIDDEN" ? 403
          : code === "NOT_FOUND" ? 404 : 409;
    super(messages[code], status);
    this.presentation = { code, message: messages[code] };
  }
}
