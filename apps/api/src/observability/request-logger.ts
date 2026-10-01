import { getRequestContext } from "./request-context.js";

export type RequestLogFields = Readonly<{
  correlationId: string;
  method: string;
  statusCode?: number;
  durationMs?: number;
  errorCategory?: ErrorCategory;
}>;

export type ErrorCategory =
  | "INVALID_REQUEST"
  | "AUTHENTICATION_REQUIRED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "VALIDATION_FAILED"
  | "TOO_MANY_REQUESTS"
  | "INTERNAL_ERROR";

export type SharedDiagnosticEvent =
  | "onboarding.started"
  | "onboarding.default_business_context"
  | "onboarding.field_save"
  | "onboarding.recoverable_failure";

export type SafeDiagnosticFields = Readonly<{
  outcome?: "started" | "succeeded" | "failed" | "retryable_failure";
  errorCategory?: ErrorCategory;
  durationMs?: number;
}>;

type LogRecord = Readonly<Record<string, string | number>>;
type LogSink = (level: "info" | "error", record: LogRecord) => void;

const SAFE_CATEGORIES = new Set<ErrorCategory>([
  "INVALID_REQUEST",
  "AUTHENTICATION_REQUIRED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "VALIDATION_FAILED",
  "TOO_MANY_REQUESTS",
  "INTERNAL_ERROR",
]);
const SAFE_DIAGNOSTIC_EVENTS = new Set<SharedDiagnosticEvent>([
  "onboarding.started",
  "onboarding.default_business_context",
  "onboarding.field_save",
  "onboarding.recoverable_failure",
]);
const SAFE_OUTCOMES = new Set<SafeDiagnosticFields["outcome"]>([
  "started",
  "succeeded",
  "failed",
  "retryable_failure",
]);

/** Emits structured records built only from explicit, allow-listed fields. */
export class RequestLogger {
  constructor(
    private readonly sink: LogSink = (level, record) => {
      const line = JSON.stringify(record);
      if (level === "error") console.error(line);
      else console.info(line);
    },
  ) {}

  requestStarted(fields: RequestLogFields): void {
    this.emit("info", "request.started", fields);
  }

  requestCompleted(fields: RequestLogFields): void {
    this.emit("info", "request.completed", fields);
  }

  requestFailed(fields: RequestLogFields): void {
    this.emit("error", "request.failed", fields);
  }

  /** Shared seam for later feature events; callers can provide only safe labels/outcomes. */
  diagnosticEvent(event: SharedDiagnosticEvent, fields: SafeDiagnosticFields = {}): void {
    if (!SAFE_DIAGNOSTIC_EVENTS.has(event)) return;
    const context = getRequestContext();
    const record: Record<string, string | number> = { event };
    if (context) record.correlationId = context.correlationId;
    if (fields.outcome && SAFE_OUTCOMES.has(fields.outcome)) record.outcome = fields.outcome;
    if (fields.errorCategory && SAFE_CATEGORIES.has(fields.errorCategory)) {
      record.errorCategory = fields.errorCategory;
    }
    if (isDuration(fields.durationMs)) record.durationMs = fields.durationMs;
    this.sink(fields.outcome === "failed" || fields.outcome === "retryable_failure" ? "error" : "info", record);
  }

  private emit(level: "info" | "error", event: string, fields: RequestLogFields): void {
    const record: Record<string, string | number> = {
      event,
      correlationId: fields.correlationId,
      method: fields.method,
    };
    if (isStatusCode(fields.statusCode)) record.statusCode = fields.statusCode;
    if (isDuration(fields.durationMs)) record.durationMs = fields.durationMs;
    if (fields.errorCategory && SAFE_CATEGORIES.has(fields.errorCategory)) {
      record.errorCategory = fields.errorCategory;
    }
    this.sink(level, record);
  }
}

function isStatusCode(value: number | undefined): value is number {
  return Number.isInteger(value) && value !== undefined && value >= 100 && value <= 599;
}

function isDuration(value: number | undefined): value is number {
  return Number.isFinite(value) && value !== undefined && value >= 0;
}
