import { useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import type { ApiClient, FieldComponents } from "../../../../../packages/api-client/src/index";
import { MapAdapter, type MapLocation } from "../onboarding/map/map-adapter";
import { readField, updateField, type FieldApiError, type FieldDetail } from "./fields-client";
import { FieldStatusAnnouncement } from "./field-status-announcement";
import { formatCurrentBoundary } from "./field-location-summary";

type Props = Readonly<{
  client: ApiClient;
  field: FieldDetail;
  onSaved: (field: FieldDetail) => void;
}>;

/** Online-only edit form with an explicit stale-version recovery choice. */
export function FieldEditScreen({ client, field, onSaved }: Props) {
  const [name, setName] = useState(field.name);
  const [mode, setMode] = useState<"point" | "polygon">(field.boundary ? "polygon" : "point");
  const [location, setLocation] = useState<FieldComponents["schemas"]["FieldLocation"] | null>(null);
  const [locationChanged, setLocationChanged] = useState(false);
  const initialOverride = field.regionContext.agriculturalRegionOverride;
  const [overrideCode, setOverrideCode] = useState(initialOverride?.code ?? "");
  const [overrideLabel, setOverrideLabel] = useState(initialOverride?.label ?? "");
  const [overrideChanged, setOverrideChanged] = useState(false);
  const [latest, setLatest] = useState<FieldDetail | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const saveAttempt = useRef(0);

  const save = async (version: number) => {
    ++saveAttempt.current;
    setSaving(true);
    setMessage(null);
    try {
      const request: FieldComponents["schemas"]["FieldUpdate"] = { name };
      if (locationChanged && location) request.location = location;
      if (overrideChanged) request.agriculturalRegionOverride = overrideCode.trim() && overrideLabel.trim()
        ? { code: overrideCode.trim(), label: overrideLabel.trim() } : null;
      const saved = await updateField(client, field.id, version, request);
      setLatest(null);
      onSaved(saved);
    } catch (error) {
      const apiError = error as FieldApiError;
      if (apiError.code === "STALE_VERSION") {
        setMessage("Değişiklik başka bir cihazda güncellendi. Son bilgileri inceleyin.");
        try { setLatest(await readField(client, field.id)); }
        catch { setMessage("Son tarla bilgileri alınamadı. Bağlantınızı kontrol edip yeniden deneyin."); }
      } else {
        setMessage(apiError.message || "Tarla bilgileri kaydedilemedi. Yeniden deneyin.");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text accessibilityRole="header" style={styles.title}>Tarla bilgilerini düzenle</Text>
      <TextInput accessibilityLabel="Tarla adı" autoCapitalize="sentences" onChangeText={setName} style={styles.input} value={name} />
      <View style={styles.modeButtons}>
        <Pressable accessibilityRole="button" accessibilityLabel="Haritadan nokta seç" accessibilityState={{ selected: mode === "point" }} onPress={() => setMode("point")} style={styles.choice}><Text>Nokta seç</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Tarla sınırı çiz" accessibilityState={{ selected: mode === "polygon" }} onPress={() => setMode("polygon")} style={styles.choice}><Text>Sınır çiz</Text></Pressable>
      </View>
      <Text>{locationChanged ? "Yeni konum seçildi" : field.boundary ? "Kayıtlı tarla sınırı korunuyor" : "Kayıtlı tarla noktası korunuyor"}</Text>
      <MapAdapter mode={mode} onLocationChange={(selected: MapLocation) => {
        const encoded: FieldComponents["schemas"]["FieldLocation"] = selected.type === "Point"
          ? { type: "POINT", point: selected }
          : { type: "POLYGON", polygon: selected };
        setLocation(encoded);
        setLocationChanged(true);
      }} />
      <Text style={styles.conflictTitle}>Tarımsal bölge tercihi (isteğe bağlı)</Text>
      <TextInput accessibilityLabel="Tarımsal bölge kodu" onChangeText={(value) => { setOverrideCode(value); setOverrideChanged(true); }} placeholder="Bölge kodu" style={styles.input} value={overrideCode} />
      <TextInput accessibilityLabel="Tarımsal bölge adı" onChangeText={(value) => { setOverrideLabel(value); setOverrideChanged(true); }} placeholder="Bölge adı" style={styles.input} value={overrideLabel} />
      {initialOverride && <Pressable accessibilityRole="button" accessibilityLabel="Elle seçilen bölgeyi kaldır" onPress={() => { setOverrideCode(""); setOverrideLabel(""); setOverrideChanged(true); }} style={styles.choice}><Text>Elle seçilen bölgeyi kaldır</Text></Pressable>}
      <FieldStatusAnnouncement
        transitionKey={saving ? `field-save:${saveAttempt.current}:saving` : latest ? `field-save:${saveAttempt.current}:stale:${latest.version}` : message ? `field-save:${saveAttempt.current}:error:${message}` : null}
        message={saving ? "Tarla değişiklikleri kaydediliyor" : message}
      />
      {message ? <Text accessibilityRole="text" style={styles.message}>{message}</Text> : null}
      {latest ? (
        <View style={styles.conflict}>
          <Text style={styles.conflictTitle}>Güncel tarla adı</Text>
          <Text>{latest.name}</Text>
          <Text>Güncel tarla konumu: {latest.representativePoint.coordinates[1].toFixed(5)}, {latest.representativePoint.coordinates[0].toFixed(5)}</Text>
          <Text>{formatCurrentBoundary(latest.boundary)}</Text>
          <Text>Güncel tarımsal bölge tercihi: {latest.regionContext.agriculturalRegionOverride?.label ?? "Elle seçilmiş tercih yok"}</Text>
          <Text>Güncel tarımsal bölge önerisi: {latest.regionContext.agriculturalRegion.state === "RESOLVED" ? latest.regionContext.agriculturalRegion.label : "Henüz belirlenmedi"}</Text>
          <Text style={styles.conflictTitle}>Sizin girdiğiniz ad</Text>
          <Text>{name}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Kendi değişikliğimi yeniden gönder" disabled={saving} onPress={() => void save(latest.version)} style={styles.button}>
            <Text style={styles.buttonText}>Kendi değişikliğimi yeniden gönder</Text>
          </Pressable>
        </View>
      ) : null}
      {!latest ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Değişiklikleri kaydet" disabled={saving || !name.trim()} onPress={() => void save(field.version)} style={styles.button}>
          <Text style={styles.buttonText}>{saving ? "Kaydediliyor…" : "Değişiklikleri kaydet"}</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, gap: 16 },
  title: { fontSize: 22, fontWeight: "700" },
  input: { borderColor: "#65734b", borderWidth: 1, borderRadius: 8, minHeight: 48, paddingHorizontal: 12 },
  message: { color: "#8b2c21" },
  conflict: { borderColor: "#7a6534", borderWidth: 1, borderRadius: 8, padding: 14, gap: 8 },
  conflictTitle: { fontWeight: "700" },
  modeButtons: { flexDirection: "row", gap: 10 },
  choice: { minHeight: 42, justifyContent: "center", paddingHorizontal: 10, borderColor: "#65734b", borderWidth: 1, borderRadius: 8 },
  button: { minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: 8, backgroundColor: "#40603a", padding: 12 },
  buttonText: { color: "#fff", fontWeight: "600" },
});
