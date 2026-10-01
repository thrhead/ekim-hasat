import AsyncStorage from "@react-native-async-storage/async-storage";
import type { MapLocation } from "./map/map-adapter";

export type OnboardingDraft = Readonly<{
  fieldName?: string;
  geometry?: MapLocation;
}>;

export type DurableDraftStorage = Readonly<{
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
}>;

type OnboardingDraftStoreOptions = Readonly<{
  /** Override only at the storage boundary for deterministic tests. */
  storage?: DurableDraftStorage;
  /** Clock seam for deterministic inactivity-expiry tests. */
  now?: () => number;
}>;

const DRAFT_PREFIX = "onboarding-draft:";
const EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

const asyncStorage: DurableDraftStorage = {
  get: (key) => AsyncStorage.getItem(key),
  set: async (key, value) => {
    const serialized = typeof value === "string" ? value : JSON.stringify(value);
    await AsyncStorage.setItem(key, serialized);
  },
  remove: async (key) => {
    await AsyncStorage.removeItem(key);
  },
};

/** Durable, account-scoped storage for the temporary first-field form values. */
export function createOnboardingDraftStore(options: OnboardingDraftStoreOptions = {}) {
  const storage = options.storage ?? asyncStorage;
  const now = options.now ?? Date.now;

  function key(accountId: string) {
    if (typeof accountId !== "string" || accountId.trim().length === 0) {
      throw new Error("An authenticated account is required for an onboarding draft");
    }
    return `${DRAFT_PREFIX}${encodeURIComponent(accountId)}`;
  }

  return {
    async save(accountId: string, draft: OnboardingDraft): Promise<void> {
      const draftKey = key(accountId);
      const safeDraft = normalizeDraft(draft);
      await storage.set(draftKey, JSON.stringify({ draft: safeDraft, lastActivityAt: now() }));
    },

    async read(accountId: string): Promise<OnboardingDraft | null> {
      const draftKey = key(accountId);
      const stored = await storage.get(draftKey);
      if (stored === null || stored === undefined) return null;

      try {
        const parsed = typeof stored === "string" ? JSON.parse(stored) as unknown : stored;
        if (!isStoredDraft(parsed)) return null;
        if (now() - parsed.lastActivityAt >= EXPIRY_MS) {
          await storage.remove(draftKey);
          return null;
        }
        return normalizeDraft(parsed.draft);
      } catch {
        return null;
      }
    },

    async recordActivity(accountId: string): Promise<void> {
      const draftKey = key(accountId);
      const stored = await storage.get(draftKey);
      if (stored === null || stored === undefined) return;
      try {
        const parsed = typeof stored === "string" ? JSON.parse(stored) as unknown : stored;
        if (!isStoredDraft(parsed)) return;
        if (now() - parsed.lastActivityAt >= EXPIRY_MS) {
          await storage.remove(draftKey);
          return;
        }
        await storage.set(draftKey, JSON.stringify({ ...parsed, lastActivityAt: now() }));
      } catch {
        await storage.remove(draftKey);
      }
    },

    async purge(accountId: string): Promise<void> {
      await storage.remove(key(accountId));
    },
  };
}

function normalizeDraft(value: OnboardingDraft): OnboardingDraft {
  const draft: { fieldName?: string; geometry?: MapLocation } = {};
  if (typeof value.fieldName === "string") draft.fieldName = value.fieldName;
  if (value.geometry !== undefined) {
    if (!isMapLocation(value.geometry, true)) throw new Error("Onboarding draft geometry is invalid");
    draft.geometry = cloneGeometry(value.geometry);
  }
  return draft;
}

function isDraft(value: unknown): value is OnboardingDraft {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (Object.keys(candidate).some((key) => key !== "fieldName" && key !== "geometry")) return false;
  if (candidate.fieldName !== undefined && typeof candidate.fieldName !== "string") return false;
  if (candidate.geometry === undefined) return true;
  return isMapLocation(candidate.geometry);
}

function isStoredDraft(value: unknown): value is { draft: OnboardingDraft; lastActivityAt: number } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return Object.keys(candidate).sort().join(",") === "draft,lastActivityAt"
    && typeof candidate.lastActivityAt === "number"
    && Number.isFinite(candidate.lastActivityAt)
    && isDraft(candidate.draft);
}

function isMapLocation(value: unknown, allowAdditionalProperties = false): value is MapLocation {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (!allowAdditionalProperties && !hasExactKeys(candidate, ["type", "coordinates"])) return false;
  if (candidate.type === "Point") {
    return Array.isArray(candidate.coordinates)
      && candidate.coordinates.length === 2
      && candidate.coordinates.every((coordinate) => typeof coordinate === "number" && Number.isFinite(coordinate));
  }
  if (candidate.type === "Polygon") {
    return Array.isArray(candidate.coordinates)
      && candidate.coordinates.length === 1
      && Array.isArray(candidate.coordinates[0])
      && candidate.coordinates[0].every((position: unknown) => Array.isArray(position)
        && position.length === 2
        && position.every((coordinate: unknown) => typeof coordinate === "number" && Number.isFinite(coordinate)));
  }
  return false;
}

function hasExactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length && actual.every((key, index) => key === sortedExpected[index]);
}

function cloneGeometry(location: MapLocation): MapLocation {
  if (location.type === "Point") {
    return { type: "Point", coordinates: [location.coordinates[0], location.coordinates[1]] };
  }
  const ring = location.coordinates[0] ?? [];
  const points: [number, number][] = ring.map(([longitude, latitude]): [number, number] => [longitude, latitude]);
  return {
    type: "Polygon",
    coordinates: [points],
  };
}
