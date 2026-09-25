jest.mock("@react-native-async-storage/async-storage", () => (
  jest.requireActual("@react-native-async-storage/async-storage/jest/async-storage-mock")
));

import {
  createFirstFieldDraftBinding,
} from "../../src/features/onboarding/first-field-screen";
import {
  createOnboardingDraftLifecycle,
} from "../../src/features/onboarding/onboarding-draft.lifecycle";
import {
  createOnboardingDraftStore,
  type DurableDraftStorage,
} from "../../src/features/onboarding/onboarding-draft.store";
import type { MapLocation } from "../../src/features/onboarding/map/map-adapter";

const accountId = "farmer-account-1";
const point: MapLocation = { type: "Point", coordinates: [29.02, 41.01] };
const polygon: MapLocation = {
  type: "Polygon",
  coordinates: [[[29, 41], [29.1, 41], [29.1, 41.1], [29, 41]]],
};

function setup(seed?: Map<string, unknown>) {
  let now = Date.UTC(2026, 0, 1);
  const values = seed ?? new Map<string, unknown>();
  const storage: DurableDraftStorage = {
    get: async (key) => values.get(key) ?? null,
    set: async (key, value) => { values.set(key, value); },
    remove: async (key) => { values.delete(key); },
  };
  const store = createOnboardingDraftStore({ storage, now: () => now });
  const lifecycle = createOnboardingDraftLifecycle({ store });
  const binding = createFirstFieldDraftBinding({ accountId, store, lifecycle });
  return { values, storage, store, lifecycle, binding, setNow: (next: number) => { now = next; } };
}

describe("first-field draft integration", () => {
  it.each([
    ["Point", point],
    ["Polygon", polygon],
  ])("restores a valid %s draft and its field name", async (_kind, geometry) => {
    const { binding, store } = setup();
    await store.save(accountId, { fieldName: "Bahçe", geometry });

    await expect(binding.restore()).resolves.toEqual({
      name: "Bahçe",
      location: geometry,
      mode: geometry.type === "Polygon" ? "polygon" : "point",
      hasDraft: true,
    });
  });

  it("keeps the empty form when there is no valid draft", async () => {
    const { binding } = setup();
    await expect(binding.restore()).resolves.toEqual({ name: "", location: null, mode: "point", hasDraft: false });
  });

  it.each([
    ["expired", JSON.stringify({ draft: { fieldName: "Stale", geometry: point }, lastActivityAt: 0 })],
    ["corrupt", "not-json"],
  ])("does not restore %s stored data", async (_kind, rawValue) => {
    const { binding } = setup(new Map([["onboarding-draft:farmer-account-1", rawValue]]));
    await expect(binding.restore()).resolves.toEqual({ name: "", location: null, mode: "point", hasDraft: false });
  });

  it("can restore the persisted draft after screen reconstruction", async () => {
    const { storage, binding } = setup();
    await binding.persist("Bahçe", polygon);

    const reopenedStore = createOnboardingDraftStore({ storage, now: () => Date.UTC(2026, 0, 1) });
    const reopened = createFirstFieldDraftBinding({
      accountId,
      store: reopenedStore,
      lifecycle: createOnboardingDraftLifecycle({ store: reopenedStore }),
    });
    await expect(reopened.restore()).resolves.toEqual({ name: "Bahçe", location: polygon, mode: "polygon", hasDraft: true });
  });

  it("records return activity through the existing T043 store behavior", async () => {
    const { store, binding, setNow } = setup();
    await store.save(accountId, { fieldName: "Bahçe" });
    setNow(Date.UTC(2026, 0, 7));

    await binding.restore();
    setNow(Date.UTC(2026, 0, 13));
    await expect(store.read(accountId)).resolves.toEqual({ fieldName: "Bahçe" });
    setNow(Date.UTC(2026, 0, 14));
    await expect(store.read(accountId)).resolves.toBeNull();
  });

  it("retains the draft after a recoverable submit failure", async () => {
    const { binding, store } = setup();
    await binding.persist("Bahçe", point);

    await expect(binding.submit(async () => { throw new Error("offline"); })).rejects.toThrow("offline");
    await expect(store.read(accountId)).resolves.toEqual({ fieldName: "Bahçe", geometry: point });
  });

  it("purges through the T043 lifecycle after successful completion", async () => {
    const { binding, store } = setup();
    const summary = { id: "field-1", name: "Bahçe", representativePoint: point, createdAt: "2026-01-01T00:00:00.000Z" };
    await binding.persist("Bahçe", point);

    await expect(binding.submit(async () => summary)).resolves.toBe(summary);
    await expect(store.read(accountId)).resolves.toBeNull();
  });

  it("keeps drafts isolated between accounts", async () => {
    const { store, binding } = setup();
    await binding.persist("Bahçe", point);
    const otherAccount = createFirstFieldDraftBinding({
      accountId: "farmer-account-2",
      store,
      lifecycle: createOnboardingDraftLifecycle({ store }),
    });

    await expect(otherAccount.restore()).resolves.toEqual({ name: "", location: null, mode: "point", hasDraft: false });
    await expect(store.read(accountId)).resolves.toEqual({ fieldName: "Bahçe", geometry: point });
  });
});
