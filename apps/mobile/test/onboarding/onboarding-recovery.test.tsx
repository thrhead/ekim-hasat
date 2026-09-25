jest.mock("@react-native-async-storage/async-storage", () => (
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("@react-native-async-storage/async-storage/jest/async-storage-mock")
));

import { Pressable, Text } from "react-native";
import { OnboardingRecovery } from "../../src/features/onboarding/onboarding-recovery";
import { createFirstFieldDraftBinding } from "../../src/features/onboarding/first-field-screen";
import type { MapLocation } from "../../src/features/onboarding/map/map-adapter";

function collectElements(node: unknown): Array<{ type: unknown; props: Record<string, unknown> }> {
  if (Array.isArray(node)) return node.flatMap(collectElements);
  if (node === null || typeof node !== "object" || !("props" in node)) return [];
  const element = node as { type: unknown; props: Record<string, unknown> };
  return [element, ...collectElements(element.props.children)];
}

describe("onboarding recovery UX", () => {
  it.each([
    [{ type: "Point", coordinates: [29.02, 41.01] }, "point"],
    [{ type: "Polygon", coordinates: [[[29, 41], [29.1, 41], [29.1, 41.1], [29, 41]]] }, "polygon"],
  ] as const)("restores a valid %s draft to the existing first-field form state", async (geometry, mode) => {
    const binding = createFirstFieldDraftBinding({
      accountId: "farmer-a",
      store: {
        read: async () => ({ fieldName: "Bahçe", geometry: geometry as MapLocation }),
        save: async () => {},
        recordActivity: async () => {},
      },
      lifecycle: { successfulSave: async () => {}, cancel: async () => {} },
    });
    await expect(binding.restore()).resolves.toEqual({
      name: "Bahçe",
      location: geometry,
      mode,
      hasDraft: true,
    });
  });

  it("does not offer recovery without a usable draft and discards through the lifecycle", async () => {
    const cancel = jest.fn(async () => {});
    const binding = createFirstFieldDraftBinding({
      accountId: "farmer-a",
      store: { read: async () => null, save: async () => {}, recordActivity: async () => {} },
      lifecycle: { successfulSave: async () => {}, cancel },
    });
    await expect(binding.restore()).resolves.toEqual({
      name: "",
      location: null,
      mode: "point",
      hasDraft: false,
    });
    await binding.cancel();
    expect(cancel).toHaveBeenCalledWith("farmer-a");
  });

  it("offers accessible continue and discard actions for a valid restored draft", () => {
    const onContinue = jest.fn();
    const onDiscard = jest.fn();
    const elements = collectElements(OnboardingRecovery({
      state: "draft-restored",
      onContinue,
      onDiscard,
    }));

    expect(elements.some(({ type, props }) => type === Text
      && props.children === "Tarla bilgilerinizi kaldığınız yerden sürdürebilirsiniz.")).toBe(true);
    const actions = elements.filter(({ type }) => type === Pressable);
    expect(actions.map(({ props }) => [props.accessibilityRole, props.accessibilityLabel])).toEqual([
      ["button", "Devam et"],
      ["button", "Taslağı sil"],
    ]);
    (actions[0]?.props.onPress as (() => void) | undefined)?.();
    (actions[1]?.props.onPress as (() => void) | undefined)?.();
    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(elements.some(({ props }) => props.children === "Tarla kaydedildi")).toBe(false);
  });

  it.each([
    ["connectivity", "Bağlantı kurulamadı. Bağlantınızı kontrol edip yeniden deneyin."],
    ["map-unavailable", "Harita şu anda açılamıyor. Konumunuzu haritaya dokunarak seçmeyi deneyin."],
    ["invalid-geometry", "Tarla konumu geçerli değil. Haritada konumu veya sınırı düzeltin."],
    ["session-expired", "Oturumunuz sona erdi. Yeniden giriş yaptıktan sonra devam edin."],
    ["uncertain-save", "Tarla kaydedilmiş olabilir; henüz onay alamadık. Aynı kaydı yeniden deneyin."],
  ] as const)("explains %s in farmer language", (state, message) => {
    const elements = collectElements(OnboardingRecovery({ state }));
    expect(elements.some(({ type, props }) => type === Text
      && props.accessibilityRole === "alert" && props.children === message)).toBe(true);
  });

  it("shows an accessible retry action for connectivity and uncertain saves only", () => {
    const onRetry = jest.fn();
    for (const state of ["connectivity", "uncertain-save"] as const) {
      const elements = collectElements(OnboardingRecovery({ state, onRetry }));
      const retry = elements.find(({ type, props }) => type === Pressable
        && props.accessibilityLabel === "Tekrar dene");
      expect(retry?.props.accessibilityRole).toBe("button");
      (retry?.props.onPress as (() => void) | undefined)?.();
    }
    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(collectElements(OnboardingRecovery({ state: "invalid-geometry" }))
      .some(({ props }) => props.accessibilityLabel === "Tekrar dene")).toBe(false);
  });
});
