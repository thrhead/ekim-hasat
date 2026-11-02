import { createManualTaskStore, type ManualTaskState, type ManualTaskStorage } from "../../src/features/tasks/manual-task-store";
import { createManualTaskDelivery } from "../../src/features/tasks/manual-task-delivery";
import type { ApiClient } from "../../../../packages/api-client/src/index";

function memory(): ManualTaskStorage {
  let state: ManualTaskState = { activeAccount: null, contexts: [], commands: [] };
  return { read: async () => JSON.parse(JSON.stringify(state)), update: async fn => { state = fn(JSON.parse(JSON.stringify(state))); } };
}
const context = { fieldId: "field", seasonId: "season", role: "OWNER" as const, seasonStatus: "ACTIVE" as const, planStatus: "APPROVED" as const, actualPlantingDate: "2024-01-01", businessTimezone: "Europe/Istanbul" };
const command = { accountId: "a", fieldId: "field", seasonId: "season", taskId: "task", mutationId: "mutation", title: "Test", plannedLocalDate: "2024-01-01" };

test("lost response followed by denial remains unconfirmed and cannot be removed", async () => {
  expect(typeof createManualTaskStore).toBe("function"); expect(typeof createManualTaskDelivery).toBe("function");
  const store = createManualTaskStore({ storage: memory() });
  await store.setAuthenticatedAccount("a"); await store.saveContext("a", context); await store.enqueue("a", command);
  const POST = jest.fn().mockRejectedValueOnce(new Error("network")).mockResolvedValueOnce({ response: { ok: false, status: 403 }, error: { error: { code: "ACCESS_DENIED" } } });
  const delivery = createManualTaskDelivery({ store, getAuthorizationSession: () => ({ accountId: "a", client: { POST } as unknown as ApiClient }) });
  await delivery.deliver("a"); expect((await store.list("a"))[0].state).toBe("UNCONFIRMED");
  await delivery.deliver("a"); expect((await store.list("a"))[0].state).toBe("UNCONFIRMED");
  await expect(store.removeRejected("a", command.taskId)).rejects.toThrow();
  expect(POST.mock.calls[0][1].body).toEqual(POST.mock.calls[1][1].body);
});

test("definitive rejection is retained and can be retried or removed only explicitly", async () => {
  expect(typeof createManualTaskStore).toBe("function"); expect(typeof createManualTaskDelivery).toBe("function");
  const store = createManualTaskStore({ storage: memory() });
  await store.setAuthenticatedAccount("a"); await store.saveContext("a", context); await store.enqueue("a", command);
  const POST = jest.fn().mockResolvedValue({ response: { ok: false, status: 409 }, error: { error: { code: "SEASON_INELIGIBLE" } } });
  const delivery = createManualTaskDelivery({ store, getAuthorizationSession: () => ({ accountId: "a", client: { POST } as unknown as ApiClient }) });
  await delivery.deliver("a"); expect((await store.list("a"))[0].state).toBe("REJECTED");
  await store.retryRejected("a", command.taskId); expect((await store.list("a"))[0].state).toBe("PENDING");
  await delivery.deliver("a"); await store.removeRejected("a", command.taskId); expect(await store.list("a")).toEqual([]);
});

test("overlapping coordinators cannot remove a command while a send is in flight", async () => {
  const storage = memory(), first = createManualTaskStore({ storage }), second = createManualTaskStore({ storage });
  await first.setAuthenticatedAccount("a"); await first.saveContext("a", context); await first.enqueue("a", command);
  let resolve!: (value: unknown) => void;
  const response = new Promise(done => { resolve = done; });
  const POST = jest.fn().mockReturnValue(response);
  const session = () => ({ accountId: "a", client: { POST } as unknown as ApiClient });
  const a = createManualTaskDelivery({ store: first, getAuthorizationSession: session });
  const b = createManualTaskDelivery({ store: second, getAuthorizationSession: session });
  const running = a.deliver("a");
  await new Promise(done => setTimeout(done, 0));
  const duplicate = b.deliver("a");
  await new Promise(done => setTimeout(done, 0));
  expect(POST).toHaveBeenCalledTimes(1);
  await expect(first.removeRejected("a", command.taskId)).rejects.toThrow();
  resolve({ response: { ok: false, status: 403 }, error: { error: { code: "ACCESS_DENIED" } } });
  await Promise.all([running, duplicate]);
});

