import { HttpException } from "@nestjs/common";

const messages = {
  INVALID_REQUEST: "Check the completion information and try again",
  IDEMPOTENCY_KEY_REUSED: "This completion request conflicts with an earlier request",
  TASK_VERSION_CONFLICT: "This task changed. Review it before completing again",
  TASK_ALREADY_COMPLETED: "This task has already been completed",
  TASK_NOT_ACTIONABLE: "This task is no longer available to complete",
} as const;

export type TaskCompletionErrorCode = keyof typeof messages;

export class TaskCompletionError extends HttpException {
  readonly presentation: { code: TaskCompletionErrorCode; message: string };
  constructor(code: TaskCompletionErrorCode) {
    super(messages[code], code === "INVALID_REQUEST" ? 400 : 409);
    this.presentation = { code, message: messages[code] };
  }
}
