jest.mock("@react-native-async-storage/async-storage", () => jest.requireActual("@react-native-async-storage/async-storage/jest/async-storage-mock"));
import { createAppComposition } from "../../src/app-composition";
import type { MobileAuthController } from "../../src/auth/auth-port";
import { createManualTaskStore, type ManualTaskState, type ManualTaskStorage } from "../../src/features/tasks/manual-task-store";
function memory(): ManualTaskStorage { let s: ManualTaskState = { activeAccount: null, contexts: [], commands: [] }; return { read: async () => JSON.parse(JSON.stringify(s)), update: async fn => { s = fn(JSON.parse(JSON.stringify(s))); } }; }

test("retryable offline restoration opens the previously authorized manual task context", async () => {
  const store = createManualTaskStore({ storage: memory() });
  await store.setAuthenticatedAccount("a"); await store.saveContext("a", { fieldId: "field", seasonId: "season", role: "OWNER", seasonStatus: "ACTIVE", planStatus: "APPROVED", actualPlantingDate: "2024-01-01", businessTimezone: "Europe/Istanbul" });
  const controller = { getState: () => ({ status: "signed-out" }), getRestorationOutcome: () => "retryable-unavailable", getAuthenticatedApiClient: () => null, getAuthenticatedApiSession: () => null,
    subscribe: (listener: (value: unknown) => void) => { listener({ status: "signed-out" }); return () => {}; }, start: async () => {} } as unknown as MobileAuthController;
  const composition = createAppComposition(controller, { manualTaskStore: store } as never);
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(composition.getState()).toMatchObject({ entry: "manual-task-create", accountId: "a", fieldId: "field", diarySeasonId: "season", client: null });
  composition.dispose();
});

test("account switch and definitive sign-out hide earlier account commands", async () => {
  const store = createManualTaskStore({ storage: memory() }); await store.setAuthenticatedAccount("a");
  await store.saveContext("a", { fieldId: "field", seasonId: "season", role: "OWNER", seasonStatus: "ACTIVE", planStatus: "APPROVED", actualPlantingDate: "2024-01-01", businessTimezone: "Europe/Istanbul" });
  await store.enqueue("a", { accountId: "a", fieldId: "field", seasonId: "season", taskId: "task", mutationId: "mutation", title: "Kontrol", plannedLocalDate: "2024-01-01" });
  const client = { GET: jest.fn().mockResolvedValue({ response: { ok: true, status: 200 }, data: { firstFieldOnboardingNeeded: true } }), POST: jest.fn() };
  let current: { status: string; accountId?: string } = { status: "authenticated", accountId: "b" }, outcome: string = "authenticated", listener!: (value: { status: string; accountId?: string }) => void;
  const controller = { getState: () => current, getRestorationOutcome: () => outcome, getAuthenticatedApiClient: () => current.status === "authenticated" ? client : null,
    getAuthenticatedApiSession: () => current.status === "authenticated" ? { accountId: current.accountId, client } : null,
    subscribe: (fn: typeof listener) => { listener = fn; fn(current); return () => {}; }, start: async () => {} } as unknown as MobileAuthController;
  const composition = createAppComposition(controller, { manualTaskStore: store });
  await new Promise(resolve => setTimeout(resolve, 10));
  expect(await store.list("a")).toEqual([]); expect(client.POST).not.toHaveBeenCalled();
  current = { status: "signed-out" }; outcome = "definitive-no-session"; listener(current);
  await new Promise(resolve => setTimeout(resolve, 10));
  expect(await store.getLocalCaptureAccount("retryable-unavailable")).toBeNull();
  composition.dispose();
});

test("a slow account marker write cannot restore the previous account after a switch", async () => {
  let finishA!: () => void; const delayA = new Promise<void>(resolve => { finishA = resolve; });
  let marker: string | null = null;
  const manualTaskStore = { setAuthenticatedAccount: jest.fn(async (account: string) => { if (account === "a") await delayA; marker = account; }), clearActiveAccount: async () => { marker = null; }, list: async () => [] };
  const client = { GET: jest.fn().mockResolvedValue({ response: { ok: true, status: 200 }, data: { firstFieldOnboardingNeeded: true } }) };
  let current: { status: string; accountId?: string } = { status: "authenticated", accountId: "a" }, listener!: (value: { status: string; accountId?: string }) => void;
  const controller = { getState: () => current, getRestorationOutcome: () => "authenticated", getAuthenticatedApiClient: () => client,
    getAuthenticatedApiSession: () => ({ accountId: current.accountId, client }), subscribe: (fn: typeof listener) => { listener = fn; fn(current); return () => {}; }, start: async () => {} } as unknown as MobileAuthController;
  const composition = createAppComposition(controller, { manualTaskStore: manualTaskStore as never });
  current = { status: "authenticated", accountId: "b" }; listener(current);
  finishA(); await new Promise(resolve => setTimeout(resolve, 20));
  expect(marker).toBe("b"); composition.dispose();
});