test("authoritative matching receipt is retained across restart and does not resend", async () => {
  const storage = memory(), store = createManualTaskStore({ storage });
  await store.setAuthenticatedAccount("a"); await store.saveContext("a", context); await store.enqueue("a", command);
  const receipt = { taskId: command.taskId, mutationId: command.mutationId, seasonId: command.seasonId, fieldId: command.fieldId, title: command.title, description: null, plannedLocalDate: command.plannedLocalDate, sourceKind: "MANUAL", templateVersionId: null, acceptedAt: "2026-10-31T00:00:00Z" };
  const POST = jest.fn().mockResolvedValue({ response: { ok: true, status: 201 }, data: receipt });
  const delivery = createManualTaskDelivery({ store, getAuthorizationSession: () => ({ accountId: "a", client: { POST } as unknown as ApiClient }) });
  await delivery.deliver("a"); await delivery.deliver("a");
  expect(POST).toHaveBeenCalledTimes(1);
  expect((await createManualTaskStore({ storage }).list("a"))[0]).toMatchObject({ state: "ACCEPTED", acceptedResult: receipt });
  await expect(store.removeRejected("a", command.taskId)).rejects.toThrow();
});

test("correction creates new identities while rejected original remains", async () => {
  const store = createManualTaskStore({ storage: memory() });
  await store.setAuthenticatedAccount("a"); await store.saveContext("a", context); await store.enqueue("a", command);
  const POST = jest.fn().mockResolvedValue({ response: { ok: false, status: 422 }, error: { error: { code: "INVALID_TASK" } } });
  await createManualTaskDelivery({ store, getAuthorizationSession: () => ({ accountId: "a", client: { POST } as unknown as ApiClient }) }).deliver("a");
  await expect(store.enqueue("a", { ...command, title: "fixed" })).rejects.toThrow();
  await store.enqueue("a", { ...command, taskId: "new-task", mutationId: "new-mutation", title: "fixed" });
  expect((await store.list("a")).map(item => item.state)).toEqual(["REJECTED", "PENDING"]);
});

test("a crash after the durable attempt marker restores an uncertain command", async () => {
  const storage = memory(), store = createManualTaskStore({ storage });
  await store.setAuthenticatedAccount("a"); await store.saveContext("a", context); await store.enqueue("a", command);
  expect(await store.startAttempt("a", command.taskId)).toBe(false);
  store.releaseAttempt("a", command.taskId);
  const restored = createManualTaskStore({ storage });
  expect((await restored.list("a"))[0].state).toBe("UNCONFIRMED");
  const POST = jest.fn().mockResolvedValue({ response: { ok: false, status: 403 }, error: { error: { code: "ACCESS_DENIED" } } });
  await createManualTaskDelivery({ store: restored, getAuthorizationSession: () => ({ accountId: "a", client: { POST } as unknown as ApiClient }) }).deliver("a");
  expect((await restored.list("a"))[0].state).toBe("UNCONFIRMED");
  await expect(restored.removeRejected("a", command.taskId)).rejects.toThrow();
});

test("no matching authenticated session means no delivery", async () => {
  const store = createManualTaskStore({ storage: memory() });
  await store.setAuthenticatedAccount("a"); await store.saveContext("a", context); await store.enqueue("a", command);
  const POST = jest.fn();
  await createManualTaskDelivery({ store, getAuthorizationSession: () => ({ accountId: "b", client: { POST } as unknown as ApiClient }) }).deliver("a");
  expect(POST).not.toHaveBeenCalled(); expect((await store.list("a"))[0].state).toBe("PENDING");
});

test("a local failure recording server acceptance preserves uncertainty for exact replay", async () => {
  let state: ManualTaskState = { activeAccount: null, contexts: [], commands: [] };
  const storage: ManualTaskStorage = { read: async () => JSON.parse(JSON.stringify(state)), update: async fn => {
    const next = fn(JSON.parse(JSON.stringify(state)));
    if (next.commands.some(c => c.state === "ACCEPTED")) throw new Error("disk full");
    state = next;
  } };
  const store = createManualTaskStore({ storage });
  await store.setAuthenticatedAccount("a"); await store.saveContext("a", context); await store.enqueue("a", command);
  const receipt = { ...command, sourceKind: "MANUAL", templateVersionId: null, acceptedAt: "2026-10-31T00:00:00Z" };
  const POST = jest.fn().mockResolvedValue({ response: { ok: true, status: 201 }, data: receipt });
  await createManualTaskDelivery({ store, getAuthorizationSession: () => ({ accountId: "a", client: { POST } as unknown as ApiClient }) }).deliver("a");
  expect((await store.list("a"))[0].state).toBe("UNCONFIRMED");
});

test("authoritative access denial invalidates cached capture context but retains the local record", async () => {
  const store = createManualTaskStore({ storage: memory() });
  await store.setAuthenticatedAccount("a"); await store.saveContext("a", context); await store.enqueue("a", command);
  const POST = jest.fn().mockResolvedValue({ response: { ok: false, status: 403 }, error: { error: { code: "ACCESS_DENIED" } } });
  await createManualTaskDelivery({ store, getAuthorizationSession: () => ({ accountId: "a", client: { POST } as unknown as ApiClient }) }).deliver("a");
  expect(await store.getContext("a", "field", "season")).toBeNull();
  expect((await store.list("a"))[0].state).toBe("REJECTED");
  await expect(store.enqueue("a", { ...command, taskId: "another", mutationId: "another" })).rejects.toThrow();
});
