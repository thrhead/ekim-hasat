import assert from "node:assert/strict";
import test from "node:test";
import { ForbiddenException } from "@nestjs/common";
import type { ArgumentsHost } from "@nestjs/common";
import {
  CORRELATION_ID_HEADER,
  CorrelationIdMiddleware,
  isValidCorrelationId,
} from "../../src/observability/correlation-id.middleware.js";
import { getRequestContext, runWithRequestContext } from "../../src/observability/request-context.js";
import { presentApiError, RequestErrorFilter } from "../../src/observability/request-error.filter.js";
import { RequestLogger } from "../../src/observability/request-logger.js";

type CapturedRecord = { level: "info" | "error"; fields: Record<string, unknown> };

function createLogger(records: CapturedRecord[]) {
  return new RequestLogger((level, fields) => records.push({ level, fields }));
}

function mockRequest(incoming?: string) {
  return {
    headers: incoming === undefined ? {} : { [CORRELATION_ID_HEADER]: incoming },
    method: "POST",
    correlationId: "",
    requestStartedAt: 0,
  };
}

test("generates and returns a correlation ID when no acceptable ID is supplied", async () => {
  const records: CapturedRecord[] = [];
  const middleware = new CorrelationIdMiddleware(createLogger(records));
  const request = mockRequest();
  let responseHeader = "";

  middleware.onRequest(request, {
    header(name, value) {
      assert.equal(name, CORRELATION_ID_HEADER);
      responseHeader = value;
    },
    statusCode: 200,
  }, () => {});

  assert.ok(isValidCorrelationId(request.correlationId));
  assert.equal(responseHeader, request.correlationId);
  assert.equal(records[0]?.fields.correlationId, request.correlationId);
  assert.equal(records[0]?.fields.event, "request.started");
});

test("propagates a valid incoming ID and replaces malformed or unacceptable IDs", async (t) => {
  await t.test("accepts the approved safe format", () => {
    const records: CapturedRecord[] = [];
    const middleware = new CorrelationIdMiddleware(createLogger(records));
    const request = mockRequest("pilot_2026-request_42");
    let header = "";
    middleware.onRequest(request, { header: (_name, value) => { header = value; }, statusCode: 200 }, () => {});
    assert.equal(request.correlationId, "pilot_2026-request_42");
    assert.equal(header, request.correlationId);
  });

  for (const malformed of ["", "short", "has spaces", "line\nbreak", "a".repeat(65), "\r\nX-Evil: yes"]) {
    await t.test(`replaces malformed incoming ID (${JSON.stringify(malformed.slice(0, 20))})`, () => {
      const middleware = new CorrelationIdMiddleware(createLogger([]));
      const request = mockRequest(malformed);
      let header = "";
      middleware.onRequest(request, { header: (_name, value) => { header = value; }, statusCode: 200 }, () => {});
      assert.ok(isValidCorrelationId(request.correlationId));
      assert.notEqual(request.correlationId, malformed);
      assert.equal(header, request.correlationId);
    });
  }
});

test("isolates correlation context across concurrent requests", async () => {
  const records: CapturedRecord[] = [];
  const middleware = new CorrelationIdMiddleware(createLogger(records));
  const observed = await Promise.all(["request-a", "request-b"].map((id, index) => new Promise<string | undefined>((resolve) => {
    const request = mockRequest(id);
    middleware.onRequest(request, { header: () => {}, statusCode: 200 }, () => {
      setTimeout(() => resolve(getRequestContext()?.correlationId), index === 0 ? 8 : 1);
    });
  })));

  assert.deepEqual(observed, ["request-a", "request-b"]);
  assert.deepEqual(records.map(({ fields }) => fields.correlationId), ["request-a", "request-b"]);
});

test("completion and failure logs carry the same correlation ID and safe fields only", () => {
  const records: CapturedRecord[] = [];
  const logger = createLogger(records);
  const middleware = new CorrelationIdMiddleware(logger);
  const request = mockRequest("safe-id-1");
  middleware.onRequest(request, { header: () => {}, statusCode: 200 }, () => {});
  middleware.onResponse(request, { header: () => {}, statusCode: 500 });
  logger.requestFailed({
    correlationId: request.correlationId,
    method: request.method,
    statusCode: 500,
    durationMs: 2,
    errorCategory: "INTERNAL_ERROR",
  });
  runWithRequestContext({ correlationId: request.correlationId, method: request.method }, () => {
    logger.diagnosticEvent("onboarding.field_save", {
      module: "onboarding",
      action: "field_save",
      outcome: "failed",
      errorCategory: "INTERNAL_ERROR",
      accessToken: "must-not-appear",
      refreshToken: "must-not-appear",
      authorization: "must-not-appear",
      coordinates: [-73.9, 40.7],
    } as never);
    logger.diagnosticEvent("onboarding.started", { outcome: "a-secret-token-value" } as never);
  });

  const serialized = JSON.stringify(records);
  assert.ok(serialized.includes("safe-id-1"));
  assert.ok(serialized.includes("request.started"));
  assert.ok(serialized.includes("request.completed"));
  assert.ok(serialized.includes("request.failed"));
  assert.ok(serialized.includes("INTERNAL_ERROR"));
  for (const secret of ["must-not-appear", "-73.9", "40.7", "authorization"]) {
    assert.ok(!serialized.includes(secret));
  }
  assert.ok(!serialized.includes("a-secret-token-value"));
  assert.deepEqual(records[3]?.fields, {
    event: "onboarding.field_save",
    correlationId: "safe-id-1",
    outcome: "failed",
    errorCategory: "INTERNAL_ERROR",
  });
});

test("internal and authorization errors return generic correlation-linked errors", () => {
  assert.deepEqual(presentApiError(new Error("database secret, token, and coordinates")), {
    statusCode: 500,
    error: { code: "INTERNAL_ERROR", message: "Something went wrong", retryable: true },
  });
  assert.deepEqual(presentApiError(new ForbiddenException("Business 91 exists")), {
    statusCode: 403,
    error: { code: "FORBIDDEN", message: "This request is not available", retryable: false },
  });

  const records: CapturedRecord[] = [];
  const logger = createLogger(records);
  const filter = new RequestErrorFilter(logger);
  let responseStatus = 0;
  let responseBody: unknown;
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({ method: "GET", correlationId: "error-id", requestStartedAt: Date.now() }),
      getResponse: () => ({
        status(status: number) {
          responseStatus = status;
          return { send(body: unknown) { responseBody = body; } };
        },
      }),
    }),
  } as unknown as ArgumentsHost;

  runWithRequestContext({ correlationId: "error-id", method: "GET" }, () => {
    filter.catch(new Error("database secret, token, and coordinates"), host);
  });

  assert.equal(responseStatus, 500);
  assert.deepEqual(responseBody, {
    code: "INTERNAL_ERROR",
    message: "Something went wrong",
    correlationId: "error-id",
    retryable: true,
  });
  assert.equal(records[0]?.fields.correlationId, "error-id");
  assert.equal(records[0]?.fields.errorCategory, "INTERNAL_ERROR");
  assert.ok(!JSON.stringify(records).includes("database secret"));
});
