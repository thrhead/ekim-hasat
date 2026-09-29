import {
  createSeasonCreateCommandCoordinator,
  createSeasonCreateCommandStore,
  type SeasonCreateCommand,
  type SeasonCreateCommandStorage,
  type SeasonCreateRequest,
  type SeasonCreateResult,
} from "../../src/features/seasons/season-create-command-store";

const request: SeasonCreateRequest = {
  crop: { customCropName: "Arpa" },
  sowingPlantingDate: "2026-09-27",
  planSource: "MANUAL",
};

const result: SeasonCreateResult = {
  id: "season-1",
  fieldId: "field-1",
  cropDisplayName: "Arpa",
  sowingPlantingDate: "2026-09-27",
  status: "DRAFT",
  version: 1,
  plan: { source: { kind: "MANUAL", validationLabel: "NOT_CENTRALLY_VALIDATED" }, tasks: [] },
};

function createDurableStorage(): SeasonCreateCommandStorage {
  const states = new Map<string, { unresolved: SeasonCreateCommand | null; lastSuccess: { idempotencyKey: string; result: SeasonCreateResult } | null }>();
  return {
    async read(accountId) {
      const state = states.get(accountId);
      return state ? structuredClone(state) : null;
    },
    async saveCommand(accountId, command) {
      const state = states.get(accountId) ?? { unresolved: null, lastSuccess: null };
      if (state.unresolved && JSON.stringify(state.unresolved) !== JSON.stringify(command)) {
        throw new Error("An unresolved season create command already exists for this account");
      }
      state.unresolved = structuredClone(command);
      states.set(accountId, state);
    },
    async recordSuccess(accountId, idempotencyKey, created) {
      const state = states.get(accountId) ?? { unresolved: null, lastSuccess: null };
      state.lastSuccess = { idempotencyKey, result: structuredClone(created) };
      if (state.unresolved?.idempotencyKey === idempotencyKey) state.unresolved = null;
      states.set(accountId, state);
    },
    async clearSuccess(accountId, idempotencyKey) {
      const state = states.get(accountId);
      if (state?.lastSuccess?.idempotencyKey === idempotencyKey) state.lastSuccess = null;
      if (state) states.set(accountId, state);
    },
  };
}

describe("season create command persistence", () => {
  test("persists exact command before creating and clears after recording server result", async () => {
    const storage = createDurableStorage();
    const store = createSeasonCreateCommandStore({ storage });
    const create = jest.fn().mockResolvedValue(result);
    const coordinator = createSeasonCreateCommandCoordinator({
      store,
      create,
      newIdempotencyKey: () => "key-1",
    });

    await expect(coordinator.createOrRetry("account-1", "field-1", request)).resolves.toEqual(result);

    expect(create).toHaveBeenCalledWith({ idempotencyKey: "key-1", fieldId: "field-1", request });
    expect(await store.readUnresolved("account-1")).toBeNull();
    expect(await store.readLastSuccess("account-1")).toEqual({ idempotencyKey: "key-1", result });
    await store.clearLastSuccess("account-1", "key-1");
    expect(await store.readLastSuccess("account-1")).toBeNull();
  });

  test("retries a lost response with the same persisted request and key after store recreation", async () => {
    const storage = createDurableStorage();
    const firstStore = createSeasonCreateCommandStore({ storage });
    const lostRequest = { ...request, crop: { customCropName: "Buğday" } };
    const firstCreate = jest.fn().mockRejectedValue(new Error("connection lost"));
    const firstCoordinator = createSeasonCreateCommandCoordinator({
      store: firstStore,
      create: firstCreate,
      newIdempotencyKey: () => "same-key",
    });

    await expect(firstCoordinator.createOrRetry("account-1", "field-1", lostRequest)).rejects.toThrow("connection lost");
    expect(await firstStore.readUnresolved("account-1")).toEqual({
      idempotencyKey: "same-key",
      fieldId: "field-1",
      request: lostRequest,
    });

    const restartedStore = createSeasonCreateCommandStore({ storage });
    const replay = jest.fn().mockResolvedValue(result);
    const restartedCoordinator = createSeasonCreateCommandCoordinator({
      store: restartedStore,
      create: replay,
      newIdempotencyKey: () => "must-not-be-used",
    });
    await restartedCoordinator.createOrRetry("account-1", "other-field", request);

    expect(replay).toHaveBeenCalledWith({ idempotencyKey: "same-key", fieldId: "field-1", request: lostRequest });
    expect(await restartedStore.readUnresolved("account-1")).toBeNull();
  });

  test("does not claim success or clear pending command when the create fails", async () => {
    const store = createSeasonCreateCommandStore({ storage: createDurableStorage() });
    const coordinator = createSeasonCreateCommandCoordinator({
      store,
      create: jest.fn().mockRejectedValue(new Error("server unavailable")),
      newIdempotencyKey: () => "pending-key",
    });

    await expect(coordinator.createOrRetry("account-1", "field-1", request)).rejects.toThrow("server unavailable");
    expect(await store.readUnresolved("account-1")).toEqual({ idempotencyKey: "pending-key", fieldId: "field-1", request });
    expect(await store.readLastSuccess("account-1")).toBeNull();
  });

  test("keeps the exact command when persisting a successful server result fails", async () => {
    const durable = createDurableStorage();
    let failReceipt = true;
    const storage: SeasonCreateCommandStorage = {
      ...durable,
      async recordSuccess(accountId, key, created) {
        if (failReceipt) throw new Error("local database unavailable");
        await durable.recordSuccess(accountId, key, created);
      },
    };
    const store = createSeasonCreateCommandStore({ storage });
    const create = jest.fn().mockResolvedValue(result);
    const coordinator = createSeasonCreateCommandCoordinator({
      store,
      create,
      newIdempotencyKey: () => "durable-key",
    });

    await expect(coordinator.createOrRetry("account-1", "field-1", request)).rejects.toThrow("local database unavailable");
    expect(await store.readUnresolved("account-1")).toEqual({ idempotencyKey: "durable-key", fieldId: "field-1", request });
    expect(await store.readLastSuccess("account-1")).toBeNull();

    failReceipt = false;
    await coordinator.createOrRetry("account-1", "field-2", { ...request, planSource: undefined });
    expect(create).toHaveBeenNthCalledWith(2, { idempotencyKey: "durable-key", fieldId: "field-1", request });
    expect(await store.readUnresolved("account-1")).toBeNull();
    expect(await store.readLastSuccess("account-1")).toEqual({ idempotencyKey: "durable-key", result });
  });

  test("keeps commands and receipts scoped to the authenticated account", async () => {
    const store = createSeasonCreateCommandStore({ storage: createDurableStorage() });
    await store.saveUnresolved("account-1", { idempotencyKey: "account-key", fieldId: "field-1", request });

    expect(await store.readUnresolved("account-1")).not.toBeNull();
    expect(await store.readUnresolved("account-2")).toBeNull();
    await expect(store.readUnresolved(" ")).rejects.toThrow("authenticated account");
  });

  test("does not replace a different unresolved command for the same account", async () => {
    const store = createSeasonCreateCommandStore({ storage: createDurableStorage() });
    await store.saveUnresolved("account-1", { idempotencyKey: "first-key", fieldId: "field-1", request });

    await expect(store.saveUnresolved("account-1", {
      idempotencyKey: "second-key",
      fieldId: "field-1",
      request: { ...request, planSource: undefined },
    })).rejects.toThrow("already exists");
  });
});
