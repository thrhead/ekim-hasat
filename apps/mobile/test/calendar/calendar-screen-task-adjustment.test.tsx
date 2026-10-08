jest.mock("@react-native-async-storage/async-storage", () => (
  jest.requireActual("@react-native-async-storage/async-storage/jest/async-storage-mock")
));

import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { CalendarScreen } from "../../src/features/calendar/calendar-screen";
import type { ApiClient, CalendarComponents, TaskDateAdjustmentComponents } from "../../../../packages/api-client/src/index";

const businessId = "22222222-2222-4222-8222-222222222222";
const fieldId = "33333333-3333-4333-8333-333333333333";
const taskId = "55555555-5555-4555-8555-555555555555";
const readScope: CalendarComponents["schemas"]["CalendarReadScope"] = {
  businessId, asOf: "2026-10-08T09:00:00.000Z", businessTimezone: "Pacific/Honolulu", businessLocalToday: "2026-10-07",
  selectedDate: "2026-10-07", monthStart: "2026-10-01", monthEnd: "2026-10-31",
  fieldScope: { mode: "oneField", fieldId, includedFieldIds: [fieldId] },
};

function read(readId: string, date: string, items: CalendarComponents["schemas"]["CalendarTask"][]): CalendarComponents["schemas"]["CalendarRead"] {
  const scope = { ...readScope, selectedDate: date };
  const page: CalendarComponents["schemas"]["CalendarTaskPageFirst"] = { readId, group: "selectedDateTasks", complete: true, readScope: scope, items };
  return {
    readId, businessId, asOf: scope.asOf, expiresAt: "2026-10-08T09:15:00.000Z", businessTimezone: scope.businessTimezone,
    businessLocalToday: scope.businessLocalToday, selectedDate: date, monthStart: scope.monthStart, monthEnd: scope.monthEnd,
    fieldScope: scope.fieldScope, activeSeasonExists: true, hasAnyUnfinishedWork: items.length > 0, monthIndicatorsComplete: true,
    monthIndicators: Array.from({ length: 31 }, (_, index) => ({ date: `2026-10-${String(index + 1).padStart(2, "0")}`, hasWork: date === "2026-10-07" && index === 6 })),
    selectedDateTasksPage: page, overdueTasksPage: { ...page, group: "overdueTasks", items: [] },
  };
}

const task: CalendarComponents["schemas"]["CalendarTask"] = {
  taskId, title: "Sulama kontrolü", plannedLocalDate: "2026-10-07", fieldId, fieldName: "Kuzey tarla", seasonId: "44444444-4444-4444-8444-444444444444", overdue: false, taskVersion: 4,
};
const current: TaskDateAdjustmentComponents["schemas"]["TaskDateAdjustmentHistoryPage"] = {
  task: { taskId, plannedLocalDate: "2026-10-07", taskVersion: 4, adjustable: true }, items: [], nextCursor: null,
};
const accepted: TaskDateAdjustmentComponents["schemas"]["TaskDateAdjustment"] = {
  adjustmentId: "adjustment-1", taskId, previousPlannedLocalDate: "2026-10-07", newPlannedLocalDate: "2026-10-09",
  baseTaskVersion: 4, acceptedTaskVersion: 5, adjustedAt: "2026-10-08T10:00:00.000Z",
};

describe("Calendar accepted task adjustment", () => {
  test("starts a new read for server-selected date and Field scope without rewriting the old snapshot", async () => {
    const original = read("11111111-1111-4111-8111-111111111111", "2026-10-07", [task]);
    const fresh = read("77777777-7777-4777-8777-777777777777", "2026-10-07", []);
    const reads: CalendarComponents["schemas"]["CalendarRead"][] = [original, fresh];
    const POST = jest.fn().mockImplementation(async (_path: string, request: { body: { selectedDate?: string; fieldId?: string } }) => {
      if (request.body.selectedDate === undefined) return { data: original, error: undefined, response: { ok: true, status: 201 } };
      return { data: fresh, error: undefined, response: { ok: true, status: 201 } };
    });
    let acceptedResult = false;
    const GET = jest.fn(async (path: string) => path === "/tasks/{taskId}/date-adjustments"
      ? { data: current, error: undefined, response: { ok: true, status: 200 } }
      : { data: { items: [], nextCursor: null }, error: undefined, response: { ok: true, status: 200 } });
    const client = { POST: jest.fn(async (path: string, request: unknown) => {
      if (path === "/v1/calendar/reads") return POST(path, request as never);
      acceptedResult = true;
      return { data: accepted, error: undefined, response: { ok: true, status: 201 } };
    }), GET } as unknown as ApiClient;
    let screen!: ReturnType<typeof create>;
    await act(async () => { screen = create(createElement(CalendarScreen, { client, accountId: "account-1" })); });
    await act(async () => {
      const taskButton = screen.root.findAll((node) => String(node.props.accessibilityLabel ?? "").includes("Sulama kontrolü"))[0];
      expect(taskButton).toBeDefined();
      (taskButton!.props.onPress as () => void)();
    });
    const action = screen.root.findAll((node) => node.props.accessibilityLabel === "Ertele veya yeniden planla")[0];
    expect(action).toBeDefined();
    await act(async () => { (action!.props.onPress as () => void)(); });
    await act(async () => {});
    const dateInput = screen.root.findAll((node) => node.props.accessibilityLabel === "Yeni planlanan tarih")[0];
    await act(async () => { (dateInput?.props.onChangeText as (date: string) => void)("2026-10-09"); });
    const submit = screen.root.findAll((node) => node.props.accessibilityLabel === "Tarih değişikliğini kaydet")[0];
    await act(async () => { (submit?.props.onPress as () => void)(); });

    expect(acceptedResult).toBe(true);
    expect(screen.root.findAll((node) => node.props.accessibilityLabel === "Görev ayrıntılarını kapat")).toHaveLength(0);
    expect(POST.mock.calls).toEqual([
      ["/v1/calendar/reads", { body: {} }],
      ["/v1/calendar/reads", { body: { selectedDate: "2026-10-07", fieldId } }],
    ]);
    expect(original.readId).toBe("11111111-1111-4111-8111-111111111111");
    expect(original.selectedDateTasksPage.items[0]?.plannedLocalDate).toBe("2026-10-07");
    expect(reads[0]?.readId).not.toBe(reads[1]?.readId);
  });
});
