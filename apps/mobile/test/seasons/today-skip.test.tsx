import { createTaskCompletionCommandStore, type TaskCompletionCommand, type TaskCompletionCommandStorage, type TodaySnapshot } from "../../src/features/tasks/task-completion-command-store";
import { TodayContent, TodayScreen } from "../../src/features/seasons/today-screen";
import { createTaskSkipFlow } from "../../src/features/tasks/task-skip";
import type { ApiClient, SeasonOperations } from "../../../../packages/api-client/src/index";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act, create } = require("react-test-renderer") as { act: (fn: () => void | Promise<void>) => Promise<void>; create: (element: React.ReactElement) => { root: { findAll: (predicate: (node: { props: Record<string, unknown> }) => boolean) => { props: Record<string, unknown> }[] }; toJSON: () => unknown } };

type Today = SeasonOperations["getTodayPlannedTasks"]["responses"][200]["content"]["application/json"];
const planned: Today = { localDate: "2026-10-07", businessTimezone: "Europe/Istanbul", tasks: [
  { id: "task-1", seasonId: "season-1", fieldId: "field-1", title: "Sulama kontrolü", cropDisplayName: "Arpa", plannedLocalDate: "2026-10-07", taskVersion: 2 },
  { id: "task-2", seasonId: "season-1", fieldId: "field-1", title: "Tarla kontrolü", cropDisplayName: "Arpa", plannedLocalDate: "2026-10-07", taskVersion: 2 },
] };
const pending: TaskCompletionCommand = { completionId: "completion-1", taskId: "task-2", seasonId: "season-1", fieldId: "field-1", title: "Tarla kontrolü", cropDisplayName: "Arpa", plannedLocalDate: "2026-10-07", baseTaskVersion: 2, occurredAt: "2026-10-07T09:00:00Z", request: { completionId: "completion-1", occurredAt: "2026-10-07T09:00:00Z" }, state: "PENDING" };
function storage(failSnapshotWrite = false, failSnapshotRead = false): TaskCompletionCommandStorage {
  const commands = [pending]; let snapshot: TodaySnapshot | null = { ...planned, fetchedAt: "2026-10-07T08:00:00Z" };
  let shouldFailSnapshotRead = failSnapshotRead;
  return { async listCommands() { return structuredClone(commands); }, async insertCommand(_, command) { commands.push(command); }, async recordAccepted() {}, async recordConflict() {},
    async writeTodaySnapshot(_, value) { if (failSnapshotWrite) throw new Error("disk unavailable"); snapshot = structuredClone(value); }, async readTodaySnapshot() { if (shouldFailSnapshotRead) { shouldFailSnapshotRead = false; throw new Error("snapshot read failed"); } return structuredClone(snapshot); },
    async deleteTodaySnapshot() { snapshot = null; } };
}

describe("accepted Skip and Today projection", () => {
  it("keeps a Skip conflict notice visible after the task disappears during refresh", async () => {
    let todayReads = 0;
    const GET = jest.fn(async (path: string) => {
      if (path === "/today") {
        todayReads += 1;
        return { data: todayReads === 1 ? planned : { ...planned, tasks: [] }, error: undefined, response: { ok: true, status: 200 } };
      }
      return { data: undefined, error: { error: { code: "UNAVAILABLE" } }, response: { ok: false, status: 503 } };
    });
    const POST = jest.fn(async () => ({ data: undefined, error: { error: { code: "TASK_VERSION_CONFLICT" } }, response: { ok: false, status: 409 } }));
    const store = createTaskCompletionCommandStore({ storage: storage() });
    let screen!: ReturnType<typeof create>;
    await act(async () => { screen = create(<TodayScreen client={{ GET, POST } as unknown as ApiClient} accountId="account-1" store={store} now={() => new Date("2026-10-07T10:00:00Z")} />); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    await act(async () => { (screen.root.findAll(({ props }) => props.accessibilityLabel === "Görevi atla: Sulama kontrolü")[0]?.props.onPress as (() => void) | undefined)?.(); });
    await act(async () => { (screen.root.findAll(({ props }) => props.accessibilityLabel === "Atlamayı onayla")[0]?.props.onPress as (() => void) | undefined)?.(); await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(todayReads).toBe(2);
    expect(JSON.stringify(screen.toJSON())).toContain("Görev değişti. Güncel bilgileri yükleyip yeniden karar verin.");
  });

  it("prunes only the accepted task from the cached Today read across restart and preserves completion outbox", async () => {
    const persisted = storage(); const store = createTaskCompletionCommandStore({ storage: persisted });
    await store.pruneTodayTask("account-1", "task-1");
    const restarted = createTaskCompletionCommandStore({ storage: persisted });
    expect((await restarted.readTodaySnapshot("account-1"))?.tasks.map(({ id }) => id)).toEqual(["task-2"]);
    expect(await restarted.list("account-1")).toEqual([pending]);
  });

  it("invalidates a stale projection when pruning cannot be written", async () => {
    const persisted = storage(true); const store = createTaskCompletionCommandStore({ storage: persisted });
    await expect(store.pruneTodayTask("account-1", "task-1")).rejects.toThrow("disk unavailable");
    expect(await store.readTodaySnapshot("account-1")).toBeNull();
    expect(await store.list("account-1")).toEqual([pending]);
  });

  it("invalidates the persisted projection when reading it for pruning fails", async () => {
    const persisted = storage(false, true); const store = createTaskCompletionCommandStore({ storage: persisted });
    await expect(store.pruneTodayTask("account-1", "task-1")).rejects.toThrow("snapshot read failed");
    const restarted = createTaskCompletionCommandStore({ storage: persisted });
    expect(await restarted.readTodaySnapshot("account-1")).toBeNull();
    expect(await restarted.list("account-1")).toEqual([pending]);
  });

  it("does not offer Skip on cached Today and keeps it online only", async () => {
    const flow = createTaskSkipFlow({ client: { POST: jest.fn() } as never, newSkipId: () => "skip-1" });
    let screen!: ReturnType<typeof create>;
    await act(async () => { screen = create(<TodayContent loading={false} error={null} data={planned} onRetry={jest.fn()} cached skipFlow={flow} onSkipAccepted={jest.fn()} />); });
    const labels = screen.root.findAll(({ props }) => typeof props.accessibilityLabel === "string").map(({ props }) => props.accessibilityLabel);
    expect(labels).not.toContain("Görevi atla: Sulama kontrolü");
    expect(JSON.stringify(screen.toJSON())).toContain("Çevrimdışı görünüm");
  });
});
