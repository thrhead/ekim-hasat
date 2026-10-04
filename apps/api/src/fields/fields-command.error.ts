import { ApiError } from "../observability/api-error.filter.js";

export type FieldCommandErrorCode = "INVALID_REQUEST" | "IDEMPOTENCY_KEY_REUSED" | "STALE_VERSION";

const messages: Record<FieldCommandErrorCode, string> = {
  INVALID_REQUEST: "Check the field information and try again",
  IDEMPOTENCY_KEY_REUSED: "This create request key was already used for different information",
  STALE_VERSION: "This field changed. Review the latest information before saving again",
};

export class FieldCommandError extends ApiError {
  constructor(status: 400 | 409, code: FieldCommandErrorCode) {
    super(status, code, messages[code]);
    this.name = "FieldCommandError";
  }
}
