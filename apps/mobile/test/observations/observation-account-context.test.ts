import { createMobileAuthController, type MobileAuthPort } from "../../src/auth/auth-port";

function port(restoration: () => Promise<null>): MobileAuthPort {
  return { restoreSession: restoration, onSessionChange: () => () => {},
    signIn: async () => ({ ok: true, value: undefined }),
    signUp: async () => ({ ok: true, value: "confirmation-required" }),
    signOut: async () => {},
  };
}

describe("observation account restoration boundary", () => {
  it("distinguishes definitive no session from retryable restoration failure", async () => {
    const signedOut = createMobileAuthController(port(async () => null), { apiBaseUrl: "https://api.example.test/v1" });
    await signedOut.start();
    expect(signedOut.getRestorationOutcome()).toBe("definitive-no-session");

    const unavailable = createMobileAuthController(port(async () => { throw Object.assign(new Error("offline"), { code: "UNAVAILABLE" }); }), { apiBaseUrl: "https://api.example.test/v1" });
    const observedOutcomes: string[] = [];
    unavailable.subscribe(() => observedOutcomes.push(unavailable.getRestorationOutcome()));
    await unavailable.start();
    expect(unavailable.getRestorationOutcome()).toBe("retryable-unavailable");
    expect(observedOutcomes.at(-1)).toBe("retryable-unavailable");
    expect(unavailable.getAuthenticatedApiSession()).toBeNull();
  });
});
