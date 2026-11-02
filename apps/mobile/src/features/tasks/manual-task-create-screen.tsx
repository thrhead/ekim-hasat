import { useEffect, useRef, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { validateManualActiveTask } from "../../../../../packages/domain/src/seasons/plan-task-mutations";
import type { ManualTaskCommand, ManualTaskContext, ManualTaskStore } from "./manual-task-store";

function createTaskId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, char => { const n = Math.floor(Math.random() * 16); return (char === "x" ? n : (n & 3) | 8).toString(16); });
}
function rejectionMessage(code?: string): string {
  if (code === "SEASON_INELIGIBLE") return "Sezon artık görev eklemeye uygun değil.";
  if (code === "ACCESS_DENIED" || code === "RESOURCE_UNAVAILABLE") return "Bu sezona erişiminiz doğrulanamadı.";
  if (code === "IDENTITY_CONFLICT") return "Bu görev kaydı başka bilgilerle kullanılmış. Düzelterek yeni bir görev oluşturun.";
  return "Görev eklenemedi. Bilgileri kontrol edin.";
}
export function ManualTaskCreateScreen({ accountId, fieldId, seasonId, store, onBack, onPending, onSignIn, createId = createTaskId }: {
  accountId: string; fieldId: string; seasonId: string; store: ManualTaskStore; onBack?: () => void; onPending?: () => void; onSignIn?: () => void; createId?: () => string;
}) {
  const [context, setContext] = useState<ManualTaskContext | null>(null), [commands, setCommands] = useState<ManualTaskCommand[]>([]);
  const [contextLoading, setContextLoading] = useState(true), [contextError, setContextError] = useState(false), [contextRetry, setContextRetry] = useState(0);
  const [title, setTitle] = useState(""), [date, setDate] = useState(""), [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null), [saving, setSaving] = useState(false);
  const [fieldError, setFieldError] = useState<{ field: "title" | "date" | "description"; message: string } | null>(null);
  const busy = useRef(false);
  useEffect(() => {
    let mounted = true;
    setContextLoading(true);
    const refresh = () => { void Promise.all([store.getContext(accountId, fieldId, seasonId), store.list(accountId)]).then(([saved, list]) => {
      if (mounted) { setContext(saved); setCommands(list.filter(c => c.fieldId === fieldId && c.seasonId === seasonId)); setContextLoading(false); setContextError(false); }
    }).catch(() => { if (mounted) { setContextLoading(false); setContextError(true); } }); };
    refresh(); const unsubscribe = store.subscribe(refresh); return () => { mounted = false; unsubscribe(); };
  }, [accountId, fieldId, seasonId, store, contextRetry]);
  async function save() {
    if (!context || busy.current) return;
    setError(null); setFieldError(null);
    try { validateManualActiveTask({ title, description: description || null, plannedLocalDate: date }, context.actualPlantingDate); }
    catch (failure) {
      const code = (failure as { code?: string }).code;
      const field = code === "INVALID_TASK_TITLE" ? "title" : code === "INVALID_TASK_DESCRIPTION" ? "description" : "date";
      setFieldError({ field, message: code === "PLANNED_DATE_BEFORE_PLANTING" ? "Görev tarihi ekim tarihinden önce olamaz." : code === "INVALID_TASK_TITLE" ? "Görev adını girin (en fazla 200 karakter)." : code === "INVALID_TASK_DESCRIPTION" ? "Açıklama en fazla 2000 karakter olabilir." : "Geçerli bir görev tarihi girin (YYYY-AA-GG)." }); return;
    }
    busy.current = true; setSaving(true);
    try { await store.enqueue(accountId, { accountId, fieldId, seasonId, taskId: createId(), mutationId: createId(), title, description: description || null, plannedLocalDate: date }); setTitle(""); setDescription(""); setDate(""); onPending?.(); }
    catch { setError("Görev cihazda kaydedilemedi. Yeniden deneyin."); }
    finally { busy.current = false; setSaving(false); }
  }
  const remove = (command: ManualTaskCommand) => Alert.alert("Kaydı cihazdan kaldır", "Yalnızca reddedilen yerel kayıt kaldırılır.", [
    { text: "Vazgeç", style: "cancel" }, { text: "Kaldır", style: "destructive", onPress: () => { void store.removeRejected(accountId, command.taskId).catch(() => setError("Kayıt kaldırılamadı. Yeniden deneyin.")); } },
  ]);
  return <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    {onBack && <Pressable accessibilityRole="button" accessibilityLabel="Geri dön" onPress={onBack} style={styles.button}><Text>Geri dön</Text></Pressable>}
    {onSignIn && <Pressable accessibilityRole="button" accessibilityLabel="Oturum aç" onPress={onSignIn} style={styles.button}><Text>Oturum aç</Text></Pressable>}
    <Text accessibilityRole="header" style={styles.heading}>Görev ekle</Text><Text>Tarla: {context?.fieldName ?? commands.find(command => command.fieldName)?.fieldName ?? "Seçili tarla"}</Text><Text>Sezon: {context?.seasonName ?? commands.find(command => command.seasonName)?.seasonName ?? "Seçili sezon"}</Text>
    {contextLoading && <Text accessibilityRole="progressbar" accessibilityLiveRegion="polite">Görev bilgileri yükleniyor…</Text>}
    {!contextLoading && contextError && <><Text accessibilityRole="alert" accessibilityLiveRegion="assertive">Görev bilgileri yüklenemedi. Yeniden deneyin.</Text><Pressable accessibilityRole="button" accessibilityLabel="Görev bilgilerini yeniden yükle" onPress={() => { setContextError(false); setContextRetry(value => value + 1); }} style={styles.button}><Text>Yeniden dene</Text></Pressable></>}
    {!contextLoading && !context && !contextError && <Text accessibilityRole="alert">Bu sezonun görev bilgileri kullanılamıyor.</Text>}
    <Text>Görev adı</Text><TextInput accessibilityLabel="Görev adı" value={title} onChangeText={value => { setTitle(value); if (fieldError?.field === "title") setFieldError(null); }} maxLength={200} style={styles.input} />
    {fieldError?.field === "title" && <Text accessibilityRole="alert" accessibilityLabel={`Görev adı hatası: ${fieldError.message}`} accessibilityLiveRegion="assertive">{fieldError.message}</Text>}
    <Text>Görev tarihi (YYYY-AA-GG)</Text><TextInput accessibilityLabel="Görev tarihi" value={date} onChangeText={value => { setDate(value); if (fieldError?.field === "date") setFieldError(null); }} style={styles.input} />
    {fieldError?.field === "date" && <Text accessibilityRole="alert" accessibilityLabel={`Görev tarihi hatası: ${fieldError.message}`} accessibilityLiveRegion="assertive">{fieldError.message}</Text>}
    <Text>Açıklama (isteğe bağlı)</Text><TextInput accessibilityLabel="Açıklama" value={description} onChangeText={value => { setDescription(value); if (fieldError?.field === "description") setFieldError(null); }} multiline maxLength={2000} style={styles.input} />
    {fieldError?.field === "description" && <Text accessibilityRole="alert" accessibilityLabel={`Açıklama hatası: ${fieldError.message}`} accessibilityLiveRegion="assertive">{fieldError.message}</Text>}
    {error && <Text accessibilityRole="alert" accessibilityLiveRegion="assertive">{error}</Text>}
    <Pressable accessibilityRole="button" accessibilityLabel="Görevi kaydet" disabled={!context || saving} accessibilityState={{ disabled: !context || saving, busy: saving }} onPress={() => void save()} style={styles.button}><Text>Görevi kaydet</Text></Pressable>
    {commands.map(command => <View key={command.taskId} style={styles.row}>
      <Text accessibilityRole="header">{command.title}</Text><Text>{command.plannedLocalDate}</Text>
      <Text accessibilityLiveRegion="polite">{command.state === "ACCEPTED" ? "Görev eklendi" : command.state === "REJECTED" ? rejectionMessage(command.failureCode) : command.state === "UNCONFIRMED" || command.state === "SENDING" ? "Gönderim sonucu henüz doğrulanamadı" : "Cihazda kaydedildi, gönderilmeyi bekliyor"}</Text>
      {command.state === "UNCONFIRMED" && <Pressable accessibilityRole="button" accessibilityLabel="Gönderim sonucunu yeniden dene" onPress={onPending} style={styles.button}><Text>Yeniden dene</Text></Pressable>}
      {command.state === "REJECTED" && <>
        <Pressable accessibilityRole="button" accessibilityLabel="Reddedilen görevi yeniden dene" onPress={() => { void store.retryRejected(accountId, command.taskId).then(() => onPending?.()).catch(() => setError("Görev yeniden denenemedi.")); }} style={styles.button}><Text>Yeniden dene</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Düzelterek yeni görev oluştur" onPress={() => { setTitle(command.title); setDate(command.plannedLocalDate); setDescription(command.description ?? ""); }} style={styles.button}><Text>Düzelterek yeni görev oluştur</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Reddedilen kaydı cihazdan kaldır" onPress={() => remove(command)} style={styles.button}><Text>Reddedilen kaydı cihazdan kaldır</Text></Pressable>
      </>}
    </View>)}
  </ScrollView>;
}
const styles = StyleSheet.create({ content: { flexGrow: 1, padding: 20, gap: 12 }, heading: { fontSize: 26, fontWeight: "700", color: "#142b1f" }, input: { minHeight: 48, padding: 12, borderWidth: 1, borderColor: "#52616b", borderRadius: 8 }, button: { minHeight: 48, padding: 14, borderWidth: 1, borderColor: "#52616b", borderRadius: 8, justifyContent: "center" }, row: { padding: 12, gap: 8, borderWidth: 1, borderColor: "#b8c5bd", borderRadius: 8 } });
