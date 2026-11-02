import type { ApiClient } from "../../../../../packages/api-client/src/index";
import type { ManualTaskStore } from "./manual-task-store";

type Session = Readonly<{ accountId: string; client: ApiClient }>;
export function createManualTaskDelivery(options: { store: ManualTaskStore; getAuthorizationSession(): Session | null }) {
  let inFlight: Promise<void> | null = null;
  async function deliverOne(accountId: string) {
    const session = options.getAuthorizationSession();
    if (!session || session.accountId !== accountId) return;
    for (const command of await options.store.list(accountId)) {
      if (command.state !== "PENDING" && command.state !== "UNCONFIRMED") continue;
      if (options.getAuthorizationSession()?.accountId !== accountId) return;
      let priorUncertain: boolean;
      try { priorUncertain = await options.store.startAttempt(accountId, command.taskId); } catch { continue; }
      try {
        if (options.getAuthorizationSession()?.accountId !== accountId) return;
        const result = await session.client.POST("/seasons/{seasonId}/manual-tasks", {
          params: { path: { seasonId: command.seasonId } },
          body: { taskId: command.taskId, mutationId: command.mutationId, title: command.title,
            description: command.description ?? null, plannedLocalDate: command.plannedLocalDate },
        });
        if (options.getAuthorizationSession()?.accountId !== accountId) return;
        if (result.response.ok && result.data) await options.store.recordAccepted(accountId, command.taskId, result.data);
        else if ([400, 403, 404, 409, 422].includes(result.response.status)) await options.store.finishAttempt(accountId, command.taskId, priorUncertain ? "UNCONFIRMED" : "REJECTED", result.error?.error?.code);
        else await options.store.finishAttempt(accountId, command.taskId, "UNCONFIRMED");
      } catch {
        // Durable attempt marker survives network loss, write failure or process death.
        try { await options.store.finishAttempt(accountId, command.taskId, "UNCONFIRMED"); } catch { /* Account changed or local storage unavailable. */ }
      } finally { options.store.releaseAttempt(accountId, command.taskId); }
    }
  }
  return { deliver(accountId: string) { if (inFlight) return inFlight; inFlight = deliverOne(accountId).finally(() => { inFlight = null; }); return inFlight; } };
}
