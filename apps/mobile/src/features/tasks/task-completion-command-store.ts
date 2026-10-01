import * as SQLite from "expo-sqlite";
import type { SeasonOperations, TaskCompletionComponents } from "../../../../../packages/api-client/src/index";

export type Today = SeasonOperations["getTodayPlannedTasks"]["responses"][200]["content"]["application/json"];
export type TodaySnapshot = Readonly<Today & { fetchedAt: string }>;
export type TaskCompletionCommand = Readonly<{
  completionId: string;
  taskId: string;
  seasonId: string;
  fieldId: string;
  title: string;
  cropDisplayName: string;
  sourceKind?: "MANUAL" | "VALIDATED_TEMPLATE";
  plannedLocalDate: string;
  baseTaskVersion: number;
  occurredAt: string;
  request: Readonly<{ completionId: string; occurredAt: string }>;
  state: "PENDING" | "ACCEPTED" | "CONFLICTED";
  result?: TaskCompletionComponents["schemas"]["TaskCompletion"];
  conflictCode?: string;
}>;

export type TaskCompletionCommandStorage = Readonly<{
  listCommands(accountId: string): Promise<TaskCompletionCommand[]>;
  insertCommand(accountId: string, command: TaskCompletionCommand): Promise<void>;
  recordAccepted(accountId: string, completionId: string, result: TaskCompletionComponents["schemas"]["TaskCompletion"]): Promise<void>;
  recordConflict(accountId: string, completionId: string, conflictCode: string): Promise<void>;
  writeTodaySnapshot(accountId: string, snapshot: TodaySnapshot): Promise<void>;
  readTodaySnapshot(accountId: string): Promise<TodaySnapshot | null>;
}>;

