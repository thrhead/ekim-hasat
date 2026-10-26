import { ApiError } from "../observability/api-error.filter.js";
import { validateLocalDate } from "@ekim-hasat/domain/seasons/local-date";
import { businessLocalDate } from "../seasons/business-timezone.js";

export type DiaryKind = "IRRIGATION" | "OBSERVATION" | "TASK_COMPLETION" | "TASK_SKIPPED" | "EXPENSE" | "HARVEST";
export type DiaryEntry = Readonly<{
  kind: "IRRIGATION"; id: string; fieldId: string; seasonId: string | null; occurredAt: string; businessTimezone: string;
  method: string | null; durationMinutes: number | null; waterVolumeCubicMetres: string | null; note: string | null; recordedAt: string;
}> | Readonly<{
  kind: "OBSERVATION"; id: string; fieldId: string; seasonId: string | null; description: string; occurredAt: string;
}> | Readonly<{
  kind: "TASK_COMPLETION"; id: string; taskId: string; seasonId: string; fieldId: string; title: string;
  plannedLocalDate: string; occurredAt: string; sourceKind: "MANUAL" | "VALIDATED_TEMPLATE"; templateVersionId: string | null;
}> | Readonly<{
  kind: "TASK_SKIPPED"; id: string; skipId: string; taskId: string; seasonId: string; fieldId: string; title: string;
  plannedLocalDate: string; skippedAt: string; sourceKind: "MANUAL" | "VALIDATED_TEMPLATE"; templateVersionId: string | null;
}> | Readonly<{
  kind: "EXPENSE"; id: string; fieldId: string; seasonId: string | null; expenseDate: string;
  amount: string; currency: string; category: "SEED_SEEDLING" | "FERTILIZER" | "PESTICIDE" | "FUEL" | "LABOR" | "IRRIGATION" | "OTHER"; note: string | null;
}> | Readonly<{
  kind: "HARVEST"; id: string; fieldId: string; seasonId: string; harvestDate: string; quantity: string; unit: "KG" | "METRIC_TONNE";
}>;
export type DiaryV1Cursor = Readonly<{ version: 1; fieldId: string; seasonId: string | null; includeIrrigation: boolean; occurredAt: string; kind: Exclude<DiaryKind, "EXPENSE" | "HARVEST">; id: string }>;
export type DiaryV2Cursor = Readonly<{ version: 2; fieldId: string; seasonId: string | null; includeIrrigation: boolean; includeExpenses: boolean; includeHarvests: boolean;
  businessTimezone: string; localDate: string; precision: "TIMED" | "DATE_ONLY"; occurredAt?: string; kind: DiaryKind; id: string }>;
export type DiarySortKey = DiaryV1Cursor | DiaryV2Cursor;
export type DiaryPage = Readonly<{ items: readonly DiaryEntry[]; nextCursor: string | null }>;

const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
type DiaryOrderEntry = Readonly<{ kind: Exclude<DiaryKind, "EXPENSE" | "HARVEST">; id: string } & ({ occurredAt: string } | { skippedAt: string })>
  | Readonly<{ kind: "EXPENSE"; id: string; expenseDate: string }>
  | Readonly<{ kind: "HARVEST"; id: string; harvestDate: string }>;
function eventAt(entry: DiaryOrderEntry): string { return "expenseDate" in entry ? entry.expenseDate : "harvestDate" in entry ? entry.harvestDate : "occurredAt" in entry ? entry.occurredAt : entry.skippedAt; }
function isTimed(entry: DiaryOrderEntry): boolean { return entry.kind !== "EXPENSE" && entry.kind !== "HARVEST"; }

export function diaryLimit(value: number | undefined): number {
  if (value === undefined) return 50;
  if (!Number.isSafeInteger(value) || value < 1 || value > 100) throw invalidRequest();
  return value;
}

/** Negative means left sorts before right in the approved V1 global diary order. */
export function compareDiaryEntries(left: DiaryOrderEntry, right: DiaryOrderEntry): number {
  if (!isTimed(left) || !isTimed(right)) {
    if (isTimed(left) !== isTimed(right)) return isTimed(left) ? -1 : 1;
    const kindOrder = left.kind.localeCompare(right.kind);
    return kindOrder !== 0 ? kindOrder : right.id.localeCompare(left.id);
  }
  const timeOrder = Date.parse(eventAt(right)) - Date.parse(eventAt(left));
  if (timeOrder) return timeOrder;
  const kindOrder = left.kind.localeCompare(right.kind);
  if (kindOrder) return kindOrder;
  return right.id.localeCompare(left.id);
}

export function compareDiaryEntriesV2(left: DiaryOrderEntry, right: DiaryOrderEntry, timezone: string): number {
  const dateOrder = businessDate(right, timezone).localeCompare(businessDate(left, timezone));
  if (dateOrder) return dateOrder;
  if (isTimed(left) !== isTimed(right)) return isTimed(left) ? -1 : 1;
  if (!isTimed(left) && !isTimed(right)) {
    const kindOrder = left.kind.localeCompare(right.kind);
    return kindOrder !== 0 ? kindOrder : right.id.localeCompare(left.id);
  }
  const instantOrder = Date.parse(eventAt(right)) - Date.parse(eventAt(left));
  if (instantOrder) return instantOrder;
  const kindOrder = left.kind.localeCompare(right.kind);
  if (kindOrder) return kindOrder;
  return right.id.localeCompare(left.id);
}

function businessDate(entry: DiaryOrderEntry, timezone: string): string {
  return !isTimed(entry) ? eventAt(entry) : businessLocalDate(new Date(eventAt(entry)), timezone);
}

