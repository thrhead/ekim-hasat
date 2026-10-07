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
const monthIndicators = Array.from({ length: 31 }, (_, index) => ({ date: `2026-10-${String(index + 1).padStart(2, "0")}`, hasWork: index === 5 }));
const response = {
  readId,
  asOf: "2026-10-06T09:00:00.000Z",
  expiresAt: "2026-10-06T09:15:00.000Z",
  businessId,
  businessTimezone: "Europe/Istanbul",
  businessLocalToday: "2026-10-06",
  selectedDate: "2026-10-06",
  monthStart: "2026-10-01",
  monthEnd: "2026-10-31",
  fieldScope: { mode: "allAuthorized" as const, includedFieldIds: [fieldId] },
  activeSeasonExists: true,
  hasAnyUnfinishedWork: true,
  monthIndicatorsComplete: true as const,
  monthIndicators,
  selectedDateTasksPage: {
    readId, group: "selectedDateTasks" as const, complete: true, readScope: {
      businessId, asOf: "2026-10-06T09:00:00.000Z", businessTimezone: "Europe/Istanbul",
      businessLocalToday: "2026-10-06", selectedDate: "2026-10-06", monthStart: "2026-10-01", monthEnd: "2026-10-31",
      fieldScope: { mode: "allAuthorized" as const, includedFieldIds: [fieldId] },
    }, items: [{ taskId: "55555555-5555-4555-8555-555555555555", title: "Bugün sulamayı kontrol et", plannedLocalDate: "2026-10-06", fieldId, fieldName: "Kuzey tarla", seasonId, overdue: false }],
  },
  overdueTasksPage: {
    readId, group: "overdueTasks" as const, complete: true, readScope: {
      businessId, asOf: "2026-10-06T09:00:00.000Z", businessTimezone: "Europe/Istanbul",
      businessLocalToday: "2026-10-06", selectedDate: "2026-10-06", monthStart: "2026-10-01", monthEnd: "2026-10-31",
      fieldScope: { mode: "allAuthorized" as const, includedFieldIds: [fieldId] },
    }, items: [{ taskId: "66666666-6666-4666-8666-666666666666", title: "Geciken ilaçlama kontrolü", plannedLocalDate: "2026-10-04", fieldId, fieldName: "Kuzey tarla", seasonId, overdue: true }],
  },
} satisfies CalendarComponents["schemas"]["CalendarRead"];

type TestRenderer = ReturnType<typeof create> & { toJSON: () => unknown };

function readForDate(selectedDate: string, fieldScope: CalendarComponents["schemas"]["FieldScope"] = response.fieldScope): CalendarComponents["schemas"]["CalendarRead"] {
  const monthStart = `${selectedDate.slice(0, 7)}-01`;
  const days = new Date(Date.UTC(Number(selectedDate.slice(0, 4)), Number(selectedDate.slice(5, 7)), 0)).getUTCDate();
  const monthEnd = `${selectedDate.slice(0, 7)}-${String(days).padStart(2, "0")}`;
  const readScope = { businessId, asOf: response.asOf, businessTimezone: response.businessTimezone,
    businessLocalToday: response.businessLocalToday, selectedDate, monthStart, monthEnd, fieldScope };
  const indicators = Array.from({ length: days }, (_, index) => ({ date: `${selectedDate.slice(0, 7)}-${String(index + 1).padStart(2, "0")}`, hasWork: fieldScope.mode === "allAuthorized" && index === 5 }));
  const nextReadId = "77777777-7777-4777-8777-777777777777";
  return { ...response, readId: nextReadId, selectedDate, monthStart, monthEnd, fieldScope, hasAnyUnfinishedWork: false,
    monthIndicators: indicators,
    selectedDateTasksPage: { ...response.selectedDateTasksPage, readId: nextReadId, readScope, items: [] },
    overdueTasksPage: { ...response.overdueTasksPage, readId: nextReadId, readScope, items: [] } };
}

async function mount(POST: jest.Mock, GET = jest.fn()) {
  let screen!: TestRenderer;
  await act(async () => {
    screen = create(createElement(CalendarScreen, { client: { POST, GET } as unknown as ApiClient, accountId: "account-1" })) as unknown as TestRenderer;
  });
  return screen;
}

function renderedText(screen: TestRenderer): string { return JSON.stringify(screen.toJSON()); }
function node(screen: TestRenderer, label: string) {
  const found = screen.root.findAll((candidate) => candidate.props.accessibilityLabel === label);
  expect(found.length).toBeGreaterThan(0);
  return found[0]!;
}

