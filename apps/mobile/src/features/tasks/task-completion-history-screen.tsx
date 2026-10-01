import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { ApiClient } from "../../api/onboarding-client";
import type { TaskCompletionComponents, TaskCompletionOperations } from "../../../../../packages/api-client/src/index";
import { createTaskCompletionCommandStore, type TaskCompletionCommand } from "./task-completion-command-store";

type HistoryPage = TaskCompletionOperations["getFieldTaskCompletionHistory"]["responses"][200]["content"]["application/json"];
type Completion = TaskCompletionComponents["schemas"]["TaskCompletion"];

export async function readFieldTaskCompletionHistory(client: ApiClient, fieldId: string, filters: Readonly<{ seasonId?: string; cursor?: string }> = {}): Promise<HistoryPage> {
  const result = await client.GET("/fields/{fieldId}/task-completions", {
    params: { path: { fieldId }, query: { limit: 50, ...(filters.seasonId ? { seasonId: filters.seasonId } : {}), ...(filters.cursor ? { cursor: filters.cursor } : {}) } },
  });
  if (!result.response.ok || result.error !== undefined || result.data === undefined) throw new Error("Tamamlanan işler yüklenemedi.");
  return result.data;
}

function formatPlannedDate(localDate: string): string {
  const [year, month, day] = localDate.split("-").map(Number);
  return new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(year!, month! - 1, day!, 12)));
}

function formatOccurrence(instant: string, timezone: string): string {
  return new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short", timeZone: timezone }).format(new Date(instant));
}

