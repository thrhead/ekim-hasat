import type { ApiClient } from "./api/onboarding-client";
import { getOnboardingEntryRoute, type OnboardingEntryRoute } from "./features/onboarding/onboarding-entry";
import type { MobileAuthController, MobileAuthState } from "./auth/auth-port";
import { createOnboardingDraftLifecycle } from "./features/onboarding/onboarding-draft.lifecycle";
import { createOnboardingDraftStore } from "./features/onboarding/onboarding-draft.store";
import type { components, SeasonComponents } from "./api/onboarding-client";
import type { SeasonSetupResult } from "./features/seasons/season-setup-screen";
import { createSeasonCreateCommandStore } from "./features/seasons/season-create-command-store";
import { createSeasonSetupFlow } from "./features/seasons/season-setup-screen";

type FirstFieldSummary = components["schemas"]["FirstFieldSummary"];
type CreateRequest = SeasonComponents["schemas"]["CreateSeasonDraftRequest"];

export type ProductionAppState = Readonly<{
  auth: MobileAuthState;
  entry: "loading" | "status-error" | "season-setup" | "season-created" | OnboardingEntryRoute;
  client: ApiClient | null;
  accountId: string | null;
  fieldId: string | null;
  seasonRequest: CreateRequest | null;
  seasonResult: SeasonSetupResult | null;
}>;

/** Owns production auth-to-onboarding routing while leaving credentials in T051. */
export function createAppComposition(
  controller: MobileAuthController,
  options: Readonly<{
    draftLifecycle?: ReturnType<typeof createOnboardingDraftLifecycle>;
    seasonCreateStore?: ReturnType<typeof createSeasonCreateCommandStore>;
  }> = {},
) {
  const draftLifecycle = options.draftLifecycle ?? createOnboardingDraftLifecycle({
    store: createOnboardingDraftStore(),
  });
  const seasonCreateStore = options.seasonCreateStore ?? createSeasonCreateCommandStore();
  let state: ProductionAppState = {
    auth: controller.getState(),
    entry: "loading",
    client: null,
    accountId: null,
    fieldId: null,
    seasonRequest: null,
    seasonResult: null,
  };
  let disposed = false;
  let statusRevision = 0;
  const listeners = new Set<(state: ProductionAppState) => void>();

  function publish(next: ProductionAppState) {
    if (disposed) return;
    state = next;
    for (const listener of listeners) listener(state);
  }

  function resolveStatus(client: ApiClient) {
    const revision = ++statusRevision;
    publish({ ...state, entry: "loading", client });
    void getOnboardingEntryRoute(client).then(
      (entry) => {
        if (revision !== statusRevision) return;
        if (entry === "home" && state.accountId) {
          const accountId = state.accountId;
          const recoveryRevision = revision;
          const flow = createSeasonSetupFlow(client, seasonCreateStore);
          void Promise.all([
            flow.recover(accountId),
            flow.readLastSuccess(accountId),
          ]).then(([unresolved, success]) => {
            if (recoveryRevision !== statusRevision) return;
            if (unresolved) {
              publish({ ...state, entry: "season-setup", fieldId: unresolved.fieldId, seasonRequest: unresolved.request, client });
            } else if (success) {
              const season = success.result as SeasonSetupResult["season"];
              publish({
                ...state,
                entry: "season-created",
                fieldId: season.fieldId,
                seasonResult: { season, planSource: season.plan.source.kind },
                client,
              });
            } else {
              publish({ ...state, entry: "home", client });
            }
          }).catch(() => {
            if (recoveryRevision === statusRevision) publish({ ...state, entry: "home", client });
          });
        } else publish({ ...state, entry, client });
      },
      () => {
        if (revision === statusRevision) publish({ ...state, entry: "status-error", client });
      },
    );
  }

  function applyAuth(auth: MobileAuthState) {
    const client = auth.status === "authenticated" ? controller.getAuthenticatedApiClient() : null;
    const previousAccountId = state.auth.status === "authenticated" ? state.auth.accountId : null;
    const nextAccountId = auth.status === "authenticated" ? auth.accountId : null;
    if (previousAccountId && previousAccountId !== nextAccountId) {
      const cleanup = nextAccountId
        ? draftLifecycle.accountSwitch(previousAccountId)
        : draftLifecycle.signOut(previousAccountId);
      void cleanup.catch(() => {});
    }
    statusRevision += 1;
    if (auth.status === "authenticated" && client) {
      publish({ auth, entry: "loading", client, accountId: nextAccountId, fieldId: null, seasonRequest: null, seasonResult: null });
      resolveStatus(client);
    } else {
      publish({ auth, entry: "loading", client: null, accountId: null, fieldId: null, seasonRequest: null, seasonResult: null });
    }
  }

  const unsubscribe = controller.subscribe(applyAuth);
  void controller.start();

  return {
    getState: () => state,
    subscribe(listener: (state: ProductionAppState) => void) {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },
    retryStatus() {
      if (state.auth.status === "authenticated" && state.client) resolveStatus(state.client);
    },
    completeFirstField(field: FirstFieldSummary) {
      statusRevision += 1;
      publish({ ...state, entry: "season-setup", fieldId: field.id, seasonRequest: null, seasonResult: null });
    },
    async createSeason(fieldId: string, request: CreateRequest) {
      if (state.auth.status !== "authenticated" || !state.accountId || !state.client) {
        throw new Error("Sezon oluşturmak için oturum açın ve yeniden deneyin.");
      }
      const result = await createSeasonSetupFlow(state.client, seasonCreateStore).createOrRetry(state.accountId, fieldId, request);
      publish({ ...state, entry: "season-created", fieldId, seasonRequest: null, seasonResult: result });
      return result;
    },
    async continueAfterSeason() {
      if (state.accountId) {
        const success = await seasonCreateStore.readLastSuccess(state.accountId);
        if (success) await seasonCreateStore.clearLastSuccess(state.accountId, success.idempotencyKey);
      }
      publish({ ...state, entry: "home", fieldId: null, seasonRequest: null, seasonResult: null });
    },
    dispose() {
      disposed = true;
      statusRevision += 1;
      unsubscribe();
      listeners.clear();
    },
  };
}
