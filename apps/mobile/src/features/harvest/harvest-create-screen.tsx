import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import type { ApiClient, HarvestComponents } from "../../../../../packages/api-client/src/index";
import { validateLocalDate } from "../../../../../packages/domain/src/seasons/local-date";
import { readFieldDiary } from "../observations/diary-client";
import { submitHarvest, type HarvestCreateRequest, type HarvestRecord } from "./harvest-client";

type HarvestUnit = HarvestComponents["schemas"]["CreateHarvestRequest"]["unit"];
const currentTime = () => new Date();

function newHarvestId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (letter) => {
    const value = Math.floor(Math.random() * 16);
    return (letter === "x" ? value : (value & 0x3) | 0x8).toString(16);
  });
}

function businessToday(now: Date, timezone: string): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export type HarvestCreateScreenProps = Readonly<{
  client: ApiClient;
  fieldId: string;
  fieldName?: string;
  seasonId: string;
  seasonName?: string;
  onCreated?: (harvest: HarvestRecord) => void;
  onBack?: () => void;
  now?: () => Date;
  createId?: () => string;
}>;

export function HarvestCreateScreen(props: HarvestCreateScreenProps) {
  const { client, fieldId, fieldName, seasonId, seasonName, onCreated, onBack } = props;
  const now = props.now ?? currentTime;
  const createId = props.createId ?? newHarvestId;
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [timezone, setTimezone] = useState<string | null>(null);
  const [contextError, setContextError] = useState<string | null>(null);
  const [harvestDate, setHarvestDate] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState<HarvestUnit>("KG");
  const [showUnits, setShowUnits] = useState(false);
  const [attempt, setAttempt] = useState<HarvestCreateRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setContextError(null);
    void readFieldDiary(client, fieldId, { seasonId }).then((page) => {
      if (!active) return;
      setTimezone(page.businessTimezone);
      setHarvestDate((current) => current || businessToday(now(), page.businessTimezone));
    }).catch(() => {
      if (active) {
        setTimezone(null);
        setContextError("Tarla ve sezon bilgileri yüklenemedi. İnternet bağlantınızı kontrol edip yeniden deneyin.");
      }
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [client, fieldId, seasonId, now, reload]);

  async function send(request: HarvestCreateRequest) {
    if (inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    setError(null);
    try {
      const record = await submitHarvest(client, fieldId, request);
      setAttempt(null);
      onCreated?.(record);
    } catch (failure) {
      const status = failure && typeof failure === "object" && "status" in failure
        ? Number((failure as { status?: unknown }).status) : undefined;
      const uncertain = status === undefined || status >= 500;
      if (uncertain) setAttempt(request);
      else setAttempt(null);
      setError(failure instanceof Error ? failure.message
        : "Kayıt sonucu doğrulanamadı. Bağlantınızı kontrol edip aynı kaydı yeniden deneyin.");
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  function save() {
    if (loading || !timezone || saving || attempt) return;
    let exactDate: string;
    try {
      exactDate = validateLocalDate(harvestDate);
      if (exactDate > businessToday(now(), timezone)) throw new Error("Hasat tarihi bugünden ileri olamaz.");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Geçerli bir hasat tarihi girin (YYYY-MM-DD).");
      return;
    }
    if (!/^(?=.*[1-9])(?:0|[1-9][0-9]{0,10})(?:\.[0-9]{1,3})?$/.test(quantity)) {
      setError("Miktarı pozitif yazın; en fazla 11 tam ve 3 ondalık basamak kullanın.");
      return;
    }
    const request: HarvestCreateRequest = { harvestId: createId(), seasonId, harvestDate: exactDate, quantity, unit };
    setAttempt(request);
    void send(request);
  }

  const disabled = loading || !timezone || saving || attempt !== null;
  return <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    <View style={styles.topBar}>
      {onBack && <Pressable accessibilityRole="button" accessibilityLabel="Geri" onPress={onBack} style={styles.back}><Text>Geri</Text></Pressable>}
      <Text accessibilityRole="header" style={styles.title}>Hasat kaydı</Text>
    </View>
    <Text>Tarla · {fieldName ?? "Seçili tarla"}</Text>
    <Text>Sezon · {seasonName ?? "Seçili sezon"}</Text>
    <Text style={styles.muted}>İnternet bağlantısı gerekir. Hasat, sunucu onayından sonra kaydedilir.</Text>

    {loading && <View accessibilityLiveRegion="polite" style={styles.status}><ActivityIndicator color="#245b35" /><Text style={styles.muted}>Tarla ve sezon bilgileri yükleniyor…</Text></View>}
    {contextError && <>
      <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" style={styles.error}>{contextError}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Bilgileri yeniden yükle" onPress={() => setReload((value) => value + 1)} style={styles.button}><Text>Yeniden dene</Text></Pressable>
    </>}
    <Text style={styles.label}>Hasat tarihi · Gerekli</Text>
    <TextInput accessibilityLabel="Hasat tarihi" value={harvestDate} onChangeText={(value) => { setHarvestDate(value); setError(null); }} editable={!disabled} keyboardType="numbers-and-punctuation" placeholder="YYYY-AA-GG" style={styles.input} />
    <Text style={styles.hint}>Yıl-ay-gün biçiminde girin. Bugünden ileri tarih seçilemez.</Text>
    <Text style={styles.label}>Miktar · Gerekli</Text>
    <TextInput accessibilityLabel="Miktar" value={quantity} onChangeText={(value) => { setQuantity(value); setError(null); }} editable={!disabled} keyboardType="decimal-pad" placeholder="0" style={styles.input} />
    <Text style={styles.hint}>Ondalık miktarı aynen kaydederiz; en fazla 3 ondalık basamak girin.</Text>
    <Text style={styles.label}>Birim · Gerekli</Text>
    <Pressable accessibilityRole="button" accessibilityLabel="Birim" accessibilityState={{ disabled }} disabled={disabled} onPress={() => setShowUnits((value) => !value)} style={styles.button}>
      <Text>{unit === "KG" ? "Kilogram (kg)" : "Ton (t)"}</Text>
    </Pressable>
    {showUnits && <View style={styles.unitOptions}>
      <Pressable accessibilityRole="button" accessibilityLabel="KG" onPress={() => { setUnit("KG"); setShowUnits(false); }} style={styles.button}><Text>Kilogram (kg)</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Ton" onPress={() => { setUnit("METRIC_TONNE"); setShowUnits(false); }} style={styles.button}><Text>Ton (t)</Text></Pressable>
    </View>}
    {error && <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" style={styles.error}>{error}</Text>}
    {saving && <Text accessibilityRole="progressbar" accessibilityLabel="Hasat kaydediliyor" accessibilityLiveRegion="polite">Hasat kaydediliyor…</Text>}
    {attempt && !saving && <Pressable accessibilityRole="button" accessibilityLabel="Kaydı yeniden dene" accessibilityState={{ disabled: saving }} onPress={() => void send(attempt)} style={styles.button}><Text>Aynı kaydı yeniden dene</Text></Pressable>}
    <Pressable accessibilityRole="button" accessibilityLabel="Hasadı kaydet" accessibilityState={{ disabled, busy: saving }} disabled={disabled} onPress={save} style={[styles.button, disabled && styles.disabled]}><Text>Hasadı kaydet</Text></Pressable>
  </ScrollView>;
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, padding: 20, paddingBottom: 32, gap: 14 },
  topBar: { flexDirection: "row", alignItems: "center", gap: 12 },
  back: { minHeight: 48, minWidth: 48, justifyContent: "center" },
  title: { fontSize: 24, fontWeight: "600", color: "#142b1f" },
  muted: { color: "#52645a" }, label: { fontWeight: "600" },
  input: { minHeight: 48, borderWidth: 1, borderColor: "#66736b", borderRadius: 8, padding: 12, fontSize: 16 },
  hint: { color: "#52645a" }, error: { color: "#9d2d24" },
  status: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 10 },
  button: { minHeight: 48, justifyContent: "center", paddingHorizontal: 16, borderWidth: 1, borderColor: "#52616b", borderRadius: 8 },
  disabled: { opacity: 0.5 }, unitOptions: { gap: 8 },
});
