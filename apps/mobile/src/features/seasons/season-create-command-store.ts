import * as SQLite from "expo-sqlite";
import type { SeasonComponents } from "../../api/onboarding-client";

export type SeasonCreateRequest = SeasonComponents["schemas"]["CreateSeasonDraftRequest"];
export type SeasonCreateResult = SeasonComponents["schemas"]["SeasonDraft"] | SeasonComponents["schemas"]["ActiveSeason"];

/** The complete replayable request; credentials are deliberately not part of this value. */
export type SeasonCreateCommand = Readonly<{
  idempotencyKey: string;
  fieldId: string;
  request: SeasonCreateRequest;
}>;

export type SeasonCreateCommandStorage = Readonly<{
  read(accountId: string): Promise<StoredSeasonCreateCommandState | null>;
  saveCommand(accountId: string, command: SeasonCreateCommand): Promise<void>;
  recordSuccess(
    accountId: string,
    idempotencyKey: string,
    result: SeasonCreateResult,
  ): Promise<void>;
  clearSuccess(accountId: string, idempotencyKey: string): Promise<void>;
}>;

export type StoredSeasonCreateCommandState = Readonly<{
  unresolved: SeasonCreateCommand | null;
  lastSuccess: Readonly<{ idempotencyKey: string; result: SeasonCreateResult }> | null;
}>;

const DATABASE_NAME = "ekim-hasat.db";

let databasePromise: Promise<SQLite.SQLiteDatabase> | undefined;

async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  databasePromise ??= SQLite.openDatabaseAsync(DATABASE_NAME).then(async (database) => {
    await database.execAsync(`
      CREATE TABLE IF NOT EXISTS season_create_command_state (
        account_id TEXT PRIMARY KEY NOT NULL,
        unresolved_json TEXT,
        unresolved_key TEXT,
        last_success_json TEXT,
        last_success_key TEXT
      );
    `);
    return database;
  });
  return databasePromise;
}

const sqliteStorage: SeasonCreateCommandStorage = {
  async read(accountId) {
    const database = await getDatabase();
    const row = await database.getFirstAsync<{
      unresolved_json: string | null;
      last_success_json: string | null;
      last_success_key: string | null;
    }>(
      "SELECT unresolved_json, last_success_json, last_success_key FROM season_create_command_state WHERE account_id = ?",
      accountId,
    );
    if (!row) return null;
    return {
      unresolved: row.unresolved_json ? parseCommand(row.unresolved_json) : null,
      lastSuccess: row.last_success_json && row.last_success_key
        ? { idempotencyKey: row.last_success_key, result: parseResult(row.last_success_json) }
        : null,
    };
  },

  async saveCommand(accountId, command) {
    const database = await getDatabase();
    const commandJson = JSON.stringify(command);
    await database.withExclusiveTransactionAsync(async (transaction) => {
      const row = await transaction.getFirstAsync<{ unresolved_json: string | null; unresolved_key: string | null }>(
        "SELECT unresolved_json, unresolved_key FROM season_create_command_state WHERE account_id = ?",
        accountId,
      );
      if (row?.unresolved_json) {
        if (row.unresolved_key !== command.idempotencyKey || row.unresolved_json !== commandJson) {
          throw new Error("An unresolved season create command already exists for this account");
        }
        return;
      }
      await transaction.runAsync(
        `INSERT INTO season_create_command_state (account_id, unresolved_json, unresolved_key)
         VALUES (?, ?, ?)
         ON CONFLICT(account_id) DO UPDATE SET unresolved_json = excluded.unresolved_json, unresolved_key = excluded.unresolved_key`,
        accountId,
        commandJson,
        command.idempotencyKey,
      );
    });
  },

  async recordSuccess(accountId, idempotencyKey, result) {
    const database = await getDatabase();
    const resultJson = JSON.stringify(result);
    await database.withExclusiveTransactionAsync(async (transaction) => {
      await transaction.runAsync(
        `INSERT INTO season_create_command_state
           (account_id, unresolved_json, unresolved_key, last_success_json, last_success_key)
         VALUES (?, NULL, NULL, ?, ?)
         ON CONFLICT(account_id) DO UPDATE SET
           unresolved_json = CASE WHEN unresolved_key = ? THEN NULL ELSE unresolved_json END,
           unresolved_key = CASE WHEN unresolved_key = ? THEN NULL ELSE unresolved_key END,
           last_success_json = excluded.last_success_json,
           last_success_key = excluded.last_success_key`,
        accountId,
        resultJson,
        idempotencyKey,
        idempotencyKey,
        idempotencyKey,
      );
    });
  },

  async clearSuccess(accountId, idempotencyKey) {
    const database = await getDatabase();
    await database.runAsync(
      "UPDATE season_create_command_state SET last_success_json = NULL, last_success_key = NULL WHERE account_id = ? AND last_success_key = ?",
      accountId,
      idempotencyKey,
    );
  },
};

