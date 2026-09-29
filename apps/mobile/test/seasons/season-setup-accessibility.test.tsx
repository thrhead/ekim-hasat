import { Pressable, Text } from "react-native";
import {
  getManualPlanExplanation,
  SeasonSetupActionButton,
  SeasonSetupStatus,
  validatePlantingDate,
} from "../../src/features/seasons/season-setup-screen";
import type { SeasonComponents } from "../../src/api/onboarding-client";

type Element = { type: unknown; props: Record<string, unknown> };

function collectElements(node: unknown): Element[] {
  if (Array.isArray(node)) return node.flatMap(collectElements);
  if (node === null || typeof node !== "object" || !("props" in node)) return [];
  const element = node as Element;
  return [element, ...collectElements(element.props.children)];
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

describe("season setup accessibility and date rules", () => {
  it("accepts valid today and past local calendar dates but rejects invalid and future dates", () => {
    expect(validatePlantingDate("2026-09-29", "2026-09-29")).toBeNull();
    expect(validatePlantingDate("2024-02-29", "2026-09-29")).toBeNull();
    expect(validatePlantingDate("2025-02-29", "2026-09-29")).toMatch(/geçerli değil/);
    expect(validatePlantingDate("2026-09-30", "2026-09-29")).toMatch(/bugün veya geçmiş/);
    expect(validatePlantingDate("2026-9-1", "2026-09-29")).toMatch(/YYYY-AA-GG/);
  });

  it("announces loading and errors with an accessible retry", () => {
    const loading = collectElements(SeasonSetupStatus({ loading: true, error: null, onRetry: jest.fn() }));
    expect(loading.some(({ type, props }) => type === Text
      && props.accessibilityRole === "progressbar"
      && props.accessibilityLabel === "Ekim seçenekleri yükleniyor")).toBe(true);

    const onRetry = jest.fn();
    const failed = collectElements(SeasonSetupStatus({ loading: false, error: "Bağlantı kurulamadı.", onRetry }));
    expect(failed.some(({ type, props }) => type === Text && props.accessibilityRole === "alert")).toBe(true);
    const action = failed.find(({ type }) => type === SeasonSetupActionButton)!;
    const retry = collectElements(SeasonSetupActionButton(action.props as Parameters<typeof SeasonSetupActionButton>[0]))
      .find(({ type }) => type === Pressable);
    expect(retry?.props.accessibilityRole).toBe("button");
    expect(retry?.props.accessibilityLabel).toBe("Yeniden dene");
    (retry?.props.onPress as (() => void) | undefined)?.();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("requires a visible explicit MANUAL choice when a published template is empty", () => {
    const emptyCrop = {
      id: "crop-id",
      displayName: "Buğday",
      manualPlanAllowed: true,
      source: "CENTRAL",
      templateAvailability: "EMPTY_TASK_DEFINITIONS",
    } as SeasonComponents["schemas"]["CropChoice"];
    expect(getManualPlanExplanation(emptyCrop, false)).toMatch(/MANUAL planı açıkça seçin/);
    expect(getManualPlanExplanation(emptyCrop, false)).toMatch(/görev yok/);
    expect(getManualPlanExplanation(null, true)).toMatch(/doğrulanmış plan yok/);
  });

  it("uses named button semantics, scalable text, clear selection state, and a 48 point target", () => {
    const element = SeasonSetupActionButton({ label: "MANUAL planı seçiyorum", onPress: jest.fn(), selected: true });
    const pressable = collectElements(element).find(({ type }) => type === Pressable)!;
    expect(pressable.props.accessibilityRole).toBe("button");
    expect(pressable.props.accessibilityLabel).toBe("MANUAL planı seçiyorum");
    expect(pressable.props.accessibilityState).toEqual({ disabled: false, selected: true });
    const buttonStyle = (pressable.props.style as (state: { pressed: boolean }) => unknown)({ pressed: false });
    expect(flattenStyle(buttonStyle).minHeight).toBeGreaterThanOrEqual(48);
    const buttonText = collectElements(element).find(({ type }) => type === Text)!;
    expect(buttonText.props.allowFontScaling).toBe(true);
    expect(contrastRatio(flattenStyle(buttonText.props.style).color as string, "#ffffff")).toBeGreaterThanOrEqual(4.5);
  });
});
