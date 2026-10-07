jest.mock("@react-native-async-storage/async-storage", () => (
  jest.requireActual("@react-native-async-storage/async-storage/jest/async-storage-mock")
));

import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { CalendarScreen } from "../../src/features/calendar/calendar-screen";
import { canUseCalendarSavedView } from "../../src/features/calendar/calendar-offline-policy";
import type { ApiClient, CalendarComponents } from "../../../../packages/api-client/src/index";
import type { CalendarSavedViewStore } from "../../src/features/calendar/calendar-saved-view-store";

type Read = CalendarComponents["schemas"]["CalendarRead"];
const businessId = "22222222-2222-4222-8222-222222222222";
const fieldId = "33333333-3333-4333-8333-333333333333";
const readId = "11111111-1111-4111-8111-111111111111";
const task = { taskId: "55555555-5555-4555-8555-555555555555", title: "Sulama hattını kontrol et", plannedLocalDate: "2026-10-06", fieldId, fieldName: "Kuzey tarla", seasonId: "44444444-4444-4444-8444-444444444444", overdue: false };
const readScope = { businessId, asOf: "2026-10-06T09:00:00.000Z", businessTimezone: "Europe/Istanbul", businessLocalToday: "2026-10-06", selectedDate: "2026-10-06", monthStart: "2026-10-01", monthEnd: "2026-10-31", fieldScope: { mode: "allAuthorized" as const, includedFieldIds: [fieldId] } };
const savedView = {
  readId, businessId, asOf: readScope.asOf, expiresAt: "2026-10-06T09:15:00.000Z", businessTimezone: readScope.businessTimezone,
  businessLocalToday: readScope.businessLocalToday, selectedDate: readScope.selectedDate, monthStart: readScope.monthStart, monthEnd: readScope.monthEnd,
  fieldScope: readScope.fieldScope, activeSeasonExists: true, hasAnyUnfinishedWork: true, monthIndicatorsComplete: true,
  monthIndicators: Array.from({ length: 31 }, (_, index) => ({ date: `2026-10-${String(index + 1).padStart(2, "0")}`, hasWork: index === 5 })),
  selectedDateTasksPage: { readId, group: "selectedDateTasks" as const, complete: true, readScope, items: [task] },
  overdueTasksPage: { readId, group: "overdueTasks" as const, complete: true, readScope, items: [] },
  selectedDateTasks: [task], overdueTasks: [],
  accountId: "account-1", coverageStatus: "COMPLETE" as const,
} satisfies Read & { accountId: string; coverageStatus: "COMPLETE"; selectedDateTasks: Read["selectedDateTasksPage"]["items"]; overdueTasks: Read["overdueTasksPage"]["items"] };

