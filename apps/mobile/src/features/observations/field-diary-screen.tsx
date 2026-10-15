import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { ApiClient } from "../../../../../packages/api-client/src/index";
import { readFieldDiary, type DiaryPage, type DiaryEntry, type DiaryReadError } from "./diary-client";
import type { ObservationCommand, ObservationCommandStore } from "./observation-command-store";

export type FieldDiaryScreenProps = {
  client: ApiClient;
  accountId?: string;
  observationStore?: Pick<ObservationCommandStore, "list"> & Partial<Pick<ObservationCommandStore, "subscribe">>;
  fieldId: string;
  fieldName?: string;
  seasonId?: string;
  seasonName?: string;
  onBack?: () => void;
  /** Supplied only when creation is permitted in the current navigation context. */
  onAddObservation?: () => void;
};

export function FieldDiaryScreen(props: FieldDiaryScreenProps) {
  return <FieldDiaryContent key={`${props.accountId ?? ""}:${props.fieldId}:${props.seasonId ?? ""}`} {...props} />;
}

export function reconcileObservationRows(entries: DiaryEntry[], local: ObservationCommand[]): DiaryEntry[] {
  const known = new Set(entries.filter((entry) => entry.kind === "OBSERVATION").map((entry) => entry.id));
  const retained = local.filter((command) => command.state === "ACCEPTED" && command.acceptedResult
    && !known.has(command.observationId)).map((command): DiaryEntry => ({
      kind: "OBSERVATION", id: command.observationId, fieldId: command.fieldId,
      seasonId: command.seasonId, description: command.description, occurredAt: command.occurredAt,
    }));
  return [...entries, ...retained].sort((left, right) => {
    const leftAt = left.kind === "TASK_SKIPPED" ? left.skippedAt : left.occurredAt;
    const rightAt = right.kind === "TASK_SKIPPED" ? right.skippedAt : right.occurredAt;
    return rightAt.localeCompare(leftAt) || right.id.localeCompare(left.id);
  });
}

function FieldDiaryContent({ client, accountId, observationStore, fieldId, fieldName, seasonId, seasonName, onBack, onAddObservation }: FieldDiaryScreenProps) {
  const [data, setData] = useState<DiaryPage | null>(null);
  const [localCommands, setLocalCommands] = useState<ObservationCommand[]>([]);
  const [accessDenied, setAccessDenied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryCursor, setRetryCursor] = useState<string | undefined>();
  const generation = useRef(0);
  const inFlight = useRef(false);

  const load = useCallback(async (cursor?: string) => {
    if (inFlight.current) return;
    inFlight.current = true;
    const request = ++generation.current;
    if (cursor) setLoadingMore(true);
    else { setLoading(true); setData(null); }
    setError(null);
    try {
      const page = await readFieldDiary(client, fieldId, { ...(seasonId ? { seasonId } : {}), ...(cursor ? { cursor } : {}) });
      if (generation.current !== request) return;
      setAccessDenied(false);
      setData((current) => cursor && current ? { ...page, items: [...current.items, ...page.items] } : page);
      setRetryCursor(undefined);
    } catch (failure) {
      if (generation.current !== request) return;
      const status = (failure as DiaryReadError)?.status;
      const accessDenied = [401, 403, 404].includes(status ?? 0);
      setAccessDenied(accessDenied);
      if (accessDenied) setData(null);
      setRetryCursor(accessDenied ? undefined : cursor);
      setError(accessDenied ? "Bu günlüğe erişiminiz doğrulanamadı. Yeniden bağlanıp erişiminizi kontrol edin."
        : "Günlük yüklenemedi. İnternet bağlantınızı kontrol edip yeniden deneyin.");
    } finally {
      if (generation.current === request) { inFlight.current = false; setLoading(false); setLoadingMore(false); }
    }
  }, [client, fieldId, seasonId]);

  useEffect(() => {
    inFlight.current = false;
    void load();
    return () => { generation.current += 1; };
  }, [load]);

  useEffect(() => {
    let current = true;
    const refresh = () => {
      if (accountId && observationStore) void observationStore.list(accountId).then((commands) => {
        if (current) setLocalCommands(commands.filter((command) => command.fieldId === fieldId
          && (!seasonId || command.seasonId === seasonId)));
      }).catch(() => {});
    };
    refresh();
    const unsubscribe = observationStore?.subscribe?.(refresh);
    return () => { current = false; unsubscribe?.(); };
  }, [accountId, observationStore, fieldId, seasonId]);

  const visibleRows = accessDenied ? [] : reconcileObservationRows(data?.items ?? [], localCommands);
  const displayTimezone = data?.businessTimezone ?? localCommands.find((command) => command.state === "ACCEPTED")?.capturedBusinessTimezone;

  return <ScrollView contentContainerStyle={styles.content} accessibilityLabel="Tarla günlüğü">
    {onBack && <Pressable accessibilityRole="button" accessibilityLabel="Tarlaya dön" onPress={onBack} style={styles.button}><Text>Tarlaya dön</Text></Pressable>}
    <Text accessibilityRole="header" style={styles.title}>Tarla günlüğü</Text>
    <Text>Tarla: {fieldName ?? "Seçili tarla"}</Text>
    {seasonId && <Text>Sezon: {seasonName ?? "Seçili sezon"}</Text>}
    {loading && <Text accessibilityRole="progressbar" accessibilityLabel="Günlük yükleniyor" accessibilityLiveRegion="polite">Günlük yükleniyor…</Text>}
    {!loading && error && <>
      <Text accessibilityRole="alert" accessibilityLiveRegion="assertive">{error}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Günlüğü yeniden dene" accessibilityState={{ disabled: loadingMore }} disabled={loadingMore} onPress={() => void load(retryCursor)} style={styles.button}><Text>Yeniden dene</Text></Pressable>
    </>}
    {!loading && data && <>
      {!error && <Text accessibilityRole="text" accessibilityLabel="Günlük yüklendi" accessibilityLiveRegion="polite">{data.items.length ? `${data.items.length} kayıt gösteriliyor` : "Günlük boş"}</Text>}
      {data.items.length === 0 && !error && <Text accessibilityLabel="Henüz kayıt yok" accessibilityLiveRegion="polite">{seasonId ? "Bu sezonda henüz kayıt yok." : "Bu tarlada henüz kayıt yok."}</Text>}
      {visibleRows.map((item) => <DiaryRow key={`${item.kind}:${item.id}`} item={item} timezone={displayTimezone ?? data.businessTimezone} />)}
      {loadingMore && <Text accessibilityRole="progressbar" accessibilityLabel="Eski kayıtlar yükleniyor" accessibilityLiveRegion="polite">Eski kayıtlar yükleniyor…</Text>}
      {data.nextCursor && !error && <Pressable accessibilityRole="button" accessibilityLabel="Daha eski kayıtları yükle" accessibilityState={{ disabled: loadingMore, busy: loadingMore }} disabled={loadingMore} onPress={() => void load(data.nextCursor ?? undefined)} style={styles.button}><Text>Daha eski kayıtlar</Text></Pressable>}
    </>}
    {!data && !accessDenied && displayTimezone && visibleRows.map((item) =>
      <DiaryRow key={`${item.kind}:${item.id}`} item={item} timezone={displayTimezone} />)}
    {onAddObservation && <Pressable accessibilityRole="button" accessibilityLabel="Gözlem ekle" onPress={onAddObservation} style={styles.button}><Text>Gözlem ekle</Text></Pressable>}
  </ScrollView>;
}

