import * as SQLite from "expo-sqlite";
import { validateManualActiveTask } from "../../../../../packages/domain/src/seasons/plan-task-mutations";
import type { RestorationOutcome } from "../../auth/auth-port";

export type ManualTaskContext = Readonly<{ fieldId: string; seasonId: string; role: "OWNER"; seasonStatus: "ACTIVE"; planStatus: "APPROVED"; actualPlantingDate: string; businessTimezone: string; fieldName?: string; seasonName?: string }>;
export type ManualTaskInput = Readonly<{ accountId: string; fieldId: string; seasonId: string; taskId: string; mutationId: string; title: string; description?: string | null; plannedLocalDate: string }>;
export type ManualTaskCommand = ManualTaskInput & Readonly<{ state: "PENDING" | "SENDING" | "UNCONFIRMED" | "REJECTED" | "ACCEPTED"; fieldName?: string; seasonName?: string; attemptMayHaveCommitted?: boolean; failureCode?: string; acceptedResult?: unknown; reconciled?: boolean }>;
export type ManualTaskState = { activeAccount: string | null; contexts: Array<{ accountId: string; context: ManualTaskContext }>; commands: ManualTaskCommand[] };
export type ManualTaskStorage = { read(): Promise<ManualTaskState>; update(fn: (state: ManualTaskState) => ManualTaskState): Promise<void> };
const liveAttempts = new Set<string>();
const attemptKey = (account: string, task: string) => `${account}:${task}`;
const empty = (): ManualTaskState => ({ activeAccount: null, contexts: [], commands: [] });
let dbPromise: Promise<SQLite.SQLiteDatabase> | undefined;
async function database() {
  dbPromise ??= SQLite.openDatabaseAsync("ekim-hasat.db").then(async db => {
    await db.execAsync("CREATE TABLE IF NOT EXISTS manual_task_state (id INTEGER PRIMARY KEY CHECK (id=1), state_json TEXT NOT NULL)");
    return db;
  });
  return dbPromise;
}
const sqliteStorage: ManualTaskStorage = {
  async read() { const row = await (await database()).getFirstAsync<{ state_json: string }>("SELECT state_json FROM manual_task_state WHERE id=1"); return row ? JSON.parse(row.state_json) as ManualTaskState : empty(); },
  async update(fn) {
    await (await database()).withExclusiveTransactionAsync(async tx => {
      const row = await tx.getFirstAsync<{ state_json: string }>("SELECT state_json FROM manual_task_state WHERE id=1");
      const next = fn(row ? JSON.parse(row.state_json) as ManualTaskState : empty());
      await tx.runAsync("INSERT INTO manual_task_state(id,state_json) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET state_json=excluded.state_json", JSON.stringify(next));
    });
  },
};
export function createManualTaskStore(options: { storage?: ManualTaskStorage } = {}) {
  const storage = options.storage ?? sqliteStorage, listeners = new Set<() => void>();
  const mutate = async (fn: (s: ManualTaskState) => ManualTaskState) => { await storage.update(fn); listeners.forEach(listener => listener()); };
  const requireAccount = (s: ManualTaskState, account: string) => { if (!account || s.activeAccount !== account) throw new Error("Manual task account mismatch"); };
  const change = (account: string, taskId: string, fn: (command: ManualTaskCommand) => ManualTaskCommand) => mutate(s => {
    requireAccount(s, account); const index = s.commands.findIndex(c => c.accountId === account && c.taskId === taskId);
    if (index < 0) throw new Error("Manual task not found");
    const commands = [...s.commands]; commands[index] = fn(commands[index]!); return { ...s, commands };
  });
  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener); },
    async setAuthenticatedAccount(account: string) { if (!account.trim()) throw new Error("Account required"); await mutate(s => ({ ...s, activeAccount: account })); },
    async clearActiveAccount() { await mutate(s => ({ ...s, activeAccount: null })); },
    async getLocalCaptureAccount(outcome: RestorationOutcome) { return outcome === "retryable-unavailable" ? (await storage.read()).activeAccount : null; },
    async saveContext(account: string, context: ManualTaskContext) {
      await mutate(s => { requireAccount(s, account); if (!context.fieldId || !context.seasonId || !context.businessTimezone || context.role !== "OWNER" || context.seasonStatus !== "ACTIVE" || context.planStatus !== "APPROVED") throw new Error("Invalid task context");
        return { ...s, contexts: [...s.contexts.filter(c => !(c.accountId === account && c.context.fieldId === context.fieldId && c.context.seasonId === context.seasonId)), { accountId: account, context }] }; });
    },
    async getContext(account: string, fieldId: string, seasonId: string) { const s = await storage.read(); if (s.activeAccount !== account) return null; return s.contexts.find(c => c.accountId === account && c.context.fieldId === fieldId && c.context.seasonId === seasonId)?.context ?? null; },
    async getLastContext(account: string) { const s = await storage.read(); if (s.activeAccount !== account) return null; return s.contexts.filter(c => c.accountId === account).at(-1)?.context ?? null; },
    async getLastRetainedContext(account: string) { const s = await storage.read(); if (s.activeAccount !== account) return null; const command = s.commands.filter(c => c.accountId === account && !(c.state === "ACCEPTED" && c.reconciled)).at(-1); return command ? { fieldId: command.fieldId, seasonId: command.seasonId } : null; },
    async clearContext(account: string, fieldId: string, seasonId: string) { await mutate(s => { requireAccount(s, account); return { ...s, contexts: s.contexts.filter(c => !(c.accountId === account && c.context.fieldId === fieldId && c.context.seasonId === seasonId)) }; }); },
    async enqueue(account: string, input: ManualTaskInput) {
      await mutate(s => { requireAccount(s, account); if (input.accountId !== account || !input.taskId || !input.mutationId) throw new Error("Invalid task identity");
        const saved = s.contexts.find(c => c.accountId === account && c.context.fieldId === input.fieldId && c.context.seasonId === input.seasonId)?.context;
        if (!saved || saved.role !== "OWNER" || saved.seasonStatus !== "ACTIVE" || saved.planStatus !== "APPROVED") throw new Error("Eligible task context unavailable");
        const normalized = validateManualActiveTask(input, saved.actualPlantingDate);
        const command: ManualTaskCommand = { ...input, ...normalized, ...(saved.fieldName ? { fieldName: saved.fieldName } : {}), ...(saved.seasonName ? { seasonName: saved.seasonName } : {}), state: "PENDING" };
        const existing = s.commands.find(c => c.accountId === account && (c.taskId === input.taskId || c.mutationId === input.mutationId));
        if (existing) {
          if (existing.state !== "PENDING" || existing.taskId !== command.taskId || existing.mutationId !== command.mutationId ||
              existing.fieldId !== command.fieldId || existing.seasonId !== command.seasonId || existing.title !== command.title ||
              (existing.description ?? null) !== (command.description ?? null) || existing.plannedLocalDate !== command.plannedLocalDate) throw new Error("Task identity conflict");
          return s;
        }
        return { ...s, commands: [...s.commands, command] }; });
    },
    async list(account: string) { const s = await storage.read(); if (s.activeAccount !== account) return []; return s.commands.filter(c => c.accountId === account && !(c.state === "ACCEPTED" && c.reconciled)).map(c => c.state === "SENDING" ? { ...c, state: "UNCONFIRMED" as const } : c); },
    async startAttempt(account: string, taskId: string) { const key = attemptKey(account, taskId); if (liveAttempts.has(key)) throw new Error("Task delivery already in flight"); liveAttempts.add(key); let prior = false; try { await change(account, taskId, c => { if (c.state !== "PENDING" && c.state !== "UNCONFIRMED" && c.state !== "SENDING") throw new Error("Task cannot be sent"); prior = !!c.attemptMayHaveCommitted; return { ...c, state: "SENDING", attemptMayHaveCommitted: true }; }); return prior; } catch (error) { liveAttempts.delete(key); throw error; } },
    releaseAttempt(account: string, taskId: string) { liveAttempts.delete(attemptKey(account, taskId)); },
    async recordAccepted(account: string, taskId: string, result: unknown) { await change(account, taskId, c => { if (c.state !== "SENDING" || !result || typeof result !== "object") throw new Error("Invalid acceptance"); const r = result as Record<string, unknown>;
      if (r.taskId !== c.taskId || r.mutationId !== c.mutationId || r.seasonId !== c.seasonId || r.fieldId !== c.fieldId || r.title !== c.title || (r.description ?? null) !== (c.description ?? null) || typeof r.acceptedAt !== "string" || r.plannedLocalDate !== c.plannedLocalDate || r.sourceKind !== "MANUAL" || r.templateVersionId !== null) throw new Error("Acceptance does not match task");
      return { ...c, state: "ACCEPTED", acceptedResult: result }; }); },
    async finishAttempt(account: string, taskId: string, state: "UNCONFIRMED" | "REJECTED", code?: string) { await mutate(s => {
      requireAccount(s, account); const index = s.commands.findIndex(c => c.accountId === account && c.taskId === taskId);
      const c = s.commands[index]; if (!c || c.state !== "SENDING") throw new Error("Task is not being sent");
      const commands = [...s.commands]; commands[index] = { ...c, state, attemptMayHaveCommitted: state === "UNCONFIRMED", ...(code ? { failureCode: code } : {}) };
      const invalidate = code === "ACCESS_DENIED" || code === "RESOURCE_UNAVAILABLE" || code === "SEASON_INELIGIBLE";
      return { ...s, commands, contexts: invalidate ? s.contexts.filter(item => !(item.accountId === account && item.context.fieldId === c.fieldId && item.context.seasonId === c.seasonId)) : s.contexts };
    }); },
    async retryRejected(account: string, taskId: string) { await change(account, taskId, c => { if (c.state !== "REJECTED" || c.attemptMayHaveCommitted) throw new Error("Task is not definitively rejected"); return { ...c, state: "PENDING" }; }); },
    async reconcileAccepted(account: string, canonicalTaskIds: readonly string[]) { await mutate(s => { requireAccount(s, account); const ids = new Set(canonicalTaskIds); return { ...s, commands: s.commands.map(c => c.accountId === account && c.state === "ACCEPTED" && ids.has(c.taskId) ? { ...c, reconciled: true } : c) }; }); },
    async removeRejected(account: string, taskId: string) { await mutate(s => { requireAccount(s, account); const c = s.commands.find(x => x.accountId === account && x.taskId === taskId); if (!c || c.state !== "REJECTED" || c.attemptMayHaveCommitted) throw new Error("Task is not definitively rejected"); return { ...s, commands: s.commands.filter(x => !(x.accountId === account && x.taskId === taskId)) }; }); },
  };
}
export type ManualTaskStore = ReturnType<typeof createManualTaskStore>;
