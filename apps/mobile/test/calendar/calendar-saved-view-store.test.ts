import { createCalendarSavedViewStore } from "../../src/features/calendar/calendar-saved-view-store";
import type { CalendarComponents } from "../../../../packages/api-client/src/index";

type Read = CalendarComponents["schemas"]["CalendarRead"];
const readId = "11111111-1111-4111-8111-111111111111";
const businessId = "22222222-2222-4222-8222-222222222222";
const fieldId = "33333333-3333-4333-8333-333333333333";
const selectedId = "44444444-4444-4444-8444-444444444444";
const overdueId = "55555555-5555-4555-8555-555555555555";

function read(options: { date?: string; fieldScope?: Read["fieldScope"]; selectedComplete?: boolean; overdueComplete?: boolean } = {}): Read {
  const selectedDate = options.date ?? "2026-10-06";
  const [year, month] = selectedDate.split("-");
  const monthStart = `${year}-${month}-01`;
  const days = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
  const monthEnd = `${year}-${month}-${String(days).padStart(2, "0")}`;
  const fieldScope = options.fieldScope ?? { mode: "allAuthorized", includedFieldIds: [fieldId] };
  const readScope = { businessId, asOf: "2026-10-06T09:00:00.000Z", businessTimezone: "Europe/Istanbul",
    businessLocalToday: "2026-10-06", selectedDate, monthStart, monthEnd, fieldScope };
  return {
    readId, asOf: readScope.asOf, expiresAt: "2026-10-06T09:15:00.000Z", businessId, businessTimezone: readScope.businessTimezone,
    businessLocalToday: readScope.businessLocalToday, selectedDate, monthStart, monthEnd, fieldScope,
    activeSeasonExists: true, hasAnyUnfinishedWork: true, monthIndicatorsComplete: true,
    monthIndicators: Array.from({ length: days }, (_, index) => ({ date: `${year}-${month}-${String(index + 1).padStart(2, "0")}`, hasWork: index === 5 })),
    selectedDateTasksPage: { readId, group: "selectedDateTasks", complete: options.selectedComplete ?? true, readScope,
      ...((options.selectedComplete ?? true) ? {} : { nextCursor: "selected-cursor-1" }),
      items: [{ taskId: selectedId, title: "Bugün sulamayı kontrol et", plannedLocalDate: selectedDate, fieldId, fieldName: "Kuzey", seasonId: overdueId, overdue: false }] },
    overdueTasksPage: { readId, group: "overdueTasks", complete: options.overdueComplete ?? true, readScope,
      ...((options.overdueComplete ?? true) ? {} : { nextCursor: "overdue-cursor-1" }),
      items: [{ taskId: overdueId, title: "Geciken işi kontrol et", plannedLocalDate: "2026-10-04", fieldId, fieldName: "Kuzey", seasonId: overdueId, overdue: true }] },
  } as Read;
}

function makeStorage() {
  const staging = new Map<string, unknown>();
  const complete = new Map<string, unknown>();
  return {
    staging,
    complete,
    async transaction<T>(work: (tx: unknown) => Promise<T>) {
      const beforeStaging = new Map(staging);
      const beforeComplete = new Map(complete);
      const tx = {
        async getStaging(key: string) { return staging.get(key) ?? null; },
        async saveStaging(key: string, value: unknown) { staging.set(key, structuredClone(value)); },
        async deleteStaging(key: string) { staging.delete(key); },
        async promote(key: string, value: unknown) { complete.set(key, structuredClone(value)); },
        async findComplete(key: string) { return complete.get(key) ?? null; },
      };
      try { return await work(tx); }
      catch (error) { staging.clear(); beforeStaging.forEach((value, key) => staging.set(key, value)); complete.clear(); beforeComplete.forEach((value, key) => complete.set(key, value)); throw error; }
    },
  };
}

const savedScope = { businessId, selectedDate: "2026-10-06", fieldScope: { mode: "allAuthorized" as const, includedFieldIds: [fieldId] } };

