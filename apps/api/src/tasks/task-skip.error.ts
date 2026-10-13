import { HttpException } from "@nestjs/common";

const messages = {
  INVALID_REQUEST: "Check the request and try again.",
  IDEMPOTENCY_KEY_REUSED: "This Skip request conflicts with an earlier request.",
  TASK_ALREADY_COMPLETED: "This task has already been completed.",
  TASK_ALREADY_SKIPPED: "This task has already been skipped.",
  TASK_NOT_ACTIONABLE: "This task is no longer available to skip.",
  TASK_VERSION_CONFLICT: "This task changed. Reload it and try again.",
  UNAUTHORIZED: "Sign in to continue.",
  FORBIDDEN: "This request is not available.",
  NOT_FOUND: "The requested task is not available.",
} as const;

export type TaskSkipErrorCode =
  | "INVALID_REQUEST"
  | "IDEMPOTENCY_KEY_REUSED"
  | "TASK_ALREADY_COMPLETED"
  | "TASK_ALREADY_SKIPPED"
  | "TASK_NOT_ACTIONABLE"
  | "TASK_VERSION_CONFLICT"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND";

export class TaskSkipError extends HttpException {
  readonly presentation: { code: TaskSkipErrorCode; message: string };

  constructor(code: TaskSkipErrorCode) {
    const status = code === "INVALID_REQUEST" ? 400
      : code === "UNAUTHORIZED" ? 401
        : code === "FORBIDDEN" ? 403
          : code === "NOT_FOUND" ? 404 : 409;
    super(messages[code], status);
    this.name = "TaskSkipError";
    this.presentation = { code, message: messages[code] };
  }
}
