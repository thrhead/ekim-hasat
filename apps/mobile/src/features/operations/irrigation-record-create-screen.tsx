import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput } from "react-native";
import type { ApiClient, IrrigationRecordsComponents } from "../../../../../packages/api-client/src/index";
import {
  defaultIrrigationClient,
  irrigationInstant,
  irrigationLocalTime,
  readIrrigationBusinessTimezone,
  submitIrrigationRecord,
  type IrrigationRecordRequest,
} from "./irrigation-record-client";

export type IrrigationRecord = IrrigationRecordsComponents["schemas"]["IrrigationRecord"];
export type IrrigationRecordCreateScreenProps = Readonly<{
  client?: ApiClient;
  fieldId: string;
  fieldName?: string;
  seasonId?: string;
  onCreated?: (record: IrrigationRecord) => void;
  onBack?: () => void;
  now?: () => Date;
  createId?: () => string;
}>;

const currentTime = () => new Date();
function newIrrigationRecordId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (letter) => {
    const value = Math.floor(Math.random() * 16);
    return (letter === "x" ? value : (value & 0x3) | 0x8).toString(16);
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Kayıt sonucu doğrulanamadı. Bağlantınızı kontrol edip aynı kaydı yeniden deneyin.";
}

function requestStatus(error: unknown): number | undefined {
  return error && typeof error === "object" && "status" in error && typeof error.status === "number" ? error.status : undefined;
}

