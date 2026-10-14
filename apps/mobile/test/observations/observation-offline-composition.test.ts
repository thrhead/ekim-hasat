jest.mock("@react-native-async-storage/async-storage", () => (
  jest.requireActual("@react-native-async-storage/async-storage/jest/async-storage-mock")
));

import { createAppComposition } from "../../src/app-composition";
import { renderObservationContextRoute } from "../../App";
import type { MobileAuthController } from "../../src/auth/auth-port";
import type { ObservationCommandStore } from "../../src/features/observations/observation-command-store";

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
