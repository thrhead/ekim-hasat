jest.mock("@react-native-async-storage/async-storage", () => (
  jest.requireActual("@react-native-async-storage/async-storage/jest/async-storage-mock")
));

import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { CalendarScreen } from "../../src/features/calendar/calendar-screen";
import type { ApiClient, CalendarComponents } from "../../../../packages/api-client/src/index";

const readId = "11111111-1111-4111-8111-111111111111";
const businessId = "22222222-2222-4222-8222-222222222222";
const fieldId = "33333333-3333-4333-8333-333333333333";
const seasonId = "44444444-4444-4444-8444-444444444444";
const scope = {
  businessId, asOf: "2026-10-06T09:00:00.000Z", businessTimezone: "Europe/Istanbul",
  businessLocalToday: "2026-10-06", selectedDate: "2026-10-06", monthStart: "2026-10-01", monthEnd: "2026-10-31",
  fieldScope: { mode: "allAuthorized" as const, includedFieldIds: [fieldId] },
};
const read: CalendarComponents["schemas"]["CalendarRead"] = {
  readId, asOf: scope.asOf, expiresAt: "2026-10-06T09:15:00.000Z", businessId, businessTimezone: scope.businessTimezone,
  businessLocalToday: scope.businessLocalToday, selectedDate: scope.selectedDate, monthStart: scope.monthStart, monthEnd: scope.monthEnd,
  fieldScope: scope.fieldScope, activeSeasonExists: true, hasAnyUnfinishedWork: true, monthIndicatorsComplete: true,
  monthIndicators: Array.from({ length: 31 }, (_, index) => ({ date: `2026-10-${String(index + 1).padStart(2, "0")}`, hasWork: index === 5 })),
  selectedDateTasksPage: { readId, group: "selectedDateTasks", complete: true, readScope: scope,
    items: [{ taskId: "55555555-5555-4555-8555-555555555555", title: "Bugün sulamayı kontrol et", plannedLocalDate: "2026-10-06", fieldId, fieldName: "Kuzey tarla", seasonId, overdue: false }] },
  overdueTasksPage: { readId, group: "overdueTasks", complete: true, readScope: scope,
    items: [{ taskId: "66666666-6666-4666-8666-666666666666", title: "Geciken ilaçlama kontrolü", plannedLocalDate: "2026-10-04", fieldId, fieldName: "Kuzey tarla", seasonId, overdue: true }] },
};
type Renderer = ReturnType<typeof create>;

