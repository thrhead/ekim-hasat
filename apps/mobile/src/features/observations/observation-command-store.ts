import * as SQLite from "expo-sqlite";
import type { RestorationOutcome } from "../../auth/auth-port";

export type SavedObservationContext = Readonly<{
  fieldId: string;
  seasonId: string | null;
  businessTimezone: string;
}>;

export type ObservationCommand = Readonly<{
  accountId: string;
  observationId: string;
  fieldId: string;
  seasonId: string | null;
  description: string;
  occurredAtLocal: string;
  occurredAt: string;
  capturedBusinessTimezone: string;
  state: "PENDING" | "ACCEPTED" | "NEEDS_ATTENTION" | "UNCONFIRMED";
  attemptMayHaveCommitted?: boolean;
  /** Volatile UI state; never written into the durable logical command. */
  retrying?: boolean;
  acceptedResult?: unknown;
  failureCode?: string;
}>;

export type ObservationStorage = Readonly<{
  readMarker(): Promise<string | null>;
  writeMarker(accountId: string | null): Promise<void>;
  writeContext(accountId: string, context: SavedObservationContext): Promise<void>;
  readContext(accountId: string, fieldId: string, seasonId: string | null): Promise<SavedObservationContext | null>;
  readLastContext(accountId: string): Promise<SavedObservationContext | null>;
  insertCommand(accountId: string, command: ObservationCommand): Promise<void>;
  listCommands(accountId: string): Promise<ObservationCommand[]>;
  updateCommand(accountId: string, observationId: string, command: ObservationCommand): Promise<void>;
}>;

const DATABASE_NAME = "ekim-hasat.db";
let databasePromise: Promise<SQLite.SQLiteDatabase> | undefined;

