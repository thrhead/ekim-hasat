import type { ObservationCommand, ObservationStorage, SavedObservationContext } from "../../src/features/observations/observation-command-store";

describe("observation command store", () => {
  const modulePath = "../../src/features/observations/observation-command-store";
  const command = { accountId: "a", observationId: "123e4567-e89b-42d3-a456-426614174000", fieldId: "f",
    seasonId: null, description: "Soil is damp", occurredAtLocal: "2026-10-14T12:00:00",
    occurredAt: "2026-10-14T09:00:00.000Z", capturedBusinessTimezone: "Europe/Istanbul",
    state: "PENDING" } satisfies ObservationCommand;

  function load() {
    try { return jest.requireActual<typeof import("../../src/features/observations/observation-command-store")>(modulePath); }
    catch { return null; }
  }

  function storage(): ObservationStorage {
    let marker: string | null = null;
    const contexts = new Map<string, SavedObservationContext>();
    const commands = new Map<string, ObservationCommand>();
    return {
      async readMarker() { return marker; },
      async writeMarker(value: string | null) { marker = value; },
      async writeContext(account: string, value: SavedObservationContext) {
        contexts.set(`${account}:${value.fieldId}:${value.seasonId ?? ""}`, structuredClone(value));
      },
      async readContext(account: string, fieldId: string, seasonId: string | null) {
        return structuredClone(contexts.get(`${account}:${fieldId}:${seasonId ?? ""}`) ?? null);
      },
      async readLastContext(account: string) {
        return structuredClone([...contexts.entries()].filter(([key]) => key.startsWith(`${account}:`)).at(-1)?.[1] ?? null);
      },
      async insertCommand(account: string, value: ObservationCommand) {
        commands.set(`${account}:${value.observationId}`, structuredClone(value));
      },
      async listCommands(account: string) {
        return [...commands.entries()].filter(([key]) => key.startsWith(`${account}:`)).map(([, value]) => structuredClone(value));
      },
      async updateCommand(account: string, observationId: string, value: ObservationCommand) {
        commands.set(`${account}:${observationId}`, structuredClone(value));
      },
    };
  }

  it("persists only the authenticated account marker across restart and clears active use on sign-out", async () => {
    const module = load();
    expect(module).not.toBeNull();
    const persistent = storage();
    const first = module!.createObservationCommandStore({ storage: persistent });
    await first.setAuthenticatedAccount("a");
    await first.saveContext("a", { fieldId: "f", seasonId: null, businessTimezone: "Europe/Istanbul" });
    const restarted = module!.createObservationCommandStore({ storage: persistent });
    expect(await restarted.getLocalCaptureAccount("retryable-unavailable")).toBe("a");
    expect(await restarted.getContext("a", "f", null)).toEqual({ fieldId: "f", seasonId: null, businessTimezone: "Europe/Istanbul" });
    expect(await restarted.getLastContext("a")).toEqual({ fieldId: "f", seasonId: null, businessTimezone: "Europe/Istanbul" });
    await restarted.clearActiveAccount();
    expect(await first.getLocalCaptureAccount("retryable-unavailable")).toBeNull();
    expect(await first.getContext("a", "f", null)).toBeNull();
  });

  it("isolates retained commands across account switches and persists accepted result", async () => {
    const module = load();
    expect(module).not.toBeNull();
    const persistent = storage();
    const store = module!.createObservationCommandStore({ storage: persistent });
    await store.setAuthenticatedAccount("a");
    await store.saveContext("a", { fieldId: "f", seasonId: null, businessTimezone: "Europe/Istanbul" });
    await store.enqueue("a", command);
    await store.setAuthenticatedAccount("b");
    expect(await store.getLocalCaptureAccount("retryable-unavailable")).toBe("b");
    expect(await store.list("b")).toEqual([]);
    expect(await store.list("a")).toEqual([]);
    const accepted = { id: command.observationId, fieldId: "f", seasonId: null, description: command.description,
      occurredAt: command.occurredAt, businessTimezone: "Europe/Istanbul" };
    await store.recordAccepted("a", command.observationId, accepted);
    await store.setAuthenticatedAccount("a");
    expect(await module!.createObservationCommandStore({ storage: persistent }).list("a")).toEqual([{ ...command, state: "ACCEPTED", acceptedResult: accepted }]);
  });

  it("requires the active account marker for local context, queue, and presentation", async () => {
    const store = load()!.createObservationCommandStore({ storage: storage() });
    await expect(store.enqueue("a", command)).rejects.toThrow();
    await store.setAuthenticatedAccount("a");
    await store.saveContext("a", { fieldId: "f", seasonId: null, businessTimezone: "Europe/Istanbul" });
    await store.enqueue("a", command);
    await store.clearActiveAccount();
    expect(await store.getContext("a", "f", null)).toBeNull();
    expect(await store.getLastContext("a")).toBeNull();
    expect(await store.list("a")).toEqual([]);
    await expect(store.enqueue("a", { ...command, observationId: "new" })).rejects.toThrow();
    await store.setAuthenticatedAccount("a");
    expect(await store.list("a")).toEqual([command]);
  });

  it("serializes marker writes before authorized context and sign-out invalidation", async () => {
    const persistent = storage();
    const writeMarker = persistent.writeMarker;
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const slow = { ...persistent, writeMarker: async (accountId: string | null) => {
      if (accountId === "a") await pending;
      await writeMarker(accountId);
    } };
    const store = load()!.createObservationCommandStore({ storage: slow });
    const establish = store.setAuthenticatedAccount("a");
    const save = store.saveContext("a", { fieldId: "f", seasonId: null, businessTimezone: "Europe/Istanbul" });
    release();
    await Promise.all([establish, save]);
    const clear = store.clearActiveAccount();
    await clear;
    expect(await store.getContext("a", "f", null)).toBeNull();
  });

  it("refuses a mismatched canonical result and keeps the command pending", async () => {
    const store = load()!.createObservationCommandStore({ storage: storage() });
    await store.setAuthenticatedAccount("a");
    await store.saveContext("a", { fieldId: "f", seasonId: null, businessTimezone: "Europe/Istanbul" });
    await store.enqueue("a", command);
    await expect(store.recordAccepted("a", command.observationId, { id: command.observationId,
      fieldId: "different-field", seasonId: null, description: command.description,
      occurredAt: command.occurredAt })).rejects.toThrow();
    expect(await store.list("a")).toEqual([command]);
  });

  it("shows retrying only while a live attempt is in flight and restarts as pending", async () => {
    const persistent = storage();
    const store = load()!.createObservationCommandStore({ storage: persistent });
    await store.setAuthenticatedAccount("a");
    await store.saveContext("a", { fieldId: "f", seasonId: null, businessTimezone: "Europe/Istanbul" });
    await store.enqueue("a", command);
    await store.markAttempt("a", command.observationId);
    expect(await store.list("a")).toEqual([expect.objectContaining({ retrying: true })]);
    const restarted = load()!.createObservationCommandStore({ storage: persistent });
    expect(await restarted.list("a")).toEqual([expect.objectContaining({ state: "PENDING", attemptMayHaveCommitted: true })]);
    expect((await restarted.list("a"))[0]?.retrying).not.toBe(true);
    await store.finishAttempt("a", command.observationId);
    expect((await store.list("a"))[0]?.retrying).not.toBe(true);
  });

  it("queues only the saved Field/Season/timezone context for the active account", async () => {
    const store = load()!.createObservationCommandStore({ storage: storage() });
    await store.setAuthenticatedAccount("a");
    await expect(store.enqueue("a", command)).rejects.toThrow();
    await store.saveContext("a", { fieldId: "f", seasonId: null, businessTimezone: "Europe/Istanbul" });
    await expect(store.enqueue("a", { ...command, capturedBusinessTimezone: "Europe/Berlin" })).rejects.toThrow();
    await store.enqueue("a", command);
    expect(await store.list("a")).toEqual([command]);
  });

  it("retains two distinct pending notes with their original identities after store recreation", async () => {
    const persistent = storage();
    const first = load()!.createObservationCommandStore({ storage: persistent });
    await first.setAuthenticatedAccount("a");
    await first.saveContext("a", { fieldId: "f", seasonId: null, businessTimezone: "Europe/Istanbul" });
    await first.enqueue("a", command);
    const second = load()!.createObservationCommandStore({ storage: persistent });
    const secondId = "223e4567-e89b-42d3-a456-426614174000";
    await second.enqueue("a", { ...command, observationId: secondId, description: "Second note" });
    expect((await second.list("a")).map((item) => [item.observationId, item.description])).toEqual([
      [command.observationId, command.description], [secondId, "Second note"],
    ]);
  });
});
