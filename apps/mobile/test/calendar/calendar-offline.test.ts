import { canUseCalendarSavedView } from "../../src/features/calendar/calendar-offline-policy";
import { createCalendarSavedViewStore } from "../../src/features/calendar/calendar-saved-view-store";
import type { CalendarComponents } from "../../../../packages/api-client/src/index";

const scope = { businessId: "business-1", selectedDate: "2026-10-06", fieldScope: { mode: "oneField" as const, fieldId: "field-1", includedFieldIds: ["field-1"] } };
const saved = { ...scope, accountId: "account-1", readId: "read-1", coverageStatus: "COMPLETE" as const };
type Read = CalendarComponents["schemas"]["CalendarRead"];
const calendarRead = (readId: string, selectedComplete: boolean): Read => {
  const page = {
    readId, group: "selectedDateTasks" as const, complete: selectedComplete,
    ...(!selectedComplete ? { nextCursor: `cursor-${readId}` } : {}),
    readScope: { businessId, asOf: "2026-10-06T09:00:00.000Z", businessTimezone: "Europe/Istanbul", businessLocalToday: "2026-10-06", selectedDate: "2026-10-06", monthStart: "2026-10-01", monthEnd: "2026-10-31", fieldScope: { mode: "oneField" as const, fieldId, includedFieldIds: [fieldId] } },
    items: [],
  };
  return { readId, businessId, asOf: page.readScope.asOf, expiresAt: "2026-10-06T09:15:00.000Z", businessTimezone: page.readScope.businessTimezone, businessLocalToday: page.readScope.businessLocalToday, selectedDate: page.readScope.selectedDate, monthStart: page.readScope.monthStart, monthEnd: page.readScope.monthEnd, fieldScope: page.readScope.fieldScope, activeSeasonExists: true, hasAnyUnfinishedWork: false, monthIndicatorsComplete: true, monthIndicators: Array.from({ length: 31 }, (_, i) => ({ date: `2026-10-${String(i + 1).padStart(2, "0")}`, hasWork: false })), selectedDateTasksPage: page, overdueTasksPage: { ...page, group: "overdueTasks", complete: true, nextCursor: undefined } } as Read;
};
const businessId = "business-1";
const fieldId = "field-1";

describe("Calendar saved-view fallback policy", () => {
  it("allows fallback only after retryable connectivity failure and exact complete coverage", () => {
    expect(canUseCalendarSavedView({ error: { retryable: true, code: "NETWORK_ERROR" }, accountId: "account-1", requested: scope, savedView: saved })).toBe(true);
    expect(canUseCalendarSavedView({ error: { retryable: true, code: "NETWORK_ERROR" }, accountId: "account-2", requested: scope, savedView: saved })).toBe(false);
    expect(canUseCalendarSavedView({ error: { retryable: true, code: "NETWORK_ERROR" }, accountId: "account-1", requested: { ...scope, businessId: "business-2" }, savedView: saved })).toBe(false);
    expect(canUseCalendarSavedView({ error: { retryable: true, code: "NETWORK_ERROR" }, accountId: "account-1", requested: { ...scope, selectedDate: "2026-10-07" }, savedView: saved })).toBe(false);
    expect(canUseCalendarSavedView({ error: { retryable: true, code: "NETWORK_ERROR" }, accountId: "account-1", requested: { ...scope, fieldScope: { mode: "allAuthorized", includedFieldIds: ["field-1"] } }, savedView: saved })).toBe(false);
  });

  it.each([
    { retryable: false, status: 401, code: "UNAUTHENTICATED" },
    { retryable: false, status: 403, code: "FORBIDDEN" },
    { retryable: true, status: 410, code: "READ_EXPIRED" },
    { retryable: false, code: "MEMBERSHIP_REVOKED" },
    { retryable: false, code: "UNKNOWN" },
  ])("never falls back after non-retryable failures", (error) => {
    expect(canUseCalendarSavedView({ error, accountId: "account-1", requested: scope, savedView: saved })).toBe(false);
  });

  it("discards an expired incomplete read on restart but keeps an already promoted complete view", async () => {
    const storage = new Map<string, unknown>();
    const completeStorage = new Map<string, unknown>();
    const adapter = {
      async transaction<T>(work: (tx: unknown) => Promise<T>) {
        return work({
          async getStaging(key: string) { return storage.get(key) ?? null; },
          async saveStaging(key: string, value: unknown) { storage.set(key, value); },
          async deleteStaging(key: string) { storage.delete(key); },
          async promote(key: string, value: unknown) { completeStorage.set(key, value); },
          async findComplete(key: string) { return completeStorage.get(key) ?? null; },
        });
      },
    };
    const store = createCalendarSavedViewStore({ storage: adapter as never });
    await store.stageInitialRead("account-1", calendarRead("complete-read", true));
    await store.stageInitialRead("account-1", calendarRead("expired-read", false));
    await store.discardIncompleteRead("account-1", "expired-read");
    expect(await store.getCompleteView("account-1", { businessId, selectedDate: "2026-10-06", fieldScope: scope.fieldScope })).toMatchObject({ readId: "complete-read" });
    await store.stageInitialRead("account-1", calendarRead("replacement-read", true));
    expect(storage.size).toBe(0);
    expect(await store.getCompleteView("account-1", { businessId, selectedDate: "2026-10-06", fieldScope: scope.fieldScope })).toMatchObject({ readId: "replacement-read" });
  });
});
