import assert from "node:assert/strict";
import test from "node:test";
import { validateCalendarReadRequest, validateCalendarReadResponse } from "../../src/calendar/calendar.dto.js";

test("Calendar read accepts omitted or explicit Business-local selectedDate and optional Field narrowing", () => {
  assert.deepEqual(validateCalendarReadRequest({}), {});
  assert.deepEqual(validateCalendarReadRequest({ selectedDate: "2026-10-06", fieldId: "11111111-1111-4111-8111-111111111111" }), {
    selectedDate: "2026-10-06",
    fieldId: "11111111-1111-4111-8111-111111111111",
  });
});

test("Calendar read response requires its resolved selectedDate and matching first-page read identity", () => {
  const readId = "11111111-1111-4111-8111-111111111111";
  const readScope = {
    businessId: "22222222-2222-4222-8222-222222222222",
    asOf: "2026-10-06T07:00:00.000Z",
    businessTimezone: "Europe/Istanbul",
    businessLocalToday: "2026-10-06",
    selectedDate: "2026-10-06",
    monthStart: "2026-10-01",
    monthEnd: "2026-10-31",
    fieldScope: { mode: "allAuthorized", includedFieldIds: [] },
  };
  const response = {
    readId,
    asOf: readScope.asOf,
    expiresAt: "2026-10-06T07:15:00.000Z",
    businessId: readScope.businessId,
    businessTimezone: readScope.businessTimezone,
    businessLocalToday: readScope.businessLocalToday,
    selectedDate: readScope.selectedDate,
    monthStart: readScope.monthStart,
    monthEnd: readScope.monthEnd,
    fieldScope: readScope.fieldScope,
    activeSeasonExists: true,
    hasAnyUnfinishedWork: false,
    monthIndicators: [],
    monthIndicatorsComplete: true,
    selectedDateTasksPage: { readId, readScope, group: "selectedDateTasks", items: [], complete: true },
    overdueTasksPage: { readId, readScope, group: "overdueTasks", items: [], complete: true },
  };
  assert.equal(validateCalendarReadResponse(response), response);
    const missingDate = Object.fromEntries(Object.entries(response).filter(([key]) => key !== "selectedDate"));
  assert.throws(() => validateCalendarReadResponse(missingDate));
  assert.throws(() => validateCalendarReadResponse({ ...response, selectedDateTasksPage: { ...response.selectedDateTasksPage, readId: "33333333-3333-4333-8333-333333333333" } }));
});

test("Calendar read rejects invalid dates, malformed Field IDs, and client-supplied authority", () => {
  for (const body of [
    { selectedDate: "2026-02-30" },
    { fieldId: "not-a-uuid" },
    { businessId: "11111111-1111-4111-8111-111111111111" },
    { accountId: "11111111-1111-4111-8111-111111111111" },
  ]) assert.throws(() => validateCalendarReadRequest(body));
});
