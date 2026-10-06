import { ApiError } from "../observability/api-error.filter.js";

export type DiaryKind = "OBSERVATION" | "TASK_COMPLETION";
export type DiaryEntry = Readonly<{
  kind: "OBSERVATION"; id: string; fieldId: string; seasonId: string | null; description: string; occurredAt: string;
}> | Readonly<{
  kind: "TASK_COMPLETION"; id: string; taskId: string; seasonId: string; fieldId: string; title: string;
  plannedLocalDate: string; occurredAt: string; sourceKind: "MANUAL" | "VALIDATED_TEMPLATE"; templateVersionId: string | null;
}>;
export type DiarySortKey = Readonly<{ version: 1; fieldId: string; seasonId: string | null; occurredAt: string; kind: DiaryKind; id: string }>;
export type DiaryPage = Readonly<{ items: readonly DiaryEntry[]; nextCursor: string | null }>;

const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

export function diaryLimit(value: number | undefined): number {
  if (value === undefined) return 50;
  if (!Number.isSafeInteger(value) || value < 1 || value > 100) throw invalidRequest();
  return value;
}

/** Negative means left sorts before right in the approved global diary order. */
export function compareDiaryEntries(left: Pick<DiaryEntry, "occurredAt" | "kind" | "id">, right: Pick<DiaryEntry, "occurredAt" | "kind" | "id">): number {
  const timeOrder = Date.parse(right.occurredAt) - Date.parse(left.occurredAt);
  if (timeOrder) return timeOrder;
  const kindOrder = left.kind.localeCompare(right.kind);
  if (kindOrder) return kindOrder;
  return right.id.localeCompare(left.id);
}

export function sortDiaryEntries<T extends DiaryEntry>(entries: readonly T[]): T[] {
  return [...entries].sort(compareDiaryEntries);
}

export function encodeDiaryCursor(cursor: DiarySortKey): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeDiaryCursor(value: string | undefined, fieldId: string, seasonId: string | null | undefined): DiarySortKey | null {
  if (value === undefined) return null;
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) throw invalidRequest();
    const bytes = Buffer.from(value, "base64url");
    if (bytes.toString("base64url") !== value) throw invalidRequest();
    const decoded = JSON.parse(bytes.toString("utf8")) as Partial<DiarySortKey>;
    if (decoded.version !== 1 || decoded.fieldId !== fieldId || decoded.seasonId !== (seasonId ?? null)
        || typeof decoded.occurredAt !== "string" || !Number.isFinite(Date.parse(decoded.occurredAt))
        || (decoded.kind !== "OBSERVATION" && decoded.kind !== "TASK_COMPLETION")
        || typeof decoded.id !== "string" || !uuid.test(decoded.id)) throw invalidRequest();
    return decoded as DiarySortKey;
  } catch { throw invalidRequest(); }
}

export function entryIsAfterCursor(entry: Pick<DiaryEntry, "occurredAt" | "kind" | "id">, cursor: DiarySortKey): boolean {
  return compareDiaryEntries(entry, cursor) > 0;
}

/** Merge already bounded source candidates and return an opaque strict-after cursor. */
export function pageDiaryCandidates<T extends DiaryEntry>(
  candidates: readonly T[], limit: number, fieldId: string, seasonId: string | null, after: DiarySortKey | null = null,
): DiaryPage {
  const ordered = sortDiaryEntries(candidates).filter((entry) => !after || entryIsAfterCursor(entry, after));
  const items = ordered.slice(0, limit);
  const last = items.at(-1);
  const nextCursor = ordered.length > limit && last
    ? encodeDiaryCursor({ version: 1, fieldId, seasonId, occurredAt: last.occurredAt, kind: last.kind, id: last.id })
    : null;
  return { items, nextCursor };
}

function invalidRequest(): ApiError {
  return new ApiError(400, "INVALID_REQUEST", "Check the diary cursor and try again");
}
