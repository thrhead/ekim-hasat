import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import type { ApiClient } from "../../../../../packages/api-client/src/index";
import { buildObservationCommand, canonicalObservationNote, localObservationInstant, observationLocalTime, readObservationTimezone, submitObservation, validateObservationNote, type Observation, type ObservationRequest } from "./observation-client";
import type { ObservationCommand, ObservationCommandStore } from "./observation-command-store";

const currentTime = () => new Date();
function observationId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (letter) => {
    const value = Math.floor(Math.random() * 16);
    return (letter === "x" ? value : (value & 0x3) | 0x8).toString(16);
  });
}

export type ObservationCreateScreenProps = {
  client?: ApiClient;
  accountId?: string;
  offlineStore?: Pick<ObservationCommandStore, "getContext" | "enqueue"> & Partial<Pick<ObservationCommandStore, "saveContext" | "list" | "subscribe">>;
  fieldId: string;
  fieldName?: string;
  seasonId?: string;
  seasonName?: string;
  onCreated?: (observation: Observation) => void;
  onPending?: () => void;
  onSignIn?: () => void;
  onBack?: () => void;
  now?: () => Date;
  createId?: () => string;
};

export function ObservationCreateScreen(props: ObservationCreateScreenProps) {
  return <ObservationCreateForm key={`${props.fieldId}:${props.seasonId ?? ""}`} {...props} />;
}

