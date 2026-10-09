import assert from "node:assert/strict";
import test from "node:test";
import type { ArgumentsHost } from "@nestjs/common";
import { runWithRequestContext } from "../../src/observability/request-context.js";
import { TaskSkipError } from "../../src/tasks/task-skip.error.js";
import { TaskSkipErrorFilter } from "../../src/tasks/task-skip.error.filter.js";

function captureFilter(error: unknown) {
  const filter = new TaskSkipErrorFilter();
  let status = 0;
  let body: unknown;
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({ method: "POST", correlationId: "skip-request-42" }),
      getResponse: () => ({
        status(value: number) {
          status = value;
          return { send(valueBody: unknown) { body = valueBody; } };
        },
      }),
    }),
  } as unknown as ArgumentsHost;

  runWithRequestContext({ correlationId: "skip-request-42", method: "POST" }, () => filter.catch(error, host));
  return { status, body };
}

test("TaskSkipError exposes stable farmer-safe presentation and HTTP status", () => {
  const expected: Array<[ConstructorParameters<typeof TaskSkipError>[0], number]> = [
    ["INVALID_REQUEST", 400],
    ["IDEMPOTENCY_KEY_REUSED", 409],
    ["TASK_ALREADY_COMPLETED", 409],
    ["TASK_ALREADY_SKIPPED", 409],
    ["TASK_NOT_ACTIONABLE", 409],
    ["TASK_VERSION_CONFLICT", 409],
    ["UNAUTHORIZED", 401],
    ["FORBIDDEN", 403],
    ["NOT_FOUND", 404],
  ];

  for (const [code, status] of expected) {
    const error = new TaskSkipError(code);
    assert.equal(error.name, "TaskSkipError");
    assert.equal(error.getStatus(), status);
    assert.equal(error.presentation.code, code);
    assert.ok(error.presentation.message.trim().length > 0);
    assert.equal(error.message, error.presentation.message);
  }
});

test("TaskSkipErrorFilter returns the contract envelope with the correlated requestId", () => {
  const { status, body } = captureFilter(new TaskSkipError("NOT_FOUND"));
  assert.equal(status, 404);
  assert.deepEqual(body, {
    error: {
      code: "NOT_FOUND",
      message: "The requested task is not available.",
      requestId: "skip-request-42",
    },
  });
});

test("TaskSkipErrorFilter hides unexpected error details behind the generic contract response", () => {
  const { status, body } = captureFilter(new Error("database password and foreign business details"));
  assert.equal(status, 500);
  assert.deepEqual(body, {
    error: {
      code: "UNEXPECTED",
      message: "Something went wrong.",
      requestId: "skip-request-42",
    },
  });
});
