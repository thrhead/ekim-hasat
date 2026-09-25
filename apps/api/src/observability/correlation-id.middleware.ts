import { randomUUID } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";
import { runWithRequestContext } from "./request-context.js";
import { RequestLogger } from "./request-logger.js";

export const CORRELATION_ID_HEADER = "x-correlation-id";
const ACCEPTED_CORRELATION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/;

export type CorrelationRequest = {
  headers: IncomingHttpHeaders;
  method: string;
  correlationId: string;
  requestStartedAt: number;
};

export type CorrelationReply = {
  header(name: string, value: string): unknown;
  statusCode: number;
};

export function isValidCorrelationId(value: unknown): value is string {
  return typeof value === "string" && ACCEPTED_CORRELATION_ID.test(value);
}

export function resolveCorrelationId(value: unknown): string {
  return isValidCorrelationId(value) ? value : randomUUID();
}

/** Fastify onRequest/onResponse hook implementation shared by the API host. */
export class CorrelationIdMiddleware {
  constructor(private readonly logger: RequestLogger) {}

  onRequest(
    request: CorrelationRequest,
    reply: CorrelationReply,
    done: (error?: Error) => void,
  ): void {
    const incoming = request.headers[CORRELATION_ID_HEADER];
    const correlationId = resolveCorrelationId(Array.isArray(incoming) ? undefined : incoming);
    request.correlationId = correlationId;
    request.requestStartedAt = Date.now();
    reply.header(CORRELATION_ID_HEADER, correlationId);

    runWithRequestContext({ correlationId, method: request.method }, () => {
      this.logger.requestStarted({ correlationId, method: request.method });
      done();
    });
  }

  onResponse(request: CorrelationRequest, reply: CorrelationReply): void {
    const durationMs = Math.max(0, Date.now() - request.requestStartedAt);
    this.logger.requestCompleted({
      correlationId: request.correlationId,
      method: request.method,
      statusCode: reply.statusCode,
      durationMs,
    });
  }
}
