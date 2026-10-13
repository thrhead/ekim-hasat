import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { TaskSkipCommand, TaskSkipFailure, TaskSkipFlow, TaskSkipResult } from "./task-skip";

type Task = Readonly<{ id: string; title: string; plannedLocalDate: string; taskVersion?: number }>;
export function TaskSkipView({ task, flow, disabled = false, onAccepted, onConflict, businessTimezone }: Readonly<{ task: Task; flow: TaskSkipFlow; disabled?: boolean; onAccepted: (result: TaskSkipResult) => void | Promise<void>; onConflict?: (failure: TaskSkipFailure) => void | Promise<void>; businessTimezone?: string }>) {
  const [visible, setVisible] = useState(false);
  const [command, setCommand] = useState<TaskSkipCommand | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<TaskSkipFailure | null>(null);
  const [accepted, setAccepted] = useState<TaskSkipResult | null>(null);
  const [reduceMotion, setReduceMotion] = useState(false);
  const submitting = useRef(false);
  useEffect(() => { setVisible(false); setCommand(null); setLoading(false); setError(null); setAccepted(null); }, [task.id, task.taskVersion]);
  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => { if (mounted) setReduceMotion(enabled); });
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => { mounted = false; subscription.remove(); };
  }, []);

  async function submit() {
    if (submitting.current || !task.taskVersion) return;
    submitting.current = true;
    const current = command ?? flow.createCommand(task.id, task.taskVersion);
    setCommand(current); setLoading(true); setError(null);
    try {
      const result = await flow.submit(current);
      setAccepted(result);
      try { await onAccepted(result); } catch { /* Canonical acceptance remains visible; callers refresh their own projection. */ }
    } catch (failure) {
      const skipFailure = failure as TaskSkipFailure;
      setError(skipFailure);
      if (["CONFLICT", "INELIGIBLE", "ACCESS"].includes(skipFailure.kind)) await onConflict?.(skipFailure);
    }
    finally { submitting.current = false; setLoading(false); }
  }

  return <>
    {!disabled && <Pressable accessibilityRole="button" accessibilityLabel={`Görevi atla: ${task.title}`} accessibilityState={{ disabled: !task.taskVersion }} disabled={!task.taskVersion}
      onPress={() => { setVisible(true); setCommand(null); setError(null); setAccepted(null); }} style={styles.button}><Text style={styles.buttonText}>Görevi atla</Text></Pressable>}
    <Modal visible={visible} transparent animationType={reduceMotion ? "none" : "slide"} onRequestClose={() => { if (!loading) setVisible(false); }}>
      <View style={styles.backdrop}><ScrollView accessibilityViewIsModal style={styles.sheet} contentContainerStyle={styles.content}>
        <Text accessibilityRole="header" accessibilityLiveRegion={accepted ? "polite" : undefined} style={styles.title}>{accepted ? "Görev atlandı" : "Görevi atla"}</Text>
        <Text style={styles.body}>{task.title}</Text>
        <Text style={styles.body}>Planlanan gün: {formatDate(task.plannedLocalDate)}</Text>
        {!accepted && <Text style={styles.warning}>Bu görev atlandı olarak kaydedilecek ve geri alınamayacak. Onaylıyor musunuz?</Text>}
        {loading && <Text accessibilityRole="progressbar" accessibilityLabel="Görev atlanıyor" accessibilityLiveRegion="polite">Görev atlanıyor…</Text>}
        {error && <View accessibilityLiveRegion="assertive"><Text accessibilityRole="alert" style={styles.error}>{error.message}</Text>
          {error.kind === "UNCERTAIN" && <Text style={styles.body}>Güvenli biçimde yeniden denemek için aynı açık isteği kullanacağız.</Text>}</View>}
        {accepted && <Text accessibilityLiveRegion="polite" style={styles.body}>Atlanma zamanı: {new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short", timeZone: businessTimezone ?? "UTC" }).format(new Date(accepted.skippedAt))}{businessTimezone ? "" : " · UTC"}</Text>}
        {!accepted && <Pressable accessibilityRole="button" accessibilityLabel={error?.kind === "UNCERTAIN" ? "Aynı atlamayı tekrar dene" : "Atlamayı onayla"}
          accessibilityState={{ disabled: loading, busy: loading }} disabled={loading} onPress={() => void submit()} style={[styles.button, styles.confirm]}><Text style={[styles.buttonText, styles.confirmText]}>{loading ? "Kaydediliyor…" : error?.kind === "UNCERTAIN" ? "Aynı isteği tekrar dene" : "Atlamayı onayla"}</Text></Pressable>}
        <Pressable accessibilityRole="button" accessibilityLabel="Atlama penceresini kapat" accessibilityState={{ disabled: loading }} disabled={loading}
          onPress={() => setVisible(false)} style={[styles.button, styles.close]}><Text style={[styles.buttonText, styles.closeText]}>Kapat</Text></Pressable>
      </ScrollView></View>
    </Modal>
  </>;
}
function formatDate(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year!, month! - 1, day!, 12)));
}
const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.35)" },
  sheet: { maxHeight: "90%", backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  content: { padding: 22, gap: 14, paddingBottom: 36 },
  title: { color: "#142b1f", fontSize: 23, fontWeight: "700" },
  body: { color: "#263a30", fontSize: 17, lineHeight: 25 },
  warning: { color: "#663e08", fontSize: 17, lineHeight: 25, backgroundColor: "#fff4d6", padding: 12, borderRadius: 8 },
  error: { color: "#8b1d1d", fontSize: 16, lineHeight: 24 },
  button: { alignItems: "flex-start", borderColor: "#52616b", borderRadius: 8, borderWidth: 1, justifyContent: "center", minHeight: 48, paddingHorizontal: 14 },
  buttonText: { color: "#142b1f", fontSize: 17 },
  confirm: { backgroundColor: "#285c3d", borderColor: "#285c3d" },
  confirmText: { color: "#ffffff", fontWeight: "600" },
  close: { borderColor: "transparent", paddingHorizontal: 0 },
  closeText: { color: "#285c3d" },
});