function DiaryRow({ item, timezone }: { item: DiaryEntry; timezone: string }) {
  const isTask = item.kind !== "OBSERVATION";
  const skipped = item.kind === "TASK_SKIPPED";
  const happenedAt = item.kind === "OBSERVATION" ? item.occurredAt : skipped ? item.skippedAt : item.occurredAt;
  const occurred = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short", timeZone: timezone }).format(new Date(happenedAt));
  const title = item.kind === "OBSERVATION" ? "Gözlem" : skipped ? "Görev atlandı" : "Tamamlanan iş";
  const description = item.kind === "OBSERVATION" ? item.description : item.title;
  const planned = isTask ? new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${item.plannedLocalDate}T12:00:00Z`)) : null;
  const provenance = item.kind === "OBSERVATION" ? item.seasonId ? "Sezona bağlı gözlem" : "Tarla gözlemi" : item.sourceKind === "MANUAL" ? "Elle eklenen iş" : "Onaylı plana göre";
  return <View accessible accessibilityLabel={`${title}, ${description}, ${skipped ? "atlandı" : "gerçekleşti"} ${occurred}, ${timezone}${planned ? `, planlanan ${planned}` : ""}, ${provenance}`} style={styles.row}>
    <Text accessibilityRole="header" style={styles.rowTitle}>{title}</Text>
    <Text style={styles.body}>{description}</Text>
    <Text style={styles.body}>{skipped ? "Atlanma zamanı" : "Gerçekleşti"}: {occurred} · {timezone}</Text>
    {planned && <Text style={styles.body}>Planlanan gün: {planned}</Text>}
    <Text style={styles.body}>{provenance}</Text>
    {item.kind === "TASK_COMPLETION" && <Text style={styles.body}>Sezonda tamamlanan iş</Text>}
  </View>;
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, padding: 20, paddingBottom: 32, gap: 14 },
  title: { fontSize: 26, fontWeight: "700", color: "#142b1f" },
  row: { padding: 12, gap: 8, borderWidth: 1, borderColor: "#b8c5bd", borderRadius: 8 },
  rowTitle: { fontSize: 19, fontWeight: "600", color: "#142b1f" },
  body: { fontSize: 17, lineHeight: 26, color: "#263a30" },
  button: { minHeight: 48, padding: 14, borderWidth: 1, borderColor: "#52616b", borderRadius: 8, justifyContent: "center" },
});
