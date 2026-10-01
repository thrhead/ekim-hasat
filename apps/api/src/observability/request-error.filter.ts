import { Catch, HttpException, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";
import { getRequestContext } from "./request-context.js";
import { RequestLogger, type ErrorCategory } from "./request-logger.js";

type ErrorRequest = {
  method: string;
  correlationId?: string;
  requestStartedAt?: number;
};

type ErrorReply = {
  status(statusCode: number): { send(body: PublicApiError): unknown };
};

export type PublicApiError = Readonly<{
  code: string;
  message: string;
  correlationId: string;
  retryable: boolean;
}>;

type ErrorPresentation = Readonly<{
  statusCode: number;
  error: Omit<PublicApiError, "correlationId"> & { code: ErrorCategory };
}>;

const SAFE_ERRORS: Record<number, Omit<PublicApiError, "correlationId"> & { code: ErrorCategory }> = {
  400: { code: "INVALID_REQUEST", message: "The request could not be processed", retryable: false },
  401: { code: "AUTHENTICATION_REQUIRED", message: "Sign in to continue", retryable: false },
  403: { code: "FORBIDDEN", message: "This request is not available", retryable: false },
  404: { code: "NOT_FOUND", message: "The requested item is not available", retryable: false },
  409: { code: "CONFLICT", message: "The request conflicts with current information", retryable: false },
  422: { code: "VALIDATION_FAILED", message: "Check the information and try again", retryable: false },
  429: { code: "TOO_MANY_REQUESTS", message: "Try again shortly", retryable: true },
};

export function presentApiError(exception: unknown): ErrorPresentation {
  const candidateStatus = exception instanceof HttpException ? exception.getStatus() : 500;
  const statusCode = Number.isInteger(candidateStatus) && candidateStatus >= 400 && candidateStatus <= 599
    ? candidateStatus
    : 500;
  const known = SAFE_ERRORS[statusCode];
  if (known) return { statusCode, error: known };
  return {
    statusCode: 500,
    error: { code: "INTERNAL_ERROR", message: "Something went wrong", retryable: true },
  };
}

@Catch()
export class RequestErrorFilter implements ExceptionFilter {
  constructor(private readonly logger: RequestLogger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<ErrorRequest>();
    const reply = http.getResponse<ErrorReply>();
    const context = getRequestContext();
    const correlationId = context?.correlationId ?? request.correlationId ?? "unavailable";
    const { statusCode, error } = presentApiError(exception);
    const durationMs = request.requestStartedAt === undefined
      ? undefined
      : Math.max(0, Date.now() - request.requestStartedAt);

    this.logger.requestFailed({
      correlationId,
      method: request.method,
      statusCode,
      durationMs,
      errorCategory: error.code,
    });
    reply.status(statusCode).send({ ...error, correlationId });
  }
}
