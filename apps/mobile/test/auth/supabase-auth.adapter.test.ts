jest.mock("@react-native-async-storage/async-storage", () => (
  jest.requireActual("@react-native-async-storage/async-storage/jest/async-storage-mock")
));

import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState } from "react-native";
import { createSupabaseAuthPort } from "../../src/auth/supabase-auth.adapter";

describe("Supabase mobile auth adapter", () => {
  afterEach(() => jest.restoreAllMocks());

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
    const appStateListener = addAppStateListener.mock.calls[0]?.[1];
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
