import { Pressable, Text } from "react-native";
import { mayUseCachedToday, TodayContent } from "../../src/features/seasons/today-screen";
import type { TaskCompletionCommand } from "../../src/features/tasks/task-completion-command-store";
import type { TodaySnapshot } from "../../src/features/tasks/task-completion-command-store";
import type { SeasonOperations } from "../../../../packages/api-client/src/index";

type Today = SeasonOperations["getTodayPlannedTasks"]["responses"][200]["content"]["application/json"];
type Element = { type: unknown; props: Record<string, unknown> };

const data: Today = {
  localDate: "2026-09-30", businessTimezone: "Europe/Istanbul", tasks: [{
    id: "task-1", seasonId: "season-1", fieldId: "field-1", title: "Sulama kontrolü", cropDisplayName: "Arpa",
    plannedLocalDate: "2026-09-30", sourceKind: "MANUAL", taskVersion: 3,
  }],
};

function collectElements(node: unknown): Element[] {
  if (Array.isArray(node)) return node.flatMap(collectElements);
  if (node === null || typeof node !== "object" || !("props" in node)) return [];
  const element = node as Element;
  return [element, ...collectElements(element.props.children)];
}

describe("Today task completion presentation", () => {
  test("offers one accessible completion action for actionable work", () => {
    const onComplete = jest.fn();
    const view = collectElements(TodayContent({ loading: false, error: null, data, onRetry: jest.fn(), onComplete }));
    const complete = view.find(({ type, props }) => type === Pressable && props.accessibilityLabel === "Tamamla: Sulama kontrolü");

    expect(complete?.props.accessibilityRole).toBe("button");
    (complete?.props.onPress as (() => void) | undefined)?.();
    expect(onComplete).toHaveBeenCalledWith(data.tasks[0]);
  });

  test("opens accepted History in the current task's field and season context", () => {
    const onOpenHistory = jest.fn();
    const view = collectElements(TodayContent({ loading: false, error: null, data, onRetry: jest.fn(), onOpenHistory }));
    const history = view.find(({ type, props }) => type === Pressable && props.accessibilityLabel === "Geçmişi aç: Sulama kontrolü");
    (history?.props.onPress as (() => void) | undefined)?.();
    expect(onOpenHistory).toHaveBeenCalledWith("field-1", "season-1");
  });

  test("keeps accepted local acknowledgement separate while linking to canonical server History", () => {
    const onOpenHistory = jest.fn();
    const command: TaskCompletionCommand = {
      completionId: "completion-accepted", taskId: "task-1", seasonId: "season-1", fieldId: "field-1", title: "Sulama kontrolü",
      cropDisplayName: "Arpa", sourceKind: "MANUAL", plannedLocalDate: "2026-09-30", baseTaskVersion: 3,
      occurredAt: "2026-09-30T10:00:00.000Z", request: { completionId: "completion-accepted", occurredAt: "2026-09-30T10:00:00.000Z" }, state: "ACCEPTED",
    };
    const view = collectElements(TodayContent({ loading: false, error: null, data: { ...data, tasks: [] }, onRetry: jest.fn(), commands: [command], onOpenHistory }));
    expect(view.some(({ type, props }) => type === Text && props.children === "Tamamlandı · geçmişi sunucudan açın")).toBe(true);
    expect(view.some(({ type, props }) => type === Text && props.children === command.occurredAt)).toBe(false);
    const history = view.find(({ type, props }) => type === Pressable && props.accessibilityLabel === "Geçmişi aç: Sulama kontrolü");
    (history?.props.onPress as (() => void) | undefined)?.();
    expect(onOpenHistory).toHaveBeenCalledWith("field-1", "season-1");
  });

  test("shows pending without calling it accepted and blocks duplicate taps while saving", () => {
    const pending = collectElements(TodayContent({
      loading: false, error: null, data, onRetry: jest.fn(), onComplete: jest.fn(),
      taskStates: { "task-1": "PENDING" }, onRetryCompletion: jest.fn(),
    }));
    expect(pending.some(({ type, props }) => type === Text && props.children === "Eşitleme bekliyor" && props.accessibilityLiveRegion === "polite")).toBe(true);
    expect(pending.some(({ type, props }) => type === Text && props.children === "Tamamlandı")).toBe(false);
    expect(pending.some(({ type, props }) => type === Pressable && props.accessibilityLabel === "Tamamla: Sulama kontrolü")).toBe(false);

    const saving = collectElements(TodayContent({ loading: false, error: null, data, onRetry: jest.fn(), onComplete: jest.fn(), taskStates: { "task-1": "SAVING" } }));
    const saveButton = saving.find(({ type, props }) => type === Pressable && props.accessibilityLabel === "Tamamla: Sulama kontrolü");
    expect(saveButton?.props.accessibilityState).toMatchObject({ disabled: true });
  });

  test("shows accepted and conflicted outcomes with text and explicit recovery", () => {
    const accepted = collectElements(TodayContent({ loading: false, error: null, data, onRetry: jest.fn(), taskStates: { "task-1": "ACCEPTED" } }));
    expect(accepted.some(({ type, props }) => type === Text && props.children === "Tamamlandı")).toBe(true);
    expect(accepted.some(({ type, props }) => type === Pressable && props.accessibilityLabel === "Tamamla: Sulama kontrolü")).toBe(false);

    const onReviewConflict = jest.fn();
    const conflicted = collectElements(TodayContent({ loading: false, error: null, data, onRetry: jest.fn(),
      taskStates: { "task-1": "CONFLICTED" }, onReviewConflict }));
    const review = conflicted.find(({ type, props }) => type === Pressable && props.accessibilityLabel === "Görevi gözden geçir: Sulama kontrolü");
    expect(conflicted.some(({ type, props }) => type === Text && props.children === "Görev bilgisi değişti; yeniden gözden geçirin.")).toBe(true);
    (review?.props.onPress as (() => void) | undefined)?.();
    expect(onReviewConflict).toHaveBeenCalledWith(data.tasks[0]);
  });

  test("identifies cached Today data and keeps Business-local date visible", () => {
    const view = collectElements(TodayContent({ loading: false, error: null, data, onRetry: jest.fn(), cached: true }));
    expect(view.some(({ type, props }) => type === Text && props.children === "Çevrimdışı görünüm · sunucudan alınan iş tarihi" )).toBe(true);
    expect(view.some(({ type, props }) => type === Text && props.accessibilityLabel === "İş tarihi 2026-09-30")).toBe(true);
    expect(view.filter(({ type }) => type === Text).every(({ props }) => props.allowFontScaling !== false)).toBe(true);
  });

  test("keeps pending or conflicted local intent visible when the server no longer lists the task", () => {
    const localIntent: TaskCompletionCommand = {
      completionId: "completion-1", taskId: "task-1", seasonId: "season-1", fieldId: "field-1", title: "Sulama kontrolü",
      cropDisplayName: "Arpa", sourceKind: "MANUAL", plannedLocalDate: "2026-09-30", baseTaskVersion: 3,
      occurredAt: "2026-09-30T10:00:00.000Z", request: { completionId: "completion-1", occurredAt: "2026-09-30T10:00:00.000Z" }, state: "PENDING",
    };
    const onRetryCompletion = jest.fn();
    const view = collectElements(TodayContent({ loading: false, error: null, data: { ...data, tasks: [] }, onRetry: jest.fn(),
      commands: [localIntent], onRetryCompletion }));
    expect(view.some(({ type, props }) => type === Text && props.children === "Eşitleme bekliyor · bu iş yerel olarak kaydedildi.")).toBe(true);
    const retry = view.find(({ type, props }) => type === Pressable && props.accessibilityLabel === "Tamamlamayı tekrar dene: Sulama kontrolü");
    (retry?.props.onPress as ((task: unknown) => void) | undefined)?.(data.tasks[0]);
    expect(onRetryCompletion).toHaveBeenCalledWith(expect.objectContaining({ id: "task-1", taskVersion: 3 }));

    const conflicted = collectElements(TodayContent({ loading: false, error: null, data: { ...data, tasks: [] }, onRetry: jest.fn(),
      commands: [{ ...localIntent, state: "CONFLICTED", conflictCode: "TASK_ALREADY_COMPLETED" }] }));
    expect(conflicted.some(({ type, props }) => type === Text && typeof props.children === "string" && props.children.includes("Çakışan tamamlama niyetiniz saklandı"))).toBe(true);
    expect(conflicted.some(({ type, props }) => type === Text && props.children === "Tamamlandı")).toBe(false);

    const unavailable = collectElements(TodayContent({ loading: false, error: "Erişim doğrulanamadı", data: null, onRetry: jest.fn(),
      commands: [{ ...localIntent, state: "CONFLICTED", conflictCode: "ACCESS_UNAVAILABLE" }] }));
    expect(unavailable.some(({ type, props }) => type === Text && typeof props.children === "string"
      && props.children.includes("Tamamlama niyetiniz bu cihazda saklandı"))).toBe(true);
  });

  test("does not use cached Today work after the server denies account access", () => {
    const snapshot: TodaySnapshot = { ...data, fetchedAt: "2026-09-30T10:00:00.000Z" };
    const now = new Date("2026-09-30T20:59:00.000Z");
    expect(mayUseCachedToday(snapshot, undefined, now)).toBe(true);
    expect(mayUseCachedToday(snapshot, 503, now)).toBe(true);
    expect(mayUseCachedToday(snapshot, 401, now)).toBe(false);
    expect(mayUseCachedToday(snapshot, 403, now)).toBe(false);
    expect(mayUseCachedToday(snapshot, 404, now)).toBe(false);
    expect(mayUseCachedToday(snapshot, undefined, new Date("2026-09-30T21:00:00.000Z"))).toBe(false);
  });
});
