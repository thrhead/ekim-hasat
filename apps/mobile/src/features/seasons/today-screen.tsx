import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppState, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { ApiClient, SeasonOperations } from "../../api/onboarding-client";
import { readTodayPlannedWork } from "./season-activation";
import { belongsToBusinessToday, createTaskCompletionCommandStore, type TaskCompletionCommand, type TaskCompletionCommandStore, type TodaySnapshot } from "../tasks/task-completion-command-store";
import { createTaskCompletionCoordinator } from "../tasks/task-completion";
import { createTaskDateAdjustmentFlow } from "../tasks/task-date-adjustment";
import { TaskDateAdjustmentView } from "../tasks/task-date-adjustment-view";
import { readWeatherOverview, type WeatherOverviewPage } from "../weather/weather-client";
import { WeatherCard, WeatherOverviewCards, type WeatherCardState } from "../weather/weather-card";
import { WeatherAnnouncement, weatherAnnouncementMessage } from "../weather/weather-announcement";

type Today = SeasonOperations["getTodayPlannedTasks"]["responses"][200]["content"]["application/json"];
type Task = Today["tasks"][number];
export type TodayTaskState = "SAVING" | "PENDING" | "ACCEPTED" | "CONFLICTED" | "ACCESS_UNAVAILABLE";

