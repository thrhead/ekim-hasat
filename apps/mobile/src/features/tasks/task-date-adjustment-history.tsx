import { Pressable, Text, View } from "react-native";
import type { TaskDateAdjustmentComponents } from "../../../../../packages/api-client/src/index";

type Page = TaskDateAdjustmentComponents["schemas"]["TaskDateAdjustmentHistoryPage"];

export function TaskDateAdjustmentHistory({ state, page, error, onRetry, onLoadMore }: Readonly<{
  state: "loading" | "error" | "ready";
  page?: Page;
  error?: string;
  onRetry: () => void;
  onLoadMore?: () => void;
}>) {
  if (state === "loading") return <Text accessibilityRole="progressbar" accessibilityLiveRegion="polite">Tarih değişikliği geçmişi yükleniyor…</Text>;
  if (state === "error") return <View accessibilityLiveRegion="polite">
    <Text accessibilityRole="alert">{error ?? "Tarih değişikliği geçmişi yüklenemedi."}</Text>
    <Pressable accessibilityRole="button" accessibilityLabel="Tarih değişikliği geçmişini yeniden yükle" onPress={onRetry}>
      <Text>Yeniden dene</Text>
    </Pressable>
  </View>;
  if (!page || page.items.length === 0) return <Text accessibilityLiveRegion="polite">Henüz tarih değişikliği yok.</Text>;
  return <View>
    {page.items.map((item) => <View key={item.adjustmentId} accessibilityLabel={`Tarih değişikliği: ${formatDate(item.previousPlannedLocalDate)} tarihinden ${formatDate(item.newPlannedLocalDate)} tarihine, ${formatTimestamp(item.adjustedAt)}`}>
      <Text>Önceki tarih · {formatDate(item.previousPlannedLocalDate)}</Text>
      <Text>Yeni tarih · {formatDate(item.newPlannedLocalDate)}</Text>
      <Text>Değişiklik zamanı · {formatTimestamp(item.adjustedAt)}</Text>
    </View>)}
    {page.nextCursor && onLoadMore && <Pressable accessibilityRole="button" accessibilityLabel="Daha fazla tarih değişikliği yükle" onPress={onLoadMore}>
      <Text>Daha fazla geçmiş yükle</Text>
    </Pressable>}
  </View>;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00.000Z`));
}

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