describe("Calendar accessibility", () => {
  it("announces loading and retryable status and labels task and month controls", async () => {
    let reject!: (reason: unknown) => void;
    const pending = new Promise((_resolve, fail) => { reject = fail; });
    const POST = jest.fn().mockReturnValueOnce(pending).mockResolvedValueOnce({ data: read, response: { ok: true, status: 201 } });
    const GET = jest.fn().mockResolvedValue({ data: { items: [{ id: fieldId, name: "Kuzey tarla", version: 1, representativePoint: { type: "Point", coordinates: [29, 41] }, hasCurrentBoundary: false }], nextCursor: null }, response: { ok: true, status: 200 } });
    let screen!: Renderer;
    await act(async () => { screen = create(createElement(CalendarScreen, { client: { POST, GET } as unknown as ApiClient, accountId: "account-1" })); });
    const loading = screen.root.findAll(({ props }) => props.accessibilityLabel === "Takvim yükleniyor")[0];
    expect(loading?.props.accessibilityRole).toBe("progressbar");
    expect(loading?.props.accessibilityLiveRegion).toBe("polite");
    await act(async () => { reject(new TypeError("offline")); });
    const error = screen.root.findAll(({ props }) => props.accessibilityRole === "alert")[0];
    expect(error?.props.accessibilityLiveRegion).toBe("assertive");
    const retry = screen.root.findAll(({ props }) => props.accessibilityLabel === "Takvimi yeniden dene")[0];
    expect(retry?.props.accessibilityRole).toBe("button");
    await act(async () => { (retry?.props.onPress as () => void)(); });

    const date = screen.root.findAll(({ props }) => props.accessibilityLabel === "Tarihi seç: 6 Ekim 2026")[0];
    expect(date?.props.accessibilityRole).toBe("button");
    expect(date?.props.accessibilityState).toMatchObject({ selected: true });
    expect(date?.props.accessibilityHint).toContain("planlanmış iş var");
    const fieldFilter = screen.root.findAll(({ props }) => props.accessibilityLabel === "Tarla filtresi: Tüm tarlalar")[0];
    expect(fieldFilter?.props.accessibilityRole).toBe("button");
    const task = screen.root.findAll(({ props }) => props.accessibilityLabel === "Bugün sulamayı kontrol et, Kuzey tarla, 6 Ekim 2026")[0];
    expect(task).toBeDefined();
  });

  it("labels continuation for the selected date instead of always calling it today", async () => {
    const selectedDate = "2026-10-05";
    const selectedReadId = "77777777-7777-4777-8777-777777777777";
    const selectedRead: CalendarComponents["schemas"]["CalendarRead"] = {
      ...read,
      readId: selectedReadId,
      selectedDate,
      selectedDateTasksPage: {
        ...read.selectedDateTasksPage,
        readId: selectedReadId,
        complete: false,
        nextCursor: "selected-date-cursor",
        readScope: { ...scope, selectedDate },
        items: [{ ...read.selectedDateTasksPage.items[0]!, taskId: "88888888-8888-4888-8888-888888888888", plannedLocalDate: selectedDate }],
      },
      overdueTasksPage: { ...read.overdueTasksPage, readId: selectedReadId, readScope: { ...scope, selectedDate } },
    };
    const POST = jest.fn()
      .mockResolvedValueOnce({ data: read, response: { ok: true, status: 201 } })
      .mockResolvedValueOnce({ data: selectedRead, response: { ok: true, status: 201 } });
    const GET = jest.fn().mockResolvedValue({ data: { items: [], nextCursor: null }, response: { ok: true, status: 200 } });
    let screen!: Renderer;
    await act(async () => { screen = create(createElement(CalendarScreen, { client: { POST, GET } as unknown as ApiClient, accountId: "account-1" })); });
    const selectedDay = screen.root.findAll(({ props }) => props.accessibilityLabel === "Tarihi seç: 5 Ekim 2026")[0];
    await act(async () => { (selectedDay?.props.onPress as () => void)(); });
    const more = screen.root.findAll(({ props }) => props.accessibilityLabel === "Seçilen günün işlerinin devamını yükle")[0];
    expect(more?.props.accessibilityRole).toBe("button");
  });

  it("removes previously visible work after the server denies authorization", async () => {
    const POST = jest.fn()
      .mockResolvedValueOnce({ data: read, response: { ok: true, status: 201 } })
      .mockResolvedValueOnce({ error: { error: { code: "FORBIDDEN" } }, response: { ok: false, status: 403 } });
    const GET = jest.fn().mockResolvedValue({ data: { items: [], nextCursor: null }, response: { ok: true, status: 200 } });
    let screen!: Renderer;
    await act(async () => { screen = create(createElement(CalendarScreen, { client: { POST, GET } as unknown as ApiClient, accountId: "account-1" })); });
    expect(screen.root.findAll(({ props }) => props.accessibilityLabel === "Bugün sulamayı kontrol et, Kuzey tarla, 6 Ekim 2026").length).toBeGreaterThan(0);
    const date = screen.root.findAll(({ props }) => props.accessibilityLabel === "Tarihi seç: 6 Ekim 2026")[0];
    await act(async () => { (date?.props.onPress as () => void)(); });
    expect(screen.root.findAll(({ props }) => props.accessibilityLabel === "Bugün sulamayı kontrol et, Kuzey tarla, 6 Ekim 2026")).toHaveLength(0);
    expect(screen.root.findAll(({ props }) => props.accessibilityRole === "alert").length).toBeGreaterThan(0);
  });
});
