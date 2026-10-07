import type { ApiClient, CalendarComponents } from "../../../../../packages/api-client/src/index";

export type CalendarRead = CalendarComponents["schemas"]["CalendarRead"];
export type CalendarTaskPage = CalendarComponents["schemas"]["CalendarTaskPage"];
export type CalendarTaskGroup = CalendarComponents["schemas"]["CalendarTaskPageFirst"]["group"];
export type CalendarReadScope = CalendarComponents["schemas"]["CalendarReadScope"];

export type CalendarReadError = Error & { status?: number; code?: string };

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export async function readCalendar(
  client: ApiClient,
  request: Readonly<{ selectedDate?: string; fieldId?: string }> = {},
): Promise<CalendarRead> {
  const result = await client.POST("/v1/calendar/reads", {
    body: {
      ...(request.selectedDate === undefined ? {} : { selectedDate: request.selectedDate }),
      ...(request.fieldId === undefined ? {} : { fieldId: request.fieldId }),
    },
  });
  if (!result.response.ok || result.error !== undefined || result.data === undefined) {
    throw calendarRequestError(result.response.status, result.error);
  }
  if (!isCalendarRead(result.data, request)) throw invalidCalendarResponse();
  return result.data;
}

export async function readCalendarPage(
  client: ApiClient,
  request: Readonly<{
    readId: string;
    group: CalendarTaskGroup;
    cursor: string;
    readScope: CalendarReadScope;
  }>,
): Promise<CalendarTaskPage> {
  const result = await client.GET("/v1/calendar/reads/{readId}/pages", {
    params: { path: { readId: request.readId }, query: { group: request.group, cursor: request.cursor } },
  });
  if (!result.response.ok || result.error !== undefined || result.data === undefined) {
    throw calendarRequestError(result.response.status, result.error);
  }
  const page = result.data;
  if (!isUuid(page.readId) || page.readId !== request.readId || page.group !== request.group
    || page.requestedCursor !== request.cursor || !Array.isArray(page.items) || typeof page.complete !== "boolean"
    || !sameReadScope(page.readScope, request.readScope)) throw invalidCalendarResponse();
  return page;
}

function isCalendarRead(value: unknown, request: { selectedDate?: string; fieldId?: string }): value is CalendarRead {
  if (typeof value !== "object" || value === null) return false;
  const read = value as Partial<CalendarRead>;
  if (!isUuid(read.readId) || !isUuid(read.businessId) || !isLocalDate(read.selectedDate)
    || !isLocalDate(read.businessLocalToday) || !isLocalDate(read.monthStart) || !isLocalDate(read.monthEnd)
    || typeof read.businessTimezone !== "string" || read.businessTimezone.length === 0
    || typeof read.asOf !== "string" || !Number.isFinite(Date.parse(read.asOf))
    || typeof read.expiresAt !== "string" || !Number.isFinite(Date.parse(read.expiresAt))
    || typeof read.activeSeasonExists !== "boolean" || typeof read.hasAnyUnfinishedWork !== "boolean"
    || read.monthIndicatorsComplete !== true || !Array.isArray(read.monthIndicators)
    || !Array.isArray(read.fieldScope?.includedFieldIds)
    || read.fieldScope.includedFieldIds.some((id) => !isUuid(id))) return false;
  if (read.fieldScope.mode === "oneField") {
    if (!isUuid(read.fieldScope.fieldId) || read.fieldScope.includedFieldIds.length !== 1
      || read.fieldScope.includedFieldIds[0] !== read.fieldScope.fieldId) return false;
  } else if (read.fieldScope.mode !== "allAuthorized" || read.fieldScope.fieldId !== undefined) return false;
  const month = monthDates(read.monthStart, read.monthEnd);
  if (!month || read.monthIndicators.length !== month.length
    || read.monthIndicators.some((indicator, index) => indicator.date !== month[index] || typeof indicator.hasWork !== "boolean")) return false;
  if (request.selectedDate !== undefined && read.selectedDate !== request.selectedDate) return false;
  if (request.fieldId !== undefined
    && (read.fieldScope.mode !== "oneField" || read.fieldScope.fieldId !== request.fieldId
      || read.fieldScope.includedFieldIds.length !== 1 || read.fieldScope.includedFieldIds[0] !== request.fieldId)) return false;
  return isFirstPage(read.selectedDateTasksPage, read, "selectedDateTasks")
    && isFirstPage(read.overdueTasksPage, read, "overdueTasks");
}

function isFirstPage(
  page: CalendarRead["selectedDateTasksPage"] | undefined,
  read: Partial<CalendarRead>,
  group: CalendarTaskGroup,
): boolean {
  return page !== undefined && page.readId === read.readId && page.group === group
    && typeof page.complete === "boolean" && Array.isArray(page.items)
    && page.items.every((item) => isUuid(item.taskId) && isUuid(item.fieldId) && isUuid(item.seasonId)
      && typeof item.title === "string" && isLocalDate(item.plannedLocalDate)
      && typeof item.overdue === "boolean" && read.fieldScope?.includedFieldIds.includes(item.fieldId))
    && sameReadScope(page.readScope, {
      businessId: read.businessId!, asOf: read.asOf!, businessTimezone: read.businessTimezone!,
      businessLocalToday: read.businessLocalToday!, selectedDate: read.selectedDate!,
      monthStart: read.monthStart!, monthEnd: read.monthEnd!, fieldScope: read.fieldScope!,
    });
}

function sameReadScope(left: CalendarReadScope, right: CalendarReadScope): boolean {
  return left.businessId === right.businessId && left.asOf === right.asOf
    && left.businessTimezone === right.businessTimezone && left.businessLocalToday === right.businessLocalToday
    && left.selectedDate === right.selectedDate && left.monthStart === right.monthStart && left.monthEnd === right.monthEnd
    && left.fieldScope.mode === right.fieldScope.mode && left.fieldScope.fieldId === right.fieldScope.fieldId
    && left.fieldScope.includedFieldIds.length === right.fieldScope.includedFieldIds.length
    && left.fieldScope.includedFieldIds.every((id, index) => id === right.fieldScope.includedFieldIds[index]);
}

function isUuid(value: unknown): value is string { return typeof value === "string" && uuidPattern.test(value); }
function isLocalDate(value: unknown): value is string {
  if (typeof value !== "string" || !datePattern.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function monthDates(start: string, end: string): string[] | null {
  if (!isLocalDate(start) || !isLocalDate(end) || start.slice(0, 7) !== end.slice(0, 7) || !start.endsWith("-01")) return null;
  const dates: string[] = [];
  const cursor = new Date(`${start}T00:00:00.000Z`);
  const last = new Date(`${end}T00:00:00.000Z`);
  while (cursor <= last && dates.length < 32) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates.at(-1) === end ? dates : null;
}

function calendarRequestError(status: number, error: unknown): CalendarReadError {
  const code = typeof error === "object" && error !== null && "error" in error
    && typeof error.error === "object" && error.error !== null && "code" in error.error
    ? String(error.error.code) : undefined;
  const message = [401, 403, 404].includes(status)
    ? "Bu takvim bilgilerine erişiminiz doğrulanamadı. Yeniden bağlanıp erişiminizi kontrol edin."
    : "Takvim yüklenemedi. İnternet bağlantınızı kontrol edip yeniden deneyin.";
  return Object.assign(new Error(message), { status, ...(code ? { code } : {}) });
}

function invalidCalendarResponse(): CalendarReadError {
  return Object.assign(new Error("Takvim yanıtı geçerli değil. Yeniden deneyin."), { code: "INVALID_RESPONSE" });
}
