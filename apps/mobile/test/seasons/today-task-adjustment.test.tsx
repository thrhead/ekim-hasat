import { Pressable } from "react-native";
import { TodayContent } from "../../src/features/seasons/today-screen";
import type { SeasonOperations } from "../../../../packages/api-client/src/index";

type Today = SeasonOperations["getTodayPlannedTasks"]["responses"][200]["content"]["application/json"];
type Element = { type: unknown; props: Record<string, unknown> };

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
  });

  test("shows accessible loading and adjustment conflict outcomes in Today", () => {
    const loading = elements(TodayContent({ loading: false, error: null, data, onRetry: jest.fn(), adjustmentStates: { "task-1": "LOADING" } }));
    expect(loading.some(({ type, props }) => type === Pressable && props.accessibilityState && (props.accessibilityState as { busy?: boolean }).busy)).toBe(true);
    const conflict = elements(TodayContent({ loading: false, error: null, data, onRetry: jest.fn(), adjustmentStates: { "task-1": "CONFLICT" } }));
    expect(conflict.some(({ props }) => String(props.children).includes("Görev bilgisi değişti"))).toBe(true);
    expect(conflict.some(({ type, props }) => type === Pressable && props.accessibilityLabel === "Görev tarihini yeniden gözden geçir: Sulama kontrolü")).toBe(true);
  });
});
