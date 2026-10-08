import { Pressable, Text } from "react-native";
import { TaskDateAdjustmentHistory } from "../../src/features/tasks/task-date-adjustment-history";
import type { TaskDateAdjustmentComponents } from "../../../../packages/api-client/src/index";

type Page = TaskDateAdjustmentComponents["schemas"]["TaskDateAdjustmentHistoryPage"];
type Element = { type: unknown; props: Record<string, unknown> };

const page: Page = {
  task: { taskId: "task-1", plannedLocalDate: "2026-10-14", taskVersion: 5, adjustable: true },
  items: [{ adjustmentId: "adjustment-1", previousPlannedLocalDate: "2026-10-12", newPlannedLocalDate: "2026-10-14", adjustedAt: "2026-10-08T10:00:00.000Z" }],
  nextCursor: "next-page",
};

function elements(node: unknown): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const item = node as Element;
  return [item, ...elements(item.props.children)];
}

describe("task date adjustment history", () => {
  test("announces loading and presents previous/new dates with adjustment time", () => {
    const loading = elements(TaskDateAdjustmentHistory({ state: "loading", onRetry: jest.fn() }));
    expect(loading.some(({ type, props }) => type === Text && props.accessibilityRole === "progressbar")).toBe(true);
    const shown = elements(TaskDateAdjustmentHistory({ state: "ready", page, onRetry: jest.fn() }));
    const text = shown.filter(({ type }) => type === Text).map(({ props }) => JSON.stringify(props.children)).join(" ");
    expect(text).toContain("12 Eki 2026");
    expect(text).toContain("14 Eki 2026");
    expect(text).toContain("8 Eki 2026");
    expect(text).not.toContain("adjustment-1");
  });

  test("shows empty, bounded-page, and retryable error states without actor identifiers", () => {
    const empty = elements(TaskDateAdjustmentHistory({ state: "ready", page: { ...page, items: [], nextCursor: null }, onRetry: jest.fn() }));
    expect(empty.some(({ type, props }) => type === Text && String(props.children).includes("Henüz tarih değişikliği yok"))).toBe(true);
    const paged = elements(TaskDateAdjustmentHistory({ state: "ready", page, onRetry: jest.fn(), onLoadMore: jest.fn() }));
    expect(paged.some(({ type, props }) => type === Pressable && props.accessibilityLabel === "Daha fazla tarih değişikliği yükle")).toBe(true);
    const retry = jest.fn();
    const failed = elements(TaskDateAdjustmentHistory({ state: "error", error: "Geçmiş yüklenemedi", onRetry: retry }));
    const button = failed.find(({ type, props }) => type === Pressable && props.accessibilityLabel === "Tarih değişikliği geçmişini yeniden yükle");
    (button?.props.onPress as (() => void) | undefined)?.();
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