export function sortDiaryEntries<T extends DiaryEntry>(entries: readonly T[], timezone?: string): T[] {
  return [...entries].sort((left, right) => timezone === undefined
    ? compareDiaryEntries(left, right) : compareDiaryEntriesV2(left, right, timezone));
}

export function encodeDiaryCursor(cursor: DiarySortKey): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeDiaryCursor(
  value: string | undefined, fieldId: string, seasonId: string | null | undefined,
  includeIrrigation = false, includeExpenses = false, businessTimezone?: string, includeHarvests = false,
): DiarySortKey | null {
  if (value === undefined) return null;
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) throw invalidRequest();
    const bytes = Buffer.from(value, "base64url");
    if (bytes.toString("base64url") !== value) throw invalidRequest();
    const decoded = JSON.parse(bytes.toString("utf8")) as Record<string, unknown>;
    if (decoded.fieldId !== fieldId || decoded.seasonId !== (seasonId ?? null)
      || (decoded.includeIrrigation ?? false) !== includeIrrigation || typeof decoded.id !== "string" || !uuid.test(decoded.id)) throw invalidRequest();
    if (includeExpenses || includeHarvests) {
      if (decoded.version !== 2 || decoded.includeExpenses !== includeExpenses
        || (decoded.includeHarvests ?? false) !== includeHarvests || decoded.businessTimezone !== businessTimezone
        || typeof decoded.localDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(decoded.localDate)
        || (decoded.precision !== "TIMED" && decoded.precision !== "DATE_ONLY")
        || !["EXPENSE", "HARVEST", "IRRIGATION", "OBSERVATION", "TASK_COMPLETION", "TASK_SKIPPED"].includes(String(decoded.kind ?? ""))
        || (decoded.precision === "DATE_ONLY" ? !["EXPENSE", "HARVEST"].includes(String(decoded.kind)) || decoded.occurredAt !== undefined
          : decoded.kind === "EXPENSE" || decoded.kind === "HARVEST" || typeof decoded.occurredAt !== "string" || !Number.isFinite(Date.parse(decoded.occurredAt)))) throw invalidRequest();
      validateLocalDate(decoded.localDate);
      return { ...decoded, includeHarvests: decoded.includeHarvests ?? false } as unknown as DiaryV2Cursor;
    }
    if (decoded.version !== 1 || decoded.kind === "EXPENSE" || decoded.kind === "HARVEST"
      || typeof decoded.occurredAt !== "string" || !Number.isFinite(Date.parse(decoded.occurredAt))) throw invalidRequest();
    return { ...decoded, includeIrrigation: decoded.includeIrrigation ?? false } as unknown as DiaryV1Cursor;
  } catch { throw invalidRequest(); }
}

export function entryIsAfterCursor(entry: DiaryOrderEntry, cursor: DiarySortKey, timezone?: string): boolean {
  if (cursor.version === 1) return compareDiaryEntries(entry, cursor) > 0;
  if (!timezone) throw invalidRequest();
  const date = businessDate(entry, timezone);
  if (date !== cursor.localDate) return date < cursor.localDate;
  const timed = isTimed(entry);
  if ((cursor.precision === "TIMED") !== timed) return cursor.precision === "DATE_ONLY" && timed ? false : !timed;
  if (!timed) {
    const kindOrder = entry.kind.localeCompare(cursor.kind);
    return kindOrder !== 0 ? kindOrder > 0 : entry.id.localeCompare(cursor.id) < 0;
  }
  const instantOrder = Date.parse(eventAt(entry)) - Date.parse(cursor.occurredAt!);
  if (instantOrder !== 0) return instantOrder < 0;
  const kindOrder = entry.kind.localeCompare(cursor.kind);
  return kindOrder !== 0 ? kindOrder > 0 : entry.id.localeCompare(cursor.id) < 0;
}

/** Merge already bounded source candidates and return an opaque strict-after cursor. */
export function pageDiaryCandidates<T extends DiaryEntry>(
  candidates: readonly T[], limit: number, fieldId: string, seasonId: string | null, after: DiarySortKey | null = null,
  includeIrrigation = false, includeExpenses = false, businessTimezone?: string, includeHarvests = false,
): DiaryPage {
  const visible = candidates.filter((entry) => (includeIrrigation || entry.kind !== "IRRIGATION")
    && (includeExpenses || entry.kind !== "EXPENSE")
    && (includeHarvests || entry.kind !== "HARVEST"));
  const useV2 = includeExpenses || includeHarvests;
  const ordered = sortDiaryEntries(visible, useV2 ? businessTimezone : undefined)
    .filter((entry) => !after || entryIsAfterCursor(entry, after, businessV2Timezone(useV2, businessTimezone)));
  const items = ordered.slice(0, limit);
  const last = items.at(-1);
  let nextCursor: string | null = null;
  if (ordered.length > limit && last) {
    nextCursor = useV2
      ? encodeDiaryCursor({ version: 2, fieldId, seasonId, includeIrrigation, includeExpenses, includeHarvests,
        businessTimezone: businessTimezone ?? "", localDate: businessDate(last, businessTimezone ?? "UTC"),
        precision: isTimed(last) ? "TIMED" : "DATE_ONLY", ...(isTimed(last) ? { occurredAt: eventAt(last) } : {}), kind: last.kind, id: last.id })
      : encodeDiaryCursor({ version: 1, fieldId, seasonId, includeIrrigation, occurredAt: eventAt(last), kind: last.kind as DiaryV1Cursor["kind"], id: last.id });
  }
  return { items, nextCursor };
}

function businessV2Timezone(useV2: boolean, timezone?: string): string | undefined {
  if (useV2 && !timezone) throw invalidRequest();
  return useV2 ? timezone : undefined;
}

function invalidRequest(): ApiError {
  return new ApiError(400, "INVALID_REQUEST", "Check the diary cursor and try again");
}