export function TodayScreen({ client, accountId, onBack, onOpenHistory, store: suppliedStore, coordinator: suppliedCoordinator, getAuthorizationSession, now = () => new Date() }: {
  client: ApiClient;
  /** Authenticated account identity used only to partition local data. */
  accountId: string;
  onBack?: () => void;
  onOpenHistory?: (fieldId: string, seasonId?: string) => void;
  store?: TaskCompletionCommandStore;
  coordinator?: ReturnType<typeof createTaskCompletionCoordinator>;
  getAuthorizationSession?: () => Readonly<{ accountId: string; client: Pick<ApiClient, "POST"> }> | null;
  now?: () => Date;
}) {
  const store = useMemo(() => suppliedStore ?? createTaskCompletionCommandStore(), [suppliedStore]);
  const coordinator = useMemo(() => suppliedCoordinator ?? createTaskCompletionCoordinator({
    store,
    getAuthorizationSession: getAuthorizationSession ?? (() => null),
  }), [client, getAuthorizationSession, store, suppliedCoordinator]);
  const adjustmentFlow = useMemo(() => createTaskDateAdjustmentFlow({ client }), [client]);
  const [adjustmentTaskId, setAdjustmentTaskId] = useState<string | null>(null);
  const [adjustmentNotice, setAdjustmentNotice] = useState<string | null>(null);
  const [adjustmentStates, setAdjustmentStates] = useState<Record<string, "LOADING" | "CONFLICT">>({});
  const [data, setData] = useState<Today | null>(null);
  const [commandsLoaded, setCommandsLoaded] = useState(false);
  const [retryPendingOnOpen, setRetryPendingOnOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cached, setCached] = useState(false);
  const [taskStates, setTaskStates] = useState<Record<string, TodayTaskState>>({});
  const [savingTaskIds, setSavingTaskIds] = useState<Set<string>>(new Set());
  const [completions, setCompletions] = useState<TaskCompletionCommand[]>([]);
  const [weather, setWeather] = useState<{ kind: "loading" } | { kind: "error" } | { kind: "access-error" } | { kind: "data"; page: WeatherOverviewPage }>({ kind: "loading" });
  const weatherRequestGeneration = useRef(0);
  const refreshCommands = useCallback(async () => {
    const rows = await store.list(accountId);
    setCompletions(rows);
    setTaskStates(Object.fromEntries(rows.filter((row) => row.state !== "CONFLICTED" || row.conflictCode)
      .map((row) => [row.taskId, row.state === "CONFLICTED"
        ? row.conflictCode === "ACCESS_UNAVAILABLE" ? "ACCESS_UNAVAILABLE" : "CONFLICTED"
        : row.state])) as Record<string, TodayTaskState>);
    return rows;
  }, [accountId, store]);

  const load = useCallback(async () => {
    setLoading(true); setError(null); setCached(false);
    try {
      const latest = await readTodayPlannedWork(client);
      const snapshot: TodaySnapshot = { ...latest, fetchedAt: now().toISOString() };
      setData(latest);
      await store.writeTodaySnapshot(accountId, snapshot).catch(() => undefined);
      const rows = await refreshCommands();
      setRetryPendingOnOpen(rows.some((row) => row.state === "PENDING"));
    } catch (failure) {
      const status = failure && typeof failure === "object" && "status" in failure ? Number((failure as { status: unknown }).status) : undefined;
      const snapshot = await store.readTodaySnapshot(accountId).catch(() => null);
      if (mayUseCachedToday(snapshot, status, now())) {
        setData(snapshot);
        setCached(true);
        setError(null);
        await refreshCommands();
      } else {
        setData(null);
        setError(status === 401 || status === 403 || status === 404
          ? "Bu işlere erişiminiz doğrulanamadı. Yeniden bağlanıp erişiminizi kontrol edin."
          : failure instanceof Error ? failure.message : "Bugünün işleri yüklenemedi.");
        await refreshCommands().catch(() => []);
      }
    }
    finally { setLoading(false); }
  }, [accountId, client, coordinator, now, refreshCommands, store]);

  const loadWeather = useCallback(async () => {
    const generation = ++weatherRequestGeneration.current;
    setWeather({ kind: "loading" });
    try {
      const page = await readWeatherOverview(client);
      if (generation === weatherRequestGeneration.current) setWeather({ kind: "data", page });
    } catch (failure) {
      if (generation !== weatherRequestGeneration.current) return;
      const status = failure && typeof failure === "object" && "status" in failure
        ? Number((failure as { status: unknown }).status) : undefined;
      setWeather({ kind: status === 401 || status === 403 ? "access-error" : "error" });
    }
  }, [client]);

  const updateTaskState = useCallback(async (taskId: string) => {
    const rows = await refreshCommands();
    const row = rows.filter((item) => item.taskId === taskId).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))[0];
    if (row?.state === "PENDING") setTaskStates((current) => ({ ...current, [taskId]: "PENDING" }));
  }, [refreshCommands]);

  async function completeTask(task: Task) {
    setSavingTaskIds((current) => new Set(current).add(task.id));
    try {
      const command = await coordinator.enqueue(accountId, task);
      setTaskStates((current) => ({ ...current, [task.id]: command.state === "PENDING" ? "PENDING" : command.state }));
      await refreshCommands();
      if (command.state === "PENDING") await coordinator.deliver(accountId, command.completionId);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "İşlem tamamlanamadı.");
    } finally {
      setSavingTaskIds((current) => { const next = new Set(current); next.delete(task.id); return next; });
      await updateTaskState(task.id);
    }
  }

  async function retryTask(task: Task) {
    const command = completions.find((row) => row.taskId === task.id && row.state === "PENDING");
    if (!command) return;
    setSavingTaskIds((current) => new Set(current).add(task.id));
    try {
      const result = await coordinator.deliver(accountId, command.completionId);
      if (result.state === "ACCEPTED") await load();
    }
    finally {
      setSavingTaskIds((current) => { const next = new Set(current); next.delete(task.id); return next; });
      await updateTaskState(task.id);
    }
  }

  async function reviewConflict(task: Task) {
    const command = [...completions].reverse().find((row) => row.taskId === task.id && row.state === "CONFLICTED");
    if (!command) return;
    setSavingTaskIds((current) => new Set(current).add(task.id));
    try {
      const refreshed = await readTodayPlannedWork(client);
      await store.writeTodaySnapshot(accountId, { ...refreshed, fetchedAt: now().toISOString() });
      setData(refreshed);
      setCached(false);
      const currentTask = refreshed.tasks.find((item) => item.id === task.id);
      if (currentTask) await coordinator.reconfirmConflict(accountId, command.completionId, currentTask);
      await refreshCommands();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Görev bilgisi yeniden alınamadı.");
    }
    finally {
      setSavingTaskIds((current) => { const next = new Set(current); next.delete(task.id); return next; });
      await updateTaskState(task.id);
    }
  }

  useEffect(() => {
    let current = true;
    void refreshCommands().then(() => { if (current) setCommandsLoaded(true); });
    return () => { current = false; };
  }, [refreshCommands]);
  useEffect(() => { if (commandsLoaded) void load(); }, [commandsLoaded, load]);
  useEffect(() => { void loadWeather(); }, [loadWeather]);
  useEffect(() => () => { weatherRequestGeneration.current++; }, []);
  useEffect(() => {
    if (!retryPendingOnOpen) return;
    setRetryPendingOnOpen(false);
    void coordinator.retryPending(accountId).then(refreshCommands).catch((failure) => {
      setError(failure instanceof Error ? failure.message : "Bekleyen tamamlamalar yenilenemedi.");
    });
  }, [accountId, coordinator, refreshCommands, retryPendingOnOpen]);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        void (async () => {
          try {
            await coordinator.retryPending(accountId);
            await refreshCommands();
          } catch (failure) {
            setError(failure instanceof Error ? failure.message : "Bekleyen tamamlamalar yenilenemedi.");
          }
        })();
      }
    });
    return () => subscription.remove();
  }, [accountId, coordinator, refreshCommands]);
  const weatherState: WeatherCardState = weather.kind === "data" ? { kind: "loading" } : weather;
  const announcement = weather.kind === "loading" ? null
    : weather.kind === "access-error" ? "Hava durumu erişiminiz doğrulanamadı."
      : weather.kind === "error" ? "Hava durumu yüklenemedi. Yeniden deneyebilirsiniz."
        : weatherAnnouncementMessage(weather.page.items);
  const weatherSection: ReactNode = <View style={styles.weather}>
    <Text accessibilityRole="header" style={styles.taskTitle}>Hava durumu</Text>
    {weather.kind === "data"
      ? <WeatherOverviewCards items={weather.page.items} onRetry={() => void loadWeather()} />
      : <WeatherCard state={weatherState} onRetry={() => void loadWeather()} />}
    <WeatherAnnouncement message={announcement} />
  </View>;
  return <>
  <TodayContent loading={loading} error={error} data={data} onRetry={() => void load()} onBack={onBack} cached={cached} weather={weatherSection}
    taskStates={Object.fromEntries(Object.keys(taskStates).map((taskId) => [taskId, savingTaskIds.has(taskId) ? "SAVING" : taskStates[taskId]])) as Record<string, TodayTaskState>}
    commands={completions}
    onComplete={(task) => void completeTask(task)} onRetryCompletion={(task) => void retryTask(task)}
    onReviewConflict={(task) => void reviewConflict(task)} onOpenHistory={onOpenHistory}
    onAdjust={(task) => { setAdjustmentNotice(null); setAdjustmentStates((current) => ({ ...current, [task.id]: "LOADING" })); setAdjustmentTaskId(task.id); }}
    adjustmentNotice={adjustmentNotice}
    adjustmentStates={adjustmentStates} />
  {adjustmentTaskId && <TaskDateAdjustmentView taskId={adjustmentTaskId} flow={adjustmentFlow} openOnMount
    taskTitle={data?.tasks.find((task) => task.id === adjustmentTaskId)?.title}
    label="Ertele veya yeniden planla"
    onAccepted={async () => { setAdjustmentNotice("Görev tarihi değişikliği kaydedildi."); setAdjustmentTaskId(null); setAdjustmentStates({}); await load(); }}
    onClose={() => { setAdjustmentTaskId(null); setAdjustmentStates((current) => { const next = { ...current }; delete next[adjustmentTaskId]; return next; }); }}
    onConflict={(failure) => { if (failure.code === "TASK_VERSION_CONFLICT") setAdjustmentStates((current) => ({ ...current, [adjustmentTaskId]: "CONFLICT" })); }} />}
  </>;
}

