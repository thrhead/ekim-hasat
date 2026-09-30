import { Pressable, Text } from "react-native";
import { TaskCompletionHistoryScreen } from "../../src/features/tasks/task-completion-history-screen";
import { TaskCompletionHistoryContent, TaskCompletionHistoryRow, readFieldTaskCompletionHistory } from "../../src/features/tasks/task-completion-history-screen";
import { TodayContent } from "../../src/features/seasons/today-screen";
import { createTaskCompletionCoordinator } from "../../src/features/tasks/task-completion";
import { createTaskCompletionCommandStore } from "../../src/features/tasks/task-completion-command-store";
import type { TaskCompletionComponents, SeasonOperations } from "../../../../packages/api-client/src/index";
import type { TaskCompletionCommand, TaskCompletionCommandStorage } from "../../src/features/tasks/task-completion-command-store";

type History = TaskCompletionComponents["schemas"]["TaskCompletionHistoryPage"];
type Today = SeasonOperations["getTodayPlannedTasks"]["responses"][200]["content"]["application/json"];
type Element = { type: unknown; props: Record<string, unknown> };
// react-test-renderer v19 ships without declarations; keep the test API narrowly typed.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act, create } = require("react-test-renderer") as {
  act: (callback: () => void | Promise<void>) => Promise<void>;
  create: (element: React.ReactElement) => { root: { findByProps: (props: Record<string, unknown>) => { props: Record<string, unknown> } }; toJSON: () => unknown };
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const accepted: TaskCompletionComponents["schemas"]["TaskCompletion"] = {
  id: "completion-1", taskId: "task-1", seasonId: "season-1", fieldId: "field-1", title: "Sulama kontrolü",
  plannedLocalDate: "2026-09-26", occurredAt: "2026-09-28T07:00:00.000Z", sourceKind: "VALIDATED_TEMPLATE",
  templateVersionId: "template-1", businessTimezone: "Asia/Tokyo",
};
const data: History = { items: [accepted], businessTimezone: "Asia/Tokyo", nextCursor: null };
const today: Today = { localDate: "2026-09-26", businessTimezone: "Asia/Tokyo", tasks: [{
  id: "task-1", seasonId: "season-1", fieldId: "field-1", title: accepted.title, cropDisplayName: "Arpa",
  plannedLocalDate: accepted.plannedLocalDate, sourceKind: accepted.sourceKind, taskVersion: 2,
}] };

function collectElements(node: unknown): Element[] {
  if (Array.isArray(node)) return node.flatMap(collectElements);
  if (node === null || typeof node !== "object" || !("props" in node)) return [];
  const element = node as Element;
  return [element, ...collectElements(element.props.children)];
}

