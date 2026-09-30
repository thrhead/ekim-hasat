import { createTaskCompletionCommandStore, type TaskCompletionCommand, type TaskCompletionCommandStorage, type TodaySnapshot } from "../../src/features/tasks/task-completion-command-store";
import { createTaskCompletionCoordinator as createCoordinator } from "../../src/features/tasks/task-completion";
import type { ApiClient } from "../../src/api/onboarding-client";
import type { SeasonOperations, TaskCompletionComponents } from "../../../../packages/api-client/src/index";

type Task = SeasonOperations["getTodayPlannedTasks"]["responses"][200]["content"]["application/json"]["tasks"][number];
type Accepted = TaskCompletionComponents["schemas"]["TaskCompletion"];

const task: Task = {
  id: "task-1", seasonId: "season-1", fieldId: "field-1", title: "Sulama kontrolü", cropDisplayName: "Arpa",
  plannedLocalDate: "2026-09-30", sourceKind: "MANUAL", taskVersion: 7,
};
const result: Accepted = {
  id: "completion-1", taskId: "task-1", seasonId: "season-1", fieldId: "field-1", title: "Sulama kontrolü",
  plannedLocalDate: "2026-09-30", occurredAt: "2026-09-30T10:00:00.000Z", businessTimezone: "Europe/Istanbul", sourceKind: "MANUAL",
};

type CoordinatorOptions = Parameters<typeof createCoordinator>[0];
type TestCoordinatorOptions = Omit<CoordinatorOptions, "getAuthorizationSession"> & {
  client: Pick<ApiClient, "POST">;
  getAuthorizationSession?: CoordinatorOptions["getAuthorizationSession"];
};
function createTaskCompletionCoordinator(options: TestCoordinatorOptions) {
  const { client, ...coordinatorOptions } = options;
  return createCoordinator({
    ...coordinatorOptions,
    getAuthorizationSession: options.getAuthorizationSession ?? (() => ({ accountId: "account-1", client })),
  });
}

function durableStorage(): TaskCompletionCommandStorage {
  const commands = new Map<string, TaskCompletionCommand[]>();
  const snapshots = new Map<string, TodaySnapshot>();
  return {
    async listCommands(accountId) { return structuredClone(commands.get(accountId) ?? []); },
    async insertCommand(accountId, value) { commands.set(accountId, [...(commands.get(accountId) ?? []), structuredClone(value)]); },
    async recordAccepted(accountId, completionId, accepted) {
      commands.set(accountId, (commands.get(accountId) ?? []).map((command) => command.completionId === completionId
        ? { ...command, state: "ACCEPTED", result: accepted } : command));
    },
    async recordConflict(accountId, completionId, conflictCode) {
      commands.set(accountId, (commands.get(accountId) ?? []).map((command) => command.completionId === completionId
        ? { ...command, state: "CONFLICTED", conflictCode } : command));
    },
    async writeTodaySnapshot(accountId, snapshot) { snapshots.set(accountId, structuredClone(snapshot)); },
    async readTodaySnapshot(accountId) { return structuredClone(snapshots.get(accountId) ?? null); },
  };
}

function okResponse(value: Accepted) {
  return { data: value, error: undefined, response: { ok: true, status: 201 } };
}

