import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { WeatherField, WeatherOverviewPage } from "./weather-client";

export type WeatherCardState =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "access-error" }
  | { kind: "data"; weather: WeatherField };

const conditionLabels: Record<WeatherField["dailyForecasts"][number]["conditionCode"], string> = {
  CLEAR: "Açık", PARTLY_CLOUDY: "Parçalı bulutlu", CLOUDY: "Bulutlu", FOG: "Sisli",
  RAIN: "Yağmurlu", SNOW: "Karlı", THUNDERSTORM: "Gök gürültülü", WINDY: "Rüzgârlı", UNKNOWN: "Durum bilinmiyor",
};
const months = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];

function localDateLabel(localDate: string): string {
  const [, month, day] = localDate.split("-").map(Number);
  return Number.isInteger(day) && month! >= 1 && month! <= 12 ? `${String(day).padStart(2, "0")} ${months[month! - 1]}` : localDate;
}
function updateLabel(fetchedAt: string | null, businessTimezone: string): string {
  if (!fetchedAt) return "Güncelleme zamanı yok";
  const date = new Date(fetchedAt);
  try {
    return Number.isNaN(date.getTime()) ? "Güncelleme zamanı bilinmiyor"
      : `Son güncelleme ${new Intl.DateTimeFormat("tr-TR", { hour: "2-digit", minute: "2-digit", timeZone: businessTimezone }).format(date)}`;
  } catch {
    return "Güncelleme zamanı bilinmiyor";
  }
}
function conditionLabel(code: WeatherField["dailyForecasts"][number]["conditionCode"], label?: string | null) {
  return label || conditionLabels[code] || "Durum bilinmiyor";
}

export function WeatherCard({ state, onRetry }: { state: WeatherCardState; onRetry: () => void }) {
  if (state.kind === "loading") return <Text accessibilityRole="progressbar" accessibilityLabel="Hava durumu yükleniyor" allowFontScaling style={styles.message}>Hava durumu yükleniyor…</Text>;
  if (state.kind === "error" || state.kind === "access-error") {
    const message = state.kind === "access-error"
      ? "Hava durumu erişiminiz doğrulanamadı. Yeniden bağlanıp erişiminizi kontrol edin."
      : "Hava durumu yüklenemedi. Bağlantınızı kontrol edip yeniden deneyin.";
    return <View style={styles.card}>
      <Text accessibilityRole="alert" accessibilityLabel={message} allowFontScaling style={styles.message}>{message}</Text>
      <RetryButton onRetry={onRetry} />
    </View>;
  }

  const { weather } = state;
  if (weather.status === "UNAVAILABLE" || !weather.current) return <View style={styles.card}>
    <Text accessibilityRole="text" accessibilityLabel={`${weather.fieldName}: hava durumu kullanılamıyor`} allowFontScaling style={styles.message}>Hava durumu kullanılamıyor</Text>
    <Text allowFontScaling style={styles.fieldName}>{weather.fieldName}</Text>
    <RetryButton onRetry={onRetry} />
  </View>;

  const stale = weather.status === "STALE";
  const forecasts = weather.dailyForecasts.slice(0, 3);
  return <View style={styles.card}>
    <Text accessibilityRole="header" accessibilityLabel={`${weather.fieldName} hava durumu`} allowFontScaling style={styles.fieldName}>{weather.fieldName}</Text>
    <Text accessibilityRole="text" accessibilityLabel={stale ? "Eski hava durumu bilgisi" : "Güncel hava durumu"} allowFontScaling style={stale ? styles.stale : styles.currentStatus}>{stale ? "Eski hava durumu bilgisi · yenileme bekleniyor" : "Güncel hava durumu"}</Text>
    <Text accessibilityRole="text" allowFontScaling style={styles.current}>{weather.current.temperatureC}° · {conditionLabel(weather.current.conditionCode, weather.current.conditionLabel)}</Text>
    <Text allowFontScaling style={styles.context}>Saat dilimi: {weather.businessTimezone}</Text>
    <Text allowFontScaling style={styles.context}>{updateLabel(weather.fetchedAt, weather.businessTimezone)}</Text>
    {forecasts.map((day) => <View key={day.localDate} accessible accessibilityRole="text" accessibilityLabel={`${localDateLabel(day.localDate)}: ${conditionLabel(day.conditionCode, day.conditionLabel)}, en yüksek ${day.temperatureHighC}, en düşük ${day.temperatureLowC} derece, yağış yüzde ${day.precipitationChancePercent}, rüzgâr saatte ${day.windSpeedKph} kilometre`} style={styles.day}>
      <Text allowFontScaling style={styles.dayTitle}>{localDateLabel(day.localDate)} · {conditionLabel(day.conditionCode, day.conditionLabel)}</Text>
      <Text allowFontScaling style={styles.metrics}>En yüksek {day.temperatureHighC}° · En düşük {day.temperatureLowC}°</Text>
      <Text allowFontScaling style={styles.metrics}>Yağış %{day.precipitationChancePercent} · Rüzgâr {day.windSpeedKph} km/sa</Text>
    </View>)}
    {forecasts.length !== 3 && <Text accessibilityRole="alert" allowFontScaling style={styles.stale}>Üç günlük tahmin şu anda tamamlanamıyor.</Text>}
    {stale && <RetryButton onRetry={onRetry} />}
  </View>;
}

function RetryButton({ onRetry }: { onRetry: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel="Hava durumunu yeniden dene" accessibilityState={{ disabled: false }} onPress={onRetry} style={styles.retry}>
    <Text allowFontScaling style={styles.retryText}>Yeniden dene</Text>
  </Pressable>;
}

export function WeatherOverviewCards({ items, onRetry }: { items: WeatherOverviewPage["items"]; onRetry: (fieldId: string) => void }) {
  return <View accessibilityLabel="Tarlaların hava durumu" style={styles.list}>
    {items.map((weather) => <WeatherCard key={weather.fieldId} state={{ kind: "data", weather }} onRetry={() => onRetry(weather.fieldId)} />)}
    {items.length === 0 && <Text accessibilityRole="text" allowFontScaling style={styles.message}>Hava durumu gösterilecek tarla yok.</Text>}
  </View>;
}

const styles = StyleSheet.create({
  list: { gap: 12 }, card: { backgroundColor: "#fff", borderColor: "#b8c9bf", borderWidth: 1, borderRadius: 12, padding: 16, gap: 8 },
  fieldName: { color: "#183b2b", fontSize: 20, fontWeight: "700" }, currentStatus: { color: "#205b3c", fontSize: 15, fontWeight: "600" },
  stale: { color: "#7a4b00", fontSize: 15, fontWeight: "700" }, current: { color: "#17251d", fontSize: 24, fontWeight: "700" },
  context: { color: "#42564a", fontSize: 14 }, day: { borderTopColor: "#d8e2dc", borderTopWidth: 1, paddingTop: 8, gap: 3 },
  dayTitle: { color: "#183b2b", fontSize: 16, fontWeight: "700" }, metrics: { color: "#26372d", fontSize: 15 },
  message: { color: "#26372d", fontSize: 16 }, retry: { alignSelf: "flex-start", minHeight: 48, justifyContent: "center", paddingHorizontal: 12 },
  retryText: { color: "#174a30", fontSize: 16, fontWeight: "700", textDecorationLine: "underline" },
});