export function TaskCompletionHistoryScreen({ client, accountId, fieldId, initialSeasonId, onBack, store: suppliedStore }: {
  client: ApiClient;
  accountId: string;
  fieldId: string;
  initialSeasonId?: string;
  onBack: () => void;
  store?: ReturnType<typeof createTaskCompletionCommandStore>;
}) {
  const store = useMemo(() => suppliedStore ?? createTaskCompletionCommandStore(), [suppliedStore]);
  const [seasonId, setSeasonId] = useState(initialSeasonId);
  const scopeKey = JSON.stringify([fieldId, seasonId ?? null]);
  const currentScopeKey = useRef(scopeKey);
  currentScopeKey.current = scopeKey;
  const latestRequest = useRef(0);
  const [scopedData, setScopedData] = useState<{ scopeKey: string; page: HistoryPage } | null>(null);
  const data = scopedData?.scopeKey === scopeKey ? scopedData.page : null;
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localCommands, setLocalCommands] = useState<TaskCompletionCommand[]>([]);

  const load = useCallback(async (cursor?: string, append = false) => {
    const requestId = ++latestRequest.current;
    const requestedScopeKey = scopeKey;
    if (append) setLoadingMore(true);
    else { setLoading(true); setLoadingMore(false); setError(null); }
    try {
      const result = await readFieldTaskCompletionHistory(client, fieldId, { ...(seasonId ? { seasonId } : {}), ...(cursor ? { cursor } : {}) });
      if (requestId !== latestRequest.current || currentScopeKey.current !== requestedScopeKey) return;
      setScopedData((current) => ({
        scopeKey: requestedScopeKey,
        page: append && current?.scopeKey === requestedScopeKey
          ? { ...result, items: [...current.page.items, ...result.items] }
          : result,
      }));
      setError(null);
    } catch (failure) {
      if (requestId !== latestRequest.current || currentScopeKey.current !== requestedScopeKey) return;
      setError(failure instanceof Error ? failure.message : "Tamamlanan işler yüklenemedi.");
    } finally {
      if (requestId === latestRequest.current && currentScopeKey.current === requestedScopeKey) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [client, fieldId, seasonId, scopeKey]);

  useEffect(() => {
    void load();
    return () => { latestRequest.current += 1; };
  }, [load]);
  useEffect(() => {
    void store.list(accountId).then((commands) => setLocalCommands(commands.filter((command) => command.state === "PENDING" || command.state === "CONFLICTED")))
      .catch(() => setLocalCommands([]));
  }, [accountId, store]);

  return <TaskCompletionHistoryContent loading={loading} loadingMore={loadingMore} error={error} data={data}
    seasonId={seasonId} localCommands={localCommands} onRetry={() => void load()} onBack={onBack} onShowAll={() => setSeasonId(undefined)}
    onLoadMore={() => { if (data?.nextCursor) void load(data.nextCursor, true); }} />;
}

export function TaskCompletionHistoryContent({ loading, loadingMore = false, error, data, seasonId, localCommands = [], onRetry, onBack, onShowAll, onLoadMore }: {
  loading: boolean;
  loadingMore?: boolean;
  error: string | null;
  data: HistoryPage | null;
  seasonId?: string;
  localCommands?: readonly TaskCompletionCommand[];
  onRetry: () => void;
  onBack: () => void;
  onShowAll: () => void;
  onLoadMore?: () => void;
}) {
  return <ScrollView contentContainerStyle={styles.content}>
    <Pressable accessibilityRole="button" accessibilityLabel="Bugüne dön" onPress={onBack} style={styles.button}><Text style={styles.buttonText}>Bugüne dön</Text></Pressable>
    <Text accessibilityRole="header" style={styles.title}>Tamamlanan işler</Text>
    <Text style={styles.body}>{seasonId ? "Bu sezonun tarla geçmişi" : "Tarla geçmişi"}</Text>
    {seasonId ? <Pressable accessibilityRole="button" accessibilityLabel="Tarlanın tüm geçmişini göster" onPress={onShowAll} style={styles.button}>
      <Text style={styles.buttonText}>Tüm sezonlar</Text></Pressable> : null}
    {loading ? <Text accessibilityRole="progressbar" accessibilityLabel="Geçmiş yükleniyor" style={styles.body}>Geçmiş yükleniyor…</Text> : null}
    {!loading && error ? <View accessibilityLiveRegion="polite"><Text accessibilityRole="alert" style={styles.error}>{error}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Geçmişi yeniden yükle" onPress={onRetry} style={styles.button}><Text style={styles.buttonText}>Yeniden dene</Text></Pressable></View> : null}
    {!loading && !error && data?.items.length === 0 ? <Text accessibilityLiveRegion="polite" style={styles.body}>
      {seasonId ? "Bu sezonda tamamlanmış iş yok." : "Bu tarlada tamamlanmış iş yok."}
    </Text> : null}
    {!loading && !error && data?.items.map((item) => <TaskCompletionHistoryRow key={item.id} item={item} timezone={data.businessTimezone} />)}
    {localCommands.length ? <View accessibilityLiveRegion="polite" style={styles.localSection}>
      <Text accessibilityRole="header" style={styles.localTitle}>Bu cihazda bekleyen işler</Text>
      <Text style={styles.body}>Bu kayıtlar henüz sunucu tarafından kabul edilmedi; tamamlanan işler geçmişine dahil değiller.</Text>
      {localCommands.map((command) => <View key={command.completionId} style={styles.row}>
        <Text accessibilityRole="header" style={styles.rowTitle}>{command.title}</Text>
        <Text accessibilityLiveRegion="polite" style={styles.body}>{command.state === "PENDING" ? "Eşitleme bekliyor" : "Sunucu kabul etmedi · gözden geçirme gerekiyor"}</Text>
      </View>)}
    </View> : null}
    {!loading && !error && data?.nextCursor ? <Pressable accessibilityRole="button" accessibilityLabel="Daha fazla tamamlanan iş yükle"
      accessibilityState={{ disabled: loadingMore }} disabled={loadingMore} onPress={onLoadMore} style={styles.button}>
      <Text style={styles.buttonText}>{loadingMore ? "Yükleniyor…" : "Daha fazla göster"}</Text></Pressable> : null}
  </ScrollView>;
}

export function TaskCompletionHistoryRow({ item, timezone }: { item: Completion; timezone: string }) {
  return <View accessible accessibilityLabel={`${item.title}, planlanan ${formatPlannedDate(item.plannedLocalDate)}, gerçekleşti ${formatOccurrence(item.occurredAt, timezone)}, ${timezone}`} style={styles.row}>
    <Text accessibilityRole="header" style={styles.rowTitle}>{item.title}</Text>
    <Text style={styles.body}>Planlanan gün: {formatPlannedDate(item.plannedLocalDate)}</Text>
    <Text style={styles.body}>Gerçekleşti: {formatOccurrence(item.occurredAt, timezone)} · {timezone}</Text>
    <Text style={styles.provenance}>{item.sourceKind === "MANUAL" ? "Elle eklenen iş" : "Onaylı plana göre"}</Text>
  </View>;
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, gap: 14, padding: 20, paddingBottom: 32 },
  title: { color: "#142b1f", fontSize: 26, fontWeight: "700" },
  body: { color: "#263a30", fontSize: 17, lineHeight: 26 },
  error: { color: "#8b1d1d", fontSize: 16, lineHeight: 24 },
  row: { borderColor: "#b8c5bd", borderRadius: 8, borderWidth: 1, gap: 8, padding: 12 },
  rowTitle: { color: "#142b1f", fontSize: 19, fontWeight: "600" },
  provenance: { color: "#263a30", fontSize: 15, lineHeight: 22 },
  localSection: { borderColor: "#b8c5bd", borderRadius: 8, borderWidth: 1, gap: 10, padding: 12 },
  localTitle: { color: "#142b1f", fontSize: 18, fontWeight: "600" },
  button: { alignItems: "flex-start", borderColor: "#52616b", borderRadius: 8, borderWidth: 1, justifyContent: "center", minHeight: 48, paddingHorizontal: 14 },
  buttonText: { color: "#142b1f", fontSize: 17 },
});
