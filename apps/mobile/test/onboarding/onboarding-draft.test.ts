jest.mock("@react-native-async-storage/async-storage", () => (
  jest.requireActual("@react-native-async-storage/async-storage/jest/async-storage-mock")
));
import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * T037 contract seam for the planned T042/T043 implementation.
 *
 * The durable storage adapter represents app-local persistent storage. Reusing
 * its backing data across store instances models an app restart or process
 * termination. The tests intentionally do not prescribe the platform storage
 * technology or expose storage details to onboarding UI.
 */
type Geometry =
  | { type: "Point"; coordinates: [number, number] }
  | { type: "Polygon"; coordinates: number[][][] };

type OnboardingDraft = {
  fieldName?: string;
  geometry?: Geometry;
};

type DurableStorage = {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
};

type DraftStore = {
  save(accountId: string, draft: OnboardingDraft): Promise<void>;
  read(accountId: string): Promise<OnboardingDraft | null>;
  recordActivity(accountId: string): Promise<void>;
  purge(accountId: string): Promise<void>;
};

type DraftLifecycle = {
  successfulSave(accountId: string): Promise<void>;
  cancel(accountId: string): Promise<void>;
  signOut(accountId: string): Promise<void>;
  accountSwitch(previousAccountId: string): Promise<void>;
};

type DraftStoreModule = {
  createOnboardingDraftStore(options: {
    storage?: DurableStorage;
    now: () => number;
  }): DraftStore;
};

type DraftLifecycleModule = {
  createOnboardingDraftLifecycle(options: { store: DraftStore }): DraftLifecycle;
};

// These planned modules do not exist until T042/T043. Keeping the imports as
// runtime requires lets Jest parse this contract before then.
const { createOnboardingDraftStore } = jest.requireActual<DraftStoreModule>(
  "../../src/features/onboarding/onboarding-draft.store",
);
const DAY = 24 * 60 * 60 * 1000;
const point: Geometry = { type: "Point", coordinates: [29.02, 41.01] };
const polygon: Geometry = {
  type: "Polygon",
  coordinates: [[[29, 41], [29.1, 41], [29.1, 41.1], [29, 41]]],
};

function createDurableStorage(seed?: Map<string, unknown>): DurableStorage & {
  values: Map<string, unknown>;
} {
  const values = seed ?? new Map<string, unknown>();
  return {
    values,
    async get(key) {
      return values.get(key) ?? null;
    },
    async set(key, value) {
      values.set(key, value);
    },
    async remove(key) {
      values.delete(key);
    },
  };
}

