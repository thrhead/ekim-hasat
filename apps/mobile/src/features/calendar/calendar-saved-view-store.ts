import * as SQLite from "expo-sqlite";
import type { CalendarComponents } from "../../../../../packages/api-client/src/index";

type Read = CalendarComponents["schemas"]["CalendarRead"];
type Scope = Read["selectedDateTasksPage"]["readScope"];
type Page = Read["selectedDateTasksPage"] | Read["overdueTasksPage"];
type SavedScope = Readonly<{ businessId: string; selectedDate: string; fieldScope: Read["fieldScope"] }>;
type Staging = { accountId: string; read: Read; selected: Page["items"][number][]; overdue: Page["items"][number][]; next: Partial<Record<Page["group"], string>>; complete: Partial<Record<Page["group"], boolean>>; consumed: Partial<Record<Page["group"], Record<string, string>>> };
type StorageTx = {
  getStaging(key: string): Promise<unknown | null>;
  saveStaging(key: string, value: unknown): Promise<void>;
  deleteStaging(key: string): Promise<void>;
  promote(key: string, value: unknown): Promise<void>;
  findComplete(key: string): Promise<unknown | null>;
  findMostRecentComplete(accountId: string, request: { selectedDate?: string; fieldId?: string }): Promise<unknown | null>;
};
export type CalendarSavedViewStorage = { transaction<T>(work: (tx: StorageTx) => Promise<T>): Promise<T> };
export type CalendarSavedView = Read & Readonly<{
  accountId: string;
  coverageStatus: "COMPLETE";
  selectedDateTasks: Read["selectedDateTasksPage"]["items"];
  overdueTasks: Read["overdueTasksPage"]["items"];
}>;

