import { type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";
import { ApiError, ApiErrorFilter } from "../observability/api-error.filter.js";
import { SeasonCommandError } from "./seasons-command.error.js";

/** Season contract presentation is scoped to these controllers; SPEC-001 stays compatible. */
export class SeasonsErrorFilter implements ExceptionFilter {
  private readonly shared = new ApiErrorFilter();

  catch(exception: unknown, host: ArgumentsHost): void {
    const normalized = exception instanceof SeasonCommandError
      ? new ApiError(exception.getStatus(), exception.presentation.code, exception.presentation.message)
      : exception;
    this.shared.catch(normalized, host);
  }
}
