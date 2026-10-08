import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { createTaskDateAdjustmentFlow } from "../../src/features/tasks/task-date-adjustment";
import { TaskDateAdjustmentView } from "../../src/features/tasks/task-date-adjustment-view";
import type { ApiClient, TaskDateAdjustmentComponents } from "../../../../packages/api-client/src/index";

type Page = TaskDateAdjustmentComponents["schemas"]["TaskDateAdjustmentHistoryPage"];

const first: Page = {
  task: { taskId: "task-1", plannedLocalDate: "2026-10-14", taskVersion: 5, adjustable: true },
  items: [{ adjustmentId: "adjustment-1", previousPlannedLocalDate: "2026-10-12", newPlannedLocalDate: "2026-10-14", adjustedAt: "2026-10-08T10:00:00.000Z" }],
  nextCursor: "cursor-2",
};
const second: Page = {
  ...first,
  items: [{ adjustmentId: "adjustment-2", previousPlannedLocalDate: "2026-10-10", newPlannedLocalDate: "2026-10-12", adjustedAt: "2026-10-07T10:00:00.000Z" }],
  nextCursor: null,
};

describe("task date adjustment detail", () => {
  test("keeps the task name and current planned date visible while choosing a new date", async () => {
    const GET = jest.fn().mockResolvedValue({ data: first, error: undefined, response: { ok: true, status: 200 } });
    const flow = createTaskDateAdjustmentFlow({ client: { GET, POST: jest.fn() } as unknown as ApiClient });
    let screen!: ReturnType<typeof create>;
    await act(async () => { screen = create(createElement(TaskDateAdjustmentView, { taskId: "task-1", taskTitle: "Sulama kontrolü", flow, onAccepted: jest.fn() })) as typeof screen; });
    const open = screen.root.findAll((node) => node.props.accessibilityLabel === "Ertele / Yeniden planla")[0];
    await act(async () => { (open!.props.onPress as () => void)(); });

    const tree = JSON.stringify((screen as unknown as { toJSON(): unknown }).toJSON());
    expect(tree).toContain("Sulama kontrolü");
    expect(tree).toContain("Mevcut planlanan tarih: 14 Ekim 2026");
    expect(tree).toContain("Yeni planlanan tarih");
  });

  test("disables the save action while the selected date is still canonical", async () => {
    const GET = jest.fn().mockResolvedValue({ data: first, error: undefined, response: { ok: true, status: 200 } });
    const flow = createTaskDateAdjustmentFlow({ client: { GET, POST: jest.fn() } as unknown as ApiClient });
    let screen!: ReturnType<typeof create>;
    await act(async () => { screen = create(createElement(TaskDateAdjustmentView, { taskId: "task-1", flow, onAccepted: jest.fn() })) as typeof screen; });
    const open = screen.root.findAll((node) => node.props.accessibilityLabel === "Ertele / Yeniden planla")[0];
    await act(async () => { (open!.props.onPress as () => void)(); });
    const save = screen.root.findAll((node) => node.props.accessibilityLabel === "Tarih değişikliğini kaydet")[0];
    expect(save?.props.disabled).toBe(true);
    expect((save?.props.accessibilityState as { disabled?: boolean }).disabled).toBe(true);
  });

  test("loads the next bounded history page and appends it to current task history", async () => {
    const GET = jest.fn()
      .mockResolvedValueOnce({ data: first, error: undefined, response: { ok: true, status: 200 } })
      .mockResolvedValueOnce({ data: second, error: undefined, response: { ok: true, status: 200 } });
    const flow = createTaskDateAdjustmentFlow({ client: { GET, POST: jest.fn() } as unknown as ApiClient });
    let screen!: ReturnType<typeof create> & { toJSON: () => unknown };
    await act(async () => { screen = create(createElement(TaskDateAdjustmentView, { taskId: "task-1", flow, onAccepted: jest.fn() })) as typeof screen; });
    const open = screen.root.findAll((node) => node.props.accessibilityLabel === "Ertele / Yeniden planla")[0];
    await act(async () => { (open!.props.onPress as () => void)(); });
    const more = screen.root.findAll((node) => node.props.accessibilityLabel === "Daha fazla tarih değişikliği yükle")[0];
    expect(more).toBeDefined();
    await act(async () => { (more!.props.onPress as () => void)(); });

    expect(GET).toHaveBeenNthCalledWith(2, "/tasks/{taskId}/date-adjustments", {
      params: { path: { taskId: "task-1" }, query: { limit: 50, cursor: "cursor-2" } },
    });
    const tree = JSON.stringify(screen.toJSON());
    expect(tree).toContain("10 Eki 2026");
    expect(tree).toContain("12 Eki 2026");
  });
});
