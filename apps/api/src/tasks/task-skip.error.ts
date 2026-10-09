/** Narrow command error consumed by the Skip repository and its acceptance tests.
 * HTTP status and presentation mapping are added in the command boundary task.
 */
export type TaskSkipErrorCode =
  | "INVALID_REQUEST"
  | "IDEMPOTENCY_KEY_REUSED"
  | "TASK_ALREADY_COMPLETED"
  | "TASK_ALREADY_SKIPPED"
  | "TASK_NOT_ACTIONABLE"
  | "TASK_VERSION_CONFLICT";

export class TaskSkipError extends Error {
  readonly presentation: { code: TaskSkipErrorCode };

  constructor(code: TaskSkipErrorCode) {
    super(code);
    this.name = "TaskSkipError";
    this.presentation = { code };
  }
}