async function database() {
  databasePromise ??= SQLite.openDatabaseAsync(DATABASE_NAME).then(async (db) => {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS observation_active_account (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1), account_id TEXT
      );
      CREATE TABLE IF NOT EXISTS observation_contexts (
        account_id TEXT NOT NULL, field_id TEXT NOT NULL, season_key TEXT NOT NULL,
        context_json TEXT NOT NULL, PRIMARY KEY (account_id, field_id, season_key)
      );
      CREATE TABLE IF NOT EXISTS observation_commands (
        account_id TEXT NOT NULL, observation_id TEXT NOT NULL, command_json TEXT NOT NULL,
        PRIMARY KEY (account_id, observation_id)
      );
    `);
    return db;
  });
  return databasePromise;
}

const sqliteStorage: ObservationStorage = {
  async readMarker() {
    const row = await (await database()).getFirstAsync<{ account_id: string | null }>(
      "SELECT account_id FROM observation_active_account WHERE singleton = 1",
    );
    return row?.account_id ?? null;
  },
  async writeMarker(accountId) {
    await (await database()).runAsync(
      "INSERT INTO observation_active_account (singleton, account_id) VALUES (1, ?) ON CONFLICT(singleton) DO UPDATE SET account_id = excluded.account_id",
      accountId,
    );
  },
  async writeContext(accountId, context) {
    await (await database()).runAsync(
      `INSERT INTO observation_contexts (account_id, field_id, season_key, context_json) VALUES (?, ?, ?, ?)
       ON CONFLICT(account_id, field_id, season_key) DO UPDATE SET context_json = excluded.context_json`,
      accountId, context.fieldId, context.seasonId ?? "", JSON.stringify(context),
    );
  },
  async readContext(accountId, fieldId, seasonId) {
    const row = await (await database()).getFirstAsync<{ context_json: string }>(
      "SELECT context_json FROM observation_contexts WHERE account_id = ? AND field_id = ? AND season_key = ?",
      accountId, fieldId, seasonId ?? "",
    );
    return row ? JSON.parse(row.context_json) as SavedObservationContext : null;
  },
  async readLastContext(accountId) {
    const row = await (await database()).getFirstAsync<{ context_json: string }>(
      "SELECT context_json FROM observation_contexts WHERE account_id = ? ORDER BY rowid DESC LIMIT 1", accountId,
    );
    return row ? JSON.parse(row.context_json) as SavedObservationContext : null;
  },
  async insertCommand(accountId, command) {
    await (await database()).runAsync(
      "INSERT INTO observation_commands (account_id, observation_id, command_json) VALUES (?, ?, ?)",
      accountId, command.observationId, JSON.stringify(command),
    );
  },
  async listCommands(accountId) {
    const rows = await (await database()).getAllAsync<{ command_json: string }>(
      "SELECT command_json FROM observation_commands WHERE account_id = ? ORDER BY rowid", accountId,
    );
    return rows.map((row) => JSON.parse(row.command_json) as ObservationCommand);
  },
  async updateCommand(accountId, observationId, command) {
    const db = await database();
    await db.withExclusiveTransactionAsync(async (tx) => {
      const result = await tx.runAsync(
        "UPDATE observation_commands SET command_json = ? WHERE account_id = ? AND observation_id = ?",
        JSON.stringify(command), accountId, observationId,
      );
      if (result.changes !== 1) throw new Error("Observation command was not found");
    });
  },
};

export function createObservationCommandStore(options: Readonly<{ storage?: ObservationStorage }> = {}) {
  const storage = options.storage ?? sqliteStorage;
  const listeners = new Set<() => void>();
  const retrying = new Set<string>();
  const retryKey = (accountId: string, observationId: string) => `${accountId}:${observationId}`;
  function notifyChange() { for (const listener of listeners) listener(); }
  let markerTransition: Promise<void> = Promise.resolve();
  function writeActiveMarker(accountId: string | null) {
    markerTransition = markerTransition.catch(() => {}).then(() => storage.writeMarker(accountId));
    return markerTransition;
  }
  async function activeMarker() {
    await markerTransition;
    return storage.readMarker();
  }
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async setAuthenticatedAccount(accountId: string) {
      if (!accountId?.trim()) throw new Error("Authenticated account ID is required");
      await writeActiveMarker(accountId);
    },
    async clearActiveAccount() { await writeActiveMarker(null); },
    async getLocalCaptureAccount(outcome: RestorationOutcome) {
      if (outcome !== "retryable-unavailable") return null;
      return activeMarker();
    },
    async saveContext(accountId: string, context: SavedObservationContext) {
      if ((await activeMarker()) !== accountId) throw new Error("Observation account mismatch");
      if (!context.fieldId || !context.businessTimezone) throw new Error("Invalid observation context");
      await storage.writeContext(accountId, context);
    },
    async getContext(accountId: string, fieldId: string, seasonId: string | null) {
      if ((await activeMarker()) !== accountId) return null;
      return storage.readContext(accountId, fieldId, seasonId);
    },
    async getLastContext(accountId: string) {
      if ((await activeMarker()) !== accountId) return null;
      return storage.readLastContext(accountId);
    },
    async enqueue(accountId: string, command: ObservationCommand) {
      if ((await activeMarker()) !== accountId) throw new Error("Observation account mismatch");
      if (accountId !== command.accountId || command.state !== "PENDING") throw new Error("Invalid observation command");
      const context = await storage.readContext(accountId, command.fieldId, command.seasonId);
      if (!context || context.businessTimezone !== command.capturedBusinessTimezone) {
        throw new Error("Saved observation context does not match the command");
      }
      const existing = (await storage.listCommands(accountId)).find((item) => item.observationId === command.observationId);
      if (existing) {
        if (JSON.stringify(existing) !== JSON.stringify(command)) throw new Error("Observation identity conflicts with saved command");
        return;
      }
      if ((await activeMarker()) !== accountId) throw new Error("Observation account mismatch");
      await storage.insertCommand(accountId, command);
      notifyChange();
    },
    async list(accountId: string) {
      if ((await activeMarker()) !== accountId) return [];
      return (await storage.listCommands(accountId)).map((command) => retrying.has(retryKey(accountId, command.observationId))
        ? { ...command, retrying: true } : command);
    },
    async markAttempt(accountId: string, observationId: string) {
      const command = (await storage.listCommands(accountId)).find((item) => item.observationId === observationId);
      if (!command || command.state !== "PENDING") throw new Error("Pending observation command was not found");
      await storage.updateCommand(accountId, observationId, { ...command, attemptMayHaveCommitted: true });
      retrying.add(retryKey(accountId, observationId));
      notifyChange();
    },
    async finishAttempt(accountId: string, observationId: string) {
      retrying.delete(retryKey(accountId, observationId));
      notifyChange();
    },
    async clearAttemptUncertainty(accountId: string, observationId: string) {
      const command = (await storage.listCommands(accountId)).find((item) => item.observationId === observationId);
      if (!command || command.state !== "PENDING") throw new Error("Pending observation command was not found");
      await storage.updateCommand(accountId, observationId, { ...command, attemptMayHaveCommitted: false });
      notifyChange();
    },
    async recordAccepted(accountId: string, observationId: string, acceptedResult: unknown) {
      const command = (await storage.listCommands(accountId)).find((item) => item.observationId === observationId);
      if (!command) throw new Error("Observation command was not found");
      if (!acceptedResult || typeof acceptedResult !== "object") throw new Error("Canonical result does not match the observation command");
      const canonical = acceptedResult as Record<string, unknown>;
      if (canonical.id !== observationId || canonical.fieldId !== command.fieldId
        || canonical.seasonId !== command.seasonId || canonical.description !== command.description
        || canonical.occurredAt !== command.occurredAt) {
        throw new Error("Canonical result does not match the observation command");
      }
      await storage.updateCommand(accountId, observationId, { ...command, state: "ACCEPTED", acceptedResult });
      notifyChange();
    },
    async recordAttention(accountId: string, observationId: string, state: "NEEDS_ATTENTION" | "UNCONFIRMED", failureCode: string) {
      const command = (await storage.listCommands(accountId)).find((item) => item.observationId === observationId);
      if (!command || command.state !== "PENDING") throw new Error("Pending observation command was not found");
      await storage.updateCommand(accountId, observationId, { ...command, state, failureCode });
      notifyChange();
    },
  };
}

export type ObservationCommandStore = ReturnType<typeof createObservationCommandStore>;
