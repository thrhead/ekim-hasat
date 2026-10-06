import type { ApiClient } from "./api/onboarding-client";
import { getOnboardingEntryRoute, type OnboardingEntryRoute } from "./features/onboarding/onboarding-entry";
import type { MobileAuthController, MobileAuthState } from "./auth/auth-port";
import { createOnboardingDraftLifecycle } from "./features/onboarding/onboarding-draft.lifecycle";
import { createOnboardingDraftStore } from "./features/onboarding/onboarding-draft.store";
import type { components, SeasonComponents } from "./api/onboarding-client";
import type { SeasonSetupResult } from "./features/seasons/season-setup-screen";
import { createSeasonCreateCommandStore } from "./features/seasons/season-create-command-store";
import { createSeasonSetupFlow } from "./features/seasons/season-setup-screen";
import { readSeason } from "./features/seasons/season-setup-screen";
import { createTaskCompletionCommandStore, type TaskCompletionCommandStore } from "./features/tasks/task-completion-command-store";
import { createTaskCompletionCoordinator } from "./features/tasks/task-completion";
import type { FieldDetail } from "./features/fields/fields-client";

type FirstFieldSummary = components["schemas"]["FirstFieldSummary"];
type CreateRequest = SeasonComponents["schemas"]["CreateSeasonDraftRequest"];

export type ProductionAppState = Readonly<{
  auth: MobileAuthState;
  entry: "loading" | "status-error" | "season-setup" | "season-created" | "season-review" | "today" | "history" | "fields-list" | "field-detail" | "field-create" | "field-edit" | "observation-create" | "field-diary" | OnboardingEntryRoute;
  client: ApiClient | null;
  accountId: string | null;
  fieldId: string | null;
  seasonRequest: CreateRequest | null;
  seasonResult: SeasonSetupResult | null;
  seasonDraft: SeasonComponents["schemas"]["SeasonDraft"] | null;
  historyFieldId: string | null;
  historySeasonId: string | null;
  observationSeasonId: string | null;
  diaryFieldId: string | null;
  diarySeasonId: string | null;
  editingField?: FieldDetail | null;
}>;

export const APP_PRIMARY_NAVIGATION = [
  { id: "today", label: "Bugün" },
  { id: "calendar", label: "Takvim" },
  { id: "fields", label: "Tarlalar" },
  { id: "create", label: "+" },
  { id: "more", label: "Daha Fazla" },
] as const;

