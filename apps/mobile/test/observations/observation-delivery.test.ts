import type { ApiClient } from "../../../../packages/api-client/src/index";
import type { ObservationCommand, ObservationCommandStore } from "../../src/features/observations/observation-command-store";

const original: ObservationCommand = { accountId: "account-a", observationId: "123e4567-e89b-42d3-a456-426614174000",
  fieldId: "field-a", seasonId: null, description: "Damp soil", occurredAtLocal: "2026-10-14T12:00",
  occurredAt: "2026-10-14T09:00:00.000Z", capturedBusinessTimezone: "Europe/Istanbul", state: "PENDING" };

function deliveryModule() {
  try { return require("../../src/features/observations/observation-delivery") as typeof import("../../src/features/observations/observation-delivery"); }
  catch { return null; }
}

it("retries the same command after a lost response and durably settles exact replay", async () => {
  const module = deliveryModule();
  expect(module).not.toBeNull();
  let saved = original;
  const store = {
    list: async () => [saved],
    markAttempt: async () => { saved = { ...saved, attemptMayHaveCommitted: true }; },
    finishAttempt: async () => {},
    recordAccepted: async (_accountId: string, _id: string, result: unknown) => {
      saved = { ...saved, state: "ACCEPTED", acceptedResult: result };
    },
  } as unknown as ObservationCommandStore;
  const accepted = { id: original.observationId, fieldId: "field-a", seasonId: null, description: "Damp soil",
    occurredAt: original.occurredAt, businessTimezone: "Europe/Istanbul" };
  const POST = jest.fn().mockRejectedValueOnce(new TypeError("connection lost"))
    .mockResolvedValueOnce({ response: { ok: true, status: 200 }, data: accepted });
  const client = { POST } as unknown as ApiClient;
  const coordinator = module!.createObservationDelivery({ store, getAuthorizationSession: () => ({ accountId: "account-a", client }) });
  await coordinator.deliver("account-a");
  expect(saved.state).toBe("PENDING");
  await coordinator.deliver("account-a");
  expect(POST).toHaveBeenCalledTimes(2);
  expect(POST.mock.calls[0]).toEqual(POST.mock.calls[1]);
  expect(saved).toMatchObject({ state: "ACCEPTED", acceptedResult: accepted });
});

it("does not submit an old account command after the account switches during durable send marking", async () => {
  const module = deliveryModule();
  expect(module).not.toBeNull();
  let release!: () => void;
  const marking = new Promise<void>((resolve) => { release = resolve; });
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  const store = { list: async () => [original], markAttempt: async () => { markStarted(); await marking; }, finishAttempt: async () => {} } as unknown as ObservationCommandStore;
  const POST = jest.fn();
  const client = { POST } as unknown as ApiClient;
  let active = "account-a";
  const coordinator = module!.createObservationDelivery({ store,
    getAuthorizationSession: () => ({ accountId: active, client }) });
  const sending = coordinator.deliver("account-a");
  await started;
  active = "account-b";
  release();
  await sending;
  expect(POST).not.toHaveBeenCalled();
});

it("does not call a later denial unconfirmed when an earlier 401 definitely did not commit", async () => {
  const module = deliveryModule();
  expect(module).not.toBeNull();
  let saved: ObservationCommand = original;
  const store = {
    list: async () => [saved],
    markAttempt: async () => { saved = { ...saved, attemptMayHaveCommitted: true }; },
    finishAttempt: async () => {},
    clearAttemptUncertainty: async () => { saved = { ...saved, attemptMayHaveCommitted: false }; },
    recordAttention: async (_account: string, _id: string, state: ObservationCommand["state"]) => { saved = { ...saved, state }; },
  } as unknown as ObservationCommandStore;
  const POST = jest.fn().mockResolvedValueOnce({ response: { ok: false, status: 401 }, error: { error: { code: "UNAUTHORIZED" } } })
    .mockResolvedValueOnce({ response: { ok: false, status: 403 }, error: { error: { code: "FORBIDDEN" } } });
  const client = { POST } as unknown as ApiClient;
  const coordinator = module!.createObservationDelivery({ store, getAuthorizationSession: () => ({ accountId: "account-a", client }) });
  await coordinator.deliver("account-a");
  expect(saved).toMatchObject({ state: "PENDING", attemptMayHaveCommitted: false });
  await coordinator.deliver("account-a");
  expect(saved.state).toBe("NEEDS_ATTENTION");
});

it("schedules observation-only retry after connectivity returns while authenticated", async () => {
  jest.useFakeTimers();
  try {
    const module = deliveryModule() as typeof import("../../src/features/observations/observation-delivery") & {
      scheduleObservationRetry?: (deliver: () => Promise<void>, intervalMs: number) => () => void;
    };
    expect(typeof module.scheduleObservationRetry).toBe("function");
    const deliver = jest.fn().mockResolvedValue(undefined);
    const stop = module.scheduleObservationRetry!(deliver, 1000);
    await jest.advanceTimersByTimeAsync(1000);
    expect(deliver).toHaveBeenCalledTimes(1);
    stop();
    await jest.advanceTimersByTimeAsync(2000);
    expect(deliver).toHaveBeenCalledTimes(1);
  } finally { jest.useRealTimers(); }
});

it("does not submit the same pending command twice when reconnect triggers overlap", async () => {
  let release!: () => void;
  const response = new Promise<unknown>((resolve) => { release = () => resolve({ response: { ok: true, status: 201 },
    data: { id: original.observationId, fieldId: original.fieldId, seasonId: null,
      description: original.description, occurredAt: original.occurredAt } }); });
  const POST = jest.fn().mockReturnValue(response);
  const store = { list: async () => [original], markAttempt: async () => {}, finishAttempt: async () => {},
    recordAccepted: async () => {} } as unknown as ObservationCommandStore;
  const client = { POST } as unknown as ApiClient;
  const delivery = deliveryModule()!.createObservationDelivery({ store,
    getAuthorizationSession: () => ({ accountId: "account-a", client }) });
  const first = delivery.deliver("account-a");
  const second = delivery.deliver("account-a");
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(POST).toHaveBeenCalledTimes(1);
  release();
  await Promise.all([first, second]);
});

it("rejects a command whose embedded account namespace does not match the authenticated session", async () => {
  const POST = jest.fn();
  const client = { POST } as unknown as ApiClient;
  const store = { list: async () => [original], markAttempt: jest.fn(), finishAttempt: async () => {} } as unknown as ObservationCommandStore;
  const delivery = deliveryModule()!.createObservationDelivery({ store,
    getAuthorizationSession: () => ({ accountId: "account-b", client }) });
  await delivery.deliver("account-b");
  expect(POST).not.toHaveBeenCalled();
  expect(store.markAttempt).not.toHaveBeenCalled();
});
