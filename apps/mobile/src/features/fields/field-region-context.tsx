import { Text, View } from "react-native";
import type { FieldComponents } from "../../../../../packages/api-client/src/index";
import { FieldStatusAnnouncement } from "./field-status-announcement";

type RegionContext = FieldComponents["schemas"]["RegionContext"];
export type FieldRegionResolutionState = "IDLE" | "LOADING" | "ERROR" | "CONFLICT";

/** Visible, color-independent region state for a Field detail or edit form. */
export function FieldRegionContextView({
  context,
  resolutionState = "IDLE",
  errorMessage,
}: Readonly<{
  context: RegionContext;
  resolutionState?: FieldRegionResolutionState;
  errorMessage?: string | null;
}>) {
  const agricultural = context.agriculturalRegionOverride
    ? { label: context.agriculturalRegionOverride.label, source: "Farmer choice" }
    : context.agriculturalRegion.state === "RESOLVED"
      ? { label: context.agriculturalRegion.label, source: "Suggested region" }
      : null;
  const announcement = resolutionState === "LOADING" ? null
    : resolutionState === "ERROR" || resolutionState === "CONFLICT"
      ? errorMessage ?? (resolutionState === "CONFLICT" ? "Konum değişti. Bölge önerileri yeniden kontrol edilecek." : "Bölge bilgisi alınamadı. Daha sonra tekrar deneyin.")
      : context.administrativeLocation.state === "RESOLVED" || context.agriculturalRegion.state === "RESOLVED"
        ? "Bölge bilgileri güncellendi."
        : "Bölge bilgisi henüz belirlenmedi.";
  const announcementKey = announcement ? `${resolutionState}:${context.administrativeLocation.state}:${context.administrativeLocation.resolvedAt ?? ""}:${context.agriculturalRegion.state}:${context.agriculturalRegion.resolvedAt ?? ""}:${announcement}` : null;

  return (
    <View accessibilityLabel="Bölge bilgisi" accessibilityRole="summary">
      <FieldStatusAnnouncement transitionKey={announcementKey} message={announcement} />
      {resolutionState === "LOADING" ? (
        <Text accessibilityRole="progressbar" accessibilityLiveRegion="polite">Bölge önerileri kontrol ediliyor</Text>
      ) : null}
      {resolutionState === "ERROR" || resolutionState === "CONFLICT" ? (
        <Text accessibilityRole="text">
          {errorMessage ?? (resolutionState === "CONFLICT"
            ? "Konum değişti. Bölge önerileri yeniden kontrol edilecek."
            : "Bölge bilgisi alınamadı. Daha sonra tekrar deneyin.")}
        </Text>
      ) : null}
      <Text accessibilityRole="text">
        İdari bölge: {context.administrativeLocation.state === "RESOLVED"
          ? context.administrativeLocation.label
          : "Bölge bilgisi henüz belirlenmedi"}
      </Text>
      <Text accessibilityRole="text">
        Tarımsal bölge: {agricultural?.label ?? "Bölge bilgisi henüz belirlenmedi"}
      </Text>
      {agricultural ? <Text accessibilityRole="text">{agricultural.source}</Text> : null}
    </View>
  );
}
