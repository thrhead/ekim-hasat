import { Catch, HttpException, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";
import { getRequestContext } from "../observability/request-context.js";
import { RequestLogger } from "../observability/request-logger.js";
import { TaskCompletionError } from "./task-completion.error.js";

@Catch()
export class TaskCompletionErrorFilter implements ExceptionFilter {
  private readonly logger = new RequestLogger();
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<{ method: string; correlationId?: string }>();
    const reply = http.getResponse<{ status: (statusCode: number) => { send: (body: unknown) => unknown } }>();
    const requestId = getRequestContext()?.correlationId ?? request.correlationId ?? "unavailable";
    const status = exception instanceof HttpException ? exception.getStatus() : 500;
    const presentation = exception instanceof TaskCompletionError ? exception.presentation : {
      code: status === 401 ? "UNAUTHORIZED" : status === 403 ? "FORBIDDEN" : status === 404 ? "NOT_FOUND" : "UNEXPECTED",
      message: status === 401 ? "Sign in to continue" : status === 403 ? "This request is not available" : status === 404 ? "The requested item is not available" : "Something went wrong",
    };
    this.logger.requestFailed({ correlationId: requestId, method: request.method, statusCode: status,
      errorCategory: status === 401 ? "AUTHENTICATION_REQUIRED" : status === 403 ? "FORBIDDEN" : status === 404 ? "NOT_FOUND" : status < 500 ? "CONFLICT" : "INTERNAL_ERROR" });
    reply.status(status).send({ error: { ...presentation, requestId } });
  }
}
