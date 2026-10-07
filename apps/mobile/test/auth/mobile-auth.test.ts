import {
  createMobileAuthController,
  type AuthSession,
  type MobileAuthPort,
} from "../../src/auth/auth-port";

function createAuthPort(initialSession: AuthSession | null = null) {
  let session = initialSession;
  let listener: ((next: AuthSession | null) => void) | null = null;
  const signInResult = { ok: true as const, value: undefined };
  const signUpResult = { ok: true as const, value: "confirmation-required" as const };
  const port: MobileAuthPort = {
    restoreSession: jest.fn(async () => session),
    onSessionChange: jest.fn((nextListener) => {
      listener = nextListener;
      return () => { listener = null; };
    }),
    signOut: jest.fn(async () => {
      session = null;
      listener?.(null);
    }),
    signIn: jest.fn(async () => signInResult),
    signUp: jest.fn(async () => signUpResult),
  };
  return {
    port,
    setSession(next: AuthSession | null) {
      session = next;
      listener?.(next);
    },
  };
}

function response(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("mobile authenticated session bootstrap", () => {
  it("delegates sign-in credentials and leaves authentication to the session observer", async () => {
    const port = createAuthPort();
    const controller = createMobileAuthController(port.port, { apiBaseUrl: "https://api.example.test/v1" });
    await controller.start();
    const before = controller.getState();
    const result = await controller.signIn("farmer@example.test", "correct horse battery staple");

    expect(port.port.signIn).toHaveBeenCalledWith("farmer@example.test", "correct horse battery staple");
    expect(result).toEqual({ ok: true, value: undefined });
    expect(controller.getState()).toBe(before);
    expect(controller.getState()).toEqual({ status: "signed-out" });

    port.setSession({ accountId: "new-account", accessToken: "opaque-session-token" });
    expect(controller.getState()).toEqual({ status: "authenticated", accountId: "new-account" });
  });

  it("delegates signup credentials and reports confirmation without creating authenticated state", async () => {
    const port = createAuthPort();
    const controller = createMobileAuthController(port.port, { apiBaseUrl: "https://api.example.test/v1" });
    await controller.start();

    const result = await controller.signUp("newfarmer@example.test", "a-long-password");

    expect(port.port.signUp).toHaveBeenCalledWith("newfarmer@example.test", "a-long-password");
    expect(result).toEqual({ ok: true, value: "confirmation-required" });
    expect(controller.getState()).toEqual({ status: "signed-out" });
    expect(controller.getAuthenticatedApiClient()).toBeNull();
  });

  it("exposes loading until an existing persisted session is restored", async () => {
    let resolveRestore!: (session: AuthSession | null) => void;
    const port = createAuthPort();
    jest.spyOn(port.port, "restoreSession").mockImplementation(() => new Promise((resolve) => {
      resolveRestore = resolve;
    }));
    const controller = createMobileAuthController(port.port, { apiBaseUrl: "https://api.example.test/v1" });

    const starting = controller.start();
    expect(controller.getState()).toEqual({ status: "loading" });
    expect(controller.getAuthenticatedApiClient()).toBeNull();
    resolveRestore({ accountId: "account-1", accessToken: "restored-access-token" });
    await starting;

    expect(controller.getState()).toEqual({ status: "authenticated", accountId: "account-1" });
    expect(controller.getAuthenticatedApiClient()).not.toBeNull();
  });

  it("resolves to signed-out when no persisted session exists", async () => {
    const port = createAuthPort(null);
    const controller = createMobileAuthController(port.port, { apiBaseUrl: "https://api.example.test/v1" });

    await controller.start();

    expect(controller.getState()).toEqual({ status: "signed-out" });
    expect(controller.getAuthenticatedApiClient()).toBeNull();
  });

  it("attaches the latest refreshed token to each generated API request", async () => {
    const port = createAuthPort({ accountId: "account-1", accessToken: "old-access-token" });
    const fetchMock = jest.fn<Promise<Response>, [RequestInfo | URL, RequestInit?]>()
      .mockImplementation(async () => response({ firstFieldOnboardingNeeded: true }));
    const controller = createMobileAuthController(port.port, {
      apiBaseUrl: "https://api.example.test/v1",
      fetch: fetchMock,
    });
    await controller.start();
    const client = controller.getAuthenticatedApiClient()!;

    await client.GET("/onboarding/status");
    port.setSession({ accountId: "account-1", accessToken: "refreshed-access-token" });
    await client.GET("/onboarding/status");

    expect((fetchMock.mock.calls[0]?.[0] as Request).headers.get("Authorization"))
      .toBe("Bearer old-access-token");
    expect((fetchMock.mock.calls[1]?.[0] as Request).headers.get("Authorization"))
      .toBe("Bearer refreshed-access-token");
  });

  it("keeps a session-bound generated client on its captured account token after a switch", async () => {
    const port = createAuthPort({ accountId: "account-1", accessToken: "account-1-token" });
    const fetchMock = jest.fn<Promise<Response>, [RequestInfo | URL, RequestInit?]>()
      .mockImplementation(async () => response({ firstFieldOnboardingNeeded: true }));
    const controller = createMobileAuthController(port.port, {
      apiBaseUrl: "https://api.example.test/v1",
      fetch: fetchMock,
    });
    await controller.start();
    const accountOneSession = controller.getAuthenticatedApiSession()!;

    port.setSession({ accountId: "account-2", accessToken: "account-2-token" });
    await accountOneSession.client.GET("/onboarding/status");

    expect(accountOneSession.accountId).toBe("account-1");
    expect((fetchMock.mock.calls[0]?.[0] as Request).headers.get("Authorization"))
      .toBe("Bearer account-1-token");
    expect(controller.getAuthenticatedApiSession()?.accountId).toBe("account-2");
  });

  it("stops exposing the client and rejects stale client requests after sign-out", async () => {
    const port = createAuthPort({ accountId: "account-1", accessToken: "active-token" });
    const fetchMock = jest.fn<Promise<Response>, [RequestInfo | URL, RequestInit?]>()
      .mockImplementation(async () => response({ firstFieldOnboardingNeeded: false }));
    const controller = createMobileAuthController(port.port, {
      apiBaseUrl: "https://api.example.test/v1",
      fetch: fetchMock,
    });
    await controller.start();
    const previousClient = controller.getAuthenticatedApiClient()!;

    await controller.signOut();

    expect(controller.getState()).toEqual({ status: "signed-out" });
    expect(controller.getAuthenticatedApiClient()).toBeNull();
    await expect(previousClient.GET("/onboarding/status")).rejects.toThrow("Authentication required");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not expose authorization metadata from a session supplied by a provider", async () => {
    const providerSession = {
      accountId: "account-1",
      accessToken: "opaque-token",
      app_metadata: { role: "OWNER", business_id: "forged-business" },
      user_metadata: { role: "admin" },
    } as unknown as AuthSession;
    const port = createAuthPort(providerSession);
    const controller = createMobileAuthController(port.port, { apiBaseUrl: "https://api.example.test/v1" });

    await controller.start();

    expect(controller.getState()).toEqual({ status: "authenticated", accountId: "account-1" });
    expect(Object.keys(controller.getState())).toEqual(["status", "accountId"]);
  });
});
