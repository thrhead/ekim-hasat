jest.mock("@react-native-async-storage/async-storage", () => (
  jest.requireActual("@react-native-async-storage/async-storage/jest/async-storage-mock")
));

import { createMobileAuthController, type AuthSession, type MobileAuthPort } from "../src/auth/auth-port";
import { createAppComposition } from "../src/app-composition";
import { createOnboardingDraftLifecycle } from "../src/features/onboarding/onboarding-draft.lifecycle";
import { createSeasonCreateCommandStore, type SeasonCreateCommand, type SeasonCreateCommandStorage, type SeasonCreateResult } from "../src/features/seasons/season-create-command-store";
import { createTaskCompletionCommandStore, type TaskCompletionCommand, type TaskCompletionCommandStorage, type TodaySnapshot } from "../src/features/tasks/task-completion-command-store";
import { TodayScreen } from "../src/features/seasons/today-screen";
import { createElement } from "react";
import type { SeasonComponents } from "../src/api/onboarding-client";

// react-test-renderer v19 ships without declarations; keep the test API narrowly typed.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act, create } = require("react-test-renderer") as {
  act: (callback: () => void | Promise<void>) => Promise<void>;
  create: (element: React.ReactElement) => { root: { findByProps: (props: Record<string, unknown>) => { props: Record<string, unknown> } }; toJSON: () => unknown };
};

const summary = {
  id: "field-1",
  name: "Tarla 1",
  representativePoint: { type: "Point" as const, coordinates: [29.02, 41.01] as [number, number] },
  createdAt: "2026-09-25T12:00:00.000Z",
};

