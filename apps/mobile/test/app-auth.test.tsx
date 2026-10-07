jest.mock("../src/auth/bootstrap", () => ({ createMobileAuthBootstrap: jest.fn() }));
jest.mock("@react-native-async-storage/async-storage", () => (
  jest.requireActual("@react-native-async-storage/async-storage/jest/async-storage-mock")
));

import React from "react";
import { createMobileAuthBootstrap } from "../src/auth/bootstrap";
import { createMobileAuthController, type AuthSession, type MobileAuthPort } from "../src/auth/auth-port";
import App from "../App";
import { AuthScreen } from "../src/features/auth/auth-screen";
import { OnboardingEntryView } from "../src/features/onboarding/onboarding-entry-view";

// react-test-renderer v19 exposes a narrow declaration through Expo.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act, create } = require("react-test-renderer") as {
  act(callback: () => void | Promise<void>): Promise<void>;
  create(element: React.ReactElement): {
    root: {
      findAllByType(type: unknown): Array<{ props: Record<string, unknown> }>;
    };
    unmount(): void;
  };
};

describe("production App signed-out auth route", () => {
  afterEach(() => jest.clearAllMocks());

  it("keeps startup loading visible until restore resolves, then renders delegated auth actions", async () => {
    let resolveRestore!: (session: AuthSession | null) => void;
    const signIn = jest.fn(async () => ({ ok: true as const, value: undefined }));
    const signUp = jest.fn(async () => ({ ok: true as const, value: "confirmation-required" as const }));
    const auth: MobileAuthPort = {
      restoreSession: () => new Promise((resolve) => { resolveRestore = resolve; }),
      onSessionChange: () => () => {},
      signIn,
      signUp,
      signOut: async () => {},
    };
    const controller = createMobileAuthController(auth, { apiBaseUrl: "https://api.example.test/v1" });
    (createMobileAuthBootstrap as jest.Mock).mockReturnValue({ controller, dispose: jest.fn() });

    let renderer!: ReturnType<typeof create>;
    await act(async () => { renderer = create(<App />); });
    expect(renderer.root.findAllByType(OnboardingEntryView)).toHaveLength(1);
    expect(renderer.root.findAllByType(AuthScreen)).toHaveLength(0);

    await act(async () => { resolveRestore(null); });
    const authScreens = renderer.root.findAllByType(AuthScreen);
    expect(authScreens).toHaveLength(1);
    const onSignIn = authScreens[0]!.props.onSignIn as (email: string, password: string) => Promise<unknown>;
    const onSignUp = authScreens[0]!.props.onSignUp as (email: string, password: string) => Promise<unknown>;
    await onSignIn("farmer@example.test", "password-value");
    await onSignUp("new@example.test", "password-value");
    expect(signIn).toHaveBeenCalledWith("farmer@example.test", "password-value");
    expect(signUp).toHaveBeenCalledWith("new@example.test", "password-value");
    expect(controller.getState()).toEqual({ status: "signed-out" });

    await act(async () => { renderer.unmount(); });
  });
});
