import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import type { ApiClient, FieldComponents } from "../../../../../packages/api-client/src/index";
import { MapAdapter, type MapLocation } from "../onboarding/map/map-adapter";
import { createField } from "./fields-client";

type FieldDetail = FieldComponents["schemas"]["FieldDetail"];
type FieldLocation = FieldComponents["schemas"]["FieldLocation"];
export type FieldCreateAttempt = Readonly<{
  idempotencyKey: string;
  request: FieldComponents["schemas"]["FieldCreate"];
}>;
type LocationMode = "point" | "polygon";

/** Keep the API's Point/Polygon discriminator and omit blank optional names. */
export function createFieldAttempt(
  name: string,
  location: MapLocation,
  idempotencyKey: string,
): FieldCreateAttempt {
  const trimmedName = name.trim();
  const fieldLocation: FieldLocation = location.type === "Point"
    ? { type: "POINT", point: location }
    : { type: "POLYGON", polygon: location };
  return {
    idempotencyKey,
    request: {
      ...(trimmedName ? { name: trimmedName } : {}),
      location: fieldLocation,
    },
  };
}

/** Send only the generated create contract and preserve exact retries. */
export async function submitFieldCreate(
  client: ApiClient,
  attempt: FieldCreateAttempt,
): Promise<FieldDetail> {
  return createField(client, attempt.request, attempt.idempotencyKey);
}

type FieldCreateControlsProps = Readonly<{
  name: string;
  mode: LocationMode;
  locationSelected: boolean;
  submitting: boolean;
  errorMessage: string | null;
  onNameChange: (name: string) => void;
  onModeChange: (mode: LocationMode) => void;
  onLocationChange: (location: MapLocation) => void;
  onSubmit: () => void;
  onRetry: () => void;
}>;