function setup(
  fetchMock = jest.fn<Promise<Response>, [input: RequestInfo | URL, init?: RequestInit]>(),
  seasonCreateStore = createSeasonCreateCommandStore({
    storage: {
      async read() { return null; },
      async saveCommand() {},
      async recordSuccess() {},
      async clearSuccess() {},
    } satisfies SeasonCreateCommandStorage,
  }),
  taskCompletionStore?: ReturnType<typeof createTaskCompletionCommandStore>,
) {
  const purgedAccounts: string[] = [];
  let sessionListener: ((session: AuthSession | null) => void) | undefined;
  let restore: (session: AuthSession | null) => void = () => {};
  const auth: MobileAuthPort = {
    restoreSession: () => new Promise((resolve) => { restore = resolve; }),
    onSessionChange: (listener) => {
      sessionListener = listener;
      return () => { sessionListener = undefined; };
    },
    signOut: async () => { sessionListener?.(null); },
  };
  const controller = createMobileAuthController(auth, {
    apiBaseUrl: "https://api.example.test/v1",
    fetch: fetchMock,
  });
  const draftLifecycle = createOnboardingDraftLifecycle({
    store: { purge: async (accountId) => { purgedAccounts.push(accountId); } },
  });
  const app = createAppComposition(controller, { draftLifecycle, seasonCreateStore, ...(taskCompletionStore ? { taskCompletionStore } : {}) });
  return {
    app,
    controller,
    fetchMock,
    authenticate: (accountId = "account-1") => sessionListener?.({ accountId, accessToken: "session-token" }),
    finishRestore: (session: AuthSession | null = null) => restore(session),
    purgedAccounts,
    seasonCreateStore,
  };
}

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("production app composition", () => {
  it("routes an activated season into the read-only Today surface", () => {
    const { app } = setup();
    app.showToday();
    expect(app.getState().entry).toBe("today");
  });

  it("routes accepted-work navigation to the selected field and season History, then back to Today", () => {
    const { app } = setup();
    app.showHistory("field-1", "season-1");
    expect(app.getState()).toMatchObject({ entry: "history", historyFieldId: "field-1", historySeasonId: "season-1" });
    app.showToday();
    expect(app.getState()).toMatchObject({ entry: "today", historyFieldId: null, historySeasonId: null });
  });

  it("shows loading while the persisted auth session is resolving", () => {
    const { app } = setup();
    expect(app.getState().auth.status).toBe("loading");
    expect(app.getState().entry).toBe("loading");
  });

  it("keeps signed-out users on the existing shell without sign-in UI", async () => {
    const { app, finishRestore, fetchMock } = setup();
    finishRestore(null);
    await settle();
    expect(app.getState().auth.status).toBe("signed-out");
    expect(app.getState().client).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("routes an authenticated new farmer to the first-field screen entry", async () => {
    const fetchMock = jest.fn<Promise<Response>, [input: RequestInfo | URL, init?: RequestInit]>()
      .mockResolvedValue(response({ firstFieldOnboardingNeeded: true }));
    const seasonCreateStore = createSeasonCreateCommandStore({ storage: {
      async read(accountId) {
        return accountId === "account-1" ? {
          unresolved: { idempotencyKey: "stale-season-key", fieldId: "stale-field", request: { crop: { customCropName: "Arpa" }, sowingPlantingDate: "2026-09-25", planSource: "MANUAL" } },
          lastSuccess: null,
        } : null;
      },
      async saveCommand() {}, async recordSuccess() {}, async clearSuccess() {},
    } satisfies SeasonCreateCommandStorage });
    const taskCompletionStore = createTaskCompletionCommandStore({ storage: {
      async listCommands(accountId) { return accountId === "account-1" ? [{
        completionId: "stale-completion", taskId: "task-1", seasonId: "season-1", fieldId: "field-1", title: "Sulama kontrolü",
        cropDisplayName: "Arpa", plannedLocalDate: "2026-09-30", baseTaskVersion: 7, occurredAt: "2026-09-30T08:15:00.000Z",
        request: { completionId: "stale-completion", occurredAt: "2026-09-30T08:15:00.000Z" }, state: "PENDING" as const,
      }] : []; },
      async insertCommand() {}, async recordAccepted() {}, async recordConflict() {},
      async writeTodaySnapshot() {}, async readTodaySnapshot() { return null; },
    } satisfies TaskCompletionCommandStorage });
    const { app, authenticate } = setup(fetchMock, seasonCreateStore, taskCompletionStore);
    authenticate();
    await settle();
    expect(app.getState().entry).toBe("first-field-onboarding");
    expect(app.getState().client).not.toBeNull();
    expect(app.getState().accountId).toBe("account-1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("routes an authenticated returning farmer to Today after server confirmation", async () => {
    const fetchMock = jest.fn<Promise<Response>, [input: RequestInfo | URL, init?: RequestInit]>()
      .mockResolvedValue(response({ firstFieldOnboardingNeeded: false }));
    const { app, authenticate } = setup(fetchMock);
    authenticate();
    await settle();
    expect(app.getState().entry).toBe("today");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps one task completion coordinator for the authenticated app composition", () => {
    const { app, authenticate } = setup();
    authenticate();
    const coordinator = app.getTaskCompletionCoordinator();
    expect(app.getTaskCompletionCoordinator()).toBe(coordinator);
  });

  it("routes a restarted authenticated account with a durable pending command to offline Today when status is unavailable", async () => {
    const parts = new Intl.DateTimeFormat("en", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
    const dateParts = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    const localDate = `${dateParts.year}-${dateParts.month}-${dateParts.day}`;
    const command: TaskCompletionCommand = {
      completionId: "completion-stable", taskId: "task-1", seasonId: "season-1", fieldId: "field-1",
      title: "Sulama kontrolü", cropDisplayName: "Arpa", plannedLocalDate: localDate, baseTaskVersion: 7,
      occurredAt: "2026-09-30T08:15:00.000Z",
      request: { completionId: "completion-stable", occurredAt: "2026-09-30T08:15:00.000Z" }, state: "PENDING",
    };
    const now = new Date();
    const snapshot: TodaySnapshot = {
      localDate, businessTimezone: "Europe/Istanbul",
      tasks: [{ id: command.taskId, seasonId: command.seasonId, fieldId: command.fieldId, title: command.title,
        cropDisplayName: command.cropDisplayName, plannedLocalDate: command.plannedLocalDate, taskVersion: command.baseTaskVersion }],
      fetchedAt: now.toISOString(),
    };
    let commands = [command];
    let cached: TodaySnapshot | null = snapshot;
    const taskCompletionStore = createTaskCompletionCommandStore({ storage: {
      async listCommands(accountId) { return accountId === "account-1" ? commands : []; },
      async insertCommand(_accountId, next) { commands = [...commands, { ...next, state: "PENDING" }]; },
      async recordAccepted(_accountId, completionId, result) { commands = commands.map((row) => row.completionId === completionId ? { ...row, state: "ACCEPTED", result } : row); },
      async recordConflict(_accountId, completionId, conflictCode) { commands = commands.map((row) => row.completionId === completionId ? { ...row, state: "CONFLICTED", conflictCode } : row); },
      async writeTodaySnapshot(accountId, next) { if (accountId === "account-1") cached = next; },
      async readTodaySnapshot(accountId) { return accountId === "account-1" ? cached : null; },
    } satisfies TaskCompletionCommandStorage });
    const fetchMock = jest.fn<Promise<Response>, [input: RequestInfo | URL, init?: RequestInit]>()
      .mockResolvedValue(response({ code: "UNAVAILABLE" }, 503));
    const { app, authenticate } = setup(fetchMock, undefined, taskCompletionStore);

    authenticate("account-1");
    await settle();

    expect(app.getState()).toMatchObject({ entry: "today", accountId: "account-1" });
    expect(await taskCompletionStore.list("account-1")).toEqual([command]);
    expect(await taskCompletionStore.readTodaySnapshot("account-1")).toEqual(snapshot);

    const acceptedResult = {
      id: command.completionId, taskId: command.taskId, seasonId: command.seasonId, fieldId: command.fieldId,
      title: command.title, plannedLocalDate: command.plannedLocalDate, occurredAt: command.occurredAt,
      sourceKind: "MANUAL" as const, templateVersionId: null, businessTimezone: "Europe/Istanbul",
    };
    const POST = jest.fn()
      .mockResolvedValueOnce({ response: { ok: false, status: 503 }, error: { code: "UNAVAILABLE" } })
      .mockResolvedValueOnce({ response: { ok: true, status: 200 }, data: acceptedResult, error: undefined });
    const client = { GET: jest.fn().mockRejectedValue(new Error("offline")), POST } as never;
    const onOpenHistory = jest.fn();
    let rendered!: ReturnType<typeof create>;
    await act(async () => {
      rendered = create(createElement(TodayScreen, {
        client, accountId: "account-1", store: taskCompletionStore,
        getAuthorizationSession: () => ({ accountId: "account-1", client }),
        now: () => now, onOpenHistory,
      }));
    });
    expect(JSON.stringify(rendered.toJSON())).toContain("Eşitleme bekliyor");
    const retry = rendered.root.findByProps({ accessibilityLabel: "Tamamlamayı tekrar dene: Sulama kontrolü" });
    await act(async () => { (retry.props.onPress as () => void)(); });
    expect(POST).toHaveBeenCalledWith("/tasks/{taskId}/completions", {
      params: { path: { taskId: "task-1" }, header: { "If-Match": "7" } },
      body: { completionId: "completion-stable", occurredAt: command.occurredAt },
    });
    expect(await taskCompletionStore.list("account-1")).toMatchObject([{ completionId: "completion-stable", state: "PENDING" }]);

    await taskCompletionStore.writeTodaySnapshot("account-1", { ...snapshot, localDate: "2000-01-01" });
    let staleCacheView!: ReturnType<typeof create>;
    await act(async () => {
      staleCacheView = create(createElement(TodayScreen, {
        client, accountId: "account-1", store: taskCompletionStore,
        getAuthorizationSession: () => ({ accountId: "account-1", client }),
        now: () => now, onOpenHistory,
      }));
    });
    expect(JSON.stringify(staleCacheView.toJSON())).toContain("Sulama kontrolü");
    expect(JSON.stringify(staleCacheView.toJSON())).toContain("Eşitleme bekliyor");
    expect(() => staleCacheView.root.findByProps({ accessibilityLabel: "Tamamlamayı tekrar dene: Sulama kontrolü" })).not.toThrow();
    const secondRetry = staleCacheView.root.findByProps({ accessibilityLabel: "Tamamlamayı tekrar dene: Sulama kontrolü" });
    await act(async () => { (secondRetry.props.onPress as () => void)(); });
    expect(await taskCompletionStore.list("account-1")).toMatchObject([{ completionId: "completion-stable", state: "ACCEPTED" }]);
    expect(JSON.stringify(staleCacheView.toJSON())).toContain("Tamamlandı · geçmişi sunucudan açın");
    const openHistory = staleCacheView.root.findByProps({ accessibilityLabel: "Geçmişi aç: Sulama kontrolü" });
    await act(async () => { (openHistory.props.onPress as () => void)(); });
    expect(onOpenHistory).toHaveBeenCalledWith("field-1", "season-1");

    const denied = setup(jest.fn().mockResolvedValue(response({ code: "FORBIDDEN" }, 403)), undefined, taskCompletionStore);
    denied.authenticate("account-1");
    await settle();
    expect(denied.app.getState()).toMatchObject({ entry: "status-error", accountId: "account-1" });
  });

  it("recovers unresolved season setup before offline Today when both durable commands exist", async () => {
    const unresolved: SeasonCreateCommand = {
      idempotencyKey: "season-stable-key",
      fieldId: "field-1",
      request: { crop: { customCropName: "Arpa" }, sowingPlantingDate: "2026-09-25", planSource: "MANUAL" },
    };
    const saveCommand = jest.fn(async () => {});
    const seasonCreateStore = createSeasonCreateCommandStore({ storage: {
      async read(accountId) {
        return accountId === "account-1" ? { unresolved, lastSuccess: null } : null;
      },
      saveCommand,
      async recordSuccess() {},
      async clearSuccess() {},
    } satisfies SeasonCreateCommandStorage });
    const completion: TaskCompletionCommand = {
      completionId: "completion-stable", taskId: "task-1", seasonId: "season-1", fieldId: "field-1",
      title: "Sulama kontrolü", cropDisplayName: "Arpa", plannedLocalDate: "2026-09-30", baseTaskVersion: 7,
      occurredAt: "2026-09-30T08:15:00.000Z",
      request: { completionId: "completion-stable", occurredAt: "2026-09-30T08:15:00.000Z" }, state: "PENDING",
    };
    let commands = [completion];
    const taskCompletionStore = createTaskCompletionCommandStore({ storage: {
      async listCommands(accountId) { return accountId === "account-1" ? commands : []; },
      async insertCommand(_accountId, command) { commands = [...commands, command]; },
      async recordAccepted() {},
      async recordConflict() {},
      async writeTodaySnapshot() {},
      async readTodaySnapshot() { return null; },
    } satisfies TaskCompletionCommandStorage });
    const fetchMock = jest.fn<Promise<Response>, [input: RequestInfo | URL, init?: RequestInit]>()
      .mockResolvedValue(response({ code: "UNAVAILABLE" }, 503));
    const { app, authenticate } = setup(fetchMock, seasonCreateStore, taskCompletionStore);

    authenticate("account-1");
    await settle();
    await settle();

    expect(app.getState()).toMatchObject({
      entry: "season-setup", accountId: "account-1", fieldId: "field-1", seasonRequest: unresolved.request,
    });
    expect(await seasonCreateStore.readUnresolved("account-1")).toEqual(unresolved);
    expect(saveCommand).not.toHaveBeenCalled();
    expect(await taskCompletionStore.list("account-1")).toEqual([completion]);
    expect(commands).toEqual([completion]);
  });

  it("does not use another account's season or completion recovery state", async () => {
    const seasonCreateStore = createSeasonCreateCommandStore({ storage: {
      async read(accountId) {
        return accountId === "account-1" ? {
          unresolved: { idempotencyKey: "account-a-season-key", fieldId: "field-1", request: { crop: { customCropName: "Arpa" }, sowingPlantingDate: "2026-09-25", planSource: "MANUAL" } },
          lastSuccess: null,
        } : null;
      },
      async saveCommand() {}, async recordSuccess() {}, async clearSuccess() {},
    } satisfies SeasonCreateCommandStorage });
    const taskCompletionStore = createTaskCompletionCommandStore({ storage: {
      async listCommands(accountId) { return accountId === "account-1" ? [{
        completionId: "completion-1", taskId: "task-1", seasonId: "season-1", fieldId: "field-1", title: "Sulama kontrolü",
        cropDisplayName: "Arpa", plannedLocalDate: "2026-09-30", baseTaskVersion: 7,
        occurredAt: "2026-09-30T08:15:00.000Z", request: { completionId: "completion-1", occurredAt: "2026-09-30T08:15:00.000Z" }, state: "PENDING",
      }] : []; },
      async insertCommand() {}, async recordAccepted() {}, async recordConflict() {},
      async writeTodaySnapshot() {}, async readTodaySnapshot() { return null; },
    } satisfies TaskCompletionCommandStorage });
    const fetchMock = jest.fn<Promise<Response>, [input: RequestInfo | URL, init?: RequestInit]>()
      .mockResolvedValue(response({ code: "UNAVAILABLE" }, 503));
    const { app, authenticate } = setup(fetchMock, seasonCreateStore, taskCompletionStore);

    authenticate("account-2");
    await settle();

    expect(app.getState()).toMatchObject({ entry: "status-error", accountId: "account-2" });
  });

  it("shows status retry and repeats status resolution when requested", async () => {
    const fetchMock = jest.fn<Promise<Response>, [input: RequestInfo | URL, init?: RequestInit]>()
      .mockResolvedValueOnce(response({ code: "UNAVAILABLE" }, 503))
      .mockResolvedValueOnce(response({ firstFieldOnboardingNeeded: true }));
    const { app, authenticate } = setup(fetchMock);
    authenticate();
    await settle();
    expect(app.getState().entry).toBe("status-error");
    app.retryStatus();
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(app.getState().entry).toBe("first-field-onboarding");
  });

  it("routes a committed first-field summary directly to season setup", async () => {
    const fetchMock = jest.fn<Promise<Response>, [input: RequestInfo | URL, init?: RequestInit]>()
      .mockResolvedValue(response({ firstFieldOnboardingNeeded: true }));
    const { app, authenticate } = setup(fetchMock);
    authenticate();
    await settle();
    app.completeFirstField(summary);
    expect(app.getState().entry).toBe("season-setup");
    expect(app.getState().fieldId).toBe("field-1");
  });

  it("recovers an unresolved season create command for its original field", async () => {
    const unresolved: SeasonCreateCommand = {
      idempotencyKey: "stable-key",
      fieldId: "field-1",
      request: { crop: { customCropName: "Arpa" }, sowingPlantingDate: "2026-09-25", planSource: "MANUAL" },
    };
    const storage: SeasonCreateCommandStorage = {
      async read(accountId) {
        return accountId === "account-1" ? { unresolved, lastSuccess: null } : null;
      },
      async saveCommand() {},
      async recordSuccess() {},
      async clearSuccess() {},
    };
    const seasonCreateStore = createSeasonCreateCommandStore({ storage });
    const fetchMock = jest.fn<Promise<Response>, [input: RequestInfo | URL, init?: RequestInit]>()
      .mockResolvedValue(response({ firstFieldOnboardingNeeded: false }));
    const { app, authenticate } = setup(fetchMock, seasonCreateStore);
    authenticate();
    await settle();
    await settle();

    expect(app.getState().entry).toBe("season-setup");
    expect(app.getState().fieldId).toBe("field-1");
    expect(app.getState().seasonRequest).toEqual(unresolved.request);
  });

  it("returns from a durable create receipt after acknowledgement", async () => {
    const result: SeasonCreateResult = {
      id: "season-1",
      fieldId: "field-1",
      cropDisplayName: "Arpa",
      sowingPlantingDate: "2026-09-25",
      status: "DRAFT",
      version: 1,
      plan: { source: { kind: "MANUAL", validationLabel: "NOT_CENTRALLY_VALIDATED" }, tasks: [] },
    };
    let lastSuccess: { idempotencyKey: string; result: SeasonCreateResult } | null = { idempotencyKey: "done-key", result };
    const storage: SeasonCreateCommandStorage = {
      async read() { return { unresolved: null, lastSuccess }; },
      async saveCommand() {},
      async recordSuccess() {},
      async clearSuccess(_accountId, idempotencyKey) {
        if (lastSuccess?.idempotencyKey === idempotencyKey) lastSuccess = null;
      },
    };
    const fetchMock = jest.fn<Promise<Response>, [input: RequestInfo | URL, init?: RequestInit]>()
      .mockResolvedValue(response({ firstFieldOnboardingNeeded: false }));
    const noCompletions = createTaskCompletionCommandStore({ storage: {
      async listCommands() { return []; }, async insertCommand() {}, async recordAccepted() {}, async recordConflict() {},
      async writeTodaySnapshot() {}, async readTodaySnapshot() { return null; },
    } satisfies TaskCompletionCommandStorage });
    const { app, authenticate } = setup(fetchMock, createSeasonCreateCommandStore({ storage }), noCompletions);
    authenticate();
    await settle();
    await settle();
    expect(app.getState().entry).toBe("season-created");

    await app.continueAfterSeason();
    expect(lastSuccess).toBeNull();
    expect(app.getState().entry).toBe("home");
  });

  it("continues recovered season setup to Today with the same pending completion available to retry", async () => {
    const unresolved: SeasonCreateCommand = {
      idempotencyKey: "season-recovery-key",
      fieldId: "field-1",
      request: { crop: { customCropName: "Arpa" }, sowingPlantingDate: "2026-09-25", planSource: "MANUAL" },
    };
    const createdSeason: SeasonCreateResult = {
      id: "season-draft-1", fieldId: "field-1", cropDisplayName: "Arpa", sowingPlantingDate: "2026-09-25",
      status: "DRAFT", version: 1,
      plan: { source: { kind: "MANUAL", validationLabel: "NOT_CENTRALLY_VALIDATED" }, tasks: [] },
    };
    let unresolvedCommand: SeasonCreateCommand | null = unresolved;
    let lastSuccess: { idempotencyKey: string; result: SeasonCreateResult } | null = null;
    const seasonCreateStore = createSeasonCreateCommandStore({ storage: {
      async read(accountId) {
        return accountId === "account-1" ? { unresolved: unresolvedCommand, lastSuccess } : null;
      },
      async saveCommand(accountId, command) { if (accountId === "account-1") unresolvedCommand = command; },
      async recordSuccess(accountId, idempotencyKey, result) {
        if (accountId === "account-1") {
          unresolvedCommand = null;
          lastSuccess = { idempotencyKey, result };
        }
      },
      async clearSuccess(accountId, idempotencyKey) {
        if (accountId === "account-1" && lastSuccess?.idempotencyKey === idempotencyKey) lastSuccess = null;
      },
    } satisfies SeasonCreateCommandStorage });
    const completion: TaskCompletionCommand = {
      completionId: "completion-original", taskId: "task-original", seasonId: "season-original", fieldId: "field-original",
      title: "Sulama kontrolü", cropDisplayName: "Arpa", plannedLocalDate: "2026-09-30", baseTaskVersion: 12,
      occurredAt: "2026-09-30T08:15:00.000Z",
      request: { completionId: "completion-original", occurredAt: "2026-09-30T08:15:00.000Z" }, state: "PENDING",
    };
    let commands = [completion];
    const insertCommand = jest.fn(async (_accountId: string, command: TaskCompletionCommand) => { commands = [...commands, command]; });
    const taskCompletionStore = createTaskCompletionCommandStore({ storage: {
      async listCommands(accountId) { return accountId === "account-1" ? commands : []; },
      insertCommand,
      async recordAccepted(accountId, completionId, result) {
        if (accountId === "account-1") commands = commands.map((item) => item.completionId === completionId ? { ...item, state: "ACCEPTED", result } : item);
      },
      async recordConflict(accountId, completionId, conflictCode) {
        if (accountId === "account-1") commands = commands.map((item) => item.completionId === completionId ? { ...item, state: "CONFLICTED", conflictCode } : item);
      },
      async writeTodaySnapshot() {}, async readTodaySnapshot() { return null; },
    } satisfies TaskCompletionCommandStorage });
    const fetchMock = jest.fn<Promise<Response>, [input: RequestInfo | URL, init?: RequestInit]>()
      .mockResolvedValueOnce(response({ code: "UNAVAILABLE" }, 503))
      .mockResolvedValueOnce(response(createdSeason));
    const { app, authenticate } = setup(fetchMock, seasonCreateStore, taskCompletionStore);

    authenticate("account-1");
    await settle();
    expect(app.getState()).toMatchObject({ entry: "season-setup", accountId: "account-1", fieldId: "field-1", seasonRequest: unresolved.request });
    expect(await seasonCreateStore.readUnresolved("account-1")).toEqual(unresolved);

    await app.createSeason("field-1", unresolved.request);
    const seasonRequest = fetchMock.mock.calls[1]?.[0] as Request;
    expect(new URL(seasonRequest.url).pathname).toBe("/v1/fields/field-1/seasons");
    expect(seasonRequest.headers.get("Idempotency-Key")).toBe(unresolved.idempotencyKey);
    expect(await seasonRequest.json()).toEqual(unresolved.request);
    expect(unresolvedCommand).toBeNull();
    expect(lastSuccess).toEqual({ idempotencyKey: unresolved.idempotencyKey, result: createdSeason });
    expect(await taskCompletionStore.list("account-1")).toEqual([completion]);
    expect(insertCommand).not.toHaveBeenCalled();

    await app.continueAfterSeason();

    expect(app.getState()).toMatchObject({ entry: "today", accountId: "account-1" });
    expect(lastSuccess).toBeNull();
    expect(await taskCompletionStore.list("account-1")).toEqual([completion]);

    const POST = jest.fn().mockResolvedValue({
      response: { ok: false, status: 503 }, error: { code: "UNAVAILABLE" }, data: undefined,
    });
    const todayClient = { GET: jest.fn().mockRejectedValue(new Error("offline")), POST } as never;
    let today!: ReturnType<typeof create>;
    await act(async () => {
      today = create(createElement(TodayScreen, {
        client: todayClient, accountId: "account-1", store: taskCompletionStore,
        getAuthorizationSession: () => ({ accountId: "account-1", client: todayClient }),
        now: () => new Date("2026-09-30T08:15:00.000Z"), onOpenHistory: jest.fn(),
      }));
    });
    expect(JSON.stringify(today.toJSON())).toContain("Sulama kontrolü");
    expect(JSON.stringify(today.toJSON())).toContain("Eşitleme bekliyor");
    const retry = today.root.findByProps({ accessibilityLabel: "Tamamlamayı tekrar dene: Sulama kontrolü" });
    await act(async () => { (retry.props.onPress as () => void)(); });
    expect(POST).toHaveBeenCalledWith("/tasks/{taskId}/completions", {
      params: { path: { taskId: "task-original" }, header: { "If-Match": "12" } },
      body: { completionId: "completion-original", occurredAt: "2026-09-30T08:15:00.000Z" },
    });
    expect(await taskCompletionStore.list("account-1")).toEqual([completion]);
    expect(insertCommand).not.toHaveBeenCalled();
  });

  it("restores the latest scoped DRAFT when returning to plan review", async () => {
    const draft: SeasonComponents["schemas"]["SeasonDraft"] = {
      id: "season-1", fieldId: "field-1", cropDisplayName: "Arpa", sowingPlantingDate: "2026-09-25", status: "DRAFT", version: 2,
      plan: { source: { kind: "MANUAL", validationLabel: "NOT_CENTRALLY_VALIDATED" }, tasks: [] },
    };
    const fetchMock = jest.fn<Promise<Response>, [input: RequestInfo | URL, init?: RequestInit]>()
      .mockResolvedValueOnce(response({ firstFieldOnboardingNeeded: false }))
      .mockResolvedValueOnce(response(draft));
    const { app, authenticate } = setup(fetchMock);
    authenticate();
    await settle();
    app.reviewSeason(draft);

    await app.restoreSeasonReview();

    expect(app.getState().entry).toBe("season-review");
    expect(app.getState().seasonDraft).toEqual(draft);
    expect(new URL((fetchMock.mock.calls[1]![0] as Request).url).pathname).toBe("/v1/seasons/season-1");
  });

  it("keeps the review open after a failed restore so the farmer can retry", async () => {
    const draft: SeasonComponents["schemas"]["SeasonDraft"] = {
      id: "season-1", fieldId: "field-1", cropDisplayName: "Arpa", sowingPlantingDate: "2026-09-25", status: "DRAFT", version: 2,
      plan: { source: { kind: "MANUAL", validationLabel: "NOT_CENTRALLY_VALIDATED" }, tasks: [] },
    };
    const fetchMock = jest.fn<Promise<Response>, [input: RequestInfo | URL, init?: RequestInit]>()
      .mockResolvedValueOnce(response({ firstFieldOnboardingNeeded: false }))
      .mockResolvedValueOnce(response({ code: "UNAVAILABLE" }, 503))
      .mockResolvedValueOnce(response(draft));
    const { app, authenticate } = setup(fetchMock);
    authenticate();
    await settle();
    app.reviewSeason(draft);

    await app.restoreSeasonReview();
    expect(app.getState().entry).toBe("season-review");
    expect(app.getState().seasonDraft).toEqual(draft);
    await app.restoreSeasonReview();
    expect(app.getState().entry).toBe("season-review");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("makes no general field-list request", async () => {
    const fetchMock = jest.fn<Promise<Response>, [input: RequestInfo | URL, init?: RequestInit]>()
      .mockResolvedValue(response({ firstFieldOnboardingNeeded: true }));
    const { authenticate } = setup(fetchMock);
    authenticate();
    await settle();
    const requests = fetchMock.mock.calls.map(([request]) => new URL((request as Request).url).pathname);
    expect(requests).toEqual(["/v1/onboarding/status"]);
  });

  it("uses T043 lifecycle cleanup on sign-out and account switch", async () => {
    const fetchMock = jest.fn<Promise<Response>, [input: RequestInfo | URL, init?: RequestInit]>()
      .mockResolvedValue(response({ firstFieldOnboardingNeeded: true }));
    const { authenticate, controller, purgedAccounts } = setup(fetchMock);
    authenticate("account-1");
    await settle();
    authenticate("account-2");
    await settle();
    expect(purgedAccounts).toEqual(["account-1"]);

    await controller.signOut();
    expect(purgedAccounts).toEqual(["account-1", "account-2"]);
  });
});
