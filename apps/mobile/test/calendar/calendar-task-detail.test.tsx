import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { CalendarTaskDetail } from "../../src/features/calendar/calendar-task-detail";
import { CalendarScreen } from "../../src/features/calendar/calendar-screen";
import type { ApiClient, CalendarComponents } from "../../../../packages/api-client/src/index";

type Task = CalendarComponents["schemas"]["CalendarTask"];
const task: Task = {
  taskId: "task-1", title: "Sulama hattını kontrol et", plannedLocalDate: "2026-10-04",
  fieldId: "field-1", fieldName: "Kuzey tarla", seasonId: "season-1", overdue: true,
  seasonContext: JSON.stringify({ crop: { displayName: "Arpa" }, region: { agriculturalRegion: { state: "RESOLVED", label: "İç Anadolu" } } }),
  planContext: JSON.stringify({ source: "MANUAL", approvedPlan: {} }),
};

describe("Calendar read-only task detail", () => {
  it("shows original planned date, Field, Season/plan context and overdue status without mutation actions", async () => {
    let screen!: ReturnType<typeof create>;
    await act(async () => { screen = create(createElement(CalendarTaskDetail, { task, onClose: jest.fn(), saved: true })); });
    const tree = JSON.stringify((screen as unknown as { toJSON(): unknown }).toJSON());
    expect(tree).toContain("4 Ekim 2026");
    expect(tree).toContain("Kuzey tarla");
    expect(tree).toContain("Arpa");
    expect(tree).toContain("İç Anadolu");
    expect(tree).toContain("Manuel plan");
    expect(tree).toContain("Gecikmiş");
    expect(tree).toContain("Kaydedilmiş takvim bilgisi");
    for (const forbidden of ["Tamamla", "Düzenle", "Ertele", "Atla", "Tarihi değiştir"]) expect(tree).not.toContain(forbidden);
    const buttons = screen.root.findAll((node) => node.props.accessibilityRole === "button");
    expect([...new Set(buttons.map((node) => node.props.accessibilityLabel))]).toEqual(["Görev ayrıntılarını kapat"]);
  });

  it("opens a task from the agenda into read-only details", async () => {
    const businessId = "22222222-2222-4222-8222-222222222222";
    const fieldId = "33333333-3333-4333-8333-333333333333";
    const readId = "11111111-1111-4111-8111-111111111111";
    const agendaTask = { ...task, taskId: "55555555-5555-4555-8555-555555555555", fieldId, seasonId: "44444444-4444-4444-8444-444444444444" };
    const readScope = { businessId, asOf: "2026-10-06T09:00:00.000Z", businessTimezone: "Europe/Istanbul", businessLocalToday: "2026-10-06", selectedDate: "2026-10-06", monthStart: "2026-10-01", monthEnd: "2026-10-31", fieldScope: { mode: "allAuthorized" as const, includedFieldIds: [fieldId] } };
    const agendaRead: CalendarComponents["schemas"]["CalendarRead"] = {
      readId, businessId, asOf: readScope.asOf, expiresAt: "2026-10-06T09:15:00.000Z", businessTimezone: readScope.businessTimezone,
      businessLocalToday: readScope.businessLocalToday, selectedDate: readScope.selectedDate, monthStart: readScope.monthStart, monthEnd: readScope.monthEnd,
      fieldScope: readScope.fieldScope, activeSeasonExists: true, hasAnyUnfinishedWork: true, monthIndicatorsComplete: true,
      monthIndicators: Array.from({ length: 31 }, (_, index) => ({ date: `2026-10-${String(index + 1).padStart(2, "0")}`, hasWork: index === 5 })),
      selectedDateTasksPage: { readId, group: "selectedDateTasks", complete: true, readScope, items: [agendaTask] },
      overdueTasksPage: { readId, group: "overdueTasks", complete: true, readScope, items: [] },
    };
    const POST = jest.fn().mockResolvedValue({ response: { ok: true, status: 200 }, data: agendaRead });
    const GET = jest.fn().mockResolvedValue({ response: { ok: true, status: 200 }, data: { items: [], complete: true } });
    let screen!: ReturnType<typeof create>;
    await act(async () => { screen = create(createElement(CalendarScreen, { client: { POST, GET } as unknown as ApiClient, accountId: "account-1" })); });
    await act(async () => {
      const taskButton = screen.root.findAll((node) => node.props.accessibilityLabel === "Sulama hattını kontrol et, Kuzey tarla, 4 Ekim 2026")[0];
      (taskButton?.props.onPress as () => void)();
    });
    const tree = JSON.stringify((screen as unknown as { toJSON(): unknown }).toJSON());
    expect(tree).toContain("Görev ayrıntılarını kapat");
    expect(tree).toContain("Manuel plan");
    for (const forbidden of ["Tamamla", "Düzenle", "Ertele", "Atla", "Tarihi değiştir"]) expect(tree).not.toContain(forbidden);
  });
});
