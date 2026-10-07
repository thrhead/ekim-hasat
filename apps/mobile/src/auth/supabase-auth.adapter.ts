import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState } from "react-native";
import { createClient } from "@supabase/supabase-js";
import type {
  AuthOperationErrorCode,
  AuthOperationResult,
  AuthSession,
  MobileAuthPort,
  SignupOutcome,
} from "./auth-port";

type SupabaseSession = { access_token: string; user: { id: string } } | null;
type SupabaseAuthClient = {
  auth: {
    getSession(): Promise<{ data: { session: SupabaseSession }; error: unknown }>;
    signInWithPassword(credentials: { email: string; password: string }): Promise<{ data: { session: unknown }; error: unknown }>;
    signUp(credentials: { email: string; password: string }): Promise<{ data: { session: unknown }; error: unknown }>;
    onAuthStateChange(
      callback: (_event: string, session: SupabaseSession) => void,
    ): { data: { subscription: { unsubscribe(): void } } };
    signOut(): Promise<{ error: unknown }>;
    startAutoRefresh(): void;
    stopAutoRefresh(): void;
  };
};

function normalizeAuthError(error: unknown): AuthOperationErrorCode {
  if (!error || typeof error !== "object") return "UNKNOWN";
  const providerError = error as { code?: unknown; name?: unknown; status?: unknown };
  if (providerError.code === "invalid_credentials") return "INVALID_CREDENTIALS";
  if (providerError.name === "AuthRetryableFetchError" || (typeof providerError.status === "number" && providerError.status >= 500)) {
    return "UNAVAILABLE";
  }
  return "UNKNOWN";
}

async function runAuthOperation<TProviderData, TResult>(
  operation: () => Promise<{ data: TProviderData; error: unknown }>,
  map: (data: TProviderData) => TResult,
): Promise<AuthOperationResult<TResult>> {
  try {
    const { data, error } = await operation();
    if (error) return { ok: false, error: normalizeAuthError(error) };
    return { ok: true, value: map(data) };
  } catch (error) {
    return { ok: false, error: normalizeAuthError(error) };
  }
}

export type SupabaseAuthConfig = Readonly<{
  supabaseUrl: string;
  publishableKey: string;
}>;

export type SupabaseMobileAuthPort = MobileAuthPort & Readonly<{ dispose(): void }>;

type SupabaseClientFactory = (
  url: string,
  publishableKey: string,
  options: {
    auth: {
      storage: typeof AsyncStorage;
      persistSession: true;
      autoRefreshToken: true;
      detectSessionInUrl: false;
    };
  },
) => unknown;

export function createSupabaseAuthPort(
  config: SupabaseAuthConfig,
  createSupabaseClient: SupabaseClientFactory = createClient as unknown as SupabaseClientFactory,
): SupabaseMobileAuthPort {
  const client = createSupabaseClient(config.supabaseUrl, config.publishableKey, {
    auth: {
      storage: AsyncStorage,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  }) as unknown as SupabaseAuthClient;

  if (AppState.currentState === "active") client.auth.startAutoRefresh();
  const appStateSubscription = AppState.addEventListener("change", (nextState) => {
    if (nextState === "active") client.auth.startAutoRefresh();
    else client.auth.stopAutoRefresh();
  });

  function toAuthSession(session: SupabaseSession): AuthSession | null {
    return session?.access_token && session.user?.id
      ? { accountId: session.user.id, accessToken: session.access_token }
      : null;
  }

  return {
    async restoreSession() {
      const { data, error } = await client.auth.getSession();
      if (error) throw new Error("Unable to restore authentication session");
      return toAuthSession(data.session);
    },
    onSessionChange(listener) {
      const { data } = client.auth.onAuthStateChange((_event, session) => {
        listener(toAuthSession(session));
      });
      return () => data.subscription.unsubscribe();
    },
    async signIn(email, password): Promise<AuthOperationResult<void>> {
      return runAuthOperation(
        () => client.auth.signInWithPassword({ email, password }),
        () => undefined,
      );
    },
    async signUp(email, password): Promise<AuthOperationResult<SignupOutcome>> {
      return runAuthOperation(
        () => client.auth.signUp({ email, password }),
        (data) => data.session ? "session-issued" : "confirmation-required",
      );
    },
    async signOut() {
      const { error } = await client.auth.signOut();
      if (error) throw new Error("Unable to sign out");
    },
    dispose() {
      appStateSubscription.remove();
      client.auth.stopAutoRefresh();
    },
  };
}
