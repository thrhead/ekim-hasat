import { useEffect, useRef } from "react";
import { AccessibilityInfo, Platform, StyleSheet, Text } from "react-native";
import type { WeatherOverviewPage } from "./weather-client";

type WeatherItem = WeatherOverviewPage["items"][number];

export function weatherAnnouncementMessage(items: WeatherItem[]): string | null {
  if (items.length === 0) return null;
  const counts = { current: 0, stale: 0, unavailable: 0 };
  for (const item of items) {
    if (item.status === "UNAVAILABLE" || !item.current) counts.unavailable++;
    else if (item.status === "STALE") counts.stale++;
    else counts.current++;
  }
  const active = Object.entries(counts).filter(([, count]) => count > 0);
  if (active.length === 1) {
    if (counts.current) return "Hava durumu güncel.";
    if (counts.stale) return "Eski hava durumu bilgisi.";
    return "Hava durumu kullanılamıyor.";
  }
  return `Hava durumu: ${[
    counts.current ? `${counts.current} güncel` : null,
    counts.stale ? `${counts.stale} eski` : null,
    counts.unavailable ? `${counts.unavailable} kullanılamıyor` : null,
  ].filter(Boolean).join(", ")}.`;
}

export function WeatherAnnouncement({ message }: { message: string | null }) {
  const previousMessage = useRef(message);
  useEffect(() => {
    if (previousMessage.current === message) return;
    previousMessage.current = message;
    if (Platform.OS === "ios" && message) AccessibilityInfo.announceForAccessibility(message);
  }, [message]);

  return message ? <Text accessibilityRole="text" accessibilityLiveRegion="polite" allowFontScaling style={styles.announcement}>{message}</Text> : null;
}

const styles = StyleSheet.create({ announcement: { position: "absolute", width: 1, height: 1, overflow: "hidden" } });
