import { Pressable } from "react-native";
import { createElement } from "react";
import { TodayContent, TodayScreen } from "../../src/features/seasons/today-screen";
import type { ApiClient, SeasonOperations, TaskDateAdjustmentComponents } from "../../../../packages/api-client/src/index";
import type { TaskCompletionCommandStore } from "../../src/features/tasks/task-completion-command-store";

type Today = SeasonOperations["getTodayPlannedTasks"]["responses"][200]["content"]["application/json"];
type Element = { type: unknown; props: Record<string, unknown> };
// react-test-renderer v19 ships without declarations; keep the mounted screen test narrowly typed.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act, create } = require("react-test-renderer") as {
  act: (callback: () => void | Promise<void>) => Promise<void>;
  create: (element: React.ReactElement) => { root: { findAll(predicate: (node: Element) => boolean): Element[] }; toJSON: () => unknown };
};

const data: Today = { localDate: "2026-10-12", businessTimezone: "Pacific/Honolulu", tasks: [{
  id: "task-1", seasonId: "season-1", fieldId: "field-1", title: "Sulama kontrolü", cropDisplayName: "Arpa",
  plannedLocalDate: "2026-10-12", sourceKind: "MANUAL", taskVersion: 4,
}] };

function elements(node: unknown): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const item = node as Element;
  return [item, ...elements(item.props.children)];
}

describe("Today task date adjustment entry", () => {
  test("opens adjustment only from live task data and keeps cached Today read-only", () => {
    const onAdjust = jest.fn();
    const live = elements(TodayContent({ loading: false, error: null, data, onRetry: jest.fn(), onAdjust }));
    const action = live.find(({ type, props }) => type === Pressable && props.accessibilityLabel === "Ertele veya yeniden planla: Sulama kontrolü");
    expect(action?.props.accessibilityRole).toBe("button");
    (action?.props.onPress as (() => void) | undefined)?.();
    expect(onAdjust).toHaveBeenCalledWith(data.tasks[0]);

    const cached = elements(TodayContent({ loading: false, error: null, data, onRetry: jest.fn(), onAdjust, cached: true }));
    expect(cached.some(({ type, props }) => type === Pressable && props.accessibilityLabel === "Ertele veya yeniden planla: Sulama kontrolü")).toBe(false);
    expect(cached.some(({ props }) => props.children === "Tarih değişikliği için internet bağlantısı gerekir.")).toBe(true);
  });

  test("shows accessible loading and adjustment conflict outcomes in Today", () => {
    const onAdjust = jest.fn();
    const loading = elements(TodayContent({ loading: false, error: null, data, onRetry: jest.fn(), onAdjust, adjustmentStates: { "task-1": "LOADING" } }));
    expect(loading.some(({ type, props }) => type === Pressable && props.accessibilityState && (props.accessibilityState as { busy?: boolean }).busy)).toBe(true);
    const conflict = elements(TodayContent({ loading: false, error: null, data, onRetry: jest.fn(), onAdjust, adjustmentStates: { "task-1": "CONFLICT" } }));
    expect(conflict.some(({ props }) => String(props.children).includes("Görev bilgisi değişti"))).toBe(true);
    expect(conflict.some(({ type, props }) => type === Pressable && props.accessibilityLabel === "Görev tarihini yeniden gözden geçir: Sulama kontrolü")).toBe(true);
  });

  test("reloads fresh server Today data only after an accepted adjustment", async () => {
    const state: TaskDateAdjustmentComponents["schemas"]["TaskDateAdjustmentHistoryPage"] = {
      task: { taskId: "task-1", plannedLocalDate: "2026-10-12", taskVersion: 4, adjustable: true }, items: [], nextCursor: null,
    };
    const accepted: TaskDateAdjustmentComponents["schemas"]["TaskDateAdjustment"] = {
      adjustmentId: "adjustment-1", taskId: "task-1", previousPlannedLocalDate: "2026-10-12", newPlannedLocalDate: "2026-10-14",
      baseTaskVersion: 4, acceptedTaskVersion: 5, adjustedAt: "2026-10-08T10:00:00.000Z",
    };
    let todayReads = 0;
    const GET = jest.fn(async (path: string) => {
      if (path === "/today") {
        todayReads += 1;
        return { data: todayReads === 1 ? data : { ...data, tasks: [] }, error: undefined, response: { ok: true, status: 200 } };
      }
      if (path === "/tasks/{taskId}/date-adjustments") return { data: state, error: undefined, response: { ok: true, status: 200 } };
      return { data: { items: [], nextCursor: null }, error: undefined, response: { ok: true, status: 200 } };
    });
    const POST = jest.fn().mockResolvedValue({ data: accepted, error: undefined, response: { ok: true, status: 201 } });
    const store = { list: async () => [], writeTodaySnapshot: async () => undefined, readTodaySnapshot: async () => null } as unknown as TaskCompletionCommandStore;
    let screen!: ReturnType<typeof create>;
    const now = () => new Date("2026-10-12T10:00:00.000Z");
    await act(async () => { screen = create(createElement(TodayScreen, { client: { GET, POST } as unknown as ApiClient, accountId: "account-1", store, now })); });
    const adjust = screen.root.findAll(({ props }) => props.accessibilityLabel === "Ertele veya yeniden planla: Sulama kontrolü")[0];
    expect(adjust).toBeDefined();
    await act(async () => { (adjust!.props.onPress as () => void)(); });
    for (let attempt = 0; attempt < 10 && screen.root.findAll(({ props }) => props.accessibilityLabel === "Yeni planlanan tarih").length === 0; attempt += 1) {
      await act(async () => { await Promise.resolve(); });
    }
    const input = screen.root.findAll(({ props }) => props.accessibilityLabel === "Yeni planlanan tarih")[0];
    await act(async () => { (input!.props.onChangeText as (value: string) => void)("2026-10-14"); });
    const save = screen.root.findAll(({ props }) => props.accessibilityLabel === "Tarih değişikliğini kaydet")[0];
    await act(async () => { (save!.props.onPress as () => void)(); });
    for (let attempt = 0; attempt < 20 && todayReads < 2; attempt += 1) await act(async () => { await Promise.resolve(); });

    expect(POST).toHaveBeenCalledWith("/tasks/{taskId}/date-adjustments", {
      params: { path: { taskId: "task-1" }, header: { "If-Match": "4" } },
      body: { adjustmentId: expect.any(String), newPlannedLocalDate: "2026-10-14" },
    });
    expect(todayReads).toBe(2);
    expect(JSON.stringify(screen.toJSON())).toContain("Görev tarihi değişikliği kaydedildi.");
    expect(JSON.stringify(screen.toJSON())).not.toContain("Sulama kontrolü");
  });
});
