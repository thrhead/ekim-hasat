import { createMobileAuthController, readMobilePublicConfig } from "./auth-port";
import { createSupabaseAuthPort } from "./supabase-auth.adapter";

/** Builds the session controller and generated API client for the production app. */
export function createMobileAuthBootstrap() {
  const config = readMobilePublicConfig();
  const authPort = createSupabaseAuthPort({
    supabaseUrl: config.supabaseUrl,
    publishableKey: config.supabasePublishableKey,
  });
  const controller = createMobileAuthController(authPort, {
    apiBaseUrl: config.apiBaseUrl,
  });

  return {
    controller,
    dispose() {
      controller.dispose();
      authPort.dispose();
    },
  };
}