function ObservationCreateForm({ client, accountId, offlineStore, fieldId, fieldName, seasonId, seasonName, onCreated, onPending, onBack, onSignIn, now = currentTime, createId = observationId }: ObservationCreateScreenProps) {
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
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [savedCommands, setSavedCommands] = useState<ObservationCommand[]>([]);
  const inFlight = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    let current = true;
    const refresh = () => { if (accountId) void offlineStore?.list?.(accountId).then((commands) => {
      if (current) setSavedCommands(commands.filter((command) => command.fieldId === fieldId
        && command.seasonId === (seasonId ?? null)));
    }).catch(() => {}); };
    refresh();
    const unsubscribe = offlineStore?.subscribe?.(refresh);
    return () => { current = false; unsubscribe?.(); };
  }, [accountId, offlineStore, fieldId, seasonId]);

  useEffect(() => {
    let current = true;
    setLoading(true); setTimezone(null); setContextError(null);
    void (client ? readObservationTimezone(client, fieldId, seasonId) : Promise.reject(new Error("Offline"))).then(async (value) => {
      if (!current) return;
      if (accountId) await offlineStore?.saveContext?.(accountId, { fieldId, seasonId: seasonId ?? null, businessTimezone: value });
      setTimezone(value);
      setLocal((entered) => entered || observationLocalTime(now(), value).slice(0, 16));
    }).catch(async (failure: unknown) => {
      const status = failure && typeof failure === "object" && "status" in failure
        ? Number(failure.status) : undefined;
      const mayUseSavedContext = !client || failure instanceof TypeError || status === 429 || (status !== undefined && status >= 500);
      const context = mayUseSavedContext && accountId
        ? await offlineStore?.getContext(accountId, fieldId, seasonId ?? null).catch(() => null) : null;
      if (current && context) {
        setTimezone(context.businessTimezone);
        setLocal((entered) => entered || observationLocalTime(now(), context.businessTimezone).slice(0, 16));
      } else if (current) setContextError(mayUseSavedContext
        ? "Tarla bilgileri yüklenemedi. İnternet bağlantınızı kontrol edip yeniden deneyin."
        : "Bu tarlaya erişiminiz doğrulanamadı. Yeniden bağlanıp erişiminizi kontrol edin.");
    }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [client, accountId, offlineStore, fieldId, seasonId, now, reload]);

  async function saveLocal() {
    if (inFlight.current || !timezone || !accountId || !offlineStore) return;
    inFlight.current = true; setSaving(true); setError(null);
    try {
      const command = buildObservationCommand({ accountId, observationId: createId(), fieldId,
        seasonId: seasonId ?? null, description: note, occurredAtLocal: local,
        capturedBusinessTimezone: timezone, now: now() });
      await offlineStore.enqueue(accountId, command);
      if (mounted.current) { setPendingId(command.observationId); onPending?.(); }
    } catch (failure) {
      if (mounted.current) setError(failure instanceof Error && failure.message.startsWith("Gözlem")
        ? failure.message : "Not cihazda kaydedilemedi. Yeniden deneyin.");
    } finally { inFlight.current = false; if (mounted.current) setSaving(false); }
  }

  async function submit(request: ObservationRequest) {
    if (inFlight.current || !timezone || !client) return;
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
    if (accountId && offlineStore) { void saveLocal(); return; }
    const invalidNote = validateObservationNote(note);
    if (invalidNote) { setError(invalidNote); return; }
    try {
      const occurredAt = localObservationInstant(local, timezone);
      if (Date.parse(occurredAt) > now().getTime()) { setError("Gözlem zamanı gelecekte olamaz. Tarih ve saati kontrol edin."); return; }
      void submit({ observationId: createId(), description: canonicalObservationNote(note), occurredAtLocal: local, occurredAt, ...(seasonId ? { seasonId } : {}) });
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Tarih ve saati kontrol edin."); }
  }

  const pendingCommand = savedCommands.find((command) => command.observationId === pendingId);
  const pending = pendingId !== null && (!pendingCommand || pendingCommand.state === "PENDING");
  const locked = saving || attempt !== null || pending;
  const disabled = !timezone || loading || locked;
  return <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
    {onBack && <Pressable accessibilityRole="button" accessibilityLabel="Tarlaya dön" onPress={onBack} style={styles.button}><Text>Tarlaya dön</Text></Pressable>}
    {!client && onSignIn && <Pressable accessibilityRole="button" accessibilityLabel="Oturum aç" onPress={onSignIn} style={styles.button}><Text>Oturum aç</Text></Pressable>}
    <Text accessibilityRole="header" style={styles.title}>Gözlem ekle</Text>
    <Text>Tarla: {fieldName ?? "Seçili tarla"}</Text>
    {seasonId && <Text>Sezon: {seasonName ?? "Seçili sezon"}</Text>}
    {savedCommands.map((command) => {
      const label = command.state === "UNCONFIRMED" ? "Gözlem sonucu doğrulanamadı"
        : command.state === "NEEDS_ATTENTION" ? "Gözlem için düzeltme gerekiyor"
          : command.state === "ACCEPTED" ? "Gözlem sunucuda kabul edildi"
            : command.retrying ? "Gözlem yeniden gönderiliyor" : "Gözlem gönderilmeyi bekliyor";
      return <View key={command.observationId}>
        <Text accessibilityLabel={label} accessibilityLiveRegion="polite">{label}: {command.description}</Text>
        {command.state === "NEEDS_ATTENTION" && <Pressable accessibilityRole="button"
          accessibilityLabel="Düzeltilmiş yeni gözlem oluştur" onPress={() => {
            setNote(command.description); setLocal(command.occurredAtLocal);
            setError(null);
          }} style={styles.button}><Text>Düzeltilmiş yeni gözlem oluştur</Text></Pressable>}
      </View>;
    })}
    {pending ? <>
      <Text accessibilityRole="text" accessibilityLabel={pendingCommand?.retrying ? "Gözlem yeniden gönderiliyor" : "Gözlem cihazda kaydedildi, gönderilmeyi bekliyor"} accessibilityLiveRegion="polite">{pendingCommand?.retrying ? "Gözlem yeniden gönderiliyor" : "Gözlem cihazda kaydedildi, gönderilmeyi bekliyor"}</Text>
      <Text>{note.trim()}</Text>
    </> : accepted ? <>
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
