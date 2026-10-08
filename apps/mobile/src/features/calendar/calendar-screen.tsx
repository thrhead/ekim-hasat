import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { ApiClient } from "../../../../../packages/api-client/src/index";
import { readCalendar, readCalendarPage, type CalendarRead, type CalendarReadError, type CalendarTaskGroup } from "./calendar-client";
import type { CalendarComponents } from "../../../../../packages/api-client/src/index";
import { CalendarRequestState } from "./calendar-state";
import { readFields, type FieldListItem } from "../fields/fields-client";
import { CalendarMonthOverview } from "./calendar-month-overview";
import { CalendarTaskDetail } from "./calendar-task-detail";
import { createCalendarSavedViewStore } from "./calendar-saved-view-store";
import type { CalendarSavedView } from "./calendar-saved-view-store";
import { canUseCalendarSavedView } from "./calendar-offline-policy";

type CalendarTask = CalendarComponents["schemas"]["CalendarTask"];
type SavedViewStore = ReturnType<typeof createCalendarSavedViewStore>;
const defaultSavedViewStore = createCalendarSavedViewStore();

export function CalendarScreen({ client, accountId, savedViewStore = defaultSavedViewStore }: { client: ApiClient; accountId: string; savedViewStore?: SavedViewStore }) {
  const [data, setData] = useState<CalendarRead | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ message: string; retryable: boolean } | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [loadingGroups, setLoadingGroups] = useState<Set<CalendarTaskGroup>>(new Set());
  const [fields, setFields] = useState<FieldListItem[]>([]);
  const [selectedFieldId, setSelectedFieldId] = useState<string | undefined>();
  const [fieldPickerOpen, setFieldPickerOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<CalendarTask | null>(null);
  const [adjustmentNotice, setAdjustmentNotice] = useState<string | null>(null);
  const [showingSavedView, setShowingSavedView] = useState(false);
  const requestState = useRef(new CalendarRequestState());
  const activeRequest = useRef<ReturnType<CalendarRequestState["beginRead"]> | null>(null);
  const retryRequest = useRef<{ selectedDate?: string; fieldId?: string }>({});
  const inFlightPages = useRef(new Set<string>());

  const load = useCallback(async (requestBody: { selectedDate?: string; fieldId?: string } = {}) => {
    retryRequest.current = requestBody;
    const request = requestState.current.beginRead(accountId, client);
    activeRequest.current = request;
    setLoading(true);
    setError(null);
    setPageError(null);
    setShowingSavedView(false);
    try {
      // The initial view deliberately omits selectedDate; the server owns Business-local today.
      const read = await readCalendar(client, requestBody);
      if (!requestState.current.acceptRead(request, read)) return;
      void savedViewStore.stageInitialRead(accountId, read).catch(() => undefined);
      setData(read);
      setSelectedFieldId(requestBody.fieldId);
    } catch (failure) {
      if (!requestState.current.isCurrent(request)) return;
      const status = (failure as CalendarReadError)?.status;
      const accessFailure = status === 401 || status === 403 || status === 404;
      const retryable = isRetryableConnectivityFailure(failure);
      if (!accessFailure && retryable) {
        try {
          const saved = await savedViewStore.getMostRecentCompleteView(accountId, requestBody);
          const requested = saved && { businessId: saved.businessId, selectedDate: requestBody.selectedDate ?? saved.selectedDate, fieldScope: saved.fieldScope };
          if (saved && requested && canUseCalendarSavedView({ error: { retryable, status, code: (failure as CalendarReadError)?.code }, accountId, requested, savedView: saved })) {
            const offlineRead = asCompleteRead(saved);
            if (!requestState.current.acceptRead(request, offlineRead)) return;
            setData(offlineRead);
            setSelectedFieldId(saved.fieldScope.mode === "oneField" ? saved.fieldScope.fieldId : undefined);
            setShowingSavedView(true);
            setError(null);
            return;
          }
        } catch { /* Local storage failure leaves the normal retryable error state. */ }
      }
      setData(null);
      setError({
        message: accessFailure
          ? "Takvim bilgilerine erişiminiz doğrulanamadı. Yeniden bağlanıp erişiminizi kontrol edin."
          : "Takvim yüklenemedi. İnternet bağlantınızı kontrol edip yeniden deneyin.",
        retryable,
      });
    } finally {
      if (requestState.current.isCurrent(request)) setLoading(false);
    }
  }, [client, accountId, savedViewStore]);

  const loadMore = useCallback(async (group: CalendarTaskGroup) => {
    if (!data || loadingGroups.has(group)) return;
    const firstPage = group === "overdueTasks" ? data.overdueTasksPage : data.selectedDateTasksPage;
    if (firstPage.complete || !firstPage.nextCursor || !activeRequest.current) return;
    const cursor = firstPage.nextCursor;
    const request = requestState.current.beginPage(activeRequest.current, data.readId);
    if (!request) return;
    const pageKey = `${data.readId}:${group}:${cursor}`;
    if (inFlightPages.current.has(pageKey)) return;
    inFlightPages.current.add(pageKey);
    setLoadingGroups((current) => new Set(current).add(group));
    setPageError(null);
    try {
      const page = await readCalendarPage(client, { readId: data.readId, group, cursor, readScope: firstPage.readScope });
      if (!requestState.current.isCurrentRead(request, page.readId, page.readScope.businessId)
        || page.requestedCursor !== cursor) return;
      const existingIds = new Set(firstPage.items.map(({ taskId }) => taskId));
      if (page.items.some(({ taskId }) => existingIds.has(taskId))) throw new Error("Calendar page repeated a task");
      void savedViewStore.appendPage(accountId, page).catch(() => undefined);
      setData((current) => {
        if (!current || current.readId !== data.readId) return current;
        const currentPage = group === "overdueTasks" ? current.overdueTasksPage : current.selectedDateTasksPage;
        if (currentPage.nextCursor !== cursor) return current;
        const combined = { ...page, items: [...currentPage.items, ...page.items] };
        return group === "overdueTasks"
          ? { ...current, overdueTasksPage: combined }
          : { ...current, selectedDateTasksPage: combined };
      });
    } catch (failure) {
      if (requestState.current.isCurrentRead(request, data.readId, data.businessId)) {
        const status = (failure as CalendarReadError)?.status;
        if (status === 410) {
          if (!requestState.current.restartExpiredRead(request, data.readId, data.businessId)) return;
          await savedViewStore.discardIncompleteRead(accountId, data.readId).catch(() => undefined);
          void load(retryRequest.current);
        } else if (status === 401 || status === 403 || status === 404) {
          setData(null);
          setShowingSavedView(false);
          setError({ message: "Takvim bilgilerine erişiminiz doğrulanamadı. Yeniden bağlanıp erişiminizi kontrol edin.", retryable: false });
        } else setPageError("İşlerin devamı yüklenemedi. Bağlantınızı kontrol edip yeniden deneyin.");
      }
    } finally {
      inFlightPages.current.delete(pageKey);
      if (requestState.current.isCurrent(request)) {
        setLoadingGroups((current) => { const next = new Set(current); next.delete(group); return next; });
      }
    }
  }, [accountId, client, data, load, loadingGroups, savedViewStore]);

  useEffect(() => {
    void load();
    return () => { requestState.current.invalidate(); };
  }, [load]);

  useEffect(() => {
    let current = true;
    void readAuthorizedFields(client).then((items) => { if (current) setFields(items); }).catch(() => { if (current) setFields([]); });
    return () => { current = false; };
  }, [accountId, client]);

  const selectDate = (selectedDate: string) => {
    setAdjustmentNotice(null);
    void load({ selectedDate, ...(selectedFieldId ? { fieldId: selectedFieldId } : {}) });
  };

  const changeMonth = (offset: -1 | 1) => {
    if (!data) return;
    setAdjustmentNotice(null);
    void load({ selectedDate: shiftMonth(data.selectedDate, offset), ...(selectedFieldId ? { fieldId: selectedFieldId } : {}) });
  };

  const selectField = (fieldId?: string) => {
    if (!data) return;
    setAdjustmentNotice(null);
    setFieldPickerOpen(false);
    void load({ selectedDate: data.selectedDate, ...(fieldId ? { fieldId } : {}) });
  };
  const selectedFieldName = selectedFieldId
    ? fields.find(({ id }) => id === selectedFieldId)?.name ?? "Seçili tarla"
    : "Tüm tarlalar";

  return <ScrollView contentContainerStyle={styles.content} accessibilityLabel="Takvim işleri">
    <Text accessibilityRole="header" style={styles.title}>Takvim</Text>
    {adjustmentNotice && <Text accessibilityRole="text" accessibilityLiveRegion="polite" style={styles.status}>{adjustmentNotice}</Text>}
    {loading && <Text accessibilityRole="progressbar" accessibilityLabel="Takvim yükleniyor" accessibilityLiveRegion="polite" style={styles.status}>Takvim yükleniyor…</Text>}
    {!loading && error && <View>
      <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" style={styles.error}>{error.message}</Text>
      {error.retryable && <Pressable accessibilityRole="button" accessibilityLabel="Takvimi yeniden dene" onPress={() => void load(retryRequest.current)} style={styles.retry}>
        <Text style={styles.retryText}>Yeniden dene</Text>
      </Pressable>}
    </View>}
    {!loading && !error && data && <View>
      {showingSavedView && <Text accessibilityRole="text" accessibilityLiveRegion="polite" style={styles.savedNotice}>Kayıtlı takvim bilgisi · Güncel olmayabilir. İnternet bağlantısı geldiğinde yeniden deneyin.</Text>}
      <Text accessibilityRole="header" style={styles.date}>{formatCalendarDate(data.selectedDate)}</Text>
      {fields.length > 0 && <View style={styles.fieldFilter}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Tarla filtresi: ${selectedFieldName}`} accessibilityHint="Tarla kapsamını değiştirir" accessibilityState={{ expanded: fieldPickerOpen }} onPress={() => setFieldPickerOpen((open) => !open)} style={styles.filterButton}>
          <Text style={styles.filterText}>{selectedFieldName}</Text>
        </Pressable>
        {fieldPickerOpen && <View>
          <Pressable accessibilityRole="button" accessibilityLabel="Tarla filtresi: Tüm tarlalar" onPress={() => selectField()} style={styles.fieldOption}><Text style={styles.filterText}>Tüm tarlalar</Text></Pressable>
          {fields.map((field) => <Pressable key={field.id} accessibilityRole="button" accessibilityLabel={`Tarla filtresi: ${field.name}`} accessibilityState={{ selected: selectedFieldId === field.id }} onPress={() => selectField(field.id)} style={styles.fieldOption}>
            <Text style={styles.filterText}>{field.name}</Text>
          </Pressable>)}
        </View>}
      </View>}
      {!data.activeSeasonExists && <Text accessibilityLiveRegion="polite" style={styles.empty}>{data.fieldScope.mode === "oneField" ? "Bu tarlada henüz etkin bir sezon yok." : "Henüz etkin bir sezon yok."}</Text>}
      {data.activeSeasonExists && data.overdueTasksPage.items.length === 0 && data.selectedDateTasksPage.items.length === 0
        && <Text accessibilityLiveRegion="polite" style={styles.empty}>{emptyMessage(data)}</Text>}
      {data.overdueTasksPage.items.length > 0 && <View style={styles.section}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>Geciken işler</Text>
        {data.overdueTasksPage.items.map((task) => <TaskRow key={task.taskId} task={task} onPress={setSelectedTask} />)}
        {!data.overdueTasksPage.complete && <Pressable accessibilityRole="button" accessibilityLabel="Daha fazla geciken iş" accessibilityState={{ disabled: loadingGroups.has("overdueTasks"), busy: loadingGroups.has("overdueTasks") }} disabled={loadingGroups.has("overdueTasks")} onPress={() => void loadMore("overdueTasks")} style={styles.more}>
          <Text style={styles.moreText}>{loadingGroups.has("overdueTasks") ? "Yükleniyor…" : "Daha fazla geciken iş"}</Text>
        </Pressable>}
      </View>}
      {data.selectedDateTasksPage.items.length > 0 && <View style={styles.section}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>{data.selectedDate === data.businessLocalToday ? "Bugünün işleri" : "Seçilen günün işleri"}</Text>
        {data.selectedDateTasksPage.items.map((task) => <TaskRow key={task.taskId} task={task} onPress={setSelectedTask} />)}
        {!data.selectedDateTasksPage.complete && <Pressable accessibilityRole="button" accessibilityLabel={data.selectedDate === data.businessLocalToday ? "Bugünün işlerinin devamını yükle" : "Seçilen günün işlerinin devamını yükle"} accessibilityState={{ disabled: loadingGroups.has("selectedDateTasks"), busy: loadingGroups.has("selectedDateTasks") }} disabled={loadingGroups.has("selectedDateTasks")} onPress={() => void loadMore("selectedDateTasks")} style={styles.more}>
          <Text style={styles.moreText}>{loadingGroups.has("selectedDateTasks") ? "Yükleniyor…" : "Daha fazla iş"}</Text>
        </Pressable>}
      </View>}
      {pageError && <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" style={styles.error}>{pageError}</Text>}
      <CalendarMonthOverview monthStart={data.monthStart} indicators={data.monthIndicators} selectedDate={data.selectedDate} onSelectDate={selectDate} onChangeMonth={changeMonth} />
    </View>}
    {selectedTask && <CalendarTaskDetail task={selectedTask} onClose={() => setSelectedTask(null)} saved={showingSavedView} client={client}
      onAccepted={async () => {
        setAdjustmentNotice("Görev tarihi değişikliği kaydedildi.");
        const selectedDate = data?.selectedDate;
        const fieldId = selectedFieldId ?? (data?.fieldScope.mode === "oneField" ? data.fieldScope.fieldId : undefined);
        setSelectedTask(null);
        await load({ ...(selectedDate ? { selectedDate } : {}), ...(fieldId ? { fieldId } : {}) });
      }} />}
  </ScrollView>;
}

function TaskRow({ task, onPress }: { task: CalendarTask; onPress: (task: CalendarTask) => void }) {
  return <Pressable accessible accessibilityRole="button" accessibilityLabel={`${task.title}, ${task.fieldName}, ${formatCalendarDate(task.plannedLocalDate)}`} accessibilityHint="Görev ayrıntılarını açar" onPress={() => onPress(task)} style={styles.taskRow}>
    <Text style={styles.taskTitle}>{task.title}</Text>
    <Text style={styles.taskMeta}>{task.fieldName} · {formatCalendarDate(task.plannedLocalDate)}</Text>
  </Pressable>;
}

function formatCalendarDate(value: string): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  return new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(date);
}

function emptyMessage(data: CalendarRead): string {
  const dateLabel = data.selectedDate === data.businessLocalToday ? "bugün için" : "seçilen gün için";
  return data.fieldScope.mode === "oneField"
    ? `Bu tarlada ${dateLabel} veya geciken planlanmış iş yok.`
    : `${dateLabel[0]!.toLocaleUpperCase("tr-TR")}${dateLabel.slice(1)} veya geciken planlanmış iş yok.`;
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 20, paddingBottom: 24, backgroundColor: "#fff" },
  title: { color: "#17261c", fontSize: 28, fontWeight: "700", marginBottom: 18 },
  date: { color: "#17261c", fontSize: 21, fontWeight: "600", marginBottom: 18 },
  status: { color: "#26352a", fontSize: 16, paddingVertical: 16 },
  savedNotice: { color: "#526057", fontSize: 14, lineHeight: 21, paddingBottom: 12 },
  error: { color: "#8b2020", fontSize: 16, lineHeight: 23 },
  empty: { color: "#4d5b50", fontSize: 16, lineHeight: 24, paddingVertical: 16 },
  section: { marginTop: 8, marginBottom: 20 },
  sectionTitle: { color: "#7d321d", fontSize: 18, fontWeight: "700", marginBottom: 8 },
  taskRow: { paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#b7beb8" },
  taskTitle: { color: "#17261c", fontSize: 16, fontWeight: "600", lineHeight: 23 },
  taskMeta: { color: "#526057", fontSize: 14, marginTop: 5 },
  retry: { alignSelf: "flex-start", minHeight: 48, justifyContent: "center", paddingHorizontal: 16, marginTop: 12, borderRadius: 10, backgroundColor: "#285c3d" },
  retryText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  more: { minHeight: 48, justifyContent: "center", alignSelf: "flex-start", paddingHorizontal: 8 },
  moreText: { color: "#285c3d", fontSize: 15, fontWeight: "600" },
  fieldFilter: { marginBottom: 10 },
  filterButton: { alignSelf: "flex-start", minHeight: 48, justifyContent: "center", paddingHorizontal: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: "#526057", borderRadius: 8 },
  fieldOption: { minHeight: 48, justifyContent: "center", paddingHorizontal: 12 },
  filterText: { color: "#17261c", fontSize: 15 },
});

async function readAuthorizedFields(client: ApiClient): Promise<FieldListItem[]> {
  const items: FieldListItem[] = [];
  const usedCursors = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await readFields(client, { limit: 100, ...(cursor ? { cursor } : {}) });
    items.push(...page.items);
    cursor = page.nextCursor ?? undefined;
    if (cursor && usedCursors.has(cursor)) throw new Error("Field list cursor repeated");
    if (cursor) usedCursors.add(cursor);
  } while (cursor);
  return items;
}

function isRetryableConnectivityFailure(failure: unknown): boolean {
  if (typeof failure !== "object" || failure === null) return false;
  const error = failure as CalendarReadError & { retryable?: boolean };
  if (error.retryable === true) return true;
  if (error.status !== undefined) return error.status === 408 || error.status === 429 || error.status >= 500;
  return failure instanceof TypeError && error.code !== "INVALID_RESPONSE";
}

function asCompleteRead(saved: CalendarSavedView): CalendarRead {
  return {
    readId: saved.readId,
    asOf: saved.asOf,
    expiresAt: saved.expiresAt,
    businessId: saved.businessId,
    businessTimezone: saved.businessTimezone,
    businessLocalToday: saved.businessLocalToday,
    selectedDate: saved.selectedDate,
    monthStart: saved.monthStart,
    monthEnd: saved.monthEnd,
    fieldScope: saved.fieldScope,
    activeSeasonExists: saved.activeSeasonExists,
    hasAnyUnfinishedWork: saved.selectedDateTasks.length + saved.overdueTasks.length > 0,
    monthIndicatorsComplete: true,
    monthIndicators: saved.monthIndicators,
    selectedDateTasksPage: { ...saved.selectedDateTasksPage, complete: true, nextCursor: undefined, items: saved.selectedDateTasks },
    overdueTasksPage: { ...saved.overdueTasksPage, complete: true, nextCursor: undefined, items: saved.overdueTasks },
  };
}

function shiftMonth(value: string, offset: -1 | 1): string {
  const [year, month, day] = value.split("-").map(Number);
  const first = new Date(Date.UTC(year!, month! - 1 + offset, 1));
  const nextYear = first.getUTCFullYear();
  const nextMonth = first.getUTCMonth() + 1;
  const lastDay = new Date(Date.UTC(nextYear, nextMonth, 0)).getUTCDate();
  return `${String(nextYear).padStart(4, "0")}-${String(nextMonth).padStart(2, "0")}-${String(Math.min(day!, lastDay)).padStart(2, "0")}`;
}
