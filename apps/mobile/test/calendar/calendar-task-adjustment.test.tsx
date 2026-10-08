import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { CalendarTaskDetail } from "../../src/features/calendar/calendar-task-detail";
import type { CalendarComponents } from "../../../../packages/api-client/src/index";

type Task = CalendarComponents["schemas"]["CalendarTask"];

const task: Task = {
  taskId: "task-1", title: "Sulama hattını kontrol et", plannedLocalDate: "2026-10-14", fieldId: "field-1",
  fieldName: "Kuzey tarla", seasonId: "season-1", overdue: false, taskVersion: 4,
};

describe("Calendar task date adjustment entry", () => {
  test("shows adjustment action in live task detail and keeps saved task detail read-only", async () => {
    const client = { GET: jest.fn() } as never;
    let live!: ReturnType<typeof create>;
    await act(async () => { live = create(createElement(CalendarTaskDetail, { task, onClose: jest.fn(), saved: false, client, onAccepted: jest.fn() })); });
    expect(live.root.findAll((node) => node.props.accessibilityLabel === "Ertele veya yeniden planla").length).toBeGreaterThan(0);
    expect(live.root.findAll((node) => node.props.accessibilityLabel === "Sulama hattını kontrol et, Kuzey tarla, 14 Ekim 2026")).toHaveLength(0);

    let saved!: ReturnType<typeof create>;
    await act(async () => { saved = create(createElement(CalendarTaskDetail, { task, onClose: jest.fn(), saved: true, client, onAccepted: jest.fn() })); });
    expect(saved.root.findAll((node) => node.props.accessibilityLabel === "Ertele veya yeniden planla")).toHaveLength(0);
    expect(saved.root.findAll((node) => node.props.accessibilityLabel === "Görev ayrıntılarını kapat").length).toBeGreaterThan(0);
  });
});
