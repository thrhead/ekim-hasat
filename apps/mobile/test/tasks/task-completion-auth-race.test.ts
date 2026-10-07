import { createMobileAuthController, type AuthSession, type MobileAuthPort } from "../../src/auth/auth-port";
import {
  createTaskCompletionCommandStore,
  type TaskCompletionCommand,
  type TaskCompletionCommandStorage,
} from "../../src/features/tasks/task-completion-command-store";
import { createTaskCompletionCoordinator } from "../../src/features/tasks/task-completion";
import type { SeasonOperations, TaskCompletionComponents } from "../../../../packages/api-client/src/index";

type Task = SeasonOperations["getTodayPlannedTasks"]["responses"][200]["content"]["application/json"]["tasks"][number];
type Accepted = TaskCompletionComponents["schemas"]["TaskCompletion"];

const task: Task = {
  id: "task-1", seasonId: "season-1", fieldId: "field-1", title: "Sulama kontrolü", cropDisplayName: "Arpa",
  plannedLocalDate: "2026-09-30", sourceKind: "MANUAL", taskVersion: 7,
};

function authPort(initial: AuthSession | null) {
  let current = initial;
  let listener: ((session: AuthSession | null) => void) | null = null;
  const port: MobileAuthPort = {
    restoreSession: async () => current,
    onSessionChange(next) {
      listener = next;
      return () => { listener = null; };
    },
    signIn: async () => ({ ok: true, value: undefined }),
    signUp: async () => ({ ok: true, value: "confirmation-required" }),
    signOut: async () => {
      current = null;
      listener?.(null);
    },
  };
  return {
    port,
    setSession(session: AuthSession | null) {
      current = session;
      listener?.(session);
    },
  };
}

function storageWithDeferredRead() {
  const commands = new Map<string, TaskCompletionCommand[]>();
  let deferredRead: { resolve: () => void; promise: Promise<void> } | null = null;
  let readCount = 0;
  let deferAtRead: number | null = null;
  const storage: TaskCompletionCommandStorage = {
    async listCommands(accountId) {
      readCount += 1;
      if (readCount === deferAtRead) {
        deferAtRead = null;
        deferredRead = {} as { resolve: () => void; promise: Promise<void> };
        deferredRead.promise = new Promise<void>((resolve) => { deferredRead!.resolve = resolve; });
        await deferredRead.promise;
      }
      return structuredClone(commands.get(accountId) ?? []);
    },
    async insertCommand(accountId, command) {
      commands.set(accountId, [...(commands.get(accountId) ?? []), structuredClone(command)]);
    },
    async recordAccepted(accountId, completionId, result) {
      commands.set(accountId, (commands.get(accountId) ?? []).map((command) => command.completionId === completionId
        ? { ...command, state: "ACCEPTED", result } : command));
    },
    async recordConflict(accountId, completionId, conflictCode) {
      commands.set(accountId, (commands.get(accountId) ?? []).map((command) => command.completionId === completionId
        ? { ...command, state: "CONFLICTED", conflictCode } : command));
    },
    async writeTodaySnapshot() {},
    async readTodaySnapshot() { return null; },
  };
  return {
    storage,
    deferNextRead() { deferAtRead = readCount + 1; },
    deferAfterOneRead() { deferAtRead = readCount + 2; },
    async waitForDeferredRead() {
      for (let attempt = 0; attempt < 20 && !deferredRead; attempt += 1) await Promise.resolve();
      if (!deferredRead) throw new Error("Expected the durable command read to be waiting");
    },
    releaseRead() { deferredRead?.resolve(); deferredRead = null; },
  };
}

function accepted(completionId: string, occurredAt: string): Accepted {
  return {
    id: completionId, taskId: task.id, seasonId: task.seasonId, fieldId: task.fieldId, title: task.title,
    plannedLocalDate: task.plannedLocalDate, occurredAt,
    businessTimezone: "Europe/Istanbul", sourceKind: "MANUAL",
  };
}

function acceptedResponse(completionId: string, occurredAt: string): Response {
  return new Response(JSON.stringify(accepted(completionId, occurredAt)), {
    status: 201,
    headers: { "Content-Type": "application/json" },
  });
}