/** Owns production auth-to-onboarding routing while leaving credentials in T051. */
export function createAppComposition(
  controller: MobileAuthController,
  options: Readonly<{
    draftLifecycle?: ReturnType<typeof createOnboardingDraftLifecycle>;
    seasonCreateStore?: ReturnType<typeof createSeasonCreateCommandStore>;
    taskCompletionStore?: TaskCompletionCommandStore;
  }> = {},
) {
  const draftLifecycle = options.draftLifecycle ?? createOnboardingDraftLifecycle({
    store: createOnboardingDraftStore(),
  });
  const seasonCreateStore = options.seasonCreateStore ?? createSeasonCreateCommandStore();
  const taskCompletionStore = options.taskCompletionStore ?? createTaskCompletionCommandStore();
  let taskCompletionCoordinator: ReturnType<typeof createTaskCompletionCoordinator> | null = null;
  let state: ProductionAppState = {
    auth: controller.getState(),
    entry: "loading",
    client: null,
    accountId: null,
    fieldId: null,
    seasonRequest: null,
    seasonResult: null,
    seasonDraft: null,
    historyFieldId: null,
    historySeasonId: null,
    observationSeasonId: null,
    diaryFieldId: null,
    diarySeasonId: null,
    editingField: null,
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
              publish({ ...state, entry: "season-setup", fieldId: unresolved.fieldId, seasonRequest: unresolved.request, client, seasonDraft: null });
            } else if (success) {
              const season = success.result as SeasonSetupResult["season"];
              publish({
                ...state,
                entry: "season-created",
                fieldId: season.fieldId,
                seasonResult: { season, planSource: season.plan.source.kind },
                seasonDraft: season.status === "DRAFT" ? season : null,
                client,
              });
            } else {
              publish({ ...state, entry: "today", client });
            }
          }).catch(() => {
            if (recoveryRevision === statusRevision) publish({ ...state, entry: "today", client });
          });
        } else publish({ ...state, entry, client });
      },
      (failure) => {
        if (revision !== statusRevision) return;
        void recoverPendingCompletionEntry(client, revision, failure);
      },
    );
  }

  async function recoverPendingCompletionEntry(client: ApiClient, revision: number, failure: unknown) {
    const status = failure && typeof failure === "object" && "status" in failure
      ? Number((failure as { status: unknown }).status) : undefined;
    if (status !== undefined && (status < 500 || !Number.isFinite(status))) {
      if (revision === statusRevision) publish({ ...state, entry: "status-error", client });
      return;
    }
    const accountId = state.auth.status === "authenticated" ? state.auth.accountId : null;
    if (!accountId) {
      if (revision === statusRevision) publish({ ...state, entry: "status-error", client });
      return;
    }
    try {
      const flow = createSeasonSetupFlow(client, seasonCreateStore);
      const unresolved = await flow.recover(accountId);
      if (revision !== statusRevision) return;
      if (unresolved) {
        publish({ ...state, entry: "season-setup", fieldId: unresolved.fieldId, seasonRequest: unresolved.request, client, seasonDraft: null });
        return;
      }
      const commands = await taskCompletionStore.list(accountId);
      if (revision !== statusRevision) return;
      publish({ ...state, entry: commands.some((command) => command.state === "PENDING") ? "today" : "status-error", client, accountId });
    } catch {
      if (revision === statusRevision) publish({ ...state, entry: "status-error", client });
    }
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
      publish({ auth, entry: "loading", client, accountId: nextAccountId, fieldId: null, seasonRequest: null, seasonResult: null, seasonDraft: null, historyFieldId: null, historySeasonId: null, observationSeasonId: null, diaryFieldId: null, diarySeasonId: null });
      resolveStatus(client);
    } else {
      publish({ auth, entry: "loading", client: null, accountId: null, fieldId: null, seasonRequest: null, seasonResult: null, seasonDraft: null, historyFieldId: null, historySeasonId: null, observationSeasonId: null, diaryFieldId: null, diarySeasonId: null });
    }
  }

  const unsubscribe = controller.subscribe(applyAuth);
  void controller.start();

  return {
    taskCompletionStore,
    getTaskCompletionCoordinator() {
      taskCompletionCoordinator ??= createTaskCompletionCoordinator({
        store: taskCompletionStore,
        getAuthorizationSession: () => controller.getAuthenticatedApiSession(),
      });
      return taskCompletionCoordinator;
    },
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
      publish({ ...state, entry: "season-setup", fieldId: field.id, seasonRequest: null, seasonResult: null, seasonDraft: null });
    },
    async createSeason(fieldId: string, request: CreateRequest) {
      if (state.auth.status !== "authenticated" || !state.accountId || !state.client) {
        throw new Error("Sezon oluşturmak için oturum açın ve yeniden deneyin.");
      }
      const result = await createSeasonSetupFlow(state.client, seasonCreateStore).createOrRetry(state.accountId, fieldId, request);
      publish({ ...state, entry: "season-created", fieldId, seasonRequest: null, seasonResult: result, seasonDraft: result.season.status === "DRAFT" ? result.season : null });
      return result;
    },
    reviewSeason(draft: SeasonComponents["schemas"]["SeasonDraft"]) {
      publish({ ...state, entry: "season-review", seasonDraft: draft });
    },
    showToday() { publish({ ...state, entry: "today", seasonDraft: null, historyFieldId: null, historySeasonId: null }); },
    showFields() { publish({ ...state, entry: "fields-list", seasonDraft: null, historyFieldId: null, historySeasonId: null, editingField: null }); },
    openField(fieldId: string) { publish({ ...state, entry: "field-detail", fieldId, editingField: null, seasonDraft: null }); },
    showObservationCreate(fieldId: string, seasonId?: string) {
      publish({ ...state, entry: "observation-create", fieldId, observationSeasonId: seasonId ?? null, seasonDraft: null });
    },
    showFieldDiary(fieldId: string, seasonId?: string) {
      publish({ ...state, entry: "field-diary", diaryFieldId: fieldId, diarySeasonId: seasonId ?? null, seasonDraft: null });
    },
    startFieldCreate() { publish({ ...state, entry: "field-create", editingField: null, seasonDraft: null }); },
    editField(field: FieldDetail) { publish({ ...state, entry: "field-edit", fieldId: field.id, editingField: field, seasonDraft: null }); },
    showHistory(fieldId: string, seasonId?: string) {
      publish({ ...state, entry: "history", historyFieldId: fieldId, historySeasonId: seasonId ?? null, seasonDraft: null });
    },
    async restoreSeasonReview() {
      if (!state.client || !state.seasonDraft) return;
      try {
        const latest = await readSeason(state.client, state.seasonDraft.id);
        if (latest.status === "DRAFT") publish({ ...state, entry: "season-review", seasonDraft: latest });
        else publish({ ...state, entry: "season-created", seasonDraft: null, seasonResult: { season: latest, planSource: latest.plan.source.kind } });
      } catch { publish({ ...state, entry: "season-review" }); }
    },
    exitSeasonReview() {
      publish({ ...state, entry: "season-created" });
    },
    leaveSeasonReview() {
      publish({ ...state, entry: "home", seasonDraft: null });
    },
    async continueAfterSeason() {
      const accountId = state.auth.status === "authenticated" ? state.auth.accountId : null;
      const revision = statusRevision;
      let hasPendingCompletion = false;
      if (accountId) {
        const success = await seasonCreateStore.readLastSuccess(accountId);
        if (revision !== statusRevision || state.auth.status !== "authenticated" || state.auth.accountId !== accountId) return;
        if (success) await seasonCreateStore.clearLastSuccess(accountId, success.idempotencyKey);
        if (revision !== statusRevision || state.auth.status !== "authenticated" || state.auth.accountId !== accountId) return;
        const commands = await taskCompletionStore.list(accountId);
        if (revision !== statusRevision || state.auth.status !== "authenticated" || state.auth.accountId !== accountId) return;
        hasPendingCompletion = commands.some((command) => command.state === "PENDING");
      }
      publish({ ...state, entry: hasPendingCompletion ? "today" : "home", fieldId: null, seasonRequest: null, seasonResult: null, seasonDraft: null });
    },
    dispose() {
      disposed = true;
      statusRevision += 1;
      unsubscribe();
      listeners.clear();
    },
  };
}
