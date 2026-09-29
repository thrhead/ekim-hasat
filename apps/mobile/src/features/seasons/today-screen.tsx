import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { ApiClient, SeasonOperations } from "../../api/onboarding-client";
import { readTodayPlannedWork } from "./season-activation";

type Today = SeasonOperations["getTodayPlannedTasks"]["responses"][200]["content"]["application/json"];

export function TodayScreen({ client, onBack }: { client: ApiClient; onBack?: () => void }) {
  const [data, setData] = useState<Today | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setData(await readTodayPlannedWork(client)); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Bugünün işleri yüklenemedi."); }
    finally { setLoading(false); }
  }, [client]);
  useEffect(() => { void load(); }, [load]);
  return <TodayContent loading={loading} error={error} data={data} onRetry={() => void load()} onBack={onBack} />;
}

export function TodayContent({ loading, error, data, onRetry, onBack }: {
  loading: boolean;
  error: string | null;
  data: Today | null;
  onRetry: () => void;
  onBack?: () => void;
}) {
  return <ScrollView contentContainerStyle={styles.content}>
    {onBack ? <Pressable accessibilityRole="button" accessibilityLabel="Sezon planına dön" onPress={onBack} style={styles.button}><Text style={styles.buttonText}>Sezon planına dön</Text></Pressable> : null}
    <Text accessibilityRole="header" style={styles.title}>Bugün</Text>
    {loading ? <Text accessibilityRole="progressbar" accessibilityLabel="Bugünün işleri yükleniyor" style={styles.body}>Bugünün işleri yükleniyor…</Text> : null}
    {!loading && error ? <View accessibilityLiveRegion="polite"><Text accessibilityRole="alert" style={styles.error}>{error}</Text><Pressable accessibilityRole="button" accessibilityLabel="Bugünün işlerini yeniden yükle" onPress={onRetry} style={styles.button}><Text style={styles.buttonText}>Yeniden dene</Text></Pressable></View> : null}
    {!loading && !error && data ? <>
      <Text accessibilityLabel={`İş tarihi ${data.localDate}`} style={styles.body}>İş tarihi: {data.localDate}</Text>
      {data.tasks.length === 0 ? <Text accessibilityLiveRegion="polite" style={styles.body}>Bugün için planlanmış iş yok.</Text> : data.tasks.map((task) => <View key={task.id} style={styles.task}>
        <Text accessibilityRole="header" style={styles.taskTitle}>{task.title}</Text>
        <Text style={styles.body}>{task.cropDisplayName} · {task.plannedLocalDate}</Text>
      </View>)}
    </> : null}
  </ScrollView>;
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, gap: 14, padding: 20, paddingBottom: 32 },
  title: { color: "#142b1f", fontSize: 26, fontWeight: "700" },
  body: { color: "#263a30", fontSize: 17, lineHeight: 26 },
  error: { color: "#8b1d1d", fontSize: 16, lineHeight: 24 },
  task: { borderColor: "#b8c5bd", borderRadius: 8, borderWidth: 1, gap: 8, padding: 12 },
  taskTitle: { color: "#142b1f", fontSize: 19, fontWeight: "600" },
  button: { alignItems: "flex-start", borderColor: "#52616b", borderRadius: 8, borderWidth: 1, justifyContent: "center", minHeight: 48, paddingHorizontal: 14 },
  buttonText: { color: "#142b1f", fontSize: 17 },
});
