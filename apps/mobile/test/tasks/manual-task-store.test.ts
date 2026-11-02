import { createManualTaskStore, type ManualTaskState, type ManualTaskStorage } from "../../src/features/tasks/manual-task-store";
function memory() {
  let state: ManualTaskState = { activeAccount: null, contexts: [], commands: [] };
  let fail = false;
  const storage: ManualTaskStorage = {
    read: async () => structuredClone(state),
    update: async fn => { if (fail) throw new Error("disk unavailable"); const next = fn(structuredClone(state)); state = next; },
  };
  return { storage, fail: () => { fail = true; } };
}
const context = { fieldId: "field", seasonId: "season", role: "OWNER" as const, seasonStatus: "ACTIVE" as const, planStatus: "APPROVED" as const, actualPlantingDate: "2024-01-01", businessTimezone: "Europe/Istanbul" };
const command = { accountId: "a", fieldId: "field", seasonId: "season", taskId: "task", mutationId: "mutation", title: "Test", plannedLocalDate: "2024-01-01" };

test("capture requires durable matching OWNER context and survives restart", async () => {
  expect(typeof createManualTaskStore).toBe("function");
  const db = memory(), store = createManualTaskStore({ storage: db.storage });
  await store.setAuthenticatedAccount("a"); await store.saveContext("a", context);
  await store.enqueue("a", command);
  const restarted = createManualTaskStore({ storage: db.storage });
  expect(await restarted.getLocalCaptureAccount("retryable-unavailable")).toBe("a");
  expect((await restarted.list("a"))[0]).toMatchObject({ ...command, state: "PENDING" });
  await expect(restarted.enqueue("a", { ...command, title: "changed" })).rejects.toThrow();
  await restarted.setAuthenticatedAccount("b"); expect(await restarted.list("a")).toEqual([]);
  await expect(restarted.enqueue("b", { ...command, accountId: "b" })).rejects.toThrow();
  await restarted.clearActiveAccount(); expect(await restarted.getLocalCaptureAccount("retryable-unavailable")).toBeNull();
});

test("local write failure never reports a saved command", async () => {
  expect(typeof createManualTaskStore).toBe("function");
  const db = memory(), store = createManualTaskStore({ storage: db.storage });
  await store.setAuthenticatedAccount("a"); await store.saveContext("a", context); db.fail();
  await expect(store.enqueue("a", command)).rejects.toThrow("disk unavailable");
  expect(await store.list("a")).toEqual([]);
});

test("a definitive no-session result cannot establish offline capture", async () => {
  const db = memory(), store = createManualTaskStore({ storage: db.storage });
  await store.setAuthenticatedAccount("a"); await store.saveContext("a", context);
  expect(await store.getLocalCaptureAccount("definitive-no-session")).toBeNull();
  await store.clearActiveAccount();
  expect(await store.list("a")).toEqual([]);
  await expect(store.enqueue("a", command)).rejects.toThrow();
});

test("authorized canonical task IDs reconcile only matching accepted local receipts", async () => {
  const db = memory(), store = createManualTaskStore({ storage: db.storage });
  await store.setAuthenticatedAccount("a"); await store.saveContext("a", context); await store.enqueue("a", command);
  await store.startAttempt("a", "task");
  await store.recordAccepted("a", "task", { taskId: "task", mutationId: "mutation", fieldId: "field", seasonId: "season", title: "Test", description: null, plannedLocalDate: "2024-01-01", sourceKind: "MANUAL", templateVersionId: null, acceptedAt: "2026-10-31T00:00:00Z" });
  store.releaseAttempt("a", "task");
  await store.enqueue("a", { ...command, taskId: "pending", mutationId: "pending-mutation" });
  await store.reconcileAccepted("a", ["task", "pending"]);
  expect((await store.list("a")).map(item => item.taskId)).toEqual(["pending"]);
  expect((await db.storage.read()).commands.find(item => item.taskId === "task")).toMatchObject({ state: "ACCEPTED", reconciled: true });
});

test("renamed display context does not change an existing pending command identity", async () => {
  const db = memory(), store = createManualTaskStore({ storage: db.storage });
  await store.setAuthenticatedAccount("a"); await store.saveContext("a", { ...context, fieldName: "Kuzey" });
  await store.enqueue("a", command);
  await store.saveContext("a", { ...context, fieldName: "Yeni ad" });
  await expect(store.enqueue("a", command)).resolves.toBeUndefined();
  expect(await store.list("a")).toHaveLength(1);
});