describe("temporary onboarding draft contract", () => {
  let now: number;
  let storage: ReturnType<typeof createDurableStorage>;
  let store: DraftStore;

  beforeEach(() => {
    now = Date.UTC(2026, 0, 1);
    storage = createDurableStorage();
    store = createOnboardingDraftStore({ storage, now: () => now });
  });

  it.each([
    ["field name", { fieldName: "  Kuzey parseli  " }],
    ["location geometry", { geometry: point }],
  ] as const)("persists as soon as %s is entered", async (_enteredValue, draft) => {
    await store.save("account-1", draft);

    await expect(store.read("account-1")).resolves.toEqual(draft);
  });

  it("recovers the exact draft for the same account after connectivity loss and app or process restart", async () => {
    const draft = { fieldName: "Bahçe", geometry: polygon };
    await store.save("account-1", draft);

    // No network client is involved; a new store instance reads the same
    // app-local durable backing after the original process is gone.
    const restartedStore = createOnboardingDraftStore({
      storage: createDurableStorage(storage.values),
      now: () => now,
    });

    await expect(restartedStore.read("account-1")).resolves.toEqual(draft);
  });

  it("uses the existing app-local storage backend by default across store instances", async () => {
    await AsyncStorage.clear();
    const draft = { fieldName: "Doğu parseli", geometry: point };
    await createOnboardingDraftStore({ now: () => now }).save("account-1", draft);

    const reopenedStore = createOnboardingDraftStore({ now: () => now });

    await expect(reopenedStore.read("account-1")).resolves.toEqual(draft);
  });

  it("isolates drafts to the account and device that saved them", async () => {
    await store.save("account-1", { fieldName: "Bahçe" });

    await expect(store.read("account-2")).resolves.toBeNull();
    const otherDeviceStore = createOnboardingDraftStore({
      storage: createDurableStorage(),
      now: () => now,
    });
    await expect(otherDeviceStore.read("account-1")).resolves.toBeNull();
  });

  it("expires a draft after seven consecutive inactive days", async () => {
    await store.save("account-1", { geometry: point });
    now += 7 * DAY;

    await expect(store.read("account-1")).resolves.toBeNull();
  });

  it("resets the seven-day inactivity window when the farmer returns to the draft", async () => {
    const draft = { fieldName: "Bahçe" };
    await store.save("account-1", draft);
    now += 6 * DAY;
    await store.recordActivity("account-1");
    now += 6 * DAY;

    await expect(store.read("account-1")).resolves.toEqual(draft);

    now += DAY;
    await expect(store.read("account-1")).resolves.toBeNull();
  });

  it("stores only the field name and geometry as draft data, never credentials or tokens", async () => {
    const draft = { fieldName: "Bahçe", geometry: point };
    await store.save("account-1", draft);

    const recoveredDraft = await store.read("account-1");
    expect(recoveredDraft).toEqual(draft);
    expect(Object.keys(recoveredDraft ?? {}).sort()).toEqual(["fieldName", "geometry"]);

    const persistedText = JSON.stringify([...storage.values.values()]);
    expect(persistedText).not.toMatch(/access[_-]?token|refresh[_-]?token|password|secret/i);
    expect(persistedText).not.toContain("test-auth-token");
  });

  it("strips extra properties from the saved geometry", async () => {
    const geometryWithUnexpectedData = {
      ...point,
      accessToken: "must-not-be-persisted",
      userMetadata: { email: "farmer@example.invalid" },
    } as unknown as Geometry;
    await store.save("account-1", { fieldName: "Bahçe", geometry: geometryWithUnexpectedData });

    await expect(store.read("account-1")).resolves.toEqual({ fieldName: "Bahçe", geometry: point });
    expect(JSON.stringify([...storage.values.values()])).not.toContain("must-not-be-persisted");
    expect(JSON.stringify([...storage.values.values()])).not.toContain("farmer@example.invalid");
  });

  it("does not promise recovery when app-local data is absent on another device or after data removal", async () => {
    await store.save("account-1", { fieldName: "Bahçe" });

    // Uninstall, app-data deletion, and device loss all remove the local copy.
    const cleanInstallStore = createOnboardingDraftStore({
      storage: createDurableStorage(),
      now: () => now,
    });
    await expect(cleanInstallStore.read("account-1")).resolves.toBeNull();
  });

  it("treats corrupted or unavailable local draft data as unrecoverable", async () => {
    storage.values.set("onboarding-draft:account-1", "corrupt local data");

    await expect(store.read("account-1")).resolves.toBeNull();
  });
});

describe("onboarding draft purge lifecycle", () => {
  let store: DraftStore;
  let lifecycle: DraftLifecycle;

  beforeEach(() => {
    store = createOnboardingDraftStore({
      storage: createDurableStorage(),
      now: () => Date.UTC(2026, 0, 1),
    });
    const { createOnboardingDraftLifecycle } = jest.requireActual<DraftLifecycleModule>(
      "../../src/features/onboarding/onboarding-draft.lifecycle",
    );
    lifecycle = createOnboardingDraftLifecycle({ store });
  });

  it.each([
    ["successful onboarding/save", (accountId: string) => lifecycle.successfulSave(accountId)],
    ["explicit cancellation", (accountId: string) => lifecycle.cancel(accountId)],
    ["sign-out", (accountId: string) => lifecycle.signOut(accountId)],
    ["account switch", (accountId: string) => lifecycle.accountSwitch(accountId)],
  ])("purges the draft after %s", async (_event, purge) => {
    await store.save("account-1", { fieldName: "Bahçe", geometry: point });

    await purge("account-1");

    await expect(store.read("account-1")).resolves.toBeNull();
  });
});