export function IrrigationRecordCreateScreen(props: IrrigationRecordCreateScreenProps) {
  const { fieldId, fieldName, seasonId, onCreated, onBack, now = currentTime, createId = newIrrigationRecordId } = props;
  const client = useMemo(() => props.client ?? defaultIrrigationClient(), [props.client]);
  const [reload, setReload] = useState(0);
  const [timezone, setTimezone] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [contextError, setContextError] = useState<string | null>(null);
  const [local, setLocal] = useState("");
  const [method, setMethod] = useState("");
  const [duration, setDuration] = useState("");
  const [volume, setVolume] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [attempt, setAttempt] = useState<IrrigationRecordRequest | null>(null);
  const [retryable, setRetryable] = useState(false);
  const [accepted, setAccepted] = useState<IrrigationRecord | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setContextError(null);
    void readIrrigationBusinessTimezone(client, fieldId).then((businessTimezone) => {
      if (!active) return;
      setTimezone(businessTimezone);
      setLocal(irrigationLocalTime(now(), businessTimezone));
    }).catch(() => {
      if (!active) return;
      setTimezone(null);
      setContextError("Tarla bilgileri yüklenemedi. İnternet bağlantınızı kontrol edip yeniden deneyin.");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [client, fieldId, now, reload]);

  async function submit(request: IrrigationRecordRequest) {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const record = await submitIrrigationRecord(client, fieldId, request);
      setAttempt(null);
      setRetryable(false);
      setAccepted(record);
      onCreated?.(record);
    } catch (failure) {
      const status = requestStatus(failure);
      if (status === undefined) {
        setError("İnternet bağlantınızı kontrol edip aynı kaydı yeniden deneyin.");
        setAttempt(request);
        setRetryable(true);
      } else {
        setError(errorMessage(failure));
        setAttempt(null);
        setRetryable(false);
      }
    } finally { setSaving(false); }
  }

  function save() {
    if (!timezone || loading || saving || attempt) return;
    const canonicalMethod = method.trim();
    const canonicalNote = note.trim();
    const parsedDuration = duration.trim() ? Number(duration) : undefined;
    const canonicalVolume = volume.trim();
    if (Array.from(canonicalMethod).length > 120) { setError("Sulama yöntemi en fazla 120 karakter olabilir."); return; }
    if (parsedDuration !== undefined && (!Number.isSafeInteger(parsedDuration) || parsedDuration <= 0)) {
      setError("Süreyi pozitif, tam dakika olarak yazın."); return;
    }
    if (canonicalVolume && !/^(?=.*[1-9])\d{1,11}(?:\.\d)?$/.test(canonicalVolume)) {
      setError("Su miktarını pozitif yazın; en fazla bir ondalık basamak kullanın."); return;
    }
    if (Array.from(canonicalNote).length > 2000) { setError("Not en fazla 2000 karakter olabilir."); return; }
    let occurredAt: string;
    try { occurredAt = irrigationInstant(local, timezone); }
    catch { setError("Başka bir geçerli tarih ve saat seçin."); return; }
    if (Date.parse(occurredAt) > now().getTime()) { setError("Sulama zamanı gelecekte olamaz."); return; }
    const request: IrrigationRecordRequest = {
      irrigationRecordId: createId(), occurredAtLocal: local, occurredAt,
      capturedBusinessTimezone: timezone,
      ...(seasonId ? { seasonId } : {}),
      ...(canonicalMethod ? { method: canonicalMethod } : {}),
      ...(parsedDuration === undefined ? {} : { durationMinutes: parsedDuration }),
      ...(canonicalVolume ? { waterVolumeCubicMetres: canonicalVolume } : {}),
      ...(canonicalNote ? { note: canonicalNote } : {}),
    };
    setAttempt(request);
    void submit(request);
  }

  const disabled = !timezone || loading || saving || attempt !== null;
  return <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
    {onBack && <Pressable accessibilityRole="button" accessibilityLabel="Tarlaya dön" onPress={onBack} style={styles.button}><Text>Tarlaya dön</Text></Pressable>}
    <Text accessibilityRole="header" style={styles.title}>Sulama kaydı</Text>
    <Text>Tarla: {fieldName ?? "Seçili tarla"}</Text>
    <Text>İnternet bağlantısı gerekir. Kayıt sunucudan doğrulanınca tamamlanır.</Text>
    {loading && <Text accessibilityRole="progressbar" accessibilityLabel="Tarla bilgileri yükleniyor" accessibilityLiveRegion="polite">Tarla bilgileri yükleniyor…</Text>}
    {contextError && <>
      <Text accessibilityRole="alert" accessibilityLiveRegion="assertive">{contextError}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Bilgileri yeniden yükle" onPress={() => setReload((value) => value + 1)} style={styles.button}><Text>Yeniden yükle</Text></Pressable>
    </>}
    {accepted ? <>
      <Text accessibilityLabel="Sulama kaydedildi" accessibilityLiveRegion="polite">Sulama kaydedildi</Text>
      <Text>{accepted.method ?? "Sulama"}</Text>
    </> : <>
      <Text>Sulama yöntemi</Text>
      <TextInput accessibilityLabel="Sulama yöntemi" value={method} onChangeText={(value) => { setMethod(value); setError(null); }} editable={!disabled} style={styles.input} />
      <Text>Sulama tarihi ve saati</Text>
      <TextInput accessibilityLabel="Sulama tarihi ve saati" accessibilityHint="Yıl-ay-gün ve saat:dakika" value={local} onChangeText={(value) => { setLocal(value); setError(null); }} editable={!disabled} autoCapitalize="none" placeholder="YYYY-MM-DDTHH:mm" style={styles.input} />
      {timezone && <Text>Saat dilimi: {timezone}</Text>}
      <Text>Süre (dakika)</Text>
      <TextInput accessibilityLabel="Süre (dakika)" value={duration} onChangeText={(value) => { setDuration(value); setError(null); }} editable={!disabled} keyboardType="number-pad" style={styles.input} />
      <Text>Su miktarı (m³)</Text>
      <TextInput accessibilityLabel="Su miktarı (m³)" value={volume} onChangeText={(value) => { setVolume(value); setError(null); }} editable={!disabled} keyboardType="decimal-pad" style={styles.input} />
      <Text>Sulama notu</Text>
      <TextInput accessibilityLabel="Sulama notu" value={note} onChangeText={(value) => { setNote(value); setError(null); }} editable={!disabled} multiline style={[styles.input, styles.note]} />
      {error && <Text accessibilityRole="alert" accessibilityLiveRegion="assertive">{error}</Text>}
      {saving && <Text accessibilityRole="progressbar" accessibilityLabel="Sulama kaydediliyor" accessibilityLiveRegion="polite">Sulama kaydediliyor…</Text>}
      {attempt && retryable && !saving && <Pressable accessibilityRole="button" accessibilityLabel="Kaydı yeniden dene" accessibilityState={{ disabled: saving }} onPress={() => void submit(attempt)} style={styles.button}><Text>Aynı kaydı yeniden dene</Text></Pressable>}
      <Pressable accessibilityRole="button" accessibilityLabel="Sulamayı kaydet" accessibilityState={{ disabled, busy: saving }} disabled={disabled} onPress={save} style={[styles.button, disabled && styles.disabled]}><Text>Sulamayı kaydet</Text></Pressable>
    </>}
  </ScrollView>;
}

const styles = StyleSheet.create({
  container: { padding: 20, gap: 14 }, title: { fontSize: 24, fontWeight: "600" },
  input: { borderWidth: 1, borderColor: "#66736b", borderRadius: 8, padding: 12, fontSize: 16 },
  note: { minHeight: 120, textAlignVertical: "top" },
  button: { minHeight: 48, justifyContent: "center", paddingHorizontal: 16, borderRadius: 8, backgroundColor: "#315c46" },
  disabled: { opacity: 0.5 },
});