describe("Calendar saved view store", () => {
  it("promotes only exact account, Business, date and Field coverage into its separate Calendar schema", async () => {
    const storage = makeStorage();
    const store = createCalendarSavedViewStore({ storage: storage as never });
    await store.stageInitialRead("account-1", read());

    const complete = await store.getCompleteView("account-1", savedScope);
    expect(complete).toMatchObject({ readId, businessId, selectedDate: "2026-10-06", fieldScope: savedScope.fieldScope });
    expect(await store.getCompleteView("account-2", savedScope)).toBeNull();
    expect(await store.getCompleteView("account-1", { ...savedScope, businessId: fieldId })).toBeNull();
    expect(await store.getCompleteView("account-1", { ...savedScope, selectedDate: "2026-10-07" })).toBeNull();
    expect(storage.staging.size).toBe(0);
    expect(storage.complete.size).toBe(1);
  });

  it("keeps incomplete page chains invisible and rejects mixed read, cursor, date, or Field scope", async () => {
    const store = createCalendarSavedViewStore({ storage: makeStorage() as never });
    await store.stageInitialRead("account-1", read({ overdueComplete: false }));
    expect(await store.getCompleteView("account-1", savedScope)).toBeNull();

    const page = {
      readId, group: "overdueTasks" as const, requestedCursor: "overdue-cursor-1",
      readScope: read().overdueTasksPage.readScope, items: [], complete: true,
    };
    await expect(store.appendPage("account-1", { ...page, readId: selectedId })).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    await expect(store.appendPage("account-1", { ...page, requestedCursor: "different-cursor" })).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    await expect(store.appendPage("account-1", { ...page, readScope: { ...page.readScope, selectedDate: "2026-10-07" } })).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    await expect(store.appendPage("account-1", { ...page, readScope: { ...page.readScope, monthStart: "2026-09-01" } })).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    await expect(store.appendPage("account-1", { ...page, readScope: { ...page.readScope, fieldScope: { ...page.readScope.fieldScope, includedFieldIds: [] } } })).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    expect(await store.getCompleteView("account-1", savedScope)).toBeNull();

    await store.appendPage("account-1", page);
    expect(await store.getCompleteView("account-1", savedScope)).toMatchObject({ readId, overdueTasks: [{ taskId: overdueId }] });
  });

  it("does not treat complete month indicators as task-row coverage for another date", async () => {
    const storage = makeStorage();
    const store = createCalendarSavedViewStore({ storage: storage as never });
    await store.stageInitialRead("account-1", read({ selectedComplete: false, overdueComplete: false }));
    expect(await store.getCompleteView("account-1", savedScope)).toBeNull();
    expect(await store.getCompleteView("account-1", { ...savedScope, selectedDate: "2026-10-05" })).toBeNull();
    expect(await store.getCompleteView("account-1", { ...savedScope, fieldScope: { mode: "allAuthorized", includedFieldIds: [] } })).toBeNull();
    const afterRestart = createCalendarSavedViewStore({ storage: storage as never });
    expect(await afterRestart.getCompleteView("account-1", savedScope)).toBeNull();
  });

  it("binds Field saved views to the exact one-Field scope returned by the server", async () => {
    const oneField = { mode: "oneField" as const, fieldId, includedFieldIds: [fieldId] };
    const store = createCalendarSavedViewStore({ storage: makeStorage() as never });
    await store.stageInitialRead("account-1", read({ fieldScope: oneField }));
    expect(await store.getCompleteView("account-1", { ...savedScope, fieldScope: oneField })).toMatchObject({ fieldScope: oneField });
    expect(await store.getCompleteView("account-1", savedScope)).toBeNull();
  });

  it("accepts an identical consumed page replay and rejects changed content for that cursor", async () => {
    const store = createCalendarSavedViewStore({ storage: makeStorage() as never });
    await store.stageInitialRead("account-1", read({ overdueComplete: false }));
    const page = {
      readId, group: "overdueTasks" as const, requestedCursor: "overdue-cursor-1",
      readScope: read().overdueTasksPage.readScope, items: [], complete: false, nextCursor: "overdue-cursor-2",
    };
    await store.appendPage("account-1", page);
    await expect(store.appendPage("account-1", page)).resolves.toBeUndefined();
    await expect(store.appendPage("account-1", { ...page, nextCursor: "different-next-cursor" })).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
});
