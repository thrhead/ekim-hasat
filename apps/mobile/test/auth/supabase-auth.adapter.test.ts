jest.mock("@react-native-async-storage/async-storage", () => (
  jest.requireActual("@react-native-async-storage/async-storage/jest/async-storage-mock")
));

import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState } from "react-native";
import { createSupabaseAuthPort } from "../../src/auth/supabase-auth.adapter";

describe("Supabase mobile auth adapter", () => {
  afterEach(() => jest.restoreAllMocks());

  it("maps password operations to safe outcomes without exposing provider payloads", async () => {
    const subscription = { unsubscribe: jest.fn() };
    const providerSession = { access_token: "must-not-escape", user: { id: "account-1" } };
    const fakeClient = {
      auth: {
        getSession: jest.fn(async () => ({ error: null, data: { session: null } })),
        onAuthStateChange: jest.fn(() => ({ data: { subscription } })),
        signOut: jest.fn(async () => ({ error: null })),
        signInWithPassword: jest.fn(async () => ({ data: { session: providerSession }, error: null })),
        signUp: jest.fn(async () => ({ data: { session: null, user: { id: "account-2" } }, error: null })),
        startAutoRefresh: jest.fn(),
        stopAutoRefresh: jest.fn(),
      },
    };
    const auth = createSupabaseAuthPort({
      supabaseUrl: "https://project.supabase.co",
      publishableKey: "sb_publishable_test",
    }, () => fakeClient);

    await expect(auth.signIn("farmer@example.test", "password-value"))
      .resolves.toEqual({ ok: true, value: undefined });
    expect(fakeClient.auth.signInWithPassword).toHaveBeenCalledWith({ email: "farmer@example.test", password: "password-value" });
    await expect(auth.signUp("new@example.test", "signup-password"))
      .resolves.toEqual({ ok: true, value: "confirmation-required" });
    expect(fakeClient.auth.signUp).toHaveBeenCalledWith({ email: "new@example.test", password: "signup-password" });
    expect(JSON.stringify(await auth.signIn("farmer@example.test", "password-value"))).not.toContain("must-not-escape");
    auth.dispose();
  });

  it("maps a signup session to session-issued without returning provider internals", async () => {
    const fakeClient = {
      auth: {
        getSession: jest.fn(async () => ({ error: null, data: { session: null } })),
        onAuthStateChange: jest.fn(() => ({ data: { subscription: { unsubscribe: jest.fn() } } })),
        signOut: jest.fn(async () => ({ error: null })),
        signInWithPassword: jest.fn(async () => ({ data: { session: null }, error: null })),
        signUp: jest.fn(async () => ({ data: { session: { access_token: "private-token", user: { id: "account-1" } }, user: { id: "account-1" } }, error: null })),
        startAutoRefresh: jest.fn(),
        stopAutoRefresh: jest.fn(),
      },
    };
    const auth = createSupabaseAuthPort({ supabaseUrl: "https://project.supabase.co", publishableKey: "sb_publishable_test" }, () => fakeClient);

    const result = await auth.signUp("new@example.test", "signup-password");

    expect(result).toEqual({ ok: true, value: "session-issued" });
    expect(JSON.stringify(result)).not.toContain("private-token");
    auth.dispose();
  });

  it.each([
    [{ code: "invalid_credentials", message: "provider private message" }, "INVALID_CREDENTIALS"],
    [{ name: "AuthRetryableFetchError", message: "network private message" }, "UNAVAILABLE"],
    [{ code: "unexpected_provider_error", message: "provider private message" }, "UNKNOWN"],
  ] as const)("normalizes provider failure %j into %s without leaking the message", async (providerError, expectedCode) => {
    const fakeClient = {
      auth: {
        getSession: jest.fn(async () => ({ error: null, data: { session: null } })),
        onAuthStateChange: jest.fn(() => ({ data: { subscription: { unsubscribe: jest.fn() } } })),
        signOut: jest.fn(async () => ({ error: null })),
        signInWithPassword: jest.fn(async () => ({ data: { session: null }, error: providerError })),
        signUp: jest.fn(async () => ({ data: { session: null }, error: providerError })),
        startAutoRefresh: jest.fn(),
        stopAutoRefresh: jest.fn(),
      },
    };
    const auth = createSupabaseAuthPort({ supabaseUrl: "https://project.supabase.co", publishableKey: "sb_publishable_test" }, () => fakeClient);

    const signInResult = await auth.signIn("farmer@example.test", "password-value");
    const signUpResult = await auth.signUp("farmer@example.test", "password-value");

    expect(signInResult).toEqual({ ok: false, error: expectedCode });
    expect(signUpResult).toEqual({ ok: false, error: expectedCode });
    expect(JSON.stringify([signInResult, signUpResult])).not.toContain("private message");
    auth.dispose();
  });

  it("configures persistent native sessions and exposes only the access token", async () => {
    const removeAppStateListener = jest.fn();
    const addAppStateListener = jest.spyOn(AppState, "addEventListener")
      .mockReturnValue({ remove: removeAppStateListener } as never);
    const subscription = { unsubscribe: jest.fn() };
    type TestSession = { access_token: string; user: { id: string; app_metadata: { role: string; business_id: string } } };
    const callbacks: { authStateListener?: (_event: string, session: TestSession | null) => void } = {};
    const fakeClient = {
      auth: {
        getSession: jest.fn(async () => ({
          error: null,
          data: { session: {
            access_token: "session-access-token",
            user: { id: "account-1", app_metadata: { role: "OWNER", business_id: "business-1" } },
          } },
        })),
        onAuthStateChange: jest.fn((listener: (_event: string, session: TestSession | null) => void) => {
          callbacks.authStateListener = listener;
          return { data: { subscription } };
        }),
        signOut: jest.fn(async () => ({ error: null })),
        startAutoRefresh: jest.fn(),
        stopAutoRefresh: jest.fn(),
      },
    };
    let clientOptions: { auth: { storage: unknown; persistSession: boolean; autoRefreshToken: boolean; detectSessionInUrl: boolean } } | undefined;
    const createClient = jest.fn((_url: string, _key: string, options: NonNullable<typeof clientOptions>) => {
      clientOptions = options;
      return fakeClient;
    });

    const auth = createSupabaseAuthPort({
      supabaseUrl: "https://project.supabase.co",
      publishableKey: "sb_publishable_test",
    }, createClient);

    expect(clientOptions?.auth).toEqual({
      storage: AsyncStorage,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    });
    await expect(auth.restoreSession()).resolves.toEqual({ accountId: "account-1", accessToken: "session-access-token" });

    const onSession = jest.fn();
    const unsubscribe = auth.onSessionChange(onSession);
    expect(fakeClient.auth.onAuthStateChange).toHaveBeenCalledTimes(1);
    callbacks.authStateListener?.("TOKEN_REFRESHED", {
      access_token: "refreshed-access-token",
      user: { id: "account-1", app_metadata: { role: "OWNER", business_id: "business-1" } },
    });
    expect(onSession).toHaveBeenCalledWith({ accountId: "account-1", accessToken: "refreshed-access-token" });
    const appStateListener = addAppStateListener.mock.calls[addAppStateListener.mock.calls.length - 1]?.[1];
    appStateListener?.("background");
    appStateListener?.("active");
    expect(fakeClient.auth.stopAutoRefresh).toHaveBeenCalled();
    expect(fakeClient.auth.startAutoRefresh).toHaveBeenCalled();
    unsubscribe();
    expect(subscription.unsubscribe).toHaveBeenCalledTimes(1);

    await auth.signOut();
    expect(fakeClient.auth.signOut).toHaveBeenCalledTimes(1);
    auth.dispose();
    expect(removeAppStateListener).toHaveBeenCalledTimes(1);
  });
});
