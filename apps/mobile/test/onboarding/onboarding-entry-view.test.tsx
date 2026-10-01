import { Pressable, Text } from "react-native";
import { OnboardingEntryView } from "../../src/features/onboarding/onboarding-entry-view";

function collectElements(node: unknown): Array<{ type: unknown; props: Record<string, unknown> }> {
  if (Array.isArray(node)) return node.flatMap(collectElements);
  if (node === null || typeof node !== "object" || !("props" in node)) return [];
  const element = node as { type: unknown; props: Record<string, unknown> };
  return [element, ...collectElements(element.props.children)];
}

describe("onboarding entry view", () => {
  it("shows a farmer-language loading message while checking the account", () => {
    const elements = collectElements(OnboardingEntryView({ state: "loading" }));

    expect(elements.some(({ type, props }) => type === Text && props.children === "Girişiniz kontrol ediliyor…"))
      .toBe(true);
  });

  it("explains a sign-in problem and offers an accessible retry action", () => {
    const onRetry = jest.fn();
    const elements = collectElements(OnboardingEntryView({ state: "authentication-failed", onRetry }));
    const retry = elements.find(({ type }) => type === Pressable);

    expect(elements.some(({ type, props }) => type === Text && props.children === "Giriş yapılamadı. Yeniden deneyin."))
      .toBe(true);
    expect(retry?.props.accessibilityRole).toBe("button");
    expect(retry?.props.accessibilityLabel).toBe("Yeniden dene");
    (retry?.props.onPress as (() => void) | undefined)?.();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