export function belongsToBusinessToday(snapshot: Pick<TodaySnapshot, "localDate" | "businessTimezone">, now: Date): boolean {
  if (!Number.isFinite(now.getTime())) return false;
  try {
    const parts = new Intl.DateTimeFormat("en", {
      timeZone: snapshot.businessTimezone,
      year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(now);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}` === snapshot.localDate;
  } catch {
    return false;
  }
}

const DATABASE_NAME = "ekim-hasat.db";
let databasePromise: Promise<SQLite.SQLiteDatabase> | undefined;

async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  databasePromise ??= SQLite.openDatabaseAsync(DATABASE_NAME).then(async (database) => {
    await database.execAsync(`
      CREATE TABLE IF NOT EXISTS task_completion_commands (
        account_id TEXT NOT NULL,
        completion_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        season_id TEXT NOT NULL,
        field_id TEXT NOT NULL,
        title TEXT NOT NULL,
        crop_display_name TEXT NOT NULL,
        source_kind TEXT,
        planned_local_date TEXT NOT NULL,
        base_task_version INTEGER NOT NULL,
        occurred_at TEXT NOT NULL,
        request_json TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('PENDING', 'ACCEPTED', 'CONFLICTED')),
        result_json TEXT,
        conflict_code TEXT,
        PRIMARY KEY (account_id, completion_id)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS task_completion_one_live_command_per_task
        ON task_completion_commands(account_id, task_id) WHERE state IN ('PENDING', 'ACCEPTED');
      CREATE TABLE IF NOT EXISTS today_task_snapshot (
        account_id TEXT PRIMARY KEY NOT NULL,
        local_date TEXT NOT NULL,
        business_timezone TEXT NOT NULL,
        fetched_at TEXT NOT NULL,
        snapshot_json TEXT NOT NULL
      );
    `);
    return database;
  });
  return databasePromise;
}

const sqliteStorage: TaskCompletionCommandStorage = {
  async listCommands(accountId) {
    const db = await getDatabase();
    const rows = await db.getAllAsync<{
      completion_id: string; task_id: string; season_id: string; field_id: string; title: string;
      crop_display_name: string; source_kind: "MANUAL" | "VALIDATED_TEMPLATE" | null; planned_local_date: string;
      base_task_version: number; occurred_at: string; request_json: string; state: TaskCompletionCommand["state"];
      result_json: string | null; conflict_code: string | null;
    }>(
      `SELECT completion_id, task_id, season_id, field_id, title, crop_display_name, source_kind, planned_local_date,
        base_task_version, occurred_at, request_json, state, result_json, conflict_code
       FROM task_completion_commands WHERE account_id = ? ORDER BY rowid`,
      accountId,
    );
    return rows.map((row) => parseCommand(JSON.stringify({
      completionId: row.completion_id, taskId: row.task_id, seasonId: row.season_id, fieldId: row.field_id,
      title: row.title, cropDisplayName: row.crop_display_name, ...(row.source_kind ? { sourceKind: row.source_kind } : {}),
      plannedLocalDate: row.planned_local_date, baseTaskVersion: row.base_task_version, occurredAt: row.occurred_at,
      request: JSON.parse(row.request_json), state: row.state,
      ...(row.result_json ? { result: JSON.parse(row.result_json) } : {}), ...(row.conflict_code ? { conflictCode: row.conflict_code } : {}),
    })));
  },
  async insertCommand(accountId, command) {
    const db = await getDatabase();
    await db.runAsync(
      `INSERT INTO task_completion_commands
       (account_id, completion_id, task_id, season_id, field_id, title, crop_display_name, source_kind,
        planned_local_date, base_task_version, occurred_at, request_json, state)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')`,
      accountId, command.completionId, command.taskId, command.seasonId, command.fieldId, command.title,
      command.cropDisplayName, command.sourceKind ?? null, command.plannedLocalDate, command.baseTaskVersion,
      command.occurredAt, JSON.stringify(command.request),
    );
  },
  async recordAccepted(accountId, completionId, result) {
    const db = await getDatabase();
    const resultJson = JSON.stringify(result);
    await db.withExclusiveTransactionAsync(async (tx) => {
      const update = await tx.runAsync(
        "UPDATE task_completion_commands SET state = 'ACCEPTED', result_json = ?, conflict_code = NULL WHERE account_id = ? AND completion_id = ? AND state = 'PENDING'",
        resultJson, accountId, completionId,
      );
      if (update.changes !== 1) throw new Error("Pending task completion command was not found");
    });
  },
  async recordConflict(accountId, completionId, conflictCode) {
    const db = await getDatabase();
    await db.withExclusiveTransactionAsync(async (tx) => {
      const update = await tx.runAsync(
        "UPDATE task_completion_commands SET state = 'CONFLICTED', conflict_code = ?, result_json = NULL WHERE account_id = ? AND completion_id = ? AND state = 'PENDING'",
        conflictCode, accountId, completionId,
      );
      if (update.changes !== 1) throw new Error("Pending task completion command was not found");
    });
  },
  async writeTodaySnapshot(accountId, snapshot) {
    const db = await getDatabase();
    await db.runAsync(
      `INSERT INTO today_task_snapshot (account_id, local_date, business_timezone, fetched_at, snapshot_json)
       VALUES (?, ?, ?, ?, ?) ON CONFLICT(account_id) DO UPDATE SET
       local_date = excluded.local_date, business_timezone = excluded.business_timezone,
       fetched_at = excluded.fetched_at, snapshot_json = excluded.snapshot_json`,
      accountId, snapshot.localDate, snapshot.businessTimezone, snapshot.fetchedAt, JSON.stringify(snapshot),
    );
  },
  async readTodaySnapshot(accountId) {
    const db = await getDatabase();
    const row = await db.getFirstAsync<{ snapshot_json: string }>(
      "SELECT snapshot_json FROM today_task_snapshot WHERE account_id = ?", accountId,
    );
    return row ? parseSnapshot(row.snapshot_json) : null;
  },
};

