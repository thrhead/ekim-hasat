import type { ApiClient } from "./api/onboarding-client";
import { getOnboardingEntryRoute, type OnboardingEntryRoute } from "./features/onboarding/onboarding-entry";
import type { MobileAuthController, MobileAuthState } from "./auth/auth-port";
import { createOnboardingDraftLifecycle } from "./features/onboarding/onboarding-draft.lifecycle";
import { createOnboardingDraftStore } from "./features/onboarding/onboarding-draft.store";

export type ProductionAppState = Readonly<{
  auth: MobileAuthState;
  entry: "loading" | "status-error" | OnboardingEntryRoute;
  client: ApiClient | null;
  accountId: string | null;
}>;

/** Owns production auth-to-onboarding routing while leaving credentials in T051. */
export function createAppComposition(
  controller: MobileAuthController,
  options: Readonly<{ draftLifecycle?: ReturnType<typeof createOnboardingDraftLifecycle> }> = {},
) {
  const draftLifecycle = options.draftLifecycle ?? createOnboardingDraftLifecycle({
    store: createOnboardingDraftStore(),
  });
  let state: ProductionAppState = {
    auth: controller.getState(),
    entry: "loading",
    client: null,
    accountId: null,
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
        if (revision === statusRevision) publish({ ...state, entry, client });
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
      publish({ auth, entry: "loading", client, accountId: nextAccountId });
      resolveStatus(client);
    } else {
      publish({ auth, entry: "loading", client: null, accountId: null });
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
    completeFirstField(field: unknown) {
      void field;
      statusRevision += 1;
      publish({ ...state, entry: "home" });
    },
    dispose() {
      disposed = true;
      statusRevision += 1;
      unsubscribe();
      listeners.clear();
    },
  };
}
