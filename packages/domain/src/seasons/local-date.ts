declare const localDateBrand: unique symbol;

/** A validated Gregorian calendar date, with no time or timezone conversion. */
export type LocalDate = string & { readonly [localDateBrand]: true };

export type LocalDateErrorCode =
  | "INVALID_LOCAL_DATE"
  | "FUTURE_ACTUAL_PLANTING_DATE"
  | "PLANNED_DATE_BEFORE_PLANTING";

export class LocalDateValidationError extends Error {
  constructor(public readonly code: LocalDateErrorCode, message: string) {
    super(message);
    this.name = "LocalDateValidationError";
  }
}

export function validateLocalDate(value: unknown): LocalDate {
  // Do not parse with Date: it can normalize impossible dates or introduce UTC.
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new LocalDateValidationError("INVALID_LOCAL_DATE", "A calendar date in YYYY-MM-DD format is required.");
  }
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth[month - 1]) {
    throw new LocalDateValidationError("INVALID_LOCAL_DATE", "The calendar date does not exist.");
  }
  return value as LocalDate;
}

/** The caller supplies today in the authorized business timezone. */
export function validateActualPlantingDate(value: unknown, today: unknown): LocalDate {
  const actual = validateLocalDate(value);
  const localToday = validateLocalDate(today);
  if (actual > localToday) {
    throw new LocalDateValidationError("FUTURE_ACTUAL_PLANTING_DATE", "Actual planting cannot be in the future.");
  }
  return actual;
}

/** Each task is checked against planting only; other task dates are independent. */
export function validatePlannedTaskDate(value: unknown, actualPlantingDate: unknown): LocalDate {
  const planned = validateLocalDate(value);
  const actual = validateLocalDate(actualPlantingDate);
  if (planned < actual) {
    throw new LocalDateValidationError("PLANNED_DATE_BEFORE_PLANTING", "Planned work cannot precede actual planting.");
  }
  return planned;
}