describe("Calendar saved view screen fallback", () => {
  it("shows a complete exact saved view after a retryable network failure", async () => {
    expect(canUseCalendarSavedView({ error: { retryable: true }, accountId: "account-1", requested: { businessId: savedView.businessId, selectedDate: savedView.selectedDate, fieldScope: savedView.fieldScope }, savedView })).toBe(true);
    const savedViewStore = {
      stageInitialRead: jest.fn(), appendPage: jest.fn(), discardIncompleteRead: jest.fn(),
      getMostRecentCompleteView: jest.fn().mockResolvedValue(savedView),
      getCompleteView: jest.fn().mockResolvedValue(savedView),
    };
    const POST = jest.fn().mockRejectedValue(new TypeError("Network request failed"));
    const GET = jest.fn().mockResolvedValue({ response: { ok: true, status: 200 }, data: { items: [], nextCursor: null } });
    let screen!: ReturnType<typeof create>;
    await act(async () => { screen = create(createElement(CalendarScreen, { client: { POST, GET } as unknown as ApiClient, accountId: "account-1", savedViewStore: savedViewStore as unknown as CalendarSavedViewStore })); });
    const tree = JSON.stringify((screen as unknown as { toJSON(): unknown }).toJSON());
    expect(savedViewStore.getMostRecentCompleteView).toHaveBeenCalled();
    expect(tree).toContain("Kayıtlı takvim bilgisi");
    expect(tree).toContain("Güncel olmayabilir");
    expect(tree).toContain("Sulama hattını kontrol et");
    expect(tree).not.toContain("Takvim yüklenemedi");
  });

  it("never exposes a saved view after authorization denial", async () => {
    const savedViewStore = { getMostRecentCompleteView: jest.fn().mockResolvedValue(savedView) };
    const POST = jest.fn().mockResolvedValue({ error: { error: { code: "FORBIDDEN" } }, response: { ok: false, status: 403 } });
    const GET = jest.fn().mockResolvedValue({ response: { ok: true, status: 200 }, data: { items: [], nextCursor: null } });
    let screen!: ReturnType<typeof create>;
    await act(async () => { screen = create(createElement(CalendarScreen, { client: { POST, GET } as unknown as ApiClient, accountId: "account-1", savedViewStore: savedViewStore as unknown as CalendarSavedViewStore })); });
    const tree = JSON.stringify((screen as unknown as { toJSON(): unknown }).toJSON());
    expect(tree).toContain("erişiminiz doğrulanamadı");
    expect(tree).not.toContain("Sulama hattını kontrol et");
    expect(savedViewStore.getMostRecentCompleteView).not.toHaveBeenCalled();
  });

  it("drops expired in-progress pages and restarts the online read with a fresh identity", async () => {
    const overdueTask = { ...task, taskId: "66666666-6666-4666-8666-666666666666", title: "Geciken budama kontrolü", plannedLocalDate: "2026-10-04", overdue: true };
    const expiredRead: Read = { ...savedView, overdueTasksPage: { ...savedView.overdueTasksPage, items: [overdueTask], complete: false, nextCursor: "expired-cursor" } };
    const replacement: Read = { ...savedView, readId: "77777777-7777-4777-8777-777777777777",
      selectedDateTasksPage: { ...savedView.selectedDateTasksPage, items: [{ ...task, title: "Yeni okumadan gelen iş" }], readId: "77777777-7777-4777-8777-777777777777" },
      overdueTasksPage: { ...savedView.overdueTasksPage, readId: "77777777-7777-4777-8777-777777777777" } };
    const savedViewStore = {
      stageInitialRead: jest.fn().mockResolvedValue(undefined), appendPage: jest.fn().mockResolvedValue(undefined), discardIncompleteRead: jest.fn().mockResolvedValue(undefined),
      getMostRecentCompleteView: jest.fn().mockResolvedValue(null), getCompleteView: jest.fn().mockResolvedValue(null),
    };
    const POST = jest.fn()
      .mockResolvedValueOnce({ response: { ok: true, status: 201 }, data: expiredRead })
      .mockResolvedValueOnce({ response: { ok: true, status: 201 }, data: replacement });
    const GET = jest.fn().mockResolvedValue({ response: { ok: false, status: 410 }, error: { error: { code: "READ_EXPIRED" } } });
    let screen!: ReturnType<typeof create>;
    await act(async () => { screen = create(createElement(CalendarScreen, { client: { POST, GET } as unknown as ApiClient, accountId: "account-1", savedViewStore: savedViewStore as unknown as CalendarSavedViewStore })); });
    const more = screen.root.findAll((node) => node.props.accessibilityLabel === "Daha fazla geciken iş" && typeof node.props.onPress === "function")[0];
    expect(more).toBeDefined();
    await act(async () => { (more?.props.onPress as () => void)(); });
    expect(savedViewStore.discardIncompleteRead).toHaveBeenCalledWith("account-1", readId);
    expect(POST).toHaveBeenCalledTimes(2);
    expect(JSON.stringify((screen as unknown as { toJSON(): unknown }).toJSON())).toContain("Yeni okumadan gelen iş");
  });
});
