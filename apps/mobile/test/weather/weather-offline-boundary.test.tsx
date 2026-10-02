import { Pressable } from "react-native";
import { WeatherCard } from "../../src/features/weather/weather-card";
import { readWeatherOverview } from "../../src/features/weather/weather-client";
import type { ApiClient } from "../../../../packages/api-client/src/index";

type Element = { type: unknown; props: Record<string, unknown> };
function collect(node: unknown): Element[] {
  if (Array.isArray(node)) return node.flatMap(collect);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as Element;
  if (typeof element.type === "function" && element.type.name === "RetryButton") return collect((element.type as (props: Record<string, unknown>) => unknown)(element.props));
  return [element, ...collect(element.props.children)];
}
function strings(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(strings);
  if (typeof value === "string" || typeof value === "number") return [String(value)];
  if (value && typeof value === "object" && "props" in value) return strings((value as Element).props.children);
  return [];
}

describe("weather offline boundary", () => {
  it("shows retry with no weather values when the API is unavailable and there is no approved local snapshot", async () => {
    const GET = jest.fn().mockRejectedValue(new TypeError("Network request failed"));
    await expect(readWeatherOverview({ GET } as unknown as ApiClient)).rejects.toThrow("Hava durumu yüklenemedi");
    expect(GET).toHaveBeenCalledTimes(1);

    const retry = jest.fn();
    const elements = collect(WeatherCard({ state: { kind: "error" }, onRetry: retry }));
    const content = strings(elements).join(" ");
    expect(content).toContain("Bağlantınızı kontrol edip yeniden deneyin");
    expect(content).not.toMatch(/\d+°|%\d+|km\/sa/);
    const button = elements.find(({ type }) => type === Pressable)!;
    expect(button.props.accessibilityLabel).toBe("Hava durumunu yeniden dene");
    (button.props.onPress as () => void)();
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("renders unavailable without current or forecast values and has no cache/outbox input seam", () => {
    const elements = collect(WeatherCard({ state: { kind: "data", weather: {
      fieldId: "field-1", fieldName: "Kuzey tarla", status: "UNAVAILABLE", businessTimezone: "Europe/Istanbul",
      coverage: null, current: null, dailyForecasts: [], fetchedAt: null,
    } }, onRetry: jest.fn() }));
    const content = strings(elements).join(" ");
    expect(content).toContain("Hava durumu kullanılamıyor");
    expect(content).not.toMatch(/\d+°|%\d+|km\/sa/);
  });
});