function accountKey(accountId: string): string {
  if (typeof accountId !== "string" || accountId.trim().length === 0) {
    throw new Error("An authenticated account is required for a season create command");
  }
  return accountId;
}

export function createSeasonCreateCommandStore(options: Readonly<{ storage?: SeasonCreateCommandStorage }> = {}) {
  const storage = options.storage ?? sqliteStorage;

  return {
    async readUnresolved(accountId: string): Promise<SeasonCreateCommand | null> {
      return (await storage.read(accountKey(accountId)))?.unresolved ?? null;
    },

    async saveUnresolved(accountId: string, command: SeasonCreateCommand): Promise<void> {
      assertCommand(command);
      await storage.saveCommand(accountKey(accountId), command);
    },

    async recordSuccess(accountId: string, idempotencyKey: string, result: SeasonCreateResult): Promise<void> {
      if (typeof idempotencyKey !== "string" || idempotencyKey.length === 0) throw new Error("An idempotency key is required");
      await storage.recordSuccess(accountKey(accountId), idempotencyKey, result);
    },

    async readLastSuccess(accountId: string): Promise<{ idempotencyKey: string; result: SeasonCreateResult } | null> {
      return (await storage.read(accountKey(accountId)))?.lastSuccess ?? null;
    },

    async clearLastSuccess(accountId: string, idempotencyKey: string): Promise<void> {
      if (typeof idempotencyKey !== "string" || idempotencyKey.length === 0) throw new Error("An idempotency key is required");
      await storage.clearSuccess(accountKey(accountId), idempotencyKey);
    },
  };
}

export function createSeasonCreateCommandCoordinator(options: Readonly<{
  store: ReturnType<typeof createSeasonCreateCommandStore>;
  create: (command: SeasonCreateCommand) => Promise<SeasonCreateResult>;
  newIdempotencyKey?: () => string;
}>) {
  const newIdempotencyKey = options.newIdempotencyKey ?? createIdempotencyKey;

  return {
    async createOrRetry(accountId: string, fieldId: string, request: SeasonCreateRequest): Promise<SeasonCreateResult> {
      const unresolved = await options.store.readUnresolved(accountId);
      const command = unresolved ?? {
        idempotencyKey: newIdempotencyKey(),
        fieldId,
        request,
      };
      if (!unresolved) await options.store.saveUnresolved(accountId, command);

      const result = await options.create(command);
      await options.store.recordSuccess(accountId, command.idempotencyKey, result);
      return result;
    },
  };
}

function createIdempotencyKey(): string {
  const randomUUID = globalThis.crypto?.randomUUID;
  if (randomUUID) return randomUUID.call(globalThis.crypto);
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    return (character === "x" ? random : (random & 0x3) | 0x8).toString(16);
  });
}

function assertCommand(value: SeasonCreateCommand): void {
  if (!value || typeof value !== "object" || typeof value.idempotencyKey !== "string" || !value.idempotencyKey
    || typeof value.fieldId !== "string" || !value.fieldId || !isCreateRequest(value.request)) {
    throw new Error("The season create command is invalid");
  }
}

function isCreateRequest(value: unknown): value is SeasonCreateRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  const crop = candidate.crop;
  const cropIsValid = !!crop && typeof crop === "object" && !Array.isArray(crop)
    && Object.keys(crop).length === 1
    && (("centralCropId" in crop && typeof (crop as Record<string, unknown>).centralCropId === "string")
      || ("customCropName" in crop && typeof (crop as Record<string, unknown>).customCropName === "string"));
  const keys = Object.keys(candidate);
  return keys.every((key) => key === "crop" || key === "sowingPlantingDate" || key === "planSource")
    && typeof candidate.sowingPlantingDate === "string"
    && (candidate.planSource === undefined || candidate.planSource === "MANUAL")
    && cropIsValid;
}

function parseCommand(serialized: string): SeasonCreateCommand {
  const value = JSON.parse(serialized) as SeasonCreateCommand;
  assertCommand(value);
  return value;
}

function parseResult(serialized: string): SeasonCreateResult {
  return JSON.parse(serialized) as SeasonCreateResult;
}
