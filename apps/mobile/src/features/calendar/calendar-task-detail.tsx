import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useMemo } from "react";
import type { ApiClient, CalendarComponents } from "../../../../../packages/api-client/src/index";
import { createTaskDateAdjustmentFlow } from "../tasks/task-date-adjustment";
import { TaskDateAdjustmentView } from "../tasks/task-date-adjustment-view";

type Task = CalendarComponents["schemas"]["CalendarTask"];

export function CalendarTaskDetail({ task, onClose, saved = false, client, onAccepted }: Readonly<{ task: Task; onClose: () => void; saved?: boolean; client: ApiClient; onAccepted: () => void | Promise<void> }>) {
  const adjustmentFlow = useMemo(() => createTaskDateAdjustmentFlow({ client }), [client]);
  const season = parseContext(task.seasonContext);
  const plan = parseContext(task.planContext);
  const crop = stringAt(season, ["crop", "displayName"]) ?? stringAt(season, ["cropSnapshot", "displayName"]);
  const region = stringAt(season, ["region", "agriculturalRegion", "label"])
    ?? stringAt(season, ["regionContext", "agriculturalRegion", "label"]);
  const planSource = stringAt(plan, ["source"]);
  return <Modal visible transparent animationType="slide" onRequestClose={onClose}>
    <View style={styles.backdrop}>
      <ScrollView accessibilityViewIsModal style={styles.sheet} contentContainerStyle={styles.content}>
        <View style={styles.heading}>
          <Text accessibilityRole="header" style={styles.title}>{task.title}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Görev ayrıntılarını kapat" onPress={onClose} style={styles.close}>
            <Text style={styles.closeText}>Kapat</Text>
          </Pressable>
        </View>
        {saved && <Text accessibilityRole="text" style={styles.saved}>Kaydedilmiş takvim bilgisi · Güncel olmayabilir</Text>}
        {saved && <Text accessibilityRole="text" style={styles.saved}>Çevrimdışıyken tarih değiştirilemez.</Text>}
        {task.overdue && <Text accessibilityRole="text" style={styles.overdue}>Gecikmiş</Text>}
        <DetailLine label="Planlanan tarih" value={formatCalendarDate(task.plannedLocalDate)} />
        <DetailLine label="Tarla" value={task.fieldName} />
        <DetailLine label="Ürün" value={crop ?? "Ürün bilgisi mevcut değil"} />
        <DetailLine label="Bölge" value={region ?? "Bölge bilgisi mevcut değil"} />
        <DetailLine label="Plan" value={planSource === "MANUAL" ? "Manuel plan" : planSource === "VALIDATED_TEMPLATE" ? "Onaylı şablon planı" : "Plan bilgisi mevcut değil"} />
        <Text style={styles.context}>Bu görev takvimdeki planlanan tarihine göre gösterilir.</Text>
        <TaskDateAdjustmentView taskId={task.taskId} taskTitle={task.title} flow={adjustmentFlow} disabled={saved}
          label="Ertele veya yeniden planla" onAccepted={onAccepted} />
      </ScrollView>
    </View>
  </Modal>;
}

function DetailLine({ label, value }: { label: string; value: string }) {
  return <View style={styles.line}><Text style={styles.label}>{label}</Text><Text accessibilityRole="text" style={styles.value}>{value}</Text></View>;
}
function parseContext(value: string | undefined): unknown {
  if (!value) return null;
  try { return JSON.parse(value) as unknown; } catch { return null; }
}
function stringAt(value: unknown, path: string[]): string | null {
  let current = value;
  for (const key of path) {
    if (typeof current !== "object" || current === null) return null;
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === "string" && current.trim() ? current : null;
}
function formatCalendarDate(value: string): string {
  return new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00.000Z`));
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.35)" },
  sheet: { maxHeight: "90%", backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  content: { paddingHorizontal: 22, paddingTop: 22, paddingBottom: 36 },
  heading: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 },
  title: { flex: 1, color: "#17261c", fontSize: 23, fontWeight: "700", lineHeight: 30 },
  close: { minHeight: 48, justifyContent: "center", paddingHorizontal: 10 },
  closeText: { color: "#285c3d", fontSize: 15, fontWeight: "600" },
  saved: { color: "#526057", fontSize: 14, marginTop: 12 },
  overdue: { alignSelf: "flex-start", color: "#8b321e", fontWeight: "700", marginTop: 12 },
  line: { paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#b7beb8" },
  label: { color: "#526057", fontSize: 14 },
  value: { color: "#17261c", fontSize: 17, marginTop: 4 },
  context: { color: "#526057", fontSize: 14, lineHeight: 21, marginTop: 18 },
});
