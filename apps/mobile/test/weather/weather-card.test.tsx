import { Pressable, Text } from "react-native";
import { act, create } from "react-test-renderer";
import { WeatherCard, WeatherOverviewCards } from "../../src/features/weather/weather-card";
import type { WeatherComponents } from "../../src/features/weather/weather-client";

type Element = { type: unknown; props: Record<string, unknown> };
function collect(node: unknown): Element[] {
  if (Array.isArray(node)) return node.flatMap(collect);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as Element;
  if (typeof element.type === "function" && ["WeatherCard", "WeatherOverviewCards", "RetryButton"].includes(element.type.name)) {
    return collect((element.type as (props: Record<string, unknown>) => unknown)(element.props));
  }
  return [element, ...collect(element.props.children)];
}
const render = (node: unknown) => collect(node);
function flattenText(value: unknown): string {
  if (Array.isArray(value)) return value.map(flattenText).join("");
  return value === null || value === undefined || typeof value === "boolean" ? "" : String(value);
}
const text = (elements: Element[]) => elements.filter(({ type }) => type === Text).map(({ props }) => flattenText(props.children)).join(" ");

const field = (status: WeatherComponents["schemas"]["FieldWeather"]["status"] = "CURRENT") => ({
  fieldId: "field-1", fieldName: "Kuzey tarla", status, businessTimezone: "Europe/Istanbul",
  fetchedAt: "2026-10-01T06:00:00.000Z",
  coverage: { startAt: "2026-09-30T21:00:00.000Z", endAt: "2026-10-03T21:00:00.000Z", localStartDate: "2026-10-01", localEndDate: "2026-10-04" },
  current: { conditionCode: "CLEAR" as const, conditionLabel: null, observedAt: "2026-10-01T08:00:00.000Z", temperatureC: 21 },
  dailyForecasts: [0, 1, 2].map((offset) => ({
    localDate: `2026-10-0${1 + offset}`, conditionCode: "RAIN" as const, conditionLabel: null,
    temperatureHighC: 18 + offset, temperatureLowC: 9 + offset,
    precipitationChancePercent: 30 + offset, windSpeedKph: 12 + offset,
  })),
});

describe("weather card", () => {
  it("shows loading, accessible status and retryable errors", () => {
    const loading = render(WeatherCard({ state: { kind: "loading" }, onRetry: jest.fn() }));
    expect(loading.some(({ props }) => props.accessibilityRole === "progressbar" && props.accessibilityLabel === "Hava durumu yükleniyor")).toBe(true);

    const retry = jest.fn();
    const denied = render(WeatherCard({ state: { kind: "access-error" }, onRetry: retry }));
    expect(denied.some(({ props }) => props.accessibilityRole === "alert" && String(props.children).includes("erişim"))).toBe(true);
    const button = denied.find(({ type }) => type === Pressable)!;
    expect(button.props.accessibilityRole).toBe("button");
    expect(button.props.accessibilityLabel).toBe("Hava durumunu yeniden dene");
    (button.props.onPress as () => void)();
    expect(retry).toHaveBeenCalledTimes(1);

    const failed = render(WeatherCard({ state: { kind: "error" }, onRetry: retry }));
    expect(failed.some(({ props }) => props.accessibilityRole === "alert")).toBe(true);
  });

  it("renders current and stale values for exactly three Business-local forecast days", () => {
    for (const status of ["CURRENT", "STALE"] as const) {
      const elements = render(WeatherCard({ state: { kind: "data", weather: field(status) }, onRetry: jest.fn() }));
      const content = text(elements);
      expect(content).toContain("Kuzey tarla");
      expect(content).toContain("21°");
      expect(content).toContain("Açık");
      expect(content).toContain(status === "CURRENT" ? "Güncel" : "Eski hava durumu bilgisi");
      expect(content).toContain("01 Eki");
      expect(content).toContain("02 Eki");
      expect(content).toContain("03 Eki");
      expect(content).toContain("Saat dilimi: Europe/Istanbul");
      expect(content).toContain("Son güncelleme 09:00");
      expect(content).toContain("%30");
      expect(content).toContain("12 km/sa");
      expect(elements.filter(({ type }) => type === Text).every(({ props }) => props.allowFontScaling === true)).toBe(true);
      expect(content).not.toMatch(/öner|planı değiştir|görevi ertele/i);
    }
  });

  it("shows unavailable without values and uses named accessible state cues", () => {
    const unavailable = render(WeatherCard({ state: { kind: "data", weather: { ...field("UNAVAILABLE"), current: null, dailyForecasts: [], fetchedAt: null, coverage: null } }, onRetry: jest.fn() }));
    const content = text(unavailable);
    expect(content).toContain("Hava durumu kullanılamıyor");
    expect(content).not.toContain("21°");
    expect(unavailable.some(({ props }) => props.accessibilityRole === "text" && String(props.accessibilityLabel).includes("kullanılamıyor"))).toBe(true);
  });

  it("keeps current, stale, unavailable and error status text accessible per field", () => {
    const current = { kind: "data" as const, weather: field("CURRENT") };
    const stale = { kind: "data" as const, weather: field("STALE") };
    const unavailable = { kind: "data" as const, weather: { ...field("UNAVAILABLE"), current: null, dailyForecasts: [], fetchedAt: null, coverage: null } };
    const transitions = [
      [{ kind: "loading" as const }, current, "Güncel hava durumu"],
      [{ kind: "loading" as const }, stale, "Eski hava durumu bilgisi"],
      [{ kind: "loading" as const }, unavailable, "Hava durumu kullanılamıyor"],
      [{ kind: "error" as const }, unavailable, "Hava durumu kullanılamıyor"],
      [{ kind: "error" as const }, current, "Güncel hava durumu"],
    ] as const;
    for (const [before, after, expectedText] of transitions) {
      let screen!: ReturnType<typeof create>;
      act(() => { screen = create(<WeatherCard state={before} onRetry={jest.fn()} />); });
      act(() => { screen.update(<WeatherCard state={after} onRetry={jest.fn()} />); });
      const status = screen.root.findAll((node: { props: Record<string, unknown> }) => node.props.accessibilityRole === "text" || node.props.accessibilityRole === "alert");
      expect(status.some((node) => flattenText(node.props.children).includes(expectedText))).toBe(true);
      expect(screen.root.findAll((node: { props: Record<string, unknown> }) => Boolean(node.props.accessibilityLiveRegion))).toHaveLength(0);
      act(() => screen.unmount());
    }
  });
});

describe("weather overview cards", () => {
  it("is independently renderable with no Today task rows", () => {
    const elements = render(WeatherOverviewCards({ items: [field()], onRetry: jest.fn() }));
    expect(text(elements)).toContain("Kuzey tarla");
    expect(elements.filter(({ type, props }) => type === Text && String(props.children).match(/\d{2} Eki/))).toHaveLength(3);
  });
});
