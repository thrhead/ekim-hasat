import React from "react";
import { act, create } from "react-test-renderer";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { AuthScreen } from "../../../src/features/auth/auth-screen";
import type { AuthOperationResult, SignupOutcome } from "../../../src/auth/auth-port";

type TestNode = { props: Record<string, any>; type: unknown };
type TestRenderer = { root: {
  findAll(predicate: (node: TestNode) => boolean): TestNode[];
  findAllByType(type: unknown): TestNode[];
  findByType(type: unknown): TestNode;
} };

function findByLabel(renderer: TestRenderer, label: string): TestNode {
  return renderer.root.findAll((node: TestNode) => node.props.accessibilityLabel === label)[0]!;
}

function findNode(renderer: TestRenderer, predicate: (node: TestNode) => boolean): TestNode {
  return renderer.root.findAll(predicate)[0]!;
}

function flattenStyle(style: unknown): Record<string, unknown> {
  if (Array.isArray(style)) return Object.assign({}, ...style.map(flattenStyle));
  return typeof style === "object" && style !== null ? style as Record<string, unknown> : {};
}

function contrastRatio(foreground: string, background: string): number {
  const luminance = (hex: string) => {
    const channels = hex.replace("#", "").match(/.{2}/g)!.map((channel) => parseInt(channel, 16) / 255);
    const linear = channels.map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
    return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
  };
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0]! + 0.05) / (values[1]! + 0.05);
}

function press(renderer: TestRenderer, label: string) {
  act(() => findByLabel(renderer, label).props.onPress());
}

function change(renderer: TestRenderer, label: string, value: string) {
  act(() => findByLabel(renderer, label).props.onChangeText(value));
}

const succeeded = { ok: true as const, value: undefined } satisfies AuthOperationResult<void>;
const confirmationRequired = { ok: true as const, value: "confirmation-required" as const } satisfies AuthOperationResult<SignupOutcome>;