describe("Calendar agenda screen", () => {
  it("starts without a selectedDate and displays resolved date, overdue and selected-date work read-only", async () => {
    const POST = jest.fn().mockResolvedValue({ data: response, error: undefined, response: { ok: true, status: 201 } });
    const screen = await mount(POST);
    expect(POST).toHaveBeenCalledWith("/v1/calendar/reads", { body: {} });
    expect(renderedText(screen)).toContain("6 Ekim 2026");
    expect(renderedText(screen)).toContain("Geciken ilaçlama kontrolü");
    expect(renderedText(screen)).toContain("Bugün sulamayı kontrol et");
    const labels = screen.root.findAll((candidate) => candidate.props.accessibilityRole === "button").map((candidate) => String(candidate.props.accessibilityLabel ?? "").toLocaleLowerCase("tr-TR"));
    for (const forbidden of ["tamamla", "düzenle", "ertele", "atla", "yeniden planla", "hava durumuna göre değiştir"]) {
      expect(labels.some((label) => label.includes(forbidden))).toBe(false);
    }
  });

  it("shows essential loading, empty, and retryable error states", async () => {
    let reject!: (error: Error) => void;
    const pending = new Promise((_resolve, fail) => { reject = fail; });
    const POST = jest.fn().mockReturnValueOnce(pending).mockResolvedValueOnce({ data: { ...response, hasAnyUnfinishedWork: false, selectedDateTasksPage: { ...response.selectedDateTasksPage, items: [] }, overdueTasksPage: { ...response.overdueTasksPage, items: [] } }, response: { ok: true, status: 201 } });
    const screen = await mount(POST);
    expect(node(screen, "Takvim yükleniyor").props.accessibilityRole).toBe("progressbar");
    await act(async () => { reject(new TypeError("offline")); });
    expect(renderedText(screen)).toContain("Takvim yüklenemedi");
    const retry = screen.root.findAll((candidate) => candidate.props.accessibilityLabel === "Takvimi yeniden dene")[0];
    const onPress = retry?.props.onPress as (() => void) | undefined;
    expect(onPress).toBeDefined();
    await act(async () => { onPress!(); });
    expect(renderedText(screen)).toContain("Bugün için veya geciken planlanmış iş yok");
  });

  it("continues an incomplete overdue chain with its readId and recorded cursor", async () => {
    const first = { ...response, overdueTasksPage: { ...response.overdueTasksPage, complete: false, nextCursor: "next-overdue" } };
    const nextTask = { taskId: "99999999-9999-4999-8999-999999999999", title: "Geciken budama kontrolü", plannedLocalDate: "2026-10-05", fieldId, fieldName: "Kuzey tarla", seasonId, overdue: true };
    const POST = jest.fn().mockResolvedValue({ data: first, response: { ok: true, status: 201 } });
    const GET = jest.fn().mockResolvedValue({ data: { readId, group: "overdueTasks", requestedCursor: "next-overdue", readScope: response.overdueTasksPage.readScope, items: [nextTask], complete: true }, response: { ok: true, status: 200 } });
    const screen = await mount(POST, GET);
    const more = node(screen, "Daha fazla geciken iş").props.onPress as () => void;
    await act(async () => { more(); });
    expect(GET).toHaveBeenCalledWith("/v1/calendar/reads/{readId}/pages", {
      params: { path: { readId }, query: { group: "overdueTasks", cursor: "next-overdue" } },
    });
    expect(renderedText(screen)).toContain("Geciken budama kontrolü");
  });

  it("shows month work presence and starts a new read for an explicitly selected date or month", async () => {
    const selectedDateRead = readForDate("2026-10-07");
    const selectedTaskPage = { ...response.selectedDateTasksPage, readId: selectedDateRead.readId,
      readScope: selectedDateRead.selectedDateTasksPage.readScope,
      items: [{ ...response.selectedDateTasksPage.items[0]!, plannedLocalDate: "2026-10-07" }] };
    const POST = jest.fn()
      .mockResolvedValueOnce({ data: response, response: { ok: true, status: 201 } })
      .mockResolvedValueOnce({ data: { ...selectedDateRead, hasAnyUnfinishedWork: true, selectedDateTasksPage: selectedTaskPage }, response: { ok: true, status: 201 } })
      .mockResolvedValueOnce({ data: readForDate("2026-11-07"), response: { ok: true, status: 201 } });
    const screen = await mount(POST);
    expect(node(screen, "Aylık iş görünümü").props.accessibilityRole).toBe("summary");
    const seventh = node(screen, "Tarihi seç: 7 Ekim 2026").props.onPress as () => void;
    await act(async () => { seventh(); });
    expect(POST.mock.calls[1]).toEqual(["/v1/calendar/reads", { body: { selectedDate: "2026-10-07" } }]);
    expect(renderedText(screen)).toContain("Seçilen günün işleri");
    const nextMonth = node(screen, "Sonraki ay").props.onPress as () => void;
    await act(async () => { nextMonth(); });
    expect(POST.mock.calls[2]).toEqual(["/v1/calendar/reads", { body: { selectedDate: "2026-11-07" } }]);
    expect(renderedText(screen)).toContain("7 Kasım 2026");
  });

  it("narrows both task groups and month indicators to one Field and explains its no-work state", async () => {
    const fieldScope = { mode: "oneField" as const, fieldId, includedFieldIds: [fieldId] };
    const POST = jest.fn()
      .mockResolvedValueOnce({ data: response, response: { ok: true, status: 201 } })
      .mockResolvedValueOnce({ data: readForDate("2026-10-06", fieldScope), response: { ok: true, status: 201 } });
    const GET = jest.fn().mockResolvedValue({ data: { items: [{ id: fieldId, name: "Kuzey tarla", version: 1, representativePoint: { type: "Point", coordinates: [29, 41] }, hasCurrentBoundary: false }], nextCursor: null }, response: { ok: true, status: 200 } });
    const screen = await mount(POST, GET);
    const openFilter = node(screen, "Tarla filtresi: Tüm tarlalar").props.onPress as () => void;
    await act(async () => { openFilter(); });
    const chooseField = node(screen, "Tarla filtresi: Kuzey tarla").props.onPress as () => void;
    await act(async () => { chooseField(); });
    expect(POST.mock.calls[1]).toEqual(["/v1/calendar/reads", { body: { selectedDate: "2026-10-06", fieldId } }]);
    expect(renderedText(screen)).toContain("Bu tarlada bugün için veya geciken planlanmış iş yok");
  });
});
