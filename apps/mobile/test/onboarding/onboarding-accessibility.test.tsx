import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import { FirstFieldControls } from "../../src/features/onboarding/first-field-controls";
import { MapAdapter } from "../../src/features/onboarding/map/map-adapter";

type Element = {
  type: unknown;
  props: Record<string, unknown> & {
    accessibilityState?: { selected?: boolean; disabled?: boolean };
    onPress?: () => void;
  };
};

function collectElements(node: unknown): Element[] {
  if (Array.isArray(node)) return node.flatMap(collectElements);
  if (node === null || typeof node !== "object" || !("props" in node)) return [];
  const element = node as Element;
  return [element, ...collectElements(element.props.children)];
}

function control(mode: "point" | "polygon", overrides: Partial<Parameters<typeof FirstFieldControls>[0]> = {}) {
  return collectElements(FirstFieldControls({
    name: "",
    mode,
    locationSelected: false,
    submitting: false,
    errorMessage: null,
    onNameChange: jest.fn(),
    onModeChange: jest.fn(),
    onLocationChange: jest.fn(),
    onSubmit: jest.fn(),
    onRetry: jest.fn(),
    ...overrides,
  }));
}

function flattenStyle(style: unknown): Record<string, unknown> {
  if (Array.isArray(style)) return Object.assign({}, ...style.map(flattenStyle));
  return typeof style === "object" && style !== null ? style as Record<string, unknown> : {};
}

function contrastRatio(foreground: string, background: string): number {
  function luminance(hex: string): number {
    const channels = hex.replace("#", "").match(/.{2}/g)!.map((channel) => parseInt(channel, 16) / 255);
    const linear = channels.map((channel) => channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4);
    return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
  }
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0]! + 0.05) / (values[1]! + 0.05);
}

describe("first-field mobile accessibility contract", () => {
  it("exposes named controls with roles, selected/disabled state, and preserves Point/Polygon selection", () => {
    for (const mode of ["point", "polygon"] as const) {
      const elements = control(mode);
      const map = elements.find(({ type }) => type === MapAdapter);
      expect(map?.props.mode).toBe(mode);

      const input = elements.find(({ type }) => type === TextInput);
      expect(input?.props.accessibilityRole).toBe("text");
      expect(input?.props.accessibilityLabel).toBe("Tarla adı (isteğe bağlı)");

      const modeButtons = elements.filter(({ type }) => type === Pressable)
        .filter(({ props }) => props.accessibilityLabel === "Haritadan nokta seç"
          || props.accessibilityLabel === "Tarla sınırı çiz");
      expect(modeButtons).toHaveLength(2);
      expect(modeButtons.map(({ props }) => [props.accessibilityRole, props.accessibilityState?.selected]))
        .toEqual([["button", mode === "point"], ["button", mode === "polygon"]]);

      const submit = elements.find(({ type, props }) => type === Pressable
        && props.accessibilityLabel === "Tarlayı kaydet");
      expect(submit?.props.accessibilityRole).toBe("button");
      expect(submit?.props.disabled).toBe(true);
      expect(submit?.props.accessibilityState?.disabled).toBe(true);
    }
  });

  it("announces errors, retry, and saving state with accessible semantics", () => {
    const onRetry = jest.fn();
    const errorElements = control("point", {
      locationSelected: true,
      errorMessage: "Tarla kaydedilemedi.",
      onRetry,
    });
    const alert = errorElements.find(({ type, props }) => type === Text && props.accessibilityRole === "alert");
    expect(alert?.props.children).toBe("Tarla kaydedilemedi.");
    const retry = errorElements.find(({ type, props }) => type === Pressable
      && props.accessibilityLabel === "Tekrar dene");
    expect(retry?.props.accessibilityRole).toBe("button");
    retry?.props.onPress?.();
    expect(onRetry).toHaveBeenCalledTimes(1);

    const loadingElements = control("polygon", { submitting: true, locationSelected: true });
    const liveRegion = loadingElements.find(({ type, props }) => type === View
      && props.accessibilityLiveRegion === "polite");
    expect(liveRegion).toBeDefined();
    expect(loadingElements.some(({ type }) => type === ActivityIndicator)).toBe(true);
    expect(loadingElements.some(({ type, props }) => type === Text
      && props.children === "Tarla kaydediliyor…")).toBe(true);
    expect(loadingElements.some(({ type, props }) => type === Pressable
      && props.accessibilityLabel === "Tarlayı kaydet")).toBe(false);
  });

  it("keeps text scalable and interactive controls at least 48 points high", () => {
    const elements = control("point", { locationSelected: true });
    const textElements = elements.filter(({ type }) => type === Text || type === TextInput);
    expect(textElements.length).toBeGreaterThan(0);
    for (const element of textElements) expect(element.props.allowFontScaling).not.toBe(false);

    const targets = elements.filter(({ type }) => type === TextInput || type === Pressable);
    expect(targets.length).toBeGreaterThan(0);
    for (const target of targets) {
      expect(flattenStyle(target.props.style).minHeight).toBeGreaterThanOrEqual(48);
    }
  });

  it("uses text/control color pairs with at least 4.5:1 contrast", () => {
    const elements = control("point", { locationSelected: true, errorMessage: "Hata" });
    const textColors = elements.filter(({ type }) => type === Text || type === TextInput)
      .map(({ props }) => flattenStyle(props.style).color)
      .filter((color): color is string => typeof color === "string");
    const input = elements.find(({ type }) => type === TextInput);
    const inputStyle = flattenStyle(input?.props.style);
    const inputContrast = contrastRatio(inputStyle.color as string, inputStyle.backgroundColor as string);
    expect(inputContrast).toBeGreaterThanOrEqual(4.5);

    for (const color of textColors) {
      const buttonText = color.toLowerCase() === "#ffffff";
      const background = buttonText ? "#245b35" : "#ffffff";
      expect(contrastRatio(color, background)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
