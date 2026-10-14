import type { ApiClient } from "../../../../../packages/api-client/src/index";
import type { ObservationCommandStore } from "./observation-command-store";

type AuthenticatedSession = Readonly<{ accountId: string; client: ApiClient }>;

/** Bounded observation retry while the app has a matching authenticated session. */
export function scheduleObservationRetry(deliver: () => Promise<void>, intervalMs = 30000): () => void {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    void deliver().catch(() => {}).finally(() => { running = false; });
  }, intervalMs);
  return () => clearInterval(timer);
}

/** Sends only observation commands for the account holding a real authenticated API session. */
export function createObservationDelivery(options: Readonly<{
  store: ObservationCommandStore;
  getAuthorizationSession(): AuthenticatedSession | null;
}>) {
  let inFlight: Promise<void> | null = null;
  async function deliverOneAccount(accountId: string) {
    const session = options.getAuthorizationSession();
    if (!session || session.accountId !== accountId) return;
    for (const command of await options.store.list(accountId)) {
      if (command.accountId !== accountId) continue;
      if (command.state !== "PENDING") continue;
      if (options.getAuthorizationSession()?.accountId !== accountId) return;
      const priorUncertain = !!command.attemptMayHaveCommitted;
      await options.store.markAttempt(accountId, command.observationId);
      if (options.getAuthorizationSession()?.accountId !== accountId) {
        await options.store.finishAttempt(accountId, command.observationId);
        return;
      }
      try {
        const response = await session.client.POST("/fields/{fieldId}/observations", {
          params: { path: { fieldId: command.fieldId } },
          body: {
            observationId: command.observationId, description: command.description,
            occurredAtLocal: command.occurredAtLocal, occurredAt: command.occurredAt,
            capturedBusinessTimezone: command.capturedBusinessTimezone,
            ...(command.seasonId ? { seasonId: command.seasonId } : {}),
          },
        });
        if (response.response.ok && response.data) {
          if (options.getAuthorizationSession()?.accountId !== accountId) return;
          await options.store.recordAccepted(accountId, command.observationId, response.data);
        } else if ([400, 403, 404, 409].includes(response.response.status)) {
          await options.store.recordAttention(accountId, command.observationId,
            priorUncertain ? "UNCONFIRMED" : "NEEDS_ATTENTION", response.error?.error.code ?? "INVALID_REQUEST");
        } else if (response.response.status === 401 && !priorUncertain) {
          await options.store.clearAttemptUncertainty(accountId, command.observationId);
        }
      } catch {
        // The durable marker records that this request might have reached the server.
      } finally {
        await options.store.finishAttempt(accountId, command.observationId);
      }
    }
  }
  return {
    deliver(accountId: string) {
      if (inFlight) return inFlight;
      inFlight = deliverOneAccount(accountId).finally(() => { inFlight = null; });
      return inFlight;
    },
  };
}