describe("signed-out authentication screen", () => {
  it("renders Turkish sign-in fields and accessible native controls by default", () => {
    let renderer!: TestRenderer;
    act(() => { renderer = create(<AuthScreen onSignIn={jest.fn(async () => succeeded)} onSignUp={jest.fn(async () => confirmationRequired)} />) as unknown as TestRenderer; });

    expect(renderer.root.findAllByType(ScrollView)).toHaveLength(1);
    expect(renderer.root.findAllByType(Text).some((node) => node.props.children === "Giriş yap")).toBe(true);
    expect(findByLabel(renderer, "E-posta adresi").type).toBe(TextInput);
    expect(findByLabel(renderer, "Şifre").type).toBe(TextInput);
    const submit = findByLabel(renderer, "Giriş yap");
    expect(submit.props.accessibilityRole).toBe("button");
    expect(findByLabel(renderer, "Hesap oluştur").props.accessibilityRole).toBe("button");
    expect(findByLabel(renderer, "E-posta adresi").props.keyboardType).toBe("email-address");
    expect(findByLabel(renderer, "E-posta adresi").props.autoCapitalize).toBe("none");
  });

  it("validates required and basic email input before calling sign-in", async () => {
    const onSignIn = jest.fn(async () => succeeded);
    let renderer!: TestRenderer;
    act(() => { renderer = create(<AuthScreen onSignIn={onSignIn} onSignUp={jest.fn(async () => confirmationRequired)} />) as unknown as TestRenderer; });
    await act(async () => { findByLabel(renderer, "Giriş yap").props.onPress(); });
    expect(onSignIn).not.toHaveBeenCalled();
    expect(findNode(renderer, (node) => node.props.accessibilityRole === "alert").props.children).toBe("E-posta adresinizi ve şifrenizi girin.");

    change(renderer, "E-posta adresi", "not-an-email");
    change(renderer, "Şifre", "password");
    await act(async () => { findByLabel(renderer, "Giriş yap").props.onPress(); });
    expect(onSignIn).not.toHaveBeenCalled();
    expect(findNode(renderer, (node) => node.props.accessibilityRole === "alert").props.children).toBe("Geçerli bir e-posta adresi girin.");
  });

  it("trims email, preserves password exactly, and guards duplicate pending submissions", async () => {
    let resolve!: (result: AuthOperationResult<void>) => void;
    const onSignIn = jest.fn(() => new Promise<AuthOperationResult<void>>((done) => { resolve = done; }));
    let renderer!: TestRenderer;
    act(() => { renderer = create(<AuthScreen onSignIn={onSignIn} onSignUp={jest.fn(async () => confirmationRequired)} />) as unknown as TestRenderer; });
    change(renderer, "E-posta adresi", "  farmer@example.test  ");
    change(renderer, "Şifre", " pass with edges ");

    await act(async () => { findByLabel(renderer, "Giriş yap").props.onPress(); });
    expect(onSignIn).toHaveBeenCalledTimes(1);
    expect(onSignIn).toHaveBeenCalledWith("farmer@example.test", " pass with edges ");
    expect(findByLabel(renderer, "Giriş yap").props.disabled).toBe(true);
    expect(findByLabel(renderer, "Giriş yap").props.accessibilityState.busy).toBe(true);
    expect(findNode(renderer, (node) => node.props.accessibilityLabel === "Kimlik doğrulama sürüyor" && node.props.accessibilityRole === "progressbar")).toBeDefined();
    await act(async () => { findByLabel(renderer, "Giriş yap").props.onPress?.(); });
    expect(onSignIn).toHaveBeenCalledTimes(1);

    await act(async () => { resolve(succeeded); });
  });

  it("shows safe sign-in errors while retaining email for retry", async () => {
    const onSignIn = jest.fn(async () => ({ ok: false as const, error: "INVALID_CREDENTIALS" as const }));
    let renderer!: TestRenderer;
    act(() => { renderer = create(<AuthScreen onSignIn={onSignIn} onSignUp={jest.fn(async () => confirmationRequired)} />) as unknown as TestRenderer; });
    change(renderer, "E-posta adresi", "farmer@example.test");
    change(renderer, "Şifre", "wrong");
    await act(async () => { findByLabel(renderer, "Giriş yap").props.onPress(); });
    expect(findNode(renderer, (node) => node.props.accessibilityRole === "alert").props.children).toBe("E-posta veya şifre hatalı. Bilgilerinizi kontrol edip yeniden deneyin.");
    expect(findByLabel(renderer, "E-posta adresi").props.value).toBe("farmer@example.test");
    expect(findByLabel(renderer, "Şifre").props.value).toBe("");
  });

  it("shows a generic unavailable message and keeps keyboard progression native", async () => {
    const onSignIn = jest.fn(async () => ({ ok: false as const, error: "UNAVAILABLE" as const }));
    let renderer!: TestRenderer;
    act(() => { renderer = create(<AuthScreen onSignIn={onSignIn} onSignUp={jest.fn(async () => confirmationRequired)} />) as unknown as TestRenderer; });
    change(renderer, "E-posta adresi", "farmer@example.test");
    change(renderer, "Şifre", "secret");
    await act(async () => { findByLabel(renderer, "Şifre").props.onSubmitEditing(); });

    expect(onSignIn).toHaveBeenCalledTimes(1);
    expect(findNode(renderer, (node) => node.props.accessibilityRole === "alert").props.children)
      .toBe("Şu anda giriş yapılamıyor. Bağlantınızı kontrol edip yeniden deneyin.");
    const email = findByLabel(renderer, "E-posta adresi");
    expect(typeof email.props.onSubmitEditing).toBe("function");
    await act(async () => { email.props.onSubmitEditing(); });
    expect(onSignIn).toHaveBeenCalledTimes(1);
  });

  it("keeps the form above the Android keyboard", () => {
    const originalPlatform = Object.getOwnPropertyDescriptor(Platform, "OS");
    Object.defineProperty(Platform, "OS", { configurable: true, value: "android" });
    try {
      let renderer!: TestRenderer;
      act(() => { renderer = create(<AuthScreen onSignIn={jest.fn(async () => succeeded)} onSignUp={jest.fn(async () => confirmationRequired)} />) as unknown as TestRenderer; });
      expect(renderer.root.findByType(KeyboardAvoidingView).props.behavior).toBe("height");
    } finally {
      if (originalPlatform) Object.defineProperty(Platform, "OS", originalPlatform);
      else delete (Platform as unknown as { OS?: string }).OS;
    }
  });

  it("supports account creation, confirmation-required, and return to sign-in", async () => {
    const onSignUp = jest.fn(async () => confirmationRequired);
    let renderer!: TestRenderer;
    act(() => { renderer = create(<AuthScreen onSignIn={jest.fn(async () => succeeded)} onSignUp={onSignUp} />) as unknown as TestRenderer; });
    press(renderer, "Hesap oluştur");
    expect(renderer.root.findAllByType(Text).some((node) => node.props.children === "Hesap oluştur")).toBe(true);
    change(renderer, "E-posta adresi", "new@example.test");
    change(renderer, "Şifre", "long-password");
    await act(async () => { findByLabel(renderer, "Hesap oluştur").props.onPress(); });
    expect(onSignUp).toHaveBeenCalledWith("new@example.test", "long-password");
    expect(findNode(renderer, (node) => node.props.accessibilityLiveRegion === "polite").props.children).toBe("Hesabınız oluşturuldu. E-posta adresinizi doğrulayın, ardından giriş yapın.");
    press(renderer, "Giriş yap");
    expect(renderer.root.findAllByType(TextInput).some((node) => node.props.value === "")).toBe(true);
    expect(renderer.root.findAllByType(Text).some((node) => node.props.children === "Giriş yap")).toBe(true);
    expect(findNode(renderer, (node) => node.props.accessibilityLabel === "Giriş yap").props.accessibilityRole).toBe("button");
  });

  it("uses non-enumerating signup failure copy and accessible keyboard/touch affordances", async () => {
    const onSignUp = jest.fn(async () => ({ ok: false as const, error: "UNKNOWN" as const }));
    let renderer!: TestRenderer;
    act(() => { renderer = create(<AuthScreen onSignIn={jest.fn(async () => succeeded)} onSignUp={onSignUp} />) as unknown as TestRenderer; });
    press(renderer, "Hesap oluştur");
    change(renderer, "E-posta adresi", "existing@example.test");
    change(renderer, "Şifre", "password");
    await act(async () => { findByLabel(renderer, "Hesap oluştur").props.onPress(); });
    expect(findNode(renderer, (node) => node.props.accessibilityRole === "alert").props.children).toBe("Hesap oluşturulamadı. Bilgilerinizi kontrol edip yeniden deneyin.");

    const email = findByLabel(renderer, "E-posta adresi");
    const password = findByLabel(renderer, "Şifre");
    expect(email.props.returnKeyType).toBe("next");
    expect(password.props.returnKeyType).toBe("go");
    for (const text of [...renderer.root.findAllByType(Text), ...renderer.root.findAllByType(TextInput)]) {
      expect(text.props.allowFontScaling).not.toBe(false);
    }
    for (const control of [...renderer.root.findAllByType(TextInput), ...renderer.root.findAllByType(Pressable)]) {
      expect(control.props.style?.minHeight ?? control.props.style?.[0]?.minHeight).toBeGreaterThanOrEqual(48);
    }
    const scroll = renderer.root.findByType(ScrollView);
    expect(scroll.props.keyboardShouldPersistTaps).toBe("handled");
    expect(renderer.root.findAllByType(View).some((node) => node.props.accessibilityLiveRegion === "polite")).toBe(true);

    const colors = renderer.root.findAllByType(Text)
      .map((node) => flattenStyle(node.props.style).color)
      .filter((color): color is string => typeof color === "string");
    for (const color of colors) {
      const background = color.toLowerCase() === "#ffffff" ? "#245b35" : "#ffffff";
      expect(contrastRatio(color, background)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
