import { HttpException } from "@nestjs/common";

const commandErrors = {
  INVALID_REQUEST: "Check the information and try again",
  SEASON_DATE_IN_FUTURE: "Actual planting cannot be in the future",
  MANUAL_PLAN_CHOICE_REQUIRED: "Choose a manual plan to continue without a validated plan",
  IDEMPOTENCY_KEY_REUSED: "This request key was already used for different information",
  STALE_SEASON_VERSION: "This plan changed. Reload it before making another change",
  SEASON_NOT_DRAFT: "Only a draft season's plan can be changed",
} as const;
export type SeasonCommandErrorCode = keyof typeof commandErrors;

/** Fixed, privacy-safe presentation for recognized season command failures. */
export class SeasonCommandError extends HttpException {
  readonly presentation: { code: SeasonCommandErrorCode; message: string };
  constructor(status: 400 | 409, code: SeasonCommandErrorCode) {
    super(commandErrors[code], status);
    this.presentation = { code, message: commandErrors[code] };
  }
}