describe("task completion authorization remains bound to its account", () => {
  test("does not dispatch an A retry after its deferred durable read resumes under B", async () => {
    const sessions = authPort({ accountId: "account-a", accessToken: "token-a" });
    const requests: Request[] = [];
    const controller = createMobileAuthController(sessions.port, {
      apiBaseUrl: "https://api.example.test/v1",
      fetch: async (input) => {
        requests.push(input as Request);
        const body = await (input as Request).clone().json() as { completionId: string; occurredAt: string };
        return acceptedResponse(body.completionId, body.occurredAt);
      },
    });
    await controller.start();

    const deferred = storageWithDeferredRead();
    const store = createTaskCompletionCommandStore({ storage: deferred.storage });
    const coordinator = createTaskCompletionCoordinator({
      store,
      getAuthorizationSession: () => controller.getAuthenticatedApiSession(),
    });
    const command = await coordinator.enqueue("account-a", task);
    deferred.deferNextRead();
    const retry = coordinator.retryPending("account-a");
    await deferred.waitForDeferredRead();

    sessions.setSession({ accountId: "account-b", accessToken: "token-b" });
    deferred.releaseRead();
    await retry;

    expect(requests).toHaveLength(0);
    expect(await store.list("account-a")).toMatchObject([{ completionId: command.completionId, state: "PENDING" }]);
    expect(await store.list("account-b")).toEqual([]);

    sessions.setSession({ accountId: "account-a", accessToken: "token-a-returned" });
    await coordinator.retryPending("account-a");
    expect(requests).toHaveLength(1);
    expect(requests[0]!.headers.get("Authorization")).toBe("Bearer token-a-returned");
    expect(await store.list("account-a")).toMatchObject([{ completionId: command.completionId, state: "ACCEPTED" }]);
    expect(await store.list("account-b")).toEqual([]);
    controller.dispose();
  });

  test("settles an already-dispatched A request only in A after switching to B", async () => {
    const sessions = authPort({ accountId: "account-a", accessToken: "token-a" });
    let releaseResponse!: (response: Response) => void;
    let requestStarted!: () => void;
    const started = new Promise<void>((resolve) => { requestStarted = resolve; });
    const dispatchedRequests: Request[] = [];
    const controller = createMobileAuthController(sessions.port, {
      apiBaseUrl: "https://api.example.test/v1",
      fetch: async (input) => {
        dispatchedRequests.push(input as Request);
        requestStarted();
        return new Promise<Response>((resolve) => { releaseResponse = resolve; });
      },
    });
    await controller.start();

    const store = createTaskCompletionCommandStore({ storage: storageWithDeferredRead().storage });
    const coordinator = createTaskCompletionCoordinator({
      store,
      getAuthorizationSession: () => controller.getAuthenticatedApiSession(),
    });
    const command = await coordinator.enqueue("account-a", task);
    const delivery = coordinator.deliver("account-a", command.completionId);
    await started;

    expect(dispatchedRequests[0]?.headers.get("Authorization")).toBe("Bearer token-a");
    sessions.setSession({ accountId: "account-b", accessToken: "token-b" });
    const body = await dispatchedRequests[0]!.clone().json() as { completionId: string; occurredAt: string };
    releaseResponse(acceptedResponse(body.completionId, body.occurredAt));

    await expect(delivery).resolves.toMatchObject({ completionId: command.completionId, state: "ACCEPTED" });
    expect(await store.list("account-a")).toMatchObject([{ completionId: command.completionId, state: "ACCEPTED" }]);
    expect(await store.list("account-b")).toEqual([]);
    controller.dispose();
  });

  test("rechecks the active account after loading the command and before binding request authorization", async () => {
    const sessions = authPort({ accountId: "account-a", accessToken: "token-a" });
    const requests: Request[] = [];
    const controller = createMobileAuthController(sessions.port, {
      apiBaseUrl: "https://api.example.test/v1",
      fetch: async (input) => {
        requests.push(input as Request);
        const body = await (input as Request).clone().json() as { completionId: string; occurredAt: string };
        return acceptedResponse(body.completionId, body.occurredAt);
      },
    });
    await controller.start();
    const deferred = storageWithDeferredRead();
    const store = createTaskCompletionCommandStore({ storage: deferred.storage });
    const coordinator = createTaskCompletionCoordinator({
      store,
      getAuthorizationSession: () => controller.getAuthenticatedApiSession(),
    });
    const command = await coordinator.enqueue("account-a", task);
    deferred.deferAfterOneRead();
    const retry = coordinator.retryPending("account-a");
    await deferred.waitForDeferredRead();

    // retryPending has loaded the durable command; deliver is waiting at its final load before auth binding.
    sessions.setSession({ accountId: "account-b", accessToken: "token-b" });
    deferred.releaseRead();
    await retry;

    expect(requests).toHaveLength(0);
    expect(await store.list("account-a")).toMatchObject([{ completionId: command.completionId, state: "PENDING" }]);
    expect(await store.list("account-b")).toEqual([]);
    controller.dispose();
  });

  test("does not dispatch a queued A retry after logout", async () => {
    const sessions = authPort({ accountId: "account-a", accessToken: "token-a" });
    const requests: Request[] = [];
    const controller = createMobileAuthController(sessions.port, {
      apiBaseUrl: "https://api.example.test/v1",
      fetch: async (input) => {
        requests.push(input as Request);
        const body = await (input as Request).clone().json() as { completionId: string; occurredAt: string };
        return acceptedResponse(body.completionId, body.occurredAt);
      },
    });
    await controller.start();
    const deferred = storageWithDeferredRead();
    const store = createTaskCompletionCommandStore({ storage: deferred.storage });
    const coordinator = createTaskCompletionCoordinator({
      store,
      getAuthorizationSession: () => controller.getAuthenticatedApiSession(),
    });
    const command = await coordinator.enqueue("account-a", task);
    deferred.deferNextRead();
    const retry = coordinator.retryPending("account-a");
    await deferred.waitForDeferredRead();

    await controller.signOut();
    deferred.releaseRead();
    await retry;

    expect(requests).toHaveLength(0);
    expect(await store.list("account-a")).toMatchObject([{ completionId: command.completionId, state: "PENDING" }]);
    expect(await store.list("account-b")).toEqual([]);
    controller.dispose();
  });
});
