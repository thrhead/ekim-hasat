import { Catch, HttpException, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";
import { getRequestContext } from "./request-context.js";
import { RequestLogger } from "./request-logger.js";

const safeErrors: Readonly<Record<number, { code: string; message: string }>> = {
  400: { code: "INVALID_REQUEST", message: "Check the information and try again" },
  401: { code: "UNAUTHORIZED", message: "Sign in to continue" },
  403: { code: "FORBIDDEN", message: "This request is not available" },
  404: { code: "NOT_FOUND", message: "The requested item is not available" },
  409: { code: "SEASON_STATE_CONFLICT", message: "The request conflicts with current information" },
};

/** A validated, privacy-safe application error with a stable API code. */
export class ApiError extends HttpException {
  readonly presentation: Readonly<{ code: string; message: string }>;

  constructor(status: number, code: string, message: string) {
    super(message, status);
    this.presentation = { code, message };
  }
}

/** Shared structured error envelope for domain commands with established codes. */
@Catch()
export class ApiErrorFilter implements ExceptionFilter {
  private readonly logger = new RequestLogger();

  catch(exception: unknown, host: ArgumentsHost): void {
    const request = host.switchToHttp().getRequest<{ method: string; correlationId?: string }>();
    const reply = host.switchToHttp().getResponse<{ status: (code: number) => { send: (body: unknown) => unknown } }>();
    const requestId = getRequestContext()?.correlationId ?? request.correlationId ?? "unavailable";
    const status = exception instanceof HttpException ? exception.getStatus() : 500;
    const presentation = exception instanceof ApiError
      ? exception.presentation
      : safeErrors[status] ?? { code: "UNEXPECTED", message: "Something went wrong" };
    this.logger.requestFailed({ correlationId: requestId, method: request.method, statusCode: status,
      errorCategory: status === 401 ? "AUTHENTICATION_REQUIRED" : status === 403 ? "FORBIDDEN" : status === 404 ? "NOT_FOUND" : status === 400 || status === 422 ? "INVALID_REQUEST" : status === 409 ? "CONFLICT" : "INTERNAL_ERROR" });
    reply.status(status).send({ error: { ...presentation, requestId } });
  }
}