export function createTaskCompletionCommandStore(options: Readonly<{ storage?: TaskCompletionCommandStorage }> = {}) {
  const storage = options.storage ?? sqliteStorage;
  return {
    async list(accountId: string): Promise<TaskCompletionCommand[]> {
      return storage.listCommands(assertAccountId(accountId));
    },
    async enqueue(accountId: string, command: TaskCompletionCommand): Promise<void> {
      const account = assertAccountId(accountId);
      validateCommand(command);
      const existing = await storage.listCommands(account);
      const sameId = existing.find((entry) => entry.completionId === command.completionId);
      if (sameId) {
        if (JSON.stringify(withoutOptional(sameId)) !== JSON.stringify(withoutOptional(command))) {
          throw new Error("Completion identity cannot be reused with a changed command");
        }
        return;
      }
      if (existing.some((entry) => entry.taskId === command.taskId && ["PENDING", "ACCEPTED"].includes(entry.state))) {
        throw new Error("A pending or accepted completion already exists for this task");
      }
      await storage.insertCommand(account, { ...command, state: "PENDING" });
    },
    async recordAccepted(accountId: string, completionId: string, result: TaskCompletionComponents["schemas"]["TaskCompletion"]): Promise<void> {
      const account = assertAccountId(accountId);
      const pending = (await storage.listCommands(account)).find((item) => item.completionId === completionId && item.state === "PENDING");
      if (!pending || result.id !== completionId || result.taskId !== pending.taskId
        || result.seasonId !== pending.seasonId || result.fieldId !== pending.fieldId
        || Date.parse(result.occurredAt) !== Date.parse(pending.occurredAt)) {
        throw new Error("Accepted result does not match the pending completion command");
      }
      await storage.recordAccepted(account, completionId, result);
    },
    async recordConflict(accountId: string, completionId: string, conflictCode: string): Promise<void> {
      if (!conflictCode.trim()) throw new Error("A conflict code is required");
      await storage.recordConflict(assertAccountId(accountId), completionId, conflictCode);
    },
    async writeTodaySnapshot(accountId: string, snapshot: TodaySnapshot): Promise<void> {
      assertAccountId(accountId);
      validateSnapshot(snapshot);
      await storage.writeTodaySnapshot(accountId, snapshot);
    },
    async readTodaySnapshot(accountId: string): Promise<TodaySnapshot | null> {
      return storage.readTodaySnapshot(assertAccountId(accountId));
    },
    belongsToBusinessToday(snapshot: TodaySnapshot, now: Date): boolean {
      return belongsToBusinessToday(snapshot, now);
    },
  };
}

export type TaskCompletionCommandStore = ReturnType<typeof createTaskCompletionCommandStore>;

function assertAccountId(accountId: string): string {
  if (typeof accountId !== "string" || accountId.trim().length === 0) throw new Error("An authenticated account is required");
  return accountId;
}

function validateCommand(command: TaskCompletionCommand): void {
  if (!command || typeof command !== "object" || !command.completionId || !command.taskId || !command.seasonId || !command.fieldId
        || !command.title || !command.cropDisplayName || (command.sourceKind !== undefined && !["MANUAL", "VALIDATED_TEMPLATE"].includes(command.sourceKind))
    || !Number.isSafeInteger(command.baseTaskVersion) || command.baseTaskVersion < 1
    || !Number.isFinite(Date.parse(command.occurredAt)) || command.request?.completionId !== command.completionId
    || command.request?.occurredAt !== command.occurredAt) throw new Error("The task completion command is invalid");
}

function validateSnapshot(snapshot: TodaySnapshot): void {
  if (!snapshot || typeof snapshot.localDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(snapshot.localDate)
    || typeof snapshot.businessTimezone !== "string" || !snapshot.businessTimezone
    || !Number.isFinite(Date.parse(snapshot.fetchedAt))) throw new Error("The synchronized Today snapshot is invalid");
}

function parseCommand(json: string): TaskCompletionCommand {
  const value = JSON.parse(json) as TaskCompletionCommand;
  validateCommand(value);
  return value;
}

function parseSnapshot(json: string): TodaySnapshot {
  const value = JSON.parse(json) as TodaySnapshot;
  validateSnapshot(value);
  return value;
}

function withoutOptional(command: TaskCompletionCommand) {
  return {
    completionId: command.completionId, taskId: command.taskId, seasonId: command.seasonId, fieldId: command.fieldId,
    title: command.title, cropDisplayName: command.cropDisplayName, ...(command.sourceKind ? { sourceKind: command.sourceKind } : {}),
    plannedLocalDate: command.plannedLocalDate, baseTaskVersion: command.baseTaskVersion,
    occurredAt: command.occurredAt, request: command.request,
  };
}
