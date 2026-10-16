import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import type { ApiClient, ExpenseComponents } from "../../../../../packages/api-client/src/index";
import { ISO_4217_CURRENCY_CODES } from "../../../../../packages/domain/src/finance/iso-4217-codes";
import { validateExpenseAmount } from "../../../../../packages/domain/src/finance/expense-amount";
import { validateLocalDate } from "../../../../../packages/domain/src/seasons/local-date";
import { defaultExpenseClient, readExpenseBusinessTimezone, readExpenseSeasonOptions, submitExpense, type ExpenseRequest } from "./expense-client";

type ExpenseRecord = ExpenseComponents["schemas"]["Expense"];
type Category = ExpenseRequest["category"];
const categories: ReadonlyArray<Readonly<{ code: Category; label: string }>> = [
  { code: "SEED_SEEDLING", label: "Tohum / fide" }, { code: "FERTILIZER", label: "Gübre" },
  { code: "PESTICIDE", label: "İlaç" }, { code: "FUEL", label: "Yakıt" },
  { code: "LABOR", label: "İşçilik" }, { code: "IRRIGATION", label: "Sulama" }, { code: "OTHER", label: "Diğer" },
];
const currencyCodes = [...ISO_4217_CURRENCY_CODES].sort((left, right) => left.localeCompare(right));
const currentTime = () => new Date();
function newExpenseId(): string {
  const randomUUID = globalThis.crypto?.randomUUID;
  if (randomUUID) return randomUUID.call(globalThis.crypto);
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (letter) => {
    const random = Math.floor(Math.random() * 16);
    return (letter === "x" ? random : (random & 0x3) | 0x8).toString(16);
  });
}

export type ExpenseCreateScreenProps = Readonly<{
  client?: ApiClient; fieldId: string; fieldName?: string; seasonId?: string; seasonName?: string;
  onCreated?: (expense: ExpenseRecord) => void; onBack?: () => void;
  now?: () => Date; createId?: () => string;
}>;

function businessToday(now: Date, timezone: string): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function statusOf(error: unknown): number | undefined {
  return error && typeof error === "object" && "status" in error ? Number(error.status) : undefined;
}