describe("task completion coordinator", () => {
  test("allows the caller to expose durable pending state before attempting delivery", async () => {
    const store = createTaskCompletionCommandStore({ storage: durableStorage() });
    const POST = jest.fn().mockResolvedValue(okResponse({ ...result, id: "queued-id" }));
    const coordinator = createTaskCompletionCoordinator({
      store, client: { POST } as unknown as Pick<ApiClient, "POST">,
      newCompletionId: () => "queued-id", now: () => new Date("2026-09-30T10:00:00.000Z"),
    });

    const queued = await coordinator.enqueue("account-1", task);
    expect(queued.state).toBe("PENDING");
    expect(await store.list("account-1")).toMatchObject([{ completionId: "queued-id", state: "PENDING" }]);
    expect(POST).not.toHaveBeenCalled();

    await coordinator.deliver("account-1", "queued-id");
    expect(POST).toHaveBeenCalledTimes(1);
  });

  test("durably creates pending intent before a generated-client request and preserves the base version and occurrence", async () => {
    const store = createTaskCompletionCommandStore({ storage: durableStorage() });
    const POST = jest.fn(async () => {
      expect(await store.list("account-1")).toHaveLength(1);
      return Promise.reject(new Error("offline"));
    });
    const coordinator = createTaskCompletionCoordinator({
      store, client: { POST } as unknown as Pick<ApiClient, "POST">,
      newCompletionId: () => "completion-1", now: () => new Date("2026-09-30T10:00:00.000Z"),
    });

    await expect(coordinator.complete("account-1", task)).resolves.toMatchObject({ state: "PENDING", completionId: "completion-1" });
    expect(POST).toHaveBeenCalledWith("/tasks/{taskId}/completions", {
      params: { path: { taskId: "task-1" }, header: { "If-Match": "7" } },
      body: { completionId: "completion-1", occurredAt: "2026-09-30T10:00:00.000Z" },
    });
  });

  test("retries a lost response after restart with the exact same identity and payload", async () => {
    const storage = durableStorage();
    const firstStore = createTaskCompletionCommandStore({ storage });
    let committedOnServer: Accepted | undefined;
    const firstPost = jest.fn(async () => {
      committedOnServer = { ...result, id: "same-id" };
      throw new Error("response lost after server commit");
    });
    const lost = createTaskCompletionCoordinator({
      store: firstStore,
      client: { POST: firstPost } as unknown as Pick<ApiClient, "POST">,
      newCompletionId: () => "same-id", now: () => new Date("2026-09-30T10:00:00.000Z"),
    });
    await lost.complete("account-1", task);

    const replayResult = committedOnServer!;
    const POST = jest.fn().mockResolvedValue(okResponse(replayResult));
    const restarted = createTaskCompletionCoordinator({
      store: createTaskCompletionCommandStore({ storage }), client: { POST } as unknown as Pick<ApiClient, "POST">,
      newCompletionId: () => "must-not-be-used", now: () => new Date("2026-09-30T11:00:00.000Z"),
    });
    await expect(restarted.retryPending("account-1")).resolves.toHaveLength(1);

    expect(POST).toHaveBeenCalledWith("/tasks/{taskId}/completions", {
      params: { path: { taskId: "task-1" }, header: { "If-Match": "7" } },
      body: { completionId: "same-id", occurredAt: "2026-09-30T10:00:00.000Z" },
    });
    expect(await createTaskCompletionCommandStore({ storage }).list("account-1")).toMatchObject([{ state: "ACCEPTED", result: replayResult }]);
  });

  test("coalesces pending recovery and explicit retry for the same persisted completion", async () => {
    const store = createTaskCompletionCommandStore({ storage: durableStorage() });
    let resolvePost!: (value: ReturnType<typeof okResponse>) => void;
    const POST = jest.fn(() => {
      return new Promise<ReturnType<typeof okResponse>>((resolve) => { resolvePost = resolve; });
    });
    const coordinator = createTaskCompletionCoordinator({
      store, client: { POST } as unknown as Pick<ApiClient, "POST">,
      newCompletionId: () => "completion-1", now: () => new Date("2026-09-30T10:00:00.000Z"),
    });
    const command = await coordinator.enqueue("account-1", task);

    const recovery = coordinator.retryPending("account-1");
    const explicitRetry = coordinator.deliver("account-1", command.completionId);
    for (let attempt = 0; attempt < 20 && POST.mock.calls.length === 0; attempt += 1) await Promise.resolve();
    expect(POST).toHaveBeenCalledTimes(1);

    resolvePost(okResponse({ ...result, id: command.completionId }));
    const [recovered, retried] = await Promise.all([recovery, explicitRetry]);

    expect(recovered).toMatchObject([{ completionId: command.completionId, state: "ACCEPTED", result: { id: command.completionId } }]);
    expect(retried).toMatchObject({ completionId: command.completionId, state: "ACCEPTED", result: { id: command.completionId } });
    expect(await store.list("account-1")).toMatchObject([{ completionId: command.completionId, state: "ACCEPTED", result: { id: command.completionId } }]);
  });

  test("releases a retryable delivery so a later retry can send the same pending command", async () => {
    const store = createTaskCompletionCommandStore({ storage: durableStorage() });
    const POST = jest.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(okResponse({ ...result, id: "retryable-id" }));
    const coordinator = createTaskCompletionCoordinator({
      store, client: { POST } as unknown as Pick<ApiClient, "POST">,
      newCompletionId: () => "retryable-id", now: () => new Date("2026-09-30T10:00:00.000Z"),
    });

    await expect(coordinator.complete("account-1", task)).resolves.toMatchObject({ state: "PENDING" });
    await expect(coordinator.deliver("account-1", "retryable-id")).resolves.toMatchObject({ state: "ACCEPTED" });

    expect(POST).toHaveBeenCalledTimes(2);
    expect(await store.list("account-1")).toMatchObject([{ completionId: "retryable-id", state: "ACCEPTED" }]);
  });

  test("delivers different completion IDs concurrently", async () => {
    const store = createTaskCompletionCommandStore({ storage: durableStorage() });
    const release = new Map<string, (value: ReturnType<typeof okResponse>) => void>();
    const POST = jest.fn((_path: string, request: { body: { completionId: string } }) => new Promise<ReturnType<typeof okResponse>>((resolve) => {
      release.set(request.body.completionId, resolve);
    }));
    const coordinator = createTaskCompletionCoordinator({
      store, client: { POST } as unknown as Pick<ApiClient, "POST">,
      newCompletionId: (() => { let next = 0; return () => `parallel-${++next}`; })(),
      now: () => new Date("2026-09-30T10:00:00.000Z"),
    });
    const first = await coordinator.enqueue("account-1", task);
    const second = await coordinator.enqueue("account-1", { ...task, id: "task-2" });

    const firstDelivery = coordinator.deliver("account-1", first.completionId);
    const secondDelivery = coordinator.deliver("account-1", second.completionId);
    for (let attempt = 0; attempt < 20 && POST.mock.calls.length < 2; attempt += 1) await Promise.resolve();
    expect(POST).toHaveBeenCalledTimes(2);

    release.get(first.completionId)!(okResponse({ ...result, id: first.completionId }));
    release.get(second.completionId)!(okResponse({ ...result, id: second.completionId, taskId: second.taskId }));
    await expect(Promise.all([firstDelivery, secondDelivery])).resolves.toMatchObject([
      { completionId: first.completionId, state: "ACCEPTED" },
      { completionId: second.completionId, state: "ACCEPTED" },
    ]);
  });

  test("does not coalesce the same completion ID across authenticated accounts", async () => {
    const store = createTaskCompletionCommandStore({ storage: durableStorage() });
    const release: Array<(value: ReturnType<typeof okResponse>) => void> = [];
    const POST = jest.fn(() => new Promise<ReturnType<typeof okResponse>>((resolve) => { release.push(resolve); }));
    const coordinator = createTaskCompletionCoordinator({
      store, client: { POST } as unknown as Pick<ApiClient, "POST">,
      getAuthorizationSession: (() => {
        const activeAccounts = ["account-1", "account-2"];
        let next = 0;
        return () => ({ accountId: activeAccounts[next++]!, client: { POST } as unknown as Pick<ApiClient, "POST"> });
      })(),
      newCompletionId: () => "account-scoped-id", now: () => new Date("2026-09-30T10:00:00.000Z"),
    });
    const first = await coordinator.enqueue("account-1", task);
    const second = await coordinator.enqueue("account-2", task);
    const firstDelivery = coordinator.deliver("account-1", first.completionId);
    const secondDelivery = coordinator.deliver("account-2", second.completionId);
    for (let attempt = 0; attempt < 20 && POST.mock.calls.length < 2; attempt += 1) await Promise.resolve();
    expect(POST).toHaveBeenCalledTimes(2);
    release[0]!(okResponse({ ...result, id: first.completionId }));
    release[1]!(okResponse({ ...result, id: second.completionId }));
    await Promise.all([firstDelivery, secondDelivery]);
    expect(await store.list("account-1")).toMatchObject([{ state: "ACCEPTED" }]);
    expect(await store.list("account-2")).toMatchObject([{ state: "ACCEPTED" }]);
  });

  test("keeps a pending command when local accepted-result persistence fails after server acceptance", async () => {
    const durable = durableStorage();
    const faultyStorage: TaskCompletionCommandStorage = {
      ...durable,
      async recordAccepted() { throw new Error("SQLite write failed"); },
    };
    const storageStore = createTaskCompletionCommandStore({ storage: faultyStorage });
    const coordinator = createTaskCompletionCoordinator({
      store: storageStore, client: { POST: jest.fn().mockResolvedValue(okResponse({ ...result, id: "durable-id" })) } as unknown as Pick<ApiClient, "POST">,
      newCompletionId: () => "durable-id", now: () => new Date("2026-09-30T10:00:00.000Z"),
    });

    const outcome = await coordinator.complete("account-1", task);
    expect(outcome.state).toBe("PENDING");
    expect(await storageStore.list("account-1")).toMatchObject([{ completionId: "durable-id", state: "PENDING" }]);
  });

  test("durably records a deterministic server conflict without replacing the original command", async () => {
    const store = createTaskCompletionCommandStore({ storage: durableStorage() });
    const coordinator = createTaskCompletionCoordinator({
      store,
      client: { POST: jest.fn().mockResolvedValue({ data: undefined, error: { error: { code: "TASK_VERSION_CONFLICT" } }, response: { ok: false, status: 409 } }) } as unknown as Pick<ApiClient, "POST">,
      newCompletionId: () => "conflicted-id", now: () => new Date("2026-09-30T10:00:00.000Z"),
    });

    await coordinator.complete("account-1", task);
    expect(await store.list("account-1")).toMatchObject([{ completionId: "conflicted-id", state: "CONFLICTED", conflictCode: "TASK_VERSION_CONFLICT", occurredAt: "2026-09-30T10:00:00.000Z" }]);
  });

  test("keeps unauthenticated delivery pending but settles definitive access denial as unavailable", async () => {
    const storage = durableStorage();
    const unauthorized = createTaskCompletionCoordinator({
      store: createTaskCompletionCommandStore({ storage }),
      client: { POST: jest.fn().mockResolvedValue({ data: undefined, error: { error: {} }, response: { ok: false, status: 401 } }) } as unknown as Pick<ApiClient, "POST">,
      getAuthorizationSession: () => ({ accountId: "account-1", client: { POST: jest.fn().mockResolvedValue({ data: undefined, error: { error: {} }, response: { ok: false, status: 401 } }) } as unknown as Pick<ApiClient, "POST"> }),
      newCompletionId: () => "auth-pending", now: () => new Date("2026-09-30T10:00:00.000Z"),
    });
    await unauthorized.complete("account-1", task);
    expect(await createTaskCompletionCommandStore({ storage }).list("account-1")).toMatchObject([{ state: "PENDING" }]);

    const forbidden = createTaskCompletionCoordinator({
      store: createTaskCompletionCommandStore({ storage }),
      client: { POST: jest.fn().mockResolvedValue({ data: undefined, error: { error: {} }, response: { ok: false, status: 403 } }) } as unknown as Pick<ApiClient, "POST">,
      getAuthorizationSession: () => ({ accountId: "account-2", client: { POST: jest.fn().mockResolvedValue({ data: undefined, error: { error: {} }, response: { ok: false, status: 403 } }) } as unknown as Pick<ApiClient, "POST"> }),
      newCompletionId: () => "access-conflict", now: () => new Date("2026-09-30T10:00:00.000Z"),
    });
    await forbidden.complete("account-2", task);
    expect(await createTaskCompletionCommandStore({ storage }).list("account-2")).toMatchObject([{ state: "CONFLICTED", conflictCode: "ACCESS_UNAVAILABLE" }]);
  });

  test("explicit conflict review uses a new identity and current version while preserving original occurredAt", async () => {
    const store = createTaskCompletionCommandStore({ storage: durableStorage() });
    const coordinator = createTaskCompletionCoordinator({
      store,
      client: { POST: jest.fn().mockResolvedValue({ data: undefined, error: { error: { code: "TASK_VERSION_CONFLICT" } }, response: { ok: false, status: 409 } }) } as unknown as Pick<ApiClient, "POST">,
      newCompletionId: (() => { let id = 0; return () => `completion-${++id}`; })(),
      now: () => new Date("2026-09-30T10:00:00.000Z"),
    });
    await coordinator.complete("account-1", task);

    await coordinator.reconfirmConflict("account-1", "completion-1", { ...task, taskVersion: 8 });
    expect(await store.list("account-1")).toMatchObject([
      { completionId: "completion-1", state: "CONFLICTED", occurredAt: "2026-09-30T10:00:00.000Z", baseTaskVersion: 7 },
      { completionId: "completion-2", state: "CONFLICTED", occurredAt: "2026-09-30T10:00:00.000Z", baseTaskVersion: 8 },
    ]);
  });
});