/** Farmer-facing creation form; device permission is requested only from the map action. */
export function FieldCreateControls(props: FieldCreateControlsProps) {
  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text accessibilityRole="header" style={styles.title}>Tarla ekle</Text>
      <Text style={styles.description}>Haritadan konum seçin veya tarlanızın sınırını çizin. Konum izni isteğe bağlıdır.</Text>

      <View style={styles.nameGroup}>
        <Text style={styles.label}>Tarla adı (isteğe bağlı)</Text>
        <TextInput
          accessibilityLabel="Tarla adı (isteğe bağlı)"
          autoCapitalize="sentences"
          onChangeText={props.onNameChange}
          placeholder="Örneğin, Bahçe"
          returnKeyType="done"
          style={styles.input}
          value={props.name}
        />
      </View>

      <View style={styles.modeGroup}>
        <Text style={styles.label}>Konum seçimi</Text>
        <View style={styles.modeButtons}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Haritadan nokta seç"
            accessibilityState={{ selected: props.mode === "point" }}
            disabled={props.submitting}
            onPress={() => props.onModeChange("point")}
            style={[styles.modeButton, props.mode === "point" && styles.selectedModeButton]}
          >
            <Text style={[styles.modeButtonText, props.mode === "point" && styles.selectedModeText]}>Nokta seç</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Tarla sınırı çiz"
            accessibilityState={{ selected: props.mode === "polygon" }}
            disabled={props.submitting}
            onPress={() => props.onModeChange("polygon")}
            style={[styles.modeButton, props.mode === "polygon" && styles.selectedModeButton]}
          >
            <Text style={[styles.modeButtonText, props.mode === "polygon" && styles.selectedModeText]}>Sınır çiz</Text>
          </Pressable>
        </View>
      </View>

      <View pointerEvents={props.submitting ? "none" : "auto"}>
        <MapAdapter mode={props.mode} onLocationChange={props.onLocationChange} />
      </View>
      <Text style={styles.selectionStatus}>
        {props.locationSelected ? "Konum seçildi" : "Devam etmek için haritadan konum seçin."}
      </Text>

      {props.errorMessage ? (
        <Text accessibilityRole="alert" style={styles.error}>{props.errorMessage}</Text>
      ) : null}
      {props.submitting ? (
        <View accessibilityLiveRegion="polite" style={styles.progress}>
          <Text style={styles.progressText}>Tarla kaydediliyor…</Text>
        </View>
      ) : props.errorMessage ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Tekrar dene" onPress={props.onRetry} style={styles.primaryButton}>
          <Text style={styles.primaryButtonText}>Tekrar dene</Text>
        </Pressable>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Tarlayı kaydet"
          accessibilityState={{ disabled: !props.locationSelected }}
          disabled={!props.locationSelected}
          onPress={props.onSubmit}
          style={[styles.primaryButton, !props.locationSelected && styles.disabledButton]}
        >
          <Text style={styles.primaryButtonText}>Tarlayı kaydet</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

export function FieldCreateSuccessView({ field }: { field: FieldDetail }) {
  return (
    <View style={styles.success}>
      <Text accessibilityRole="header" style={styles.successTitle}>Tarla kaydedildi</Text>
      <Text style={styles.successName}>{field.name}</Text>
      {field.boundary ? <Text style={styles.successNote}>Tarla sınırı eklendi. Henüz doğrulanmadı.</Text> : null}
    </View>
  );
}

/** Additional Field entry; success is shown only after an accepted server response. */
export function FieldCreateScreen({ client, onCreated }: { client: ApiClient; onCreated?: (field: FieldDetail) => void }) {
  const [name, setName] = useState("");
  const [mode, setMode] = useState<LocationMode>("point");
  const [location, setLocation] = useState<MapLocation | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [failedAttempt, setFailedAttempt] = useState<FieldCreateAttempt | null>(null);
  const [savedField, setSavedField] = useState<FieldDetail | null>(null);

  async function submit(attempt: FieldCreateAttempt) {
    if (submitting) return;
    setSubmitting(true);
    setErrorMessage(null);
    try {
      const field = await submitFieldCreate(client, attempt);
      setSavedField(field);
      setFailedAttempt(null);
      onCreated?.(field);
    } catch (error) {
      setFailedAttempt(attempt);
      setErrorMessage(error instanceof Error ? error.message : "Tarla kaydedilemedi. Tekrar deneyin.");
    } finally {
      setSubmitting(false);
    }
  }

  if (savedField) return <FieldCreateSuccessView field={savedField} />;
  return (
    <FieldCreateControls
      name={name}
      mode={mode}
      locationSelected={location !== null}
      submitting={submitting}
      errorMessage={errorMessage}
      onNameChange={(value) => { setName(value); setFailedAttempt(null); setErrorMessage(null); }}
      onModeChange={(value) => { setMode(value); setLocation(null); setFailedAttempt(null); setErrorMessage(null); }}
      onLocationChange={(value) => { setLocation(value); setFailedAttempt(null); setErrorMessage(null); }}
      onSubmit={() => {
        if (!location || submitting) return;
        void submit(createFieldAttempt(name, location, createIdempotencyKey()));
      }}
      onRetry={() => { if (failedAttempt) void submit(failedAttempt); }}
    />
  );
}

function createIdempotencyKey(): string {
  return `field-create-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

const styles = StyleSheet.create({
  content: { gap: 16, padding: 20, paddingBottom: 32 },
  title: { color: "#202820", fontSize: 24, fontWeight: "700", flexShrink: 1 },
  description: { color: "#333333", fontSize: 16, lineHeight: 23, flexShrink: 1 },
  nameGroup: { gap: 6 },
  label: { color: "#202820", fontSize: 16, fontWeight: "600" },
  input: { borderColor: "#595959", borderRadius: 8, borderWidth: 1, fontSize: 16, minHeight: 48, paddingHorizontal: 12, color: "#202820", backgroundColor: "#ffffff" },
  modeGroup: { gap: 8 },
  modeButtons: { flexDirection: "row", gap: 8 },
  modeButton: { alignItems: "center", borderColor: "#245b35", borderRadius: 8, borderWidth: 1, justifyContent: "center", minHeight: 48, paddingHorizontal: 16, flexShrink: 1 },
  selectedModeButton: { backgroundColor: "#245b35" },
  modeButtonText: { color: "#245b35", fontSize: 16, flexShrink: 1 },
  selectedModeText: { color: "#ffffff" },
  selectionStatus: { color: "#333333", fontSize: 15, flexShrink: 1 },
  error: { color: "#8b1515", fontSize: 16, flexShrink: 1 },
  progress: { alignItems: "center", flexDirection: "row", gap: 10, minHeight: 48 },
  progressText: { color: "#333333", fontSize: 16 },
  primaryButton: { alignItems: "center", backgroundColor: "#245b35", borderRadius: 8, justifyContent: "center", minHeight: 48, paddingHorizontal: 20, alignSelf: "stretch" },
  disabledButton: { opacity: 0.5 },
  primaryButtonText: { color: "#ffffff", fontSize: 16, fontWeight: "600", flexShrink: 1 },
  success: { flex: 1, gap: 12, justifyContent: "center", padding: 24 },
  successTitle: { color: "#245b35", fontSize: 24, fontWeight: "700" },
  successName: { color: "#202820", fontSize: 20, fontWeight: "600" },
  successNote: { color: "#333333", fontSize: 15 },
});
