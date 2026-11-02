import { ApiError } from "../observability/api-error.filter.js";

export type ManualTaskErrorCode = "INVALID_COMMAND" | "AUTHENTICATION_REQUIRED" | "ACCESS_DENIED" | "RESOURCE_UNAVAILABLE" | "SEASON_INELIGIBLE" | "IDENTITY_CONFLICT" | "INVALID_TASK";
export class ManualTaskCommandError extends ApiError {
  constructor(status: number, code: ManualTaskErrorCode) {
    super(status, code, "The task could not be added. Check the information and try again.");
  }
}
