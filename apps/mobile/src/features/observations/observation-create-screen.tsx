import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput } from "react-native";
import type { ApiClient } from "../../../../../packages/api-client/src/index";
import { localObservationInstant, observationLocalTime, readObservationTimezone, submitObservation, validateObservationNote, type Observation, type ObservationRequest } from "./observation-client";

const currentTime = () => new Date();
function observationId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (letter) => {
    const value = Math.floor(Math.random() * 16);
    return (letter === "x" ? value : (value & 0x3) | 0x8).toString(16);
  });
}

export type ObservationCreateScreenProps = {
  client: ApiClient;
  fieldId: string;
  fieldName?: string;
  seasonId?: string;
  seasonName?: string;
  onCreated?: (observation: Observation) => void;
  onBack?: () => void;
  now?: () => Date;
  createId?: () => string;
};

export function ObservationCreateScreen(props: ObservationCreateScreenProps) {
  return <ObservationCreateForm key={`${props.fieldId}:${props.seasonId ?? ""}`} {...props} />;
}

function ObservationCreateForm({ client, fieldId, fieldName, seasonId, seasonName, onCreated, onBack, now = currentTime, createId = observationId }: ObservationCreateScreenProps) {
  const [timezone, setTimezone] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [contextError, setContextError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [local, setLocal] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState<ObservationRequest | null>(null);
  const [saving, setSaving] = useState(false);
  const [accepted, setAccepted] = useState<Observation | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    let current = true;
    setLoading(true); setTimezone(null); setContextError(null);
    void readObservationTimezone(client, fieldId, seasonId).then((value) => {
      if (!current) return;
      setTimezone(value);
      setLocal((entered) => entered || observationLocalTime(now(), value).slice(0, 16));
    }).catch(() => {
      if (current) setContextError("Tarla bilgileri yüklenemedi. İnternet bağlantınızı kontrol edip yeniden deneyin.");
    }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [client, fieldId, seasonId, now, reload]);

  async function submit(request: ObservationRequest) {
    if (inFlight.current || !timezone) return;
    inFlight.current = true; setSaving(true); setError(null);
    try {
      const saved = await submitObservation(client, fieldId, request);
      if (!mounted.current) return;
      setAccepted(saved); setAttempt(null); onCreated?.(saved);
    } catch (failure) {
      if (!mounted.current) return;
      const status = failure && typeof failure === "object" && "status" in failure ? Number(failure.status) : undefined;
      setAttempt(status && status >= 400 && status < 500 ? null : request);
      setError(status ? (failure as Error).message : "Kayıt sonucu doğrulanamadı. İnternet bağlantınızı kontrol edip aynı kaydı yeniden deneyin.");
    } finally { inFlight.current = false; if (mounted.current) setSaving(false); }
  }

  function save() {
    if (!timezone || saving || attempt) return;
    const invalidNote = validateObservationNote(note);
    if (invalidNote) { setError(invalidNote); return; }
    try {
      const occurredAt = localObservationInstant(local, timezone);
      if (Date.parse(occurredAt) > now().getTime()) { setError("Gözlem zamanı gelecekte olamaz. Tarih ve saati kontrol edin."); return; }
      void submit({ observationId: createId(), description: note.trim(), occurredAtLocal: local, occurredAt, ...(seasonId ? { seasonId } : {}) });
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Tarih ve saati kontrol edin."); }
  }

  const locked = saving || attempt !== null;
  const disabled = !timezone || loading || locked;
  return <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
    {onBack && <Pressable accessibilityRole="button" accessibilityLabel="Tarlaya dön" onPress={onBack} style={styles.button}><Text>Tarlaya dön</Text></Pressable>}
    <Text accessibilityRole="header" style={styles.title}>Gözlem ekle</Text>
    <Text>Tarla: {fieldName ?? "Seçili tarla"}</Text>
    {seasonId && <Text>Sezon: {seasonName ?? "Seçili sezon"}</Text>}
    {accepted ? <>
      <Text accessibilityRole="text" accessibilityLabel="Gözlem kaydedildi" accessibilityLiveRegion="polite">Gözlem kaydedildi</Text>
      <Text>{accepted.description}</Text>
    </> : <>
      <Text>İnternet bağlantısı gerekir. Kayıt sunucudan doğrulanınca tamamlanır.</Text>
      {loading && <Text accessibilityRole="progressbar" accessibilityLabel="Tarla bilgileri yükleniyor" accessibilityLiveRegion="polite">Tarla bilgileri yükleniyor…</Text>}
      {contextError && <>
        <Text accessibilityRole="alert" accessibilityLiveRegion="assertive">{contextError}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Bilgileri yeniden yükle" onPress={() => setReload((value) => value + 1)} style={styles.button}><Text>Yeniden yükle</Text></Pressable>
      </>}
      <Text>Gözlem notu</Text>
      <TextInput accessibilityLabel="Gözlem notu" value={note} onChangeText={(value) => { setNote(value); setError(null); }} editable={!disabled} multiline style={[styles.input, styles.note]} />
      <Text>Gözlem tarihi ve saati</Text>
      <TextInput accessibilityLabel="Gözlem tarihi ve saati" accessibilityHint="Yıl-ay-gün ve saat:dakika. Örnek: 2026-10-05T13:00" value={local} onChangeText={(value) => { setLocal(value); setError(null); }} editable={!disabled} autoCapitalize="none" placeholder="YYYY-MM-DDTHH:mm" style={styles.input} />
      {timezone && <Text>Saat dilimi: {timezone}</Text>}
      {error && <Text accessibilityRole="alert" accessibilityLiveRegion="assertive">{error}</Text>}
      {saving && <Text accessibilityRole="progressbar" accessibilityLabel="Gözlem kaydediliyor" accessibilityLiveRegion="polite">Gözlem kaydediliyor…</Text>}
      {attempt && !saving && <Pressable accessibilityRole="button" accessibilityLabel="Kaydı yeniden dene" onPress={() => void submit(attempt)} style={styles.button}><Text>Aynı kaydı yeniden dene</Text></Pressable>}
      <Pressable accessibilityRole="button" accessibilityLabel="Gözlemi kaydet" accessibilityState={{ disabled, busy: saving }} disabled={disabled} onPress={save} style={[styles.button, disabled && styles.disabled]}><Text>Gözlemi kaydet</Text></Pressable>
    </>}
  </ScrollView>;
}

const styles = StyleSheet.create({
  container: { padding: 20, gap: 14 }, title: { fontSize: 24, fontWeight: "600" },
  input: { borderWidth: 1, borderColor: "#66736b", borderRadius: 8, padding: 12, fontSize: 16 },
  note: { minHeight: 120, textAlignVertical: "top" },
  button: { minHeight: 48, padding: 14, borderWidth: 1, borderColor: "#376b48", borderRadius: 8 }, disabled: { opacity: 0.5 },
});