const DATABASE_NAME = "ekim-hasat.db";
let databasePromise: Promise<SQLite.SQLiteDatabase> | undefined;
async function getDatabase() {
  databasePromise ??= SQLite.openDatabaseAsync(DATABASE_NAME).then(async (db) => {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS calendar_saved_views (
        view_key TEXT PRIMARY KEY NOT NULL, account_id TEXT NOT NULL, business_id TEXT NOT NULL,
        selected_date TEXT NOT NULL, field_scope_json TEXT NOT NULL, read_id TEXT NOT NULL,
        saved_json TEXT NOT NULL, coverage_status TEXT NOT NULL CHECK (coverage_status = 'COMPLETE')
      );
      CREATE INDEX IF NOT EXISTS calendar_saved_views_identity
        ON calendar_saved_views(account_id, business_id, selected_date);
      CREATE TABLE IF NOT EXISTS calendar_saved_view_staging (
        staging_key TEXT PRIMARY KEY NOT NULL, account_id TEXT NOT NULL, read_id TEXT NOT NULL, staging_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS calendar_saved_view_tasks (
        staging_key TEXT NOT NULL, task_group TEXT NOT NULL, task_id TEXT NOT NULL, task_json TEXT NOT NULL,
        PRIMARY KEY (staging_key, task_group, task_id)
      );
      CREATE TABLE IF NOT EXISTS calendar_saved_view_days (
        staging_key TEXT NOT NULL, local_date TEXT NOT NULL, has_work INTEGER NOT NULL,
        PRIMARY KEY (staging_key, local_date)
      );
      CREATE TABLE IF NOT EXISTS calendar_saved_view_chains (
        staging_key TEXT NOT NULL, task_group TEXT NOT NULL, next_cursor TEXT, is_terminal INTEGER NOT NULL,
        PRIMARY KEY (staging_key, task_group)
      );
      CREATE TABLE IF NOT EXISTS calendar_saved_view_saved_tasks (
        view_key TEXT NOT NULL, task_group TEXT NOT NULL, task_id TEXT NOT NULL, task_json TEXT NOT NULL,
        PRIMARY KEY (view_key, task_group, task_id)
      );
      CREATE TABLE IF NOT EXISTS calendar_saved_view_saved_days (
        view_key TEXT NOT NULL, local_date TEXT NOT NULL, has_work INTEGER NOT NULL,
        PRIMARY KEY (view_key, local_date)
      );
      CREATE TABLE IF NOT EXISTS calendar_saved_view_schema (version INTEGER NOT NULL);
      INSERT INTO calendar_saved_view_schema(version) SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM calendar_saved_view_schema);
    `);
    return db;
  });
  return databasePromise;
}

function scopeKey(accountId: string, scope: SavedScope): string {
  return JSON.stringify([accountId, scope.businessId, scope.selectedDate, scope.fieldScope]);
}
function stagingKey(accountId: string, readId: string): string { return JSON.stringify([accountId, readId]); }
function sameScope(a: Scope, b: Scope): boolean {
  return a.businessId === b.businessId && a.asOf === b.asOf && a.businessTimezone === b.businessTimezone
    && a.businessLocalToday === b.businessLocalToday && a.selectedDate === b.selectedDate
    && a.monthStart === b.monthStart && a.monthEnd === b.monthEnd
    && a.fieldScope.mode === b.fieldScope.mode && a.fieldScope.fieldId === b.fieldScope.fieldId
    && JSON.stringify(a.fieldScope.includedFieldIds) === JSON.stringify(b.fieldScope.includedFieldIds);
}
function validateRead(read: Read): void {
  if (read.monthIndicatorsComplete !== true || read.selectedDateTasksPage.readId !== read.readId
    || read.overdueTasksPage.readId !== read.readId || !sameScope(read.selectedDateTasksPage.readScope, read.overdueTasksPage.readScope)
    || read.selectedDateTasksPage.readScope.selectedDate !== read.selectedDate) throw invalidResponse();
  const tasks = [...read.selectedDateTasksPage.items, ...read.overdueTasksPage.items];
  const ids = new Set<string>();
  for (const task of tasks) {
    if (ids.has(task.taskId) || !read.fieldScope.includedFieldIds.includes(task.fieldId)) throw invalidResponse();
    ids.add(task.taskId);
  }
  if (read.selectedDateTasksPage.items.some((task) => task.plannedLocalDate !== read.selectedDate)
    || read.overdueTasksPage.items.some((task) => task.plannedLocalDate >= read.businessLocalToday)) throw invalidResponse();
}
function invalidResponse() { return Object.assign(new Error("Calendar saved view page does not match its read"), { code: "INVALID_RESPONSE" }); }

const sqliteStorage: CalendarSavedViewStorage = {
  async transaction(work) {
    const db = await getDatabase();
    let result!: unknown;
    await db.withExclusiveTransactionAsync(async (tx) => { result = await work({
      async getStaging(key) {
        const row = await tx.getFirstAsync<{ staging_json: string }>("SELECT staging_json FROM calendar_saved_view_staging WHERE staging_key = ?", key);
        return row ? JSON.parse(row.staging_json) as unknown : null;
      },
      async saveStaging(key, value) {
        const entry = value as Staging;
        await tx.runAsync("INSERT INTO calendar_saved_view_staging(staging_key, account_id, read_id, staging_json) VALUES (?, ?, ?, ?) ON CONFLICT(staging_key) DO UPDATE SET staging_json = excluded.staging_json", key, entry.accountId, entry.read.readId, JSON.stringify(entry));
        await tx.runAsync("DELETE FROM calendar_saved_view_tasks WHERE staging_key = ?", key);
        for (const [group, rows] of [["selectedDateTasks", entry.selected], ["overdueTasks", entry.overdue]] as const) {
          for (const row of rows) await tx.runAsync("INSERT OR REPLACE INTO calendar_saved_view_tasks(staging_key, task_group, task_id, task_json) VALUES (?, ?, ?, ?)", key, group, row.taskId, JSON.stringify(row));
        }
        await tx.runAsync("DELETE FROM calendar_saved_view_days WHERE staging_key = ?", key);
        for (const day of entry.read.monthIndicators) await tx.runAsync("INSERT INTO calendar_saved_view_days(staging_key, local_date, has_work) VALUES (?, ?, ?)", key, day.date, day.hasWork ? 1 : 0);
        await tx.runAsync("DELETE FROM calendar_saved_view_chains WHERE staging_key = ?", key);
        for (const group of ["selectedDateTasks", "overdueTasks"] as const) await tx.runAsync("INSERT INTO calendar_saved_view_chains(staging_key, task_group, next_cursor, is_terminal) VALUES (?, ?, ?, ?)", key, group, entry.next[group] ?? null, entry.complete[group] ? 1 : 0);
      },
      async deleteStaging(key) {
        await tx.runAsync("DELETE FROM calendar_saved_view_tasks WHERE staging_key = ?", key);
        await tx.runAsync("DELETE FROM calendar_saved_view_days WHERE staging_key = ?", key);
        await tx.runAsync("DELETE FROM calendar_saved_view_chains WHERE staging_key = ?", key);
        await tx.runAsync("DELETE FROM calendar_saved_view_staging WHERE staging_key = ?", key);
      },
      async promote(key, value) {
        const saved = value as Read & { accountId: string; selectedDateTasks: Page["items"]; overdueTasks: Page["items"] };
        await tx.runAsync("INSERT INTO calendar_saved_views(view_key, account_id, business_id, selected_date, field_scope_json, read_id, saved_json, coverage_status) VALUES (?, ?, ?, ?, ?, ?, ?, 'COMPLETE') ON CONFLICT(view_key) DO UPDATE SET read_id=excluded.read_id, saved_json=excluded.saved_json", key, saved.accountId, saved.businessId, saved.selectedDate, JSON.stringify(saved.fieldScope), saved.readId, JSON.stringify({ ...saved, coverageStatus: "COMPLETE" }));
        await tx.runAsync("DELETE FROM calendar_saved_view_saved_tasks WHERE view_key = ?", key);
        for (const [group, rows] of [["selectedDateTasks", saved.selectedDateTasks], ["overdueTasks", saved.overdueTasks]] as const) {
          for (const row of rows) await tx.runAsync("INSERT INTO calendar_saved_view_saved_tasks(view_key, task_group, task_id, task_json) VALUES (?, ?, ?, ?)", key, group, row.taskId, JSON.stringify(row));
        }
        await tx.runAsync("DELETE FROM calendar_saved_view_saved_days WHERE view_key = ?", key);
        for (const day of saved.monthIndicators) await tx.runAsync("INSERT INTO calendar_saved_view_saved_days(view_key, local_date, has_work) VALUES (?, ?, ?)", key, day.date, day.hasWork ? 1 : 0);
        await this.deleteStaging(stagingKey(saved.accountId, saved.readId));
      },
      async findComplete(key) {
        const row = await tx.getFirstAsync<{ saved_json: string }>("SELECT saved_json FROM calendar_saved_views WHERE view_key = ? AND coverage_status = 'COMPLETE'", key);
        return row ? JSON.parse(row.saved_json) as unknown : null;
      },
      async findMostRecentComplete(accountId, request) {
        const rows = await tx.getAllAsync<{ saved_json: string }>("SELECT saved_json FROM calendar_saved_views WHERE account_id = ? AND coverage_status = 'COMPLETE' ORDER BY rowid DESC", accountId);
        for (const row of rows) {
          const saved = JSON.parse(row.saved_json) as CalendarSavedView;
          if (request.selectedDate && saved.selectedDate !== request.selectedDate) continue;
          if (request.fieldId
            ? saved.fieldScope.mode !== "oneField" || saved.fieldScope.fieldId !== request.fieldId
            : saved.fieldScope.mode !== "allAuthorized") continue;
          return saved;
        }
        return null;
      },
    }); });
    return result as Awaited<ReturnType<typeof work>>;
  },
};

export function createCalendarSavedViewStore(options: { storage?: CalendarSavedViewStorage } = {}) {
  const storage = options.storage ?? sqliteStorage;
  return {
    async stageInitialRead(accountId: string, read: Read): Promise<void> {
      if (!accountId.trim()) throw new Error("An authenticated account is required for a Calendar saved view");
      validateRead(read);
      const key = stagingKey(accountId, read.readId);
      await storage.transaction(async (tx) => {
        const entry: Staging = {
          accountId, read,
          selected: [...read.selectedDateTasksPage.items], overdue: [...read.overdueTasksPage.items],
          next: { selectedDateTasks: read.selectedDateTasksPage.nextCursor, overdueTasks: read.overdueTasksPage.nextCursor },
          complete: { selectedDateTasks: read.selectedDateTasksPage.complete, overdueTasks: read.overdueTasksPage.complete },
          consumed: {},
        };
        if (entry.complete.selectedDateTasks && entry.next.selectedDateTasks || entry.complete.overdueTasks && entry.next.overdueTasks) throw invalidResponse();
        await tx.saveStaging(key, entry);
        if (entry.complete.selectedDateTasks && entry.complete.overdueTasks) {
          await tx.promote(scopeKey(accountId, { businessId: read.businessId, selectedDate: read.selectedDate, fieldScope: read.fieldScope }), { ...read, accountId, coverageStatus: "COMPLETE", selectedDateTasks: entry.selected, overdueTasks: entry.overdue });
          await tx.deleteStaging(key);
        }
      });
    },
    async appendPage(accountId: string, page: { readId: string; group: Page["group"]; requestedCursor: string; readScope: Scope; items: Page["items"]; complete: boolean; nextCursor?: string }): Promise<void> {
      const key = stagingKey(accountId, page.readId);
      await storage.transaction(async (tx) => {
        const existing = await tx.getStaging(key) as Staging | null;
        if (!existing) throw invalidResponse();
        const signature = JSON.stringify(page);
        const consumedPage = existing.consumed?.[page.group]?.[page.requestedCursor];
        if (consumedPage !== undefined) {
          if (consumedPage === signature) return;
          throw invalidResponse();
        }
        const expected = existing.next[page.group];
        if (!expected || expected !== page.requestedCursor || !sameScope(existing.read.selectedDateTasksPage.readScope, page.readScope)
          || (page.complete && page.nextCursor !== undefined) || (!page.complete && !page.nextCursor)) throw invalidResponse();
        const rows = page.group === "selectedDateTasks" ? existing.selected : existing.overdue;
        const ids = new Set(rows.map((row) => row.taskId));
        const otherGroupIds = new Set((page.group === "selectedDateTasks" ? existing.overdue : existing.selected).map((row) => row.taskId));
        if (page.items.some((row) => ids.has(row.taskId) || otherGroupIds.has(row.taskId) || !page.readScope.fieldScope.includedFieldIds.includes(row.fieldId)
          || (page.group === "selectedDateTasks" ? row.plannedLocalDate !== page.readScope.selectedDate : row.plannedLocalDate >= page.readScope.businessLocalToday))) throw invalidResponse();
        const updated: Staging = { ...existing, selected: page.group === "selectedDateTasks" ? [...rows, ...page.items] : existing.selected,
          overdue: page.group === "overdueTasks" ? [...rows, ...page.items] : existing.overdue,
          next: { ...existing.next, [page.group]: page.nextCursor }, complete: { ...existing.complete, [page.group]: page.complete },
          consumed: { ...existing.consumed, [page.group]: { ...existing.consumed?.[page.group], [page.requestedCursor]: signature } } };
        await tx.saveStaging(key, updated);
        if (updated.complete.selectedDateTasks && updated.complete.overdueTasks) {
          await tx.promote(scopeKey(accountId, { businessId: updated.read.businessId, selectedDate: updated.read.selectedDate, fieldScope: updated.read.fieldScope }), { ...updated.read, accountId, coverageStatus: "COMPLETE", selectedDateTasks: updated.selected, overdueTasks: updated.overdue });
          await tx.deleteStaging(key);
        }
      });
    },
    async getCompleteView(accountId: string, scope: SavedScope): Promise<CalendarSavedView | null> {
      return storage.transaction((tx) => tx.findComplete(scopeKey(accountId, scope)) as Promise<CalendarSavedView | null>);
    },
    async getMostRecentCompleteView(accountId: string, request: { selectedDate?: string; fieldId?: string } = {}): Promise<CalendarSavedView | null> {
      return storage.transaction((tx) => tx.findMostRecentComplete(accountId, request) as Promise<CalendarSavedView | null>);
    },
    async discardIncompleteRead(accountId: string, readId: string): Promise<void> {
      await storage.transaction(async (tx) => {
        const key = stagingKey(accountId, readId);
        const staged = await tx.getStaging(key) as Staging | null;
        if (staged && staged.accountId === accountId && staged.read.readId === readId
          && !(staged.complete.selectedDateTasks && staged.complete.overdueTasks)) await tx.deleteStaging(key);
      });
    },
  };
}

export type CalendarSavedViewStore = ReturnType<typeof createCalendarSavedViewStore>;
