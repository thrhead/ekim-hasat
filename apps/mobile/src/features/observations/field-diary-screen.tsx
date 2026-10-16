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
  /** Supplied only when irrigation capture is available from this diary. */
  onAddIrrigation?: () => void;
  /** Supplied only when Expense Diary V2 access is available in this route. */
  onAddExpense?: () => void;
};

export function FieldDiaryScreen(props: FieldDiaryScreenProps) {
  return <FieldDiaryContent key={`${props.accountId ?? ""}:${props.fieldId}:${props.seasonId ?? ""}`} {...props} />;
}

export function reconcileObservationRows(entries: DiaryEntry[], local: ObservationCommand[], timezone = "UTC"): DiaryEntry[] {
  const known = new Set(entries.filter((entry) => entry.kind === "OBSERVATION").map((entry) => entry.id));
  const retained = local.filter((command) => command.state === "ACCEPTED" && command.acceptedResult
    && !known.has(command.observationId)).map((command): DiaryEntry => ({
      kind: "OBSERVATION", id: command.observationId, fieldId: command.fieldId,
      seasonId: command.seasonId, description: command.description, occurredAt: command.occurredAt,
    }));
  return [...entries, ...retained].sort((left, right) => compareDiaryEntries(left, right, timezone));
}

function FieldDiaryContent({ client, accountId, observationStore, fieldId, fieldName, seasonId, seasonName, onBack, onAddObservation, onAddIrrigation, onAddExpense }: FieldDiaryScreenProps) {
  const [data, setData] = useState<DiaryPage | null>(null);
  const [localCommands, setLocalCommands] = useState<ObservationCommand[]>([]);
  const [accessDenied, setAccessDenied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expenseActionAvailable, setExpenseActionAvailable] = useState(false);
  const [retryCursor, setRetryCursor] = useState<string | undefined>();
  const generation = useRef(0);
  const inFlight = useRef(false);
  const expenseMode = useRef(Boolean(onAddExpense));

  const load = useCallback(async (cursor?: string) => {
    if (inFlight.current) return;
    inFlight.current = true;
    const request = ++generation.current;
    if (cursor) setLoadingMore(true);
    else { setLoading(true); setData(null); }
    setError(null);
    try {
      const page = await readFieldDiary(client, fieldId, { ...(seasonId ? { seasonId } : {}), ...(cursor ? { cursor } : {}), ...(expenseMode.current ? { includeExpenses: true } : {}) });
      if (generation.current !== request) return;
      setAccessDenied(false);
      setData((current) => cursor && current ? { ...page, items: [...current.items, ...page.items] } : page);
      setExpenseActionAvailable(expenseMode.current);
      setRetryCursor(undefined);
    } catch (failure) {
      if (generation.current !== request) return;
      const status = (failure as DiaryReadError)?.status;
      if (status === 403 && expenseMode.current) {
        expenseMode.current = false;
        setExpenseActionAvailable(false);
        setData((current) => current ? { ...current, items: current.items.filter((entry) => entry.kind !== "EXPENSE") } : null);
        try {
          const fallback = await readFieldDiary(client, fieldId, { ...(seasonId ? { seasonId } : {}) });
          if (generation.current !== request) return;
          setAccessDenied(false);
          setData(fallback);
          setRetryCursor(undefined);
          setError(null);
          return;
        } catch (fallbackFailure) {
          if (generation.current !== request) return;
          const fallbackStatus = (fallbackFailure as DiaryReadError)?.status;
          const denied = [401, 403, 404].includes(fallbackStatus ?? 0);
          setAccessDenied(denied);
          if (denied) setData(null);
          setRetryCursor(undefined);
          setError(denied ? "Bu günlüğe erişiminiz doğrulanamadı. Yeniden bağlanıp erişiminizi kontrol edin."
            : "Günlük yüklenemedi. İnternet bağlantınızı kontrol edip yeniden deneyin.");
          return;
        }
      }
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

  const serverEntries = data?.items ?? [];
  const displayTimezone = data?.businessTimezone ?? localCommands.find((command) => command.state === "ACCEPTED")?.capturedBusinessTimezone ?? "UTC";
  const visibleRows = accessDenied ? [] : [
    ...reconcileObservationRows(serverEntries.filter((entry) => entry.kind === "OBSERVATION"), localCommands, displayTimezone),
    ...serverEntries.filter((entry) => entry.kind !== "OBSERVATION"),
  ].sort((left, right) => compareDiaryEntries(left, right, displayTimezone));

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
    {onAddIrrigation && <Pressable accessibilityRole="button" accessibilityLabel="Sulama kaydı ekle" onPress={onAddIrrigation} style={styles.button}><Text>Sulama kaydı ekle</Text></Pressable>}
    {onAddExpense && expenseActionAvailable && <Pressable accessibilityRole="button" accessibilityLabel="Gider ekle" onPress={onAddExpense} style={styles.button}><Text>Gider ekle</Text></Pressable>}
  </ScrollView>;
}

function DiaryRow({ item, timezone }: { item: DiaryEntry; timezone: string }) {
  if (item.kind === "EXPENSE") {
    const date = new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${item.expenseDate}T12:00:00Z`));
    const category = EXPENSE_CATEGORY_LABELS[item.category] ?? "Gider";
    return <View accessible accessibilityLabel={`Gider, ${item.amount} ${item.currency}, ${category}, ${date}${item.note ? `, ${item.note}` : ""}`} style={styles.row}>
      <Text accessibilityRole="header" style={styles.rowTitle}>Gider</Text>
      <Text style={styles.body}>{item.amount} {item.currency}</Text>
      <Text style={styles.body}>{category}</Text>
      <Text style={styles.body}>{date}</Text>
      {item.note && <Text style={styles.body}>{item.note}</Text>}
    </View>;
  }
  const isTask = item.kind === "TASK_COMPLETION" || item.kind === "TASK_SKIPPED";
  const irrigation = item.kind === "IRRIGATION";
  const skipped = item.kind === "TASK_SKIPPED";
  const happenedAt = skipped ? item.skippedAt : item.occurredAt;
  const occurred = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short", timeZone: timezone }).format(new Date(happenedAt));
  const title = item.kind === "OBSERVATION" ? "Gözlem" : irrigation ? "Sulama kaydı" : skipped ? "Görev atlandı" : "Tamamlanan iş";
  const description = item.kind === "OBSERVATION" ? item.description : irrigation ? item.method ?? "Yöntem belirtilmedi" : item.title;
  const planned = isTask ? new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${item.plannedLocalDate}T12:00:00Z`)) : null;
  const provenance = item.kind === "OBSERVATION" ? item.seasonId ? "Sezona bağlı gözlem" : "Tarla gözlemi" : isTask ? item.sourceKind === "MANUAL" ? "Elle eklenen iş" : "Onaylı plana göre" : null;
  const irrigationDetails = irrigation ? [
    item.durationMinutes === null ? null : `${item.durationMinutes} dakika`,
    item.waterVolumeCubicMetres === null ? null : `${new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 }).format(Number(item.waterVolumeCubicMetres))} m³`,
    item.note,
  ].filter((detail): detail is string => Boolean(detail)) : [];
  const accessibleDetails = [description, skipped ? "atlandı" : "gerçekleşti", ...irrigationDetails, provenance].filter(Boolean).join(", ");
  return <View accessible accessibilityLabel={`${title}, ${accessibleDetails} ${occurred}, ${timezone}${planned ? `, planlanan ${planned}` : ""}`} style={styles.row}>
    <Text accessibilityRole="header" style={styles.rowTitle}>{title}</Text>
    <Text style={styles.body}>{description}</Text>
    <Text style={styles.body}>{skipped ? "Atlanma zamanı" : "Gerçekleşti"}: {occurred} · {timezone}</Text>
    {planned && <Text style={styles.body}>Planlanan gün: {planned}</Text>}
    {irrigationDetails.map((detail) => <Text key={detail} style={styles.body}>{detail}</Text>)}
    {provenance && <Text style={styles.body}>{provenance}</Text>}
    {item.kind === "TASK_COMPLETION" && <Text style={styles.body}>Sezonda tamamlanan iş</Text>}
  </View>;
}

function compareDiaryEntries(left: DiaryEntry, right: DiaryEntry, timezone: string): number {
  const dayOrder = businessDate(right, timezone).localeCompare(businessDate(left, timezone));
  if (dayOrder) return dayOrder;
  if (left.kind === "EXPENSE" || right.kind === "EXPENSE") {
    if (left.kind !== right.kind) return left.kind === "EXPENSE" ? 1 : -1;
    return right.id.localeCompare(left.id);
  }
  return diaryTimedAt(right).localeCompare(diaryTimedAt(left)) || right.id.localeCompare(left.id);
}

function businessDate(item: DiaryEntry, timezone: string): string {
  if (item.kind === "EXPENSE") return item.expenseDate;
  const instant = item.kind === "TASK_SKIPPED" ? item.skippedAt : item.occurredAt;
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(instant));
}

function diaryTimedAt(item: Exclude<DiaryEntry, { kind: "EXPENSE" }>): string {
  return item.kind === "TASK_SKIPPED" ? item.skippedAt : item.occurredAt;
}

const EXPENSE_CATEGORY_LABELS: Record<string, string> = {
  SEED_SEEDLING: "Tohum / fide", FERTILIZER: "Gübre", PESTICIDE: "İlaç",
  FUEL: "Yakıt", LABOR: "İşçilik", IRRIGATION: "Sulama", OTHER: "Diğer",
};

const styles = StyleSheet.create({
  content: { flexGrow: 1, padding: 20, paddingBottom: 32, gap: 14 },
  title: { fontSize: 26, fontWeight: "700", color: "#142b1f" },
  row: { padding: 12, gap: 8, borderWidth: 1, borderColor: "#b8c5bd", borderRadius: 8 },
  rowTitle: { fontSize: 19, fontWeight: "600", color: "#142b1f" },
  body: { fontSize: 17, lineHeight: 26, color: "#263a30" },
  button: { minHeight: 48, padding: 14, borderWidth: 1, borderColor: "#52616b", borderRadius: 8, justifyContent: "center" },
});