describe("accepted task completion History", () => {
  test("keeps all-seasons results when an older season-filtered request resolves last", async () => {
    const requestA = deferred<unknown>();
    const requestB = deferred<unknown>();
    const get = jest.fn((_path: string, options: { params: { query: { seasonId?: string } } }) =>
      options.params.query.seasonId ? requestA.promise : requestB.promise);
    const client = { GET: get } as never;
    let root: ReturnType<typeof create>;

    await act(async () => {
      root = create(<TaskCompletionHistoryScreen client={client} accountId="account-1" fieldId="field-1"
        initialSeasonId="season-1" onBack={jest.fn()} store={{ list: async () => [] } as never} />);
    });
    expect(get).toHaveBeenCalledTimes(1);
    expect(get.mock.calls[0]?.[1].params.query.seasonId).toBe("season-1");

    await act(async () => {
      const showAll = root!.root.findByProps({ accessibilityLabel: "Tarlanın tüm geçmişini göster" });
      (showAll.props.onPress as () => void)();
    });
    expect(get).toHaveBeenCalledTimes(2);
    expect(get.mock.calls[1]?.[1].params.query.seasonId).toBeUndefined();

    const allSeasons: History = { ...data, items: [{ ...accepted, id: "all-row", title: "Tüm sezonlardan gelen kayıt" }] };
    const seasonOnly: History = { ...data, items: [{ ...accepted, id: "season-row", title: "Eski sezon filtresinden gelen kayıt" }] };
    await act(async () => requestB.resolve({ response: { ok: true }, data: allSeasons, error: undefined }));
    expect(JSON.stringify(root!.toJSON())).toContain("Tarla geçmişi");
    expect(JSON.stringify(root!.toJSON())).toContain("Tüm sezonlardan gelen kayıt");

    await act(async () => requestA.resolve({ response: { ok: true }, data: seasonOnly, error: undefined }));
    const currentView = JSON.stringify(root!.toJSON());
    expect(currentView).toContain("Tarla geçmişi");
    expect(currentView).toContain("Tüm sezonlardan gelen kayıt");
    expect(currentView).not.toContain("Eski sezon filtresinden gelen kayıt");
  });

  test("distinguishes original planned date from occurrence in Business timezone", () => {
    const row = collectElements(TaskCompletionHistoryRow({ item: accepted, timezone: data.businessTimezone }));
    expect(row.some(({ type, props }) => type === Text && JSON.stringify(props.children).includes("26 Eyl 2026"))).toBe(true);
    expect(row.some(({ type, props }) => type === Text && JSON.stringify(props.children).includes("16:00"))).toBe(true);
    expect(row.some(({ type, props }) => type === Text && props.children === accepted.title)).toBe(true);
    expect(row.some(({ props }) => String(props.accessibilityLabel).includes("Asia/Tokyo"))).toBe(true);
    expect(row.some(({ props }) => JSON.stringify(props).includes("recordedAt"))).toBe(false);
    expect(row.some(({ props }) => JSON.stringify(props).includes("actorUserId"))).toBe(false);
    expect(row.filter(({ type }) => type === Text).every(({ props }) => props.allowFontScaling !== false)).toBe(true);
  });

  test("offers accessible loading, empty, error retry, and season-filter reset states", () => {
    const loading = collectElements(TaskCompletionHistoryContent({ loading: true, error: null, data: null, onRetry: jest.fn(), onBack: jest.fn(), onShowAll: jest.fn(), seasonId: "season-1" }));
    expect(loading.some(({ type, props }) => type === Text && props.accessibilityRole === "progressbar")).toBe(true);

    const retry = jest.fn();
    const failure = collectElements(TaskCompletionHistoryContent({ loading: false, error: "Bağlantı kurulamadı", data: null, onRetry: retry, onBack: jest.fn(), onShowAll: jest.fn() }));
    const retryButton = failure.find(({ type, props }) => type === Pressable && props.accessibilityLabel === "Geçmişi yeniden yükle");
    (retryButton?.props.onPress as (() => void) | undefined)?.();
    expect(retry).toHaveBeenCalledTimes(1);
    expect(failure.some(({ type, props }) => type === Text && props.children === "Bağlantı kurulamadı")).toBe(true);

    const onShowAll = jest.fn();
    const empty = collectElements(TaskCompletionHistoryContent({ loading: false, error: null, data: { ...data, items: [] }, onRetry: jest.fn(), onBack: jest.fn(), onShowAll, seasonId: "season-1" }));
    expect(empty.some(({ type, props }) => type === Text && props.children === "Bu sezonda tamamlanmış iş yok.")).toBe(true);
    const allFields = empty.find(({ type, props }) => type === Pressable && props.accessibilityLabel === "Tarlanın tüm geçmişini göster");
    expect(allFields).toBeDefined();
    (allFields?.props.onPress as (() => void) | undefined)?.();
    expect(onShowAll).toHaveBeenCalledTimes(1);

    const onLoadMore = jest.fn();
    const paged = collectElements(TaskCompletionHistoryContent({ loading: false, error: null, data: { ...data, nextCursor: "next" },
      onRetry: jest.fn(), onBack: jest.fn(), onShowAll: jest.fn(), onLoadMore }));
    const more = paged.find(({ type, props }) => type === Pressable && props.accessibilityLabel === "Daha fazla tamamlanan iş yükle");
    (more?.props.onPress as (() => void) | undefined)?.();
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  test("keeps pending and conflicted device intent in a separate non-history section", () => {
    const pending: TaskCompletionCommand = {
      completionId: "pending-1", taskId: "task-pending", seasonId: "season-1", fieldId: "field-1", title: "Bekleyen sulama",
      cropDisplayName: "Arpa", plannedLocalDate: "2026-09-26", baseTaskVersion: 2, occurredAt: "2026-09-28T07:00:00.000Z",
      request: { completionId: "pending-1", occurredAt: "2026-09-28T07:00:00.000Z" }, state: "PENDING",
    };
    const conflicted: TaskCompletionCommand = { ...pending, completionId: "conflict-1", taskId: "task-conflict", title: "Çakışan kontrol", state: "CONFLICTED", conflictCode: "TASK_VERSION_CONFLICT" };
    const view = collectElements(TaskCompletionHistoryContent({ loading: false, error: null, data: { ...data, items: [] }, localCommands: [pending, conflicted],
      onRetry: jest.fn(), onBack: jest.fn(), onShowAll: jest.fn() }));
    expect(view.some(({ type, props }) => type === Text && props.children === "Bu cihazda bekleyen işler")).toBe(true);
    expect(view.some(({ type, props }) => type === Text && props.children === "Eşitleme bekliyor")).toBe(true);
    expect(view.some(({ type, props }) => type === Text && props.children === "Sunucu kabul etmedi · gözden geçirme gerekiyor")).toBe(true);
    expect(view.some(({ type, props }) => type === Text && props.children === "Tamamlandı")).toBe(false);
    expect(view.some(({ type, props }) => type === Text && props.children === "Bekleyen sulama")).toBe(true);
  });

  test("automates authorized Today completion through durable acceptance into generated-client History", async () => {
    const rows = new Map<string, TaskCompletionCommand[]>();
    const storage: TaskCompletionCommandStorage = {
      async listCommands(accountId) { return structuredClone(rows.get(accountId) ?? []); },
      async insertCommand(accountId, command) { rows.set(accountId, [...(rows.get(accountId) ?? []), structuredClone(command)]); },
      async recordAccepted(accountId, completionId, result) {
        rows.set(accountId, (rows.get(accountId) ?? []).map((command) => command.completionId === completionId ? { ...command, state: "ACCEPTED", result } : command));
      },
      async recordConflict() {}, async writeTodaySnapshot() {}, async readTodaySnapshot() { return null; },
    };
    const store = createTaskCompletionCommandStore({ storage });
    const client = {
      POST: async () => ({ response: { ok: true, status: 201 }, data: accepted, error: undefined }),
    } as never;
    const coordinator = createTaskCompletionCoordinator({
      store,
      getAuthorizationSession: () => ({ accountId: "account-1", client }),
      newCompletionId: () => accepted.id,
      now: () => new Date(accepted.occurredAt),
    });
    const settled = await coordinator.complete("account-1", today.tasks[0]!);
    expect(settled.state).toBe("ACCEPTED");
    expect(settled.result).toEqual(accepted);

    let route: { fieldId: string; seasonId?: string } | undefined;
    const todayView = collectElements(TodayContent({ loading: false, error: null, data: today, onRetry: jest.fn(),
      taskStates: { "task-1": "ACCEPTED" }, commands: [settled], onOpenHistory: (fieldId, seasonId) => { route = { fieldId, seasonId }; } }));
    const open = todayView.find(({ type, props }) => type === Pressable && props.accessibilityLabel === "Geçmişi aç: Sulama kontrolü");
    (open?.props.onPress as (() => void) | undefined)?.();
    expect(route).toEqual({ fieldId: "field-1", seasonId: "season-1" });

    const get = jest.fn(async () => ({ response: { ok: true }, data, error: undefined }));
    const page = await readFieldTaskCompletionHistory({ GET: get } as never, route!.fieldId, { seasonId: route!.seasonId });
    expect(get).toHaveBeenCalledWith("/fields/{fieldId}/task-completions", {
      params: { path: { fieldId: "field-1" }, query: { limit: 50, seasonId: "season-1" } },
    });
    const row = collectElements(TaskCompletionHistoryRow({ item: page.items[0]!, timezone: page.businessTimezone }));
    expect(row.some(({ type, props }) => type === Text && props.children === accepted.title)).toBe(true);
    expect(row.some(({ type, props }) => type === Text && JSON.stringify(props.children).includes("26 Eyl 2026"))).toBe(true);
    expect(row.some(({ type, props }) => type === Text && JSON.stringify(props.children).includes("16:00"))).toBe(true);
  });
});
