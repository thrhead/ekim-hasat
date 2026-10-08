import { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import type { TaskDateAdjustmentComponents } from "../../../../../packages/api-client/src/index";
import { createTaskDateAdjustmentFlow, TaskDateAdjustmentError } from "./task-date-adjustment";
import { TaskDateAdjustmentHistory } from "./task-date-adjustment-history";

type Current = TaskDateAdjustmentComponents["schemas"]["CurrentTaskAdjustmentState"];
type Page = TaskDateAdjustmentComponents["schemas"]["TaskDateAdjustmentHistoryPage"];
type Flow = ReturnType<typeof createTaskDateAdjustmentFlow>;

export function TaskDateAdjustmentView({ taskId, taskTitle, flow, disabled = false, label = "Ertele / Yeniden planla", openOnMount = false, onAccepted, onClose, onConflict }: Readonly<{
  taskId: string;
  taskTitle?: string;
  flow: Flow;
  disabled?: boolean;
  label?: string;
  openOnMount?: boolean;
  onAccepted: () => void | Promise<void>;
  onClose?: () => void;
  onConflict?: (failure: TaskDateAdjustmentError) => void;
}>) {
  const [visible, setVisible] = useState(false);
  const [state, setState] = useState<Current | null>(null);
  const [page, setPage] = useState<Page | null>(null);
  const [date, setDate] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);

  useEffect(() => { if (openOnMount) void open(); }, [openOnMount]);

  async function open() {
    setVisible(true); setLoading(true); setError(null); setHistoryError(null);
    try {
      const latest = await flow.read(taskId);
      setPage(latest); setState(latest.task); setDate(latest.task.plannedLocalDate);
    } catch (failure) {
      setHistoryError(failure instanceof Error ? failure.message : "Görev bilgisi yüklenemedi.");
    } finally { setLoading(false); }
  }

  async function reload() {
    setLoading(true); setHistoryError(null);
    try {
      const latest = await flow.read(taskId);
      setPage(latest); setState(latest.task); setDate(latest.task.plannedLocalDate);
    } catch (failure) { setHistoryError(failure instanceof Error ? failure.message : "Görev bilgisi yüklenemedi."); }
    finally { setLoading(false); }
  }

  async function loadMore() {
    const cursor = page?.nextCursor;
    if (!cursor || loadingMore) return;
    setLoadingMore(true); setHistoryError(null);
    try {
      const next = await flow.read(taskId, cursor);
      setPage((current) => current ? { ...next, items: [...current.items, ...next.items] } : next);
    } catch (failure) {
      setHistoryError(failure instanceof Error ? failure.message : "Geçmişin devamı yüklenemedi.");
    } finally { setLoadingMore(false); }
  }

  async function save() {
    if (!state || saving || date === state.plannedLocalDate) return;
    setSaving(true); setError(null);
    try {
      await flow.submit(taskId, state, date);
      await onAccepted();
      setVisible(false);
    } catch (failure) {
      if (failure instanceof TaskDateAdjustmentError && failure.current) {
        setPage(failure.current); setState(failure.current.task); setDate(failure.current.task.plannedLocalDate);
      }
      if (failure instanceof TaskDateAdjustmentError && failure.code === "TASK_VERSION_CONFLICT") onConflict?.(failure);
      setError(failure instanceof Error ? failure.message : "Tarih değişikliği kaydedilemedi.");
    } finally { setSaving(false); }
  }

  return <>
    {!disabled && !openOnMount && <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={() => void open()} style={styles.open}>
      <Text style={styles.openText}>{label}</Text>
    </Pressable>}
    <Modal visible={visible} transparent animationType="slide" onRequestClose={() => { setVisible(false); onClose?.(); }}>
      <View style={styles.backdrop}><ScrollView accessibilityViewIsModal style={styles.sheet} contentContainerStyle={styles.content}>
        <View style={styles.heading}>
          <Text accessibilityRole="header" style={styles.title}>Görevi ertele / yeniden planla</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Tarih değişikliğini kapat" onPress={() => { setVisible(false); onClose?.(); }} style={styles.close}><Text>Kapat</Text></Pressable>
        </View>
        {taskTitle && <Text style={styles.taskTitle}>{taskTitle}</Text>}
        {loading && <Text accessibilityRole="progressbar" accessibilityLiveRegion="polite">Görev bilgisi yükleniyor…</Text>}
        {historyError && <Text accessibilityRole="alert">{historyError}</Text>}
        {state && <>
          {!state.adjustable && <Text accessibilityLiveRegion="polite">Bu görev için tarih değişikliği yapılamıyor.</Text>}
          {state.adjustable && <>
            <Text accessibilityLabel={`Mevcut planlanan tarih: ${formatDate(state.plannedLocalDate)}`} style={styles.label}>Mevcut planlanan tarih: {formatDate(state.plannedLocalDate)}</Text>
            <Text style={styles.label}>Yeni planlanan tarih</Text>
            <TextInput accessibilityLabel="Yeni planlanan tarih" value={date} onChangeText={setDate} placeholder="YYYY-AA-GG" keyboardType="numbers-and-punctuation" style={styles.input} />
            {error && <Text accessibilityRole="alert" accessibilityLiveRegion="assertive">{error}</Text>}
            <Pressable accessibilityRole="button" accessibilityLabel="Tarih değişikliğini kaydet"
              accessibilityState={{ disabled: saving || date === state.plannedLocalDate, busy: saving }}
              disabled={saving || date === state.plannedLocalDate} onPress={() => void save()} style={styles.save}>
              <Text>{saving ? "Kaydediliyor…" : "Tarihi kaydet"}</Text>
            </Pressable>
          </>}
        </>}
        <Text accessibilityRole="header" style={styles.historyTitle}>Tarih değişikliği geçmişi</Text>
        <TaskDateAdjustmentHistory state={loading ? "loading" : historyError ? "error" : "ready"} page={page ?? undefined} error={historyError ?? undefined}
          loadingMore={loadingMore} onRetry={() => void reload()} onLoadMore={() => void loadMore()} />
      </ScrollView></View>
    </Modal>
  </>;
}

const styles = StyleSheet.create({
  open: { alignItems: "flex-start", borderColor: "#52616b", borderRadius: 8, borderWidth: 1, justifyContent: "center", minHeight: 48, paddingHorizontal: 14 },
  openText: { color: "#142b1f", fontSize: 16 },
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.35)" },
  sheet: { maxHeight: "90%", backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  content: { paddingHorizontal: 22, paddingTop: 22, paddingBottom: 36, gap: 12 },
  heading: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  close: { minHeight: 48, justifyContent: "center", paddingHorizontal: 10 },
  title: { flex: 1, color: "#17261c", fontSize: 23, fontWeight: "700" },
  taskTitle: { color: "#526057", fontSize: 17, lineHeight: 24, fontWeight: "600" },
  label: { color: "#263a30", fontSize: 15 },
  input: { borderColor: "#52616b", borderRadius: 8, borderWidth: 1, minHeight: 48, paddingHorizontal: 12, fontSize: 17 },
  save: { borderRadius: 8, backgroundColor: "#d5eadb", justifyContent: "center", minHeight: 50, paddingHorizontal: 14 },
  historyTitle: { color: "#17261c", fontSize: 18, fontWeight: "600", marginTop: 10 },
});

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${value}T00:00:00.000Z`));
}
