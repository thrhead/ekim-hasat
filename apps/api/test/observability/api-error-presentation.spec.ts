import assert from "node:assert/strict";
import test from "node:test";
import type { ArgumentsHost } from "@nestjs/common";
import { runWithRequestContext } from "../../src/observability/request-context.js";
import { ApiError, ApiErrorFilter } from "../../src/observability/api-error.filter.js";
import { SeasonCommandError } from "../../src/seasons/seasons-command.error.js";
import { SeasonsErrorFilter } from "../../src/seasons/seasons-error.filter.js";

function invoke(filter: { catch: (error: unknown, host: ArgumentsHost) => void }, error: unknown, method = "PATCH") {
  let statusCode = 0;
  let body: unknown;
  const records: Array<Record<string, unknown>> = [];
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({ method, correlationId: "field-request-42" }),
      getResponse: () => ({ status(status: number) { statusCode = status; return { send(value: unknown) { body = value; } }; } }),
    }),
  } as unknown as ArgumentsHost;
  runWithRequestContext({ correlationId: "field-request-42", method }, () => filter.catch(error, host));
  return { statusCode, body, records };
}

test("shared ApiError preserves machine-readable Field command conflicts and correlation envelope", () => {
  const stale = invoke(new ApiErrorFilter(), new ApiError(409, "STALE_VERSION", "This Field changed. Review it before saving again"));
  assert.equal(stale.statusCode, 409);
  assert.deepEqual(stale.body, { error: { code: "STALE_VERSION", message: "This Field changed. Review it before saving again", requestId: "field-request-42" } });
  const reused = invoke(new ApiErrorFilter(), new ApiError(409, "IDEMPOTENCY_KEY_REUSED", "This request key was already used for different information"));
  assert.equal(reused.statusCode, 409);
  assert.deepEqual(reused.body, { error: { code: "IDEMPOTENCY_KEY_REUSED", message: "This request key was already used for different information", requestId: "field-request-42" } });
});

test("shared ApiError gives privacy-safe authorization and absent-resource responses", () => {
  assert.deepEqual(invoke(new ApiErrorFilter(), new ApiError(403, "FORBIDDEN", "This request is not available")).body,
    { error: { code: "FORBIDDEN", message: "This request is not available", requestId: "field-request-42" } });
  assert.deepEqual(invoke(new ApiErrorFilter(), new ApiError(404, "NOT_FOUND", "The requested item is not available")).body,
    { error: { code: "NOT_FOUND", message: "The requested item is not available", requestId: "field-request-42" } });
});

test("Season command presentation remains unchanged through shared error handling", () => {
  const season = invoke(new SeasonsErrorFilter(), new SeasonCommandError(409, "STALE_VERSION"));
  assert.equal(season.statusCode, 409);
  assert.deepEqual(season.body, { error: {
    code: "STALE_VERSION",
    message: "This plan changed. Reload it before making another change",
    requestId: "field-request-42",
  } });
});
