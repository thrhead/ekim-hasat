import { Pressable } from "react-native";
import { createTaskCompletionCommandStore, type TaskCompletionCommand, type TaskCompletionCommandStorage, type TodaySnapshot } from "../../src/features/tasks/task-completion-command-store";
import { TodayContent } from "../../src/features/seasons/today-screen";
import { createTaskSkipFlow } from "../../src/features/tasks/task-skip";
import type { SeasonOperations } from "../../../../packages/api-client/src/index";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act, create } = require("react-test-renderer") as { act: (fn: () => void | Promise<void>) => Promise<void>; create: (element: React.ReactElement) => { root: { findAll: (predicate: (node: { props: Record<string, unknown> }) => boolean) => { props: Record<string, unknown> }[] }; toJSON: () => unknown } };

type Today = SeasonOperations["getTodayPlannedTasks"]["responses"][200]["content"]["application/json"];
const planned: Today = { localDate: "2026-10-07", businessTimezone: "Europe/Istanbul", tasks: [
  { id: "task-1", seasonId: "season-1", fieldId: "field-1", title: "Sulama kontrolü", cropDisplayName: "Arpa", plannedLocalDate: "2026-10-07", taskVersion: 2 },
  { id: "task-2", seasonId: "season-1", fieldId: "field-1", title: "Tarla kontrolü", cropDisplayName: "Arpa", plannedLocalDate: "2026-10-07", taskVersion: 2 },
] };
const pending: TaskCompletionCommand = { completionId: "completion-1", taskId: "task-2", seasonId: "season-1", fieldId: "field-1", title: "Tarla kontrolü", cropDisplayName: "Arpa", plannedLocalDate: "2026-10-07", baseTaskVersion: 2, occurredAt: "2026-10-07T09:00:00Z", request: { completionId: "completion-1", occurredAt: "2026-10-07T09:00:00Z" }, state: "PENDING" };
function storage(failSnapshotWrite = false): TaskCompletionCommandStorage {
  let commands = [pending]; let snapshot: TodaySnapshot | null = { ...planned, fetchedAt: "2026-10-07T08:00:00Z" };
  return { async listCommands() { return structuredClone(commands); }, async insertCommand(_, command) { commands.push(command); }, async recordAccepted() {}, async recordConflict() {},
    async writeTodaySnapshot(_, value) { if (failSnapshotWrite) throw new Error("disk unavailable"); snapshot = structuredClone(value); }, async readTodaySnapshot() { return structuredClone(snapshot); },
    async deleteTodaySnapshot() { snapshot = null; } };
}

describe("accepted Skip and Today projection", () => {
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

  it("does not offer Skip on cached Today and keeps it online only", async () => {
    const flow = createTaskSkipFlow({ client: { POST: jest.fn() } as never, newSkipId: () => "skip-1" });
    let screen!: ReturnType<typeof create>;
    await act(async () => { screen = create(<TodayContent loading={false} error={null} data={planned} onRetry={jest.fn()} cached skipFlow={flow} onSkipAccepted={jest.fn()} />); });
    const labels = screen.root.findAll(({ props }) => typeof props.accessibilityLabel === "string").map(({ props }) => props.accessibilityLabel);
    expect(labels).not.toContain("Görevi atla: Sulama kontrolü");
    expect(JSON.stringify(screen.toJSON())).toContain("Çevrimdışı görünüm");
  });
});
