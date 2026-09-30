import {
  createTaskCompletionCommandStore,
  type TaskCompletionCommand,
  type TaskCompletionCommandStorage,
  type TodaySnapshot,
} from "../../src/features/tasks/task-completion-command-store";
import type { TaskCompletionComponents, SeasonOperations } from "../../../../packages/api-client/src/index";

type Today = SeasonOperations["getTodayPlannedTasks"]["responses"][200]["content"]["application/json"];
type Accepted = TaskCompletionComponents["schemas"]["TaskCompletion"];

const today: Today = {
  localDate: "2026-09-30",
  businessTimezone: "Europe/Istanbul",
  tasks: [{
    id: "task-1", seasonId: "season-1", fieldId: "field-1", title: "Sulama kontrolü", cropDisplayName: "Arpa",
    plannedLocalDate: "2026-09-30", sourceKind: "MANUAL", taskVersion: 4,
  }],
};

const command = (completionId: string, taskId = "task-1"): TaskCompletionCommand => ({
  completionId,
  taskId,
  seasonId: "season-1",
  fieldId: "field-1",
  title: "Sulama kontrolü",
  cropDisplayName: "Arpa",
  sourceKind: "MANUAL",
  plannedLocalDate: "2026-09-30",
  baseTaskVersion: 4,
  occurredAt: "2026-09-30T10:00:00.000Z",
  request: { completionId, occurredAt: "2026-09-30T10:00:00.000Z" },
  state: "PENDING",
});

const accepted: Accepted = {
  id: "completion-1", taskId: "task-1", seasonId: "season-1", fieldId: "field-1", title: "Sulama kontrolü",
  plannedLocalDate: "2026-09-30", occurredAt: "2026-09-30T10:00:00.000Z", businessTimezone: "Europe/Istanbul", sourceKind: "MANUAL",
};

function durableStorage(): TaskCompletionCommandStorage {
  const rows = new Map<string, TaskCompletionCommand[]>();
  const snapshots = new Map<string, TodaySnapshot>();
  return {
    async listCommands(accountId) { return structuredClone(rows.get(accountId) ?? []); },
    async insertCommand(accountId, value) { rows.set(accountId, [...(rows.get(accountId) ?? []), structuredClone(value)]); },
    async recordAccepted(accountId, completionId, result) {
      const current = rows.get(accountId) ?? [];
      rows.set(accountId, current.map((row) => row.completionId === completionId ? { ...row, state: "ACCEPTED", result } : row));
    },
    async recordConflict(accountId, completionId, conflictCode) {
      const current = rows.get(accountId) ?? [];
      rows.set(accountId, current.map((row) => row.completionId === completionId ? { ...row, state: "CONFLICTED", conflictCode } : row));
    },
    async writeTodaySnapshot(accountId, value) { snapshots.set(accountId, structuredClone(value)); },
    async readTodaySnapshot(accountId) { return structuredClone(snapshots.get(accountId) ?? null); },
  };
}

describe("task completion command store", () => {
  test("keeps multiple pending commands and their original intent across store recreation", async () => {
    const storage = durableStorage();
    const first = createTaskCompletionCommandStore({ storage });
    await first.enqueue("account-1", command("completion-1"));
    await first.enqueue("account-1", command("completion-2", "task-2"));

    const restarted = createTaskCompletionCommandStore({ storage });
    expect(await restarted.list("account-1")).toEqual([command("completion-1"), command("completion-2", "task-2")]);
    expect(await restarted.list("account-2")).toEqual([]);
  });

  test("does not accept the same completion identity with a changed payload", async () => {
    const store = createTaskCompletionCommandStore({ storage: durableStorage() });
    await store.enqueue("account-1", command("completion-1"));

    await expect(store.enqueue("account-1", { ...command("completion-1"), occurredAt: "2026-09-30T11:00:00.000Z",
      request: { completionId: "completion-1", occurredAt: "2026-09-30T11:00:00.000Z" } })).rejects.toThrow(/changed command/);
    expect(await store.list("account-1")).toEqual([command("completion-1")]);
  });

  test("persists the accepted public result and accepted state together", async () => {
    const store = createTaskCompletionCommandStore({ storage: durableStorage() });
    await store.enqueue("account-1", command("completion-1"));
    await store.recordAccepted("account-1", "completion-1", accepted);

    expect(await store.list("account-1")).toEqual([{ ...command("completion-1"), state: "ACCEPTED", result: accepted }]);
  });

  test("does not accept a server result for a different task or occurrence", async () => {
    const store = createTaskCompletionCommandStore({ storage: durableStorage() });
    await store.enqueue("account-1", command("completion-1"));

    await expect(store.recordAccepted("account-1", "completion-1", { ...accepted, taskId: "task-elsewhere" })).rejects.toThrow(/does not match/);
    expect(await store.list("account-1")).toEqual([command("completion-1")]);
  });

  test("does not settle a completion when accepted result has a different season", async () => {
    const store = createTaskCompletionCommandStore({ storage: durableStorage() });
    await store.enqueue("account-1", command("completion-1"));

    await expect(store.recordAccepted("account-1", "completion-1", { ...accepted, seasonId: "another-season" }))
      .rejects.toThrow(/does not match/);
    expect(await store.list("account-1")).toEqual([command("completion-1")]);
  });

  test("does not settle a completion when accepted result has a different field", async () => {
    const store = createTaskCompletionCommandStore({ storage: durableStorage() });
    await store.enqueue("account-1", command("completion-1"));

    await expect(store.recordAccepted("account-1", "completion-1", { ...accepted, fieldId: "another-field" }))
      .rejects.toThrow(/does not match/);
    expect(await store.list("account-1")).toEqual([command("completion-1")]);
  });

  test("retains the original command payload when an outcome is conflicted", async () => {
    const store = createTaskCompletionCommandStore({ storage: durableStorage() });
    await store.enqueue("account-1", command("completion-1"));
    await store.recordConflict("account-1", "completion-1", "TASK_VERSION_CONFLICT");

    expect(await store.list("account-1")).toEqual([{ ...command("completion-1"), state: "CONFLICTED", conflictCode: "TASK_VERSION_CONFLICT" }]);
  });

  test("writes and reloads a server Today snapshot and rejects it after Business-local midnight", async () => {
    const storage = durableStorage();
    const store = createTaskCompletionCommandStore({ storage });
    const snapshot: TodaySnapshot = { ...today, fetchedAt: "2026-09-30T10:00:00.000Z" };
    await store.writeTodaySnapshot("account-1", snapshot);

    expect(await createTaskCompletionCommandStore({ storage }).readTodaySnapshot("account-1")).toEqual(snapshot);
    expect(store.belongsToBusinessToday(snapshot, new Date("2026-09-30T20:59:59.000Z"))).toBe(true);
    expect(store.belongsToBusinessToday(snapshot, new Date("2026-09-30T21:00:00.000Z"))).toBe(false);
  });

  test("does not remove pending commands when replacing the synchronized Today snapshot", async () => {
    const store = createTaskCompletionCommandStore({ storage: durableStorage() });
    await store.enqueue("account-1", command("completion-1"));
    await store.writeTodaySnapshot("account-1", { ...today, fetchedAt: "2026-09-30T10:00:00.000Z" });
    await store.writeTodaySnapshot("account-1", { ...today, tasks: [], fetchedAt: "2026-09-30T11:00:00.000Z" });

    expect(await store.list("account-1")).toEqual([command("completion-1")]);
  });
});
