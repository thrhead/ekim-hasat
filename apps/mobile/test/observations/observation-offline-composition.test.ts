jest.mock("@react-native-async-storage/async-storage", () => (
  jest.requireActual("@react-native-async-storage/async-storage/jest/async-storage-mock")
));

import { createAppComposition } from "../../src/app-composition";
import { renderObservationContextRoute } from "../../App";
import type { MobileAuthController } from "../../src/auth/auth-port";
import type { ObservationCommandStore } from "../../src/features/observations/observation-command-store";
import { createSeasonCreateCommandStore } from "../../src/features/seasons/season-create-command-store";
import { createTaskCompletionCommandStore } from "../../src/features/tasks/task-completion-command-store";

it("restores only a saved observation context after retryable offline auth restoration", async () => {
  const observationStore = {
    getLocalCaptureAccount: jest.fn().mockResolvedValue("account-a"),
    getLastContext: jest.fn().mockResolvedValue({ fieldId: "field-a", seasonId: null, businessTimezone: "Europe/Istanbul" }),
  } as unknown as ObservationCommandStore;
  const controller = {
    getState: () => ({ status: "signed-out" }),
    getRestorationOutcome: () => "retryable-unavailable",
    getAuthenticatedApiClient: () => null,
    getAuthenticatedApiSession: () => null,
    subscribe: (listener: (value: unknown) => void) => { listener({ status: "signed-out" }); return () => {}; },
    start: async () => {},
  } as unknown as MobileAuthController;
  const composition = createAppComposition(controller, { observationStore });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(composition.getState()).toMatchObject({ entry: "observation-create", accountId: "account-a", fieldId: "field-a", client: null });
  expect(renderObservationContextRoute(composition.getState(), composition)).not.toBeNull();
  composition.showSignIn();
  expect(composition.getState()).toMatchObject({ entry: "loading", accountId: null, fieldId: null });
  composition.dispose();
});

it("invalidates the marker when a definitive sign-out follows offline local recovery", async () => {
  const clearActiveAccount = jest.fn().mockResolvedValue(undefined);
  const observationStore = { getLocalCaptureAccount: async () => "account-a",
    getLastContext: async () => ({ fieldId: "field-a", seasonId: null, businessTimezone: "Europe/Istanbul" }),
    clearActiveAccount } as unknown as ObservationCommandStore;
  let authListener!: (state: { status: "signed-out" }) => void;
  let outcome = "retryable-unavailable";
  const controller = { getState: () => ({ status: "signed-out" }), getRestorationOutcome: () => outcome,
    getAuthenticatedApiClient: () => null, getAuthenticatedApiSession: () => null,
    subscribe: (listener: typeof authListener) => { authListener = listener; listener({ status: "signed-out" }); return () => {}; },
    start: async () => {} } as unknown as MobileAuthController;
  const composition = createAppComposition(controller, { observationStore });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(composition.getState().accountId).toBe("account-a");
  outcome = "definitive-no-session";
  authListener({ status: "signed-out" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(clearActiveAccount).toHaveBeenCalled();
  expect(composition.getState().accountId).toBeNull();
  composition.dispose();
});

it("offers saved observation context when sign-in is restored but onboarding status is offline", async () => {
  const observationStore = { setAuthenticatedAccount: jest.fn().mockResolvedValue(undefined),
    getLastContext: jest.fn().mockResolvedValue({ fieldId: "field-a", seasonId: null, businessTimezone: "Europe/Istanbul" }),
    list: jest.fn().mockResolvedValue([]) } as unknown as ObservationCommandStore;
  const client = { GET: jest.fn().mockRejectedValue({ status: 503 }) };
  const authenticated = { status: "authenticated" as const, accountId: "account-a" };
  const controller = { getState: () => authenticated, getRestorationOutcome: () => "authenticated",
    getAuthenticatedApiClient: () => client, getAuthenticatedApiSession: () => ({ accountId: "account-a", client }),
    subscribe: (listener: (value: typeof authenticated) => void) => { listener(authenticated); return () => {}; },
    start: async () => {} } as unknown as MobileAuthController;
  const composition = createAppComposition(controller, { observationStore });
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(composition.getState()).toMatchObject({ entry: "observation-create", accountId: "account-a", fieldId: "field-a" });
  composition.dispose();
});


it("does not publish Account A context after its authenticated status fallback resumes under Account B", async () => {
  const contextStarted = createDeferred<void>();
  const releaseContext = createDeferred<{ fieldId: string; seasonId: null; businessTimezone: string } | null>();
  const observationStore = { setAuthenticatedAccount: jest.fn().mockResolvedValue(undefined),
    getLastContext: async (accountId: string) => { expect(accountId).toBe("account-a"); contextStarted.resolve(); return releaseContext.promise; },
    list: jest.fn().mockResolvedValue([]) } as unknown as ObservationCommandStore;
  const seasonStore = createSeasonCreateCommandStore({ storage: { async read() { return null; }, async saveCommand() {}, async recordSuccess() {}, async clearSuccess() {} } });
  const taskStore = createTaskCompletionCommandStore({ storage: { async listCommands() { return []; }, async insertCommand() {}, async recordAccepted() {},
    async recordConflict() {}, async writeTodaySnapshot() {}, async readTodaySnapshot() { return null; } } });
  const clientA = { GET: jest.fn().mockRejectedValue(new TypeError("status transport unavailable")) };
  const clientB = { GET: jest.fn().mockResolvedValue({ response: { ok: true, status: 200 }, data: { firstFieldOnboardingNeeded: true } }) };
  let current: { status: "authenticated"; accountId: string } = { status: "authenticated", accountId: "account-a" };
  let listener!: (auth: typeof current) => void;
  const controller = { getState: () => current, getRestorationOutcome: () => "authenticated",
    getAuthenticatedApiClient: () => current.accountId === "account-a" ? clientA : clientB,
    getAuthenticatedApiSession: () => ({ accountId: current.accountId, client: current.accountId === "account-a" ? clientA : clientB }),
    subscribe: (next: typeof listener) => { listener = next; next(current); return () => {}; }, start: async () => {},
  } as unknown as MobileAuthController;
  const composition = createAppComposition(controller, { observationStore, seasonCreateStore: seasonStore, taskCompletionStore: taskStore });
  await contextStarted.promise;
  current = { status: "authenticated", accountId: "account-b" };
  listener(current);
  expect(composition.getState()).toMatchObject({ auth: { accountId: "account-b" }, accountId: "account-b", entry: "loading" });
  releaseContext.resolve({ fieldId: "private-field-a", seasonId: null, businessTimezone: "Europe/Istanbul" });
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(composition.getState().accountId).toBe("account-b");
  expect(composition.getState().fieldId).not.toBe("private-field-a");
  expect(composition.getState().entry).not.toBe("status-error");
  composition.dispose();
});

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}
