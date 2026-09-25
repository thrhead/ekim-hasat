jest.mock("@react-native-async-storage/async-storage", () => (
  jest.requireActual("@react-native-async-storage/async-storage/jest/async-storage-mock")
));

import { createMobileAuthController, type AuthSession, type MobileAuthPort } from "../src/auth/auth-port";
import { createAppComposition } from "../src/app-composition";
import { createOnboardingDraftLifecycle } from "../src/features/onboarding/onboarding-draft.lifecycle";

const summary = {
  id: "field-1",
  name: "Tarla 1",
  representativePoint: { type: "Point" as const, coordinates: [29.02, 41.01] as [number, number] },
  createdAt: "2026-09-25T12:00:00.000Z",
};

function setup(fetchMock = jest.fn<Promise<Response>, [input: RequestInfo | URL, init?: RequestInit]>()) {
  const purgedAccounts: string[] = [];
  let sessionListener: ((session: AuthSession | null) => void) | undefined;
  let restore: (session: AuthSession | null) => void = () => {};
  const auth: MobileAuthPort = {
    restoreSession: () => new Promise((resolve) => { restore = resolve; }),
    onSessionChange: (listener) => {
      sessionListener = listener;
      return () => { sessionListener = undefined; };
    },
    signOut: async () => { sessionListener?.(null); },
  };
  const controller = createMobileAuthController(auth, {
    apiBaseUrl: "https://api.example.test/v1",
    fetch: fetchMock,
  });
  const draftLifecycle = createOnboardingDraftLifecycle({
    store: { purge: async (accountId) => { purgedAccounts.push(accountId); } },
  });
  const app = createAppComposition(controller, { draftLifecycle });
  return {
    app,
    controller,
    fetchMock,
    authenticate: (accountId = "account-1") => sessionListener?.({ accountId, accessToken: "session-token" }),
    finishRestore: (session: AuthSession | null = null) => restore(session),
    purgedAccounts,
  };
}

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("production app composition", () => {
  it("shows loading while the persisted auth session is resolving", () => {
    const { app } = setup();
    expect(app.getState().auth.status).toBe("loading");
    expect(app.getState().entry).toBe("loading");
  });

  it("keeps signed-out users on the existing shell without sign-in UI", async () => {
    const { app, finishRestore, fetchMock } = setup();
    finishRestore(null);
    await settle();
    expect(app.getState().auth.status).toBe("signed-out");
    expect(app.getState().client).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("routes an authenticated new farmer to the first-field screen entry", async () => {
    const fetchMock = jest.fn<Promise<Response>, [input: RequestInfo | URL, init?: RequestInit]>()
      .mockResolvedValue(response({ firstFieldOnboardingNeeded: true }));
    const { app, authenticate } = setup(fetchMock);
    authenticate();
    await settle();
    expect(app.getState().entry).toBe("first-field-onboarding");
    expect(app.getState().client).not.toBeNull();
    expect(app.getState().accountId).toBe("account-1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("bypasses first-field onboarding for a returning farmer", async () => {
    const fetchMock = jest.fn<Promise<Response>, [input: RequestInfo | URL, init?: RequestInit]>()
      .mockResolvedValue(response({ firstFieldOnboardingNeeded: false }));
    const { app, authenticate } = setup(fetchMock);
    authenticate();
    await settle();
    expect(app.getState().entry).toBe("home");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("shows status retry and repeats status resolution when requested", async () => {
    const fetchMock = jest.fn<Promise<Response>, [input: RequestInfo | URL, init?: RequestInit]>()
      .mockResolvedValueOnce(response({ code: "UNAVAILABLE" }, 503))
      .mockResolvedValueOnce(response({ firstFieldOnboardingNeeded: true }));
    const { app, authenticate } = setup(fetchMock);
    authenticate();
    await settle();
    expect(app.getState().entry).toBe("status-error");
    app.retryStatus();
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(app.getState().entry).toBe("first-field-onboarding");
  });

  it("leaves onboarding after the committed first-field summary", async () => {
    const fetchMock = jest.fn<Promise<Response>, [input: RequestInfo | URL, init?: RequestInit]>()
      .mockResolvedValue(response({ firstFieldOnboardingNeeded: true }));
    const { app, authenticate } = setup(fetchMock);
    authenticate();
    await settle();
    app.completeFirstField(summary);
    expect(app.getState().entry).toBe("home");
  });

  it("makes no general field-list request", async () => {
    const fetchMock = jest.fn<Promise<Response>, [input: RequestInfo | URL, init?: RequestInit]>()
      .mockResolvedValue(response({ firstFieldOnboardingNeeded: true }));
    const { authenticate } = setup(fetchMock);
    authenticate();
    await settle();
    const requests = fetchMock.mock.calls.map(([request]) => new URL((request as Request).url).pathname);
    expect(requests).toEqual(["/v1/onboarding/status"]);
  });

  it("uses T043 lifecycle cleanup on sign-out and account switch", async () => {
    const fetchMock = jest.fn<Promise<Response>, [input: RequestInfo | URL, init?: RequestInit]>()
      .mockResolvedValue(response({ firstFieldOnboardingNeeded: true }));
    const { authenticate, controller, purgedAccounts } = setup(fetchMock);
    authenticate("account-1");
    await settle();
    authenticate("account-2");
    await settle();
    expect(purgedAccounts).toEqual(["account-1"]);

    await controller.signOut();
    expect(purgedAccounts).toEqual(["account-1", "account-2"]);
  });
});
