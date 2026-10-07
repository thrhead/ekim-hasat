import { validateLocalDate } from "@ekim-hasat/domain/seasons/local-date";
import { ApiError } from "../observability/api-error.filter.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const acceptedKeys = new Set(["selectedDate", "fieldId"]);

export type CalendarReadRequest = Readonly<{
  selectedDate?: string;
  fieldId?: string;
}>;

const responseRequiredKeys = [
  "readId", "asOf", "expiresAt", "businessId", "businessTimezone", "businessLocalToday", "selectedDate",
  "monthStart", "monthEnd", "fieldScope", "activeSeasonExists", "hasAnyUnfinishedWork", "monthIndicators",
  "monthIndicatorsComplete", "selectedDateTasksPage", "overdueTasksPage",
] as const;

/** Validate only farmer-selected Calendar filters; account and Business scope are server-owned. */
export function validateCalendarReadRequest(value: unknown): CalendarReadRequest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalidRequest();
  }
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => !acceptedKeys.has(key))) throw invalidRequest();

  let selectedDate: string | undefined;
  if (input.selectedDate !== undefined) {
    try {
      selectedDate = validateLocalDate(input.selectedDate);
    } catch {
      throw invalidRequest();
    }
  }

  let fieldId: string | undefined;
  if (input.fieldId !== undefined) {
    if (typeof input.fieldId !== "string" || !uuidPattern.test(input.fieldId)) throw invalidRequest();
    fieldId = input.fieldId;
  }

  return {
    ...(selectedDate === undefined ? {} : { selectedDate }),
    ...(fieldId === undefined ? {} : { fieldId }),
  };
}

/** Check the internal read result against the required coherent OpenAPI response identity before sending it. */
export function validateCalendarReadResponse(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw invalidResponse();
  const response = value as Record<string, unknown>;
  if (responseRequiredKeys.some((key) => !(key in response))) throw invalidResponse();
  if (!isUuid(response.readId) || !isUuid(response.businessId)) throw invalidResponse();
  if (typeof response.asOf !== "string" || !Number.isFinite(Date.parse(response.asOf))) throw invalidResponse();
  if (typeof response.expiresAt !== "string" || !Number.isFinite(Date.parse(response.expiresAt))) throw invalidResponse();
  if (typeof response.businessTimezone !== "string" || response.businessTimezone.length === 0) throw invalidResponse();
  if (typeof response.activeSeasonExists !== "boolean" || typeof response.hasAnyUnfinishedWork !== "boolean") throw invalidResponse();
  if (response.monthIndicatorsComplete !== true || !Array.isArray(response.monthIndicators)) throw invalidResponse();

  let selectedDate: string;
  try {
    selectedDate = validateLocalDate(response.selectedDate);
    validateLocalDate(response.businessLocalToday);
    validateLocalDate(response.monthStart);
    validateLocalDate(response.monthEnd);
  } catch {
    throw invalidResponse();
  }

  if (typeof response.fieldScope !== "object" || response.fieldScope === null || Array.isArray(response.fieldScope)) throw invalidResponse();
  const fieldScope = response.fieldScope as Record<string, unknown>;
  if (!new Set(["allAuthorized", "oneField"]).has(String(fieldScope.mode))
    || !Array.isArray(fieldScope.includedFieldIds)
    || fieldScope.includedFieldIds.some((id) => !isUuid(id))) throw invalidResponse();
  if (fieldScope.mode === "oneField" && !isUuid(fieldScope.fieldId)) throw invalidResponse();

  validateFirstPage(response.selectedDateTasksPage, response.readId, response.businessId, selectedDate, "selectedDateTasks");
  validateFirstPage(response.overdueTasksPage, response.readId, response.businessId, selectedDate, "overdueTasks");
  return response;
}

function validateFirstPage(value: unknown, readId: unknown, businessId: unknown, selectedDate: string, group: string): void {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw invalidResponse();
  const page = value as Record<string, unknown>;
  if (page.readId !== readId || page.group !== group || !Array.isArray(page.items) || typeof page.complete !== "boolean") {
    throw invalidResponse();
  }
  if (page.nextCursor !== undefined && typeof page.nextCursor !== "string") throw invalidResponse();
  if (typeof page.readScope !== "object" || page.readScope === null || Array.isArray(page.readScope)) throw invalidResponse();
  const readScope = page.readScope as Record<string, unknown>;
  if (readScope.selectedDate !== selectedDate || readScope.businessId !== businessId) throw invalidResponse();
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value);
}

function invalidRequest(): ApiError {
  return new ApiError(400, "INVALID_REQUEST", "Check the Calendar date and Field selection");
}

function invalidResponse(): Error {
  return new Error("Calendar read response integrity failure");
}
