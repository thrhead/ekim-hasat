import type { ApiClient } from "../../api/onboarding-client";
import type { SeasonOperations, TaskCompletionComponents } from "../../../../../packages/api-client/src/index";
import { type TaskCompletionCommand, type TaskCompletionCommandStore } from "./task-completion-command-store";

type Task = SeasonOperations["getTodayPlannedTasks"]["responses"][200]["content"]["application/json"]["tasks"][number];
type AcceptedCompletion = TaskCompletionComponents["schemas"]["TaskCompletion"];

export function createTaskCompletionCoordinator(options: Readonly<{
  store: TaskCompletionCommandStore;
  getAuthorizationSession: () => Readonly<{ accountId: string; client: Pick<ApiClient, "POST"> }> | null;
  newCompletionId?: () => string;
  now?: () => Date;
}>) {
  const newCompletionId = options.newCompletionId ?? createId;
  const now = options.now ?? (() => new Date());
  const inFlight = new Map<string, Promise<TaskCompletionCommand>>();

  async function send(accountId: string, command: TaskCompletionCommand): Promise<TaskCompletionCommand> {
    const authorizationSession = options.getAuthorizationSession();
    if (!authorizationSession || authorizationSession.accountId !== accountId) return command;
    try {
      const response = await authorizationSession.client.POST("/tasks/{taskId}/completions", {
        params: { path: { taskId: command.taskId }, header: { "If-Match": String(command.baseTaskVersion) } },
        body: command.request,
      });
      if (response.response.ok && response.error === undefined && response.data !== undefined) {
        await options.store.recordAccepted(accountId, command.completionId, response.data as AcceptedCompletion);
        return (await options.store.list(accountId)).find((item) => item.completionId === command.completionId)!;
      }
      const status = response.response.status;
      if (status === 401) return command;
      if (status === 403 || status === 404) {
        await options.store.recordConflict(accountId, command.completionId, "ACCESS_UNAVAILABLE");
      } else if (status === 409) {
        await options.store.recordConflict(accountId, command.completionId, conflictCode(response.error) ?? "TASK_CONFLICT");
      } else if (status >= 400 && status < 500) {
        await options.store.recordConflict(accountId, command.completionId, conflictCode(response.error) ?? "INVALID_COMMAND");
      } else {
        return command;
      }
    } catch {
      // A transport error is ambiguous: retain PENDING and retry this exact command.
      const persisted = (await options.store.list(accountId)).find((item) => item.completionId === command.completionId);
      return persisted ?? command;
    }
    return (await options.store.list(accountId)).find((item) => item.completionId === command.completionId)!;
  }

  function buildCommand(task: Task, completionId: string, occurredAt: string, baseTaskVersion = task.taskVersion): TaskCompletionCommand {
      return {
      completionId,
      taskId: task.id,
      seasonId: task.seasonId,
      fieldId: task.fieldId,
      title: task.title,
      cropDisplayName: task.cropDisplayName,
      ...(task.sourceKind ? { sourceKind: task.sourceKind } : {}),
      plannedLocalDate: task.plannedLocalDate,
      baseTaskVersion,
      occurredAt,
      request: { completionId, occurredAt },
      state: "PENDING",
    };
  }

  return {
    async enqueue(accountId: string, task: Task): Promise<TaskCompletionCommand> {
      const existing = (await options.store.list(accountId)).find((item) => item.taskId === task.id);
      if (existing) {
        if (existing.state === "CONFLICTED") throw new Error("Review the conflicted completion before confirming again");
        return existing;
      }
      const command = buildCommand(task, newCompletionId(), now().toISOString());
      await options.store.enqueue(accountId, command);
      return command;
    },

    async deliver(accountId: string, completionId: string): Promise<TaskCompletionCommand> {
      const key = JSON.stringify([accountId, completionId]);
      const alreadyDelivering = inFlight.get(key);
      if (alreadyDelivering) return alreadyDelivering;
      const command = (await options.store.list(accountId)).find((item) => item.completionId === completionId);
      const startedWhileReading = inFlight.get(key);
      if (startedWhileReading) return startedWhileReading;
      if (!command || command.state !== "PENDING") throw new Error("Only a pending completion can be delivered");
      const delivery = Promise.resolve().then(() => send(accountId, command));
      inFlight.set(key, delivery);
      try {
        return await delivery;
      } finally {
        if (inFlight.get(key) === delivery) inFlight.delete(key);
      }
    },

    async complete(accountId: string, task: Task): Promise<TaskCompletionCommand> {
      const command = await this.enqueue(accountId, task);
      return command.state === "PENDING" ? this.deliver(accountId, command.completionId) : command;
    },

    async retryPending(accountId: string): Promise<TaskCompletionCommand[]> {
      const pending = (await options.store.list(accountId)).filter((item) => item.state === "PENDING");
      const settled: TaskCompletionCommand[] = [];
      for (const command of pending) settled.push(await this.deliver(accountId, command.completionId));
      return settled;
    },

    async reconfirmConflict(accountId: string, conflictedCompletionId: string, refreshedTask: Task): Promise<TaskCompletionCommand> {
      const old = (await options.store.list(accountId)).find((item) => item.completionId === conflictedCompletionId);
      if (!old || old.state !== "CONFLICTED" || old.taskId !== refreshedTask.id) {
        throw new Error("A conflicted completion for this task must be reviewed first");
      }
      const command = buildCommand(refreshedTask, newCompletionId(), old.occurredAt, refreshedTask.taskVersion);
      await options.store.enqueue(accountId, command);
      return this.deliver(accountId, command.completionId);
    },
  };
}

function createId(): string {
  const randomUUID = globalThis.crypto?.randomUUID;
  if (randomUUID) return randomUUID.call(globalThis.crypto);
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (letter) => {
    const random = Math.floor(Math.random() * 16);
    return (letter === "x" ? random : (random & 0x3) | 0x8).toString(16);
  });
}

function conflictCode(error: unknown): string | null {
  if (!error || typeof error !== "object" || !("error" in error)) return null;
  const body = (error as { error?: unknown }).error;
  if (!body || typeof body !== "object" || !("code" in body)) return null;
  const code = (body as { code?: unknown }).code;
  return typeof code === "string" && code.length > 0 ? code : null;
}
