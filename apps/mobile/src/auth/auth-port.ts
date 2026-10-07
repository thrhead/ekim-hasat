import {
  createApiClient,
  type ApiClient,
} from "../../../../packages/api-client/src/index";

export type AuthSession = Readonly<{ accountId: string; accessToken: string }>;

export type AuthOperationErrorCode = "INVALID_CREDENTIALS" | "UNAVAILABLE" | "UNKNOWN";
export type AuthOperationResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; error: AuthOperationErrorCode }>;
export type SignupOutcome = "session-issued" | "confirmation-required";

/** Provider-neutral session boundary. Provider metadata never crosses this port. */
export interface MobileAuthPort {
  restoreSession(): Promise<AuthSession | null>;
  onSessionChange(listener: (session: AuthSession | null) => void): () => void;
  signIn(email: string, password: string): Promise<AuthOperationResult<void>>;
  signUp(email: string, password: string): Promise<AuthOperationResult<SignupOutcome>>;
  signOut(): Promise<void>;
}

export type MobileAuthState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "signed-out" }>
  | Readonly<{ status: "authenticated"; accountId: string }>;

export type AuthenticatedApiSession = Readonly<{ accountId: string; client: ApiClient }>;

export type MobileAuthController = Readonly<{
  getState(): MobileAuthState;
  subscribe(listener: (state: MobileAuthState) => void): () => void;
  start(): Promise<void>;
  signIn(email: string, password: string): Promise<AuthOperationResult<void>>;
  signUp(email: string, password: string): Promise<AuthOperationResult<SignupOutcome>>;
  signOut(): Promise<void>;
  getAuthenticatedApiClient(): ApiClient | null;
  getAuthenticatedApiSession(): AuthenticatedApiSession | null;
  dispose(): void;
}>;

export function createMobileAuthController(
  auth: MobileAuthPort,
  options: Readonly<{
    apiBaseUrl: string;
    fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  }>,
): MobileAuthController {
  let session: AuthSession | null = null;
  let state: MobileAuthState = { status: "loading" };
  let started = false;
  let eventRevision = 0;
  let stopObserving: (() => void) | null = null;
  const listeners = new Set<(state: MobileAuthState) => void>();

  function updateSession(next: AuthSession | null) {
    session = next;
    state = next ? { status: "authenticated", accountId: next.accountId } : { status: "signed-out" };
    for (const listener of listeners) listener(state);
  }

  function createAuthenticatedApiClient(getAccessToken: () => string | undefined): ApiClient {
    return createApiClient({
      baseUrl: options.apiBaseUrl,
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        const accessToken = getAccessToken();
        if (!accessToken) throw new Error("Authentication required");

        const request = new Request(input, init);
        const headers = new Headers(request.headers);
        headers.set("Authorization", `Bearer ${accessToken}`);
        const authenticatedRequest = new Request(request, { headers });
        return (options.fetch ?? globalThis.fetch)(authenticatedRequest);
      }) as typeof fetch,
    });
  }

  const apiClient = createAuthenticatedApiClient(() => session?.accessToken);

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },
    async start() {
      if (started) return;
      started = true;
      const revisionAtStart = eventRevision;
      stopObserving = auth.onSessionChange((next) => {
        eventRevision += 1;
        updateSession(next);
      });

      try {
        const restored = await auth.restoreSession();
        if (eventRevision === revisionAtStart) updateSession(restored);
      } catch {
        if (eventRevision === revisionAtStart) updateSession(null);
      }
    },
    signIn: (email, password) => auth.signIn(email, password),
    signUp: (email, password) => auth.signUp(email, password),
    async signOut() {
      await auth.signOut();
      updateSession(null);
    },
    getAuthenticatedApiClient: () => state.status === "authenticated" ? apiClient : null,
    getAuthenticatedApiSession() {
      const currentSession = session;
      if (!currentSession || state.status !== "authenticated" || state.accountId !== currentSession.accountId) return null;
      return {
        accountId: currentSession.accountId,
        client: createAuthenticatedApiClient(() => currentSession.accessToken),
      };
    },
    dispose() {
      stopObserving?.();
      stopObserving = null;
      session = null;
      state = { status: "signed-out" };
      listeners.clear();
    },
  };
}

export type MobilePublicConfig = Readonly<{
  supabaseUrl: string;
  supabasePublishableKey: string;
  apiBaseUrl: string;
}>;

const expoPublicEnvironment = {
  EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  EXPO_PUBLIC_API_BASE_URL: process.env.EXPO_PUBLIC_API_BASE_URL,
};

export function readMobilePublicConfig(
  environment: Record<string, string | undefined> = expoPublicEnvironment,
): MobilePublicConfig {
  const supabaseUrl = environment.EXPO_PUBLIC_SUPABASE_URL;
  const supabasePublishableKey = environment.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const apiBaseUrl = environment.EXPO_PUBLIC_API_BASE_URL;
  if (!supabaseUrl || !supabasePublishableKey || !apiBaseUrl) {
    throw new Error("Mobile auth and API configuration is incomplete");
  }
  return { supabaseUrl, supabasePublishableKey, apiBaseUrl };
}