export function mayUseCachedToday(snapshot: TodaySnapshot | null, failureStatus: number | undefined, now: Date): snapshot is TodaySnapshot {
  return Boolean(snapshot) && ![401, 403, 404].includes(failureStatus ?? 0) && belongsToBusinessToday(snapshot!, now);
}

export function TodayContent({ loading, error, data, onRetry, onBack, taskStates = {}, commands = [], onComplete, onRetryCompletion, onReviewConflict, onOpenHistory, onAdjust, adjustmentStates = {}, adjustmentNotice, cached = false, weather }: {
  loading: boolean;
  error: string | null;
  data: Today | null;
  onRetry: () => void;
  onBack?: () => void;
  taskStates?: Record<string, TodayTaskState>;
  commands?: TaskCompletionCommand[];
  onComplete?: (task: Task) => void;
  onRetryCompletion?: (task: Task) => void;
  onReviewConflict?: (task: Task) => void;
  onAdjust?: (task: Task) => void;
  adjustmentStates?: Record<string, "LOADING" | "CONFLICT">;
  adjustmentNotice?: string | null;
  onOpenHistory?: (fieldId: string, seasonId?: string) => void;
  cached?: boolean;
  weather?: ReactNode;
}) {
  const retainedCommands = commands.filter((command) => !data?.tasks.some((task) => task.id === command.taskId));
  return <ScrollView contentContainerStyle={styles.content}>
    {onBack ? <Pressable accessibilityRole="button" accessibilityLabel="Sezon planına dön" onPress={onBack} style={styles.button}><Text style={styles.buttonText}>Sezon planına dön</Text></Pressable> : null}
    <Text accessibilityRole="header" style={styles.title}>Bugün</Text>
    {adjustmentNotice && <Text accessibilityRole="text" accessibilityLiveRegion="polite" style={styles.status}>{adjustmentNotice}</Text>}
    {loading ? <Text accessibilityRole="progressbar" accessibilityLabel="Bugünün işleri yükleniyor" style={styles.body}>Bugünün işleri yükleniyor…</Text> : null}
    {!loading && error ? <View accessibilityLiveRegion="polite"><Text accessibilityRole="alert" style={styles.error}>{error}</Text>
      {commands.some((command) => command.state === "PENDING" || command.state === "CONFLICTED")
        ? <Text accessibilityLiveRegion="polite" style={styles.status}>Tamamlama niyetiniz bu cihazda saklandı; erişim doğrulanamadığı için sunucu durumu görüntülenemiyor.</Text> : null}
      <Pressable accessibilityRole="button" accessibilityLabel="Bugünün işlerini yeniden yükle" onPress={onRetry} style={styles.button}><Text style={styles.buttonText}>Yeniden dene</Text></Pressable></View> : null}
    {retainedCommands.map((command) => <View key={command.completionId} style={styles.task}>
      <Text accessibilityRole="header" style={styles.taskTitle}>{command.title}</Text>
      <Text style={styles.body}>{command.cropDisplayName} · {command.plannedLocalDate}</Text>
      {command.state === "PENDING" ? <>
        <Text accessibilityLiveRegion="polite" style={styles.status}>Eşitleme bekliyor · bu iş yerel olarak kaydedildi.</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={`Tamamlamayı tekrar dene: ${command.title}`}
          accessibilityState={{ disabled: taskStates[command.taskId] === "SAVING" }} disabled={taskStates[command.taskId] === "SAVING"}
          onPress={() => onRetryCompletion?.(commandTask(command))} style={styles.button}><Text style={styles.buttonText}>Tekrar dene</Text></Pressable>
      </> : command.state === "ACCEPTED" ? <>
        <Text accessibilityLiveRegion="polite" style={styles.status}>Tamamlandı · geçmişi sunucudan açın</Text>
        {onOpenHistory ? <Pressable accessibilityRole="button" accessibilityLabel={`Geçmişi aç: ${command.title}`}
          onPress={() => onOpenHistory(command.fieldId, command.seasonId)} style={styles.button}><Text style={styles.buttonText}>Tamamlanan işleri gör</Text></Pressable> : null}
      </> : <>
        <Text accessibilityLiveRegion="polite" style={command.conflictCode === "ACCESS_UNAVAILABLE" ? styles.error : styles.status}>
          {command.conflictCode === "ACCESS_UNAVAILABLE" ? "Bu işlem için erişim doğrulanamadı. Tamamlama niyetiniz bu cihazda saklandı." : "Çakışan tamamlama niyetiniz saklandı; sunucuya bağlanıp tekrar gözden geçirin."}
        </Text>
        {command.conflictCode === "ACCESS_UNAVAILABLE" ? null : <Pressable accessibilityRole="button" accessibilityLabel={`Görevi gözden geçir: ${command.title}`}
          onPress={() => onReviewConflict?.(commandTask(command))} style={styles.button}><Text style={styles.buttonText}>Gözden geçir</Text></Pressable>}
      </>}
    </View>)}
    {!loading && !error && data ? <>
      {cached ? <>
        <Text accessibilityLiveRegion="polite" style={styles.body}>Çevrimdışı görünüm · sunucudan alınan iş tarihi</Text>
        <Text accessibilityLiveRegion="polite" style={styles.status}>Tarih değişikliği için internet bağlantısı gerekir.</Text>
      </> : null}
      <Text accessibilityLabel={`İş tarihi ${data.localDate}`} style={styles.body}>İş tarihi: {data.localDate}</Text>
      {data.tasks.length === 0 ? <Text accessibilityLiveRegion="polite" style={styles.body}>Bugün için planlanmış iş yok.</Text> : data.tasks.map((task) => {
        const state = taskStates[task.id];
        return <View key={task.id} style={styles.task}>
        <Text accessibilityRole="header" style={styles.taskTitle}>{task.title}</Text>
        <Text style={styles.body}>{task.cropDisplayName} · {task.plannedLocalDate}</Text>
        {state === "PENDING" ? <View accessibilityLiveRegion="polite"><Text accessibilityLiveRegion="polite" style={styles.status}>Eşitleme bekliyor</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={`Tamamlamayı tekrar dene: ${task.title}`} onPress={() => onRetryCompletion?.(task)} style={styles.button}><Text style={styles.buttonText}>Tekrar dene</Text></Pressable></View> : null}
        {state === "ACCEPTED" ? <Text accessibilityLiveRegion="polite" style={styles.status}>Tamamlandı</Text> : null}
        {state === "CONFLICTED" ? <View accessibilityLiveRegion="polite"><Text style={styles.status}>Görev bilgisi değişti; yeniden gözden geçirin.</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={`Görevi gözden geçir: ${task.title}`} onPress={() => onReviewConflict?.(task)} style={styles.button}><Text style={styles.buttonText}>Gözden geçir</Text></Pressable></View> : null}
        {state === "ACCESS_UNAVAILABLE" ? <Text accessibilityRole="alert" style={styles.error}>Bu işlem için erişim doğrulanamadı. Yeniden bağlanıp erişiminizi kontrol edin.</Text> : null}
        {(!state || state === "SAVING") && onComplete ? <Pressable accessibilityRole="button" accessibilityLabel={`Tamamla: ${task.title}`}
          accessibilityState={{ disabled: state === "SAVING" }} disabled={state === "SAVING"} onPress={() => onComplete?.(task)} style={styles.button}>
          <Text style={styles.buttonText}>{state === "SAVING" ? "Kaydediliyor…" : "Tamamla"}</Text>
        </Pressable> : null}
        {onOpenHistory ? <Pressable accessibilityRole="button" accessibilityLabel={`Geçmişi aç: ${task.title}`}
          onPress={() => onOpenHistory(task.fieldId, task.seasonId)} style={styles.button}><Text style={styles.buttonText}>Tamamlanan işleri gör</Text></Pressable> : null}
        {!cached && onAdjust && task.taskVersion !== undefined && <>
          {adjustmentStates[task.id] === "LOADING" && <Text accessibilityRole="progressbar" accessibilityLiveRegion="polite">Görev bilgisi yükleniyor…</Text>}
          {adjustmentStates[task.id] === "CONFLICT" && <Text accessibilityLiveRegion="polite" style={styles.status}>Görev bilgisi değişti. Güncel tarihi kontrol edip yeniden karar verin.</Text>}
          <Pressable accessibilityRole="button"
            accessibilityLabel={adjustmentStates[task.id] === "CONFLICT" ? `Görev tarihini yeniden gözden geçir: ${task.title}` : `Ertele veya yeniden planla: ${task.title}`}
            accessibilityState={{ busy: adjustmentStates[task.id] === "LOADING" }}
            onPress={() => onAdjust(task)} style={styles.button}>
            <Text style={styles.buttonText}>{adjustmentStates[task.id] === "CONFLICT" ? "Güncel tarihi gözden geçir" : "Ertele / Yeniden planla"}</Text>
          </Pressable>
        </>}
      </View>;
      })}
      {commands.filter((command) => command.state === "ACCEPTED" && !data.tasks.some((task) => task.id === command.taskId)).map((command) => <View key={command.completionId} style={styles.task}>
        <Text accessibilityRole="header" style={styles.taskTitle}>{command.title}</Text>
        <Text accessibilityLiveRegion="polite" style={styles.status}>Tamamlandı · geçmişi sunucudan açın</Text>
        {onOpenHistory ? <Pressable accessibilityRole="button" accessibilityLabel={`Geçmişi aç: ${command.title}`}
          onPress={() => onOpenHistory(command.fieldId, command.seasonId)} style={styles.button}><Text style={styles.buttonText}>Tamamlanan işleri gör</Text></Pressable> : null}
      </View>)}
      {commands.filter((command) => command.state !== "ACCEPTED" && !data.tasks.some((task) => task.id === command.taskId)).map((command) => <View key={command.completionId} style={styles.task}>
        <Text accessibilityRole="header" style={styles.taskTitle}>{command.title}</Text>
        <Text style={styles.body}>{command.cropDisplayName} · {command.plannedLocalDate}</Text>
        {command.state === "PENDING" ? <View accessibilityLiveRegion="polite">
          <Text accessibilityLiveRegion="polite" style={styles.status}>Eşitleme bekliyor · bu iş yerel olarak kaydedildi.</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={`Tamamlamayı tekrar dene: ${command.title}`}
            onPress={() => onRetryCompletion?.(commandTask(command))} style={styles.button}><Text style={styles.buttonText}>Tekrar dene</Text></Pressable>
        </View> : <View accessibilityLiveRegion="polite">
          <Text accessibilityRole={command.conflictCode === "ACCESS_UNAVAILABLE" ? "alert" : undefined} style={command.conflictCode === "ACCESS_UNAVAILABLE" ? styles.error : styles.status}>
            {command.conflictCode === "ACCESS_UNAVAILABLE" ? "Bu işlem için erişim doğrulanamadı. Tamamlama niyetiniz bu cihazda saklandı." : "Çakışan tamamlama niyetiniz saklandı; görev Bugün listesinde değil."}
          </Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Bugünün işlerini yeniden yükle" onPress={onRetry} style={styles.button}><Text style={styles.buttonText}>Bugünü yenile</Text></Pressable>
        </View>}
      </View>)}
    </> : null}
    {weather}
  </ScrollView>;
}