export function ExpenseCreateScreen(props: ExpenseCreateScreenProps) {
  const client = useMemo(() => props.client ?? defaultExpenseClient(), [props.client]);
  const now = props.now ?? currentTime;
  const createId = props.createId ?? newExpenseId;
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [timezone, setTimezone] = useState<string | null>(null);
  const [seasonOptions, setSeasonOptions] = useState<ReadonlyArray<Readonly<{ id: string; label: string }>>>([]);
  const [selectedSeasonId, setSelectedSeasonId] = useState(props.seasonId ?? "");
  const [contextError, setContextError] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("");
  const [currencyQuery, setCurrencyQuery] = useState("");
  const [category, setCategory] = useState<Category | "">("");
  const [expenseDate, setExpenseDate] = useState("");
  const [note, setNote] = useState("");
  const [selection, setSelection] = useState<"currency" | "category" | "season" | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState<ExpenseRequest | null>(null);
  const [accepted, setAccepted] = useState<ExpenseRecord | null>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    let active = true;
    setLoading(true); setContextError(null); setTimezone(null); setSeasonOptions([]);
    void Promise.all([readExpenseBusinessTimezone(client, props.fieldId), readExpenseSeasonOptions(client, props.fieldId)]).then(([value, availableSeasons]) => {
      if (!active) return;
      setTimezone(value);
      const options = [...availableSeasons];
      if (props.seasonId && !options.some(({ id }) => id === props.seasonId)) {
        options.push({ id: props.seasonId, label: props.seasonName ?? "Seçili sezon" });
      }
      setSeasonOptions(options);
      setSelectedSeasonId(props.seasonId ?? "");
      setExpenseDate((current) => current || businessToday(now(), value));
    }).catch(() => {
      if (active) setContextError("Tarla bilgileri yüklenemedi. İnternet bağlantınızı kontrol edip yeniden deneyin.");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [client, props.fieldId, props.seasonId, props.seasonName, now, reload]);

  async function send(request: ExpenseRequest) {
    if (inFlight.current) return;
    inFlight.current = true;
    setSaving(true); setError(null);
    try {
      const record = await submitExpense(client, props.fieldId, request);
      setAttempt(null); setAccepted(record); props.onCreated?.(record);
    } catch (failure) {
      const status = statusOf(failure);
      if (status === undefined || status >= 500) {
        setAttempt(request);
        setError("İnternet bağlantınızı kontrol edip aynı kaydı yeniden deneyin.");
      } else {
        setAttempt(null);
        setError(status === 401 || status === 403 || status === 404
          ? "Bu tarlaya erişiminizi kontrol edin." : failure instanceof Error ? failure.message : "Gider kaydedilemedi.");
      }
    } finally { inFlight.current = false; setSaving(false); }
  }

  function save() {
    if (loading || !timezone || saving || attempt || accepted) return;
    try {
      const localAmount = amount.includes(",") && !amount.includes(".") ? amount.replace(",", ".") : amount;
      const exactAmount = validateExpenseAmount(localAmount);
      if (!currency || !ISO_4217_CURRENCY_CODES.has(currency)) throw new Error("Para birimini seçin.");
      if (!category) throw new Error("Gider türünü seçin.");
      const exactDate = validateLocalDate(expenseDate);
      if (exactDate > businessToday(now(), timezone)) throw new Error("Gider tarihi bugünden ileri olamaz.");
      const request: ExpenseRequest = {
        expenseId: createId(), amount: exactAmount, currency, category, expenseDate: exactDate,
        ...(selectedSeasonId ? { seasonId: selectedSeasonId } : {}), ...(note ? { note } : {}),
      };
      void send(request);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Gider bilgilerini kontrol edin."); }
  }

  const disabled = loading || !timezone || saving || !!attempt || !!accepted;
  return <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    <View style={styles.topBar}>
      {props.onBack ? <Pressable accessibilityRole="button" accessibilityLabel="Geri" onPress={props.onBack} style={styles.back}><Text style={styles.backText}>Geri</Text></Pressable> : null}
      <Text accessibilityRole="header" style={styles.title}>Gider ekle</Text>
    </View>
    <Text style={styles.field}>Tarla · {props.fieldName ?? "Seçili tarla"}</Text>

    {loading ? <View accessibilityLiveRegion="polite" style={styles.status}><ActivityIndicator color="#245b35" /><Text style={styles.muted}>Tarla bilgileri yükleniyor…</Text></View> : null}
    {contextError ? <View><Text accessibilityRole="alert" style={styles.error}>{contextError}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Bilgileri yeniden yükle" onPress={() => setReload((value) => value + 1)} style={styles.secondary}>
        <Text style={styles.secondaryText}>Yeniden dene</Text>
      </Pressable></View> : null}

    <View pointerEvents={disabled ? "none" : "auto"}>
      <Text style={styles.label}>Tutar <Text style={styles.required}>· Gerekli</Text></Text>
      <TextInput accessibilityLabel="Tutar" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0,00" style={styles.input} />

      <Text style={styles.label}>Para birimi <Text style={styles.required}>· Gerekli</Text></Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Para birimi" accessibilityState={{ disabled }} onPress={() => { setCurrencyQuery(""); setSelection("currency"); }} style={styles.select}>
        <Text style={currency ? styles.selectValue : styles.placeholder}>{currency || "Seçin"}</Text>
      </Pressable>

      <Text style={styles.label}>Kategori <Text style={styles.required}>· Gerekli</Text></Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Kategori" accessibilityState={{ disabled }} onPress={() => setSelection("category")} style={styles.select}>
        <Text style={category ? styles.selectValue : styles.placeholder}>{categories.find((item) => item.code === category)?.label ?? "Seçin"}</Text>
      </Pressable>

      <Text style={styles.label}>Sezon <Text style={styles.required}>· İsteğe bağlı</Text></Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Sezon" accessibilityState={{ disabled }} onPress={() => setSelection("season")} style={styles.select}>
        <Text style={selectedSeasonId ? styles.selectValue : styles.placeholder}>{seasonOptions.find(({ id }) => id === selectedSeasonId)?.label ?? "Sezon seçin"}</Text>
      </Pressable>

      <Text style={styles.label}>Gider tarihi <Text style={styles.required}>· Gerekli</Text></Text>
      <TextInput accessibilityLabel="Gider tarihi" value={expenseDate} onChangeText={setExpenseDate} keyboardType="numbers-and-punctuation" placeholder="YYYY-AA-GG" style={styles.input} />
      <Text style={styles.hint}>Yıl-ay-gün biçiminde girin. Gelecek tarih seçilemez.</Text>

      <Text style={styles.label}>Not (isteğe bağlı)</Text>
      <TextInput accessibilityLabel="Not (isteğe bağlı)" value={note} onChangeText={setNote} multiline textAlignVertical="top" style={[styles.input, styles.note]} />
    </View>

    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    {saving ? <View accessibilityLabel="Gider kaydediliyor" accessibilityRole="progressbar" accessibilityLiveRegion="polite" style={styles.status}>
      <ActivityIndicator color="#245b35" /><Text style={styles.muted}>Gider kaydediliyor…</Text></View> : null}
    {accepted ? <Text accessibilityLiveRegion="polite" style={styles.success}>Gider kaydedildi</Text> : null}
    {attempt ? <Pressable accessibilityRole="button" accessibilityLabel="Kaydı yeniden dene" disabled={saving} onPress={() => void send(attempt)} style={styles.primary}>
      <Text style={styles.primaryText}>Kaydı yeniden dene</Text></Pressable> : <Pressable accessibilityRole="button" accessibilityLabel="Gideri kaydet"
        accessibilityState={{ disabled, busy: saving }} disabled={disabled} onPress={save} style={[styles.primary, disabled && styles.disabled]}>
        <Text style={styles.primaryText}>Gideri kaydet</Text></Pressable>}

    <Modal transparent visible={selection !== null} animationType="slide" onRequestClose={() => setSelection(null)}>
      <View style={styles.scrim}><View accessibilityViewIsModal style={styles.sheet}>
        <Text accessibilityRole="header" style={styles.sheetTitle}>{selection === "currency" ? "Para birimi seçin" : selection === "category" ? "Gider türü seçin" : "Sezon seçin"}</Text>
        <ScrollView style={styles.options} keyboardShouldPersistTaps="handled">
          {selection === "currency" && <TextInput accessibilityLabel="Para birimi ara" value={currencyQuery} onChangeText={setCurrencyQuery}
            autoCapitalize="characters" autoCorrect={false} placeholder="Kod ara" style={styles.input} />}
          {selection === "currency" && currencyCodes.filter((code) => code.includes(currencyQuery.trim().toUpperCase())).map((code) => <Pressable key={code} accessibilityRole="button" accessibilityLabel={code}
            onPress={() => { setCurrency(code); setCurrencyQuery(""); setSelection(null); }} style={styles.option}><Text style={styles.optionText}>{code}</Text></Pressable>)}
          {selection === "category" && categories.map(({ code, label }) => <Pressable key={code} accessibilityRole="button" accessibilityLabel={label}
            onPress={() => { setCategory(code); setSelection(null); }} style={styles.option}><Text style={styles.optionText}>{label}</Text></Pressable>)}
          {selection === "season" && [{ id: "", label: "Sezon yok" }, ...seasonOptions].map(({ id, label }) => <Pressable key={id || "none"} accessibilityRole="button" accessibilityLabel={label}
            onPress={() => { setSelectedSeasonId(id); setSelection(null); }} style={styles.option}><Text style={styles.optionText}>{label}</Text></Pressable>)}
        </ScrollView>
        <Pressable accessibilityRole="button" accessibilityLabel="Seçimi kapat" onPress={() => setSelection(null)} style={styles.secondary}><Text style={styles.secondaryText}>Kapat</Text></Pressable>
      </View></View>
    </Modal>
  </ScrollView>;
}

const styles = StyleSheet.create({
  content: { padding: 20, paddingBottom: 36, gap: 8, backgroundColor: "#f8f8f3" },
  topBar: { flexDirection: "row", alignItems: "center", minHeight: 52 },
  back: { minWidth: 56, minHeight: 48, justifyContent: "center" }, backText: { color: "#245b35", fontSize: 16 },
  title: { color: "#183b25", fontSize: 24, fontWeight: "700", marginBottom: 4 },
  field: { color: "#183b25", fontSize: 16, fontWeight: "600", marginBottom: 2 },
  season: { color: "#536b5a", fontSize: 14, marginBottom: 8 },
  label: { color: "#183b25", fontSize: 15, fontWeight: "600", marginTop: 12, marginBottom: 6 },
  required: { color: "#536b5a", fontSize: 12, fontWeight: "400" },
  input: { backgroundColor: "#fff", borderColor: "#aab8ad", borderWidth: 1, borderRadius: 8, color: "#183b25", minHeight: 50, paddingHorizontal: 14, fontSize: 16 },
  note: { minHeight: 88, paddingTop: 12 },
  select: { backgroundColor: "#fff", borderColor: "#aab8ad", borderWidth: 1, borderRadius: 8, minHeight: 50, paddingHorizontal: 14, justifyContent: "center" },
  selectValue: { color: "#183b25", fontSize: 16 }, placeholder: { color: "#65756a", fontSize: 16 },
  hint: { color: "#536b5a", fontSize: 13, marginTop: 5 },
  primary: { minHeight: 50, borderRadius: 8, backgroundColor: "#245b35", justifyContent: "center", alignItems: "center", marginTop: 18 },
  disabled: { opacity: 0.55 }, primaryText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  secondary: { minHeight: 48, justifyContent: "center", alignItems: "center", borderRadius: 8 }, secondaryText: { color: "#245b35", fontWeight: "600" },
  muted: { color: "#536b5a", fontSize: 15 }, status: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 10 },
  error: { color: "#9c2828", fontSize: 14, marginTop: 10 }, success: { color: "#245b35", fontSize: 16, fontWeight: "700", marginTop: 14 },
  scrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet: { backgroundColor: "#f8f8f3", borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: "80%", padding: 20 },
  sheetTitle: { color: "#183b25", fontSize: 20, fontWeight: "700", marginBottom: 10 }, options: { maxHeight: 420 },
  option: { minHeight: 48, justifyContent: "center", borderBottomColor: "#d6ded7", borderBottomWidth: StyleSheet.hairlineWidth },
  optionText: { color: "#183b25", fontSize: 16 },
});
