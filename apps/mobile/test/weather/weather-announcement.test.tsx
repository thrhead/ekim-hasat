import { AccessibilityInfo, Platform } from "react-native";
import { act, create } from "react-test-renderer";
import { WeatherAnnouncement, weatherAnnouncementMessage } from "../../src/features/weather/weather-announcement";

describe("weather overview announcements", () => {
  it("announces asynchronous state changes once on iOS and ignores equivalent rerenders", () => {
    const previousPlatform = Platform.OS;
    Object.defineProperty(Platform, "OS", { configurable: true, value: "ios" });
    const announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => undefined);
    let screen!: ReturnType<typeof create>;
    try {
      act(() => { screen = create(<WeatherAnnouncement message={null} />); });
      act(() => { screen.update(<WeatherAnnouncement message="Hava durumu yüklenemedi. Yeniden deneyebilirsiniz." />); });
      act(() => { screen.update(<WeatherAnnouncement message="Hava durumu güncel." />); });
      act(() => { screen.update(<WeatherAnnouncement message="Hava durumu güncel." />); });
      expect(announce.mock.calls.map(([message]) => message)).toEqual([
        "Hava durumu yüklenemedi. Yeniden deneyebilirsiniz.", "Hava durumu güncel.",
      ]);
    } finally {
      act(() => screen.unmount());
      announce.mockRestore();
      Object.defineProperty(Platform, "OS", { configurable: true, value: previousPlatform });
    }
  });

  it("uses one concise aggregate message for multiple fields", () => {
    const message = weatherAnnouncementMessage([
      { status: "CURRENT", current: { temperatureC: 20 } },
      { status: "CURRENT", current: { temperatureC: 18 } },
      { status: "STALE", current: { temperatureC: 15 } },
      { status: "UNAVAILABLE", current: null },
    ] as never);
    expect(message).toBe("Hava durumu: 2 güncel, 1 eski, 1 kullanılamıyor.");
  });

  it("keeps Android live-region semantics without invoking the iOS announcement API", () => {
    const previousPlatform = Platform.OS;
    Object.defineProperty(Platform, "OS", { configurable: true, value: "android" });
    const announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => undefined);
    let screen!: ReturnType<typeof create>;
    try {
      act(() => { screen = create(<WeatherAnnouncement message={null} />); });
      act(() => { screen.update(<WeatherAnnouncement message="Hava durumu güncel." />); });
      expect(announce).not.toHaveBeenCalled();
      const status = screen.root.findAll(({ props }: { props: Record<string, unknown> }) => Boolean(props.accessibilityLiveRegion))[0];
      expect(status?.props.accessibilityLiveRegion).toBe("polite");
    } finally {
      act(() => screen.unmount());
      announce.mockRestore();
      Object.defineProperty(Platform, "OS", { configurable: true, value: previousPlatform });
    }
  });
});
