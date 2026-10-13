import type { ApiClient, TaskSkipComponents } from "../../../../../packages/api-client/src/index";

export type TaskSkipResult = TaskSkipComponents["schemas"]["TaskSkip"];
export type TaskSkipCommand = Readonly<{ taskId: string; baseTaskVersion: number; skipId: string }>;
export type TaskSkipFailure = Error & Readonly<{ kind: "OFFLINE" | "ACCESS" | "CONFLICT" | "INELIGIBLE" | "UNCERTAIN" | "INVALID"; status?: number; code?: string }>;

export function createTaskSkipFlow(options: Readonly<{ client: Pick<ApiClient, "POST">; isOnline?: () => boolean; newSkipId?: () => string }>) {
  const newSkipId = options.newSkipId ?? createId;
  return {
    createCommand(taskId: string, baseTaskVersion: number): TaskSkipCommand {
      return { taskId, baseTaskVersion, skipId: newSkipId() };
    },
    async submit(command: TaskSkipCommand): Promise<TaskSkipResult> {
      if ((options.isOnline ?? isOnline)() === false) throw failure("OFFLINE", "İnternet bağlantısı gerekli. Bağlandığınızda yeniden deneyin.");
      let result: { response: { ok: boolean; status: number }; data?: TaskSkipResult; error?: { error?: { code?: string } } };
      try {
        result = await options.client.POST("/tasks/{taskId}/skips", {
          params: { path: { taskId: command.taskId }, header: { "If-Match": String(command.baseTaskVersion) } },
          body: { skipId: command.skipId },
        }) as unknown as typeof result;
      } catch {
        throw failure("UNCERTAIN", "Sonuç doğrulanamadı. Aynı isteği yeniden deneyin.");
      }
      if (result.response.ok && result.data !== undefined) return result.data as TaskSkipResult;
      const status = result.response.status;
      const code = result.error?.error?.code;
      if (status === 401 || status === 403 || status === 404) throw failure("ACCESS", "Bu görev için erişim doğrulanamadı. Görev bilgilerini yeniden yükleyin.", status, code);
      if (status === 409) {
        const kind = code === "TASK_ALREADY_COMPLETED" || code === "TASK_ALREADY_SKIPPED" || code === "TASK_NOT_ACTIONABLE" ? "INELIGIBLE" : "CONFLICT";
        throw failure(kind, kind === "INELIGIBLE" ? "Bu görev artık atlanamaz. Güncel görevleri yükleyin." : "Görev değişti. Güncel bilgileri yükleyip yeniden karar verin.", status, code);
      }
      if (status >= 500) throw failure("UNCERTAIN", "Sonuç doğrulanamadı. Aynı isteği yeniden deneyin.", status, code);
      throw failure("INVALID", "Görev atlanamadı. Görev bilgilerini yeniden yükleyin.", status, code);
    },
  };
}

export type TaskSkipFlow = ReturnType<typeof createTaskSkipFlow>;
function failure(kind: TaskSkipFailure["kind"], message: string, status?: number, code?: string): TaskSkipFailure {
  return Object.assign(new Error(message), { kind, ...(status !== undefined ? { status } : {}), ...(code ? { code } : {}) });
}
function isOnline(): boolean { return typeof navigator === "undefined" || navigator.onLine !== false; }
function createId(): string {
  const randomUUID = globalThis.crypto?.randomUUID;
  if (randomUUID) return randomUUID.call(globalThis.crypto);
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (letter) => {
    const random = Math.floor(Math.random() * 16);
    return (letter === "x" ? random : (random & 0x3) | 0x8).toString(16);
  });
}
