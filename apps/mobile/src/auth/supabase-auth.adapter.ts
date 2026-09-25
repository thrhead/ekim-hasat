import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState } from "react-native";
import { createClient } from "@supabase/supabase-js";
import type { AuthSession, MobileAuthPort } from "./auth-port";

type SupabaseSession = { access_token: string; user: { id: string } } | null;
type SupabaseAuthClient = {
  auth: {
    getSession(): Promise<{ data: { session: SupabaseSession }; error: unknown }>;
    onAuthStateChange(
      callback: (_event: string, session: SupabaseSession) => void,
    ): { data: { subscription: { unsubscribe(): void } } };
    signOut(): Promise<{ error: unknown }>;
    startAutoRefresh(): void;
    stopAutoRefresh(): void;
  };
};

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