function commandTask(command: TaskCompletionCommand): Task {
  return {
    id: command.taskId, seasonId: command.seasonId, fieldId: command.fieldId,
    title: command.title, cropDisplayName: command.cropDisplayName, plannedLocalDate: command.plannedLocalDate,
    taskVersion: command.baseTaskVersion, ...(command.sourceKind ? { sourceKind: command.sourceKind } : {}),
  };
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, gap: 14, padding: 20, paddingBottom: 32 },
  weather: { gap: 8 },
  title: { color: "#142b1f", fontSize: 26, fontWeight: "700" },
  body: { color: "#263a30", fontSize: 17, lineHeight: 26 },
  error: { color: "#8b1d1d", fontSize: 16, lineHeight: 24 },
  status: { color: "#263a30", fontSize: 16, fontWeight: "600", lineHeight: 24 },
  task: { borderColor: "#b8c5bd", borderRadius: 8, borderWidth: 1, gap: 8, padding: 12 },
  taskTitle: { color: "#142b1f", fontSize: 19, fontWeight: "600" },
  button: { alignItems: "flex-start", borderColor: "#52616b", borderRadius: 8, borderWidth: 1, justifyContent: "center", minHeight: 48, paddingHorizontal: 14 },
  buttonText: { color: "#142b1f", fontSize: 17 },
});
