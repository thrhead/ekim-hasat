import { validateLocalDate } from "@ekim-hasat/domain/seasons/local-date";
import { TaskDateAdjustmentError } from "./task-date-adjustment.error.js";

const uuidPattern = /^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;

export type AdjustTaskDateRequest = Readonly<{
  adjustmentId: string;
  newPlannedLocalDate: string;
}>;

export type TaskDateAdjustmentHistoryQuery = Readonly<{
  cursor?: string;
  limit?: number;
}>;

function invalid(): never {
  throw new TaskDateAdjustmentError("INVALID_REQUEST");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseTaskDateAdjustmentRequest(value: unknown): AdjustTaskDateRequest {
  if (!isRecord(value) || Object.keys(value).some((key) => !["adjustmentId", "newPlannedLocalDate"].includes(key))
    || typeof value.adjustmentId !== "string" || !uuidPattern.test(value.adjustmentId)
    || typeof value.newPlannedLocalDate !== "string") invalid();
  try { validateLocalDate(value.newPlannedLocalDate); } catch { invalid(); }
  return { adjustmentId: value.adjustmentId, newPlannedLocalDate: value.newPlannedLocalDate };
}

export function parseTaskDateAdjustmentVersion(value: unknown): number {
  const raw = typeof value === "number" ? String(value)
    : typeof value === "string" ? /^"?([1-9][0-9]*)"?$/.exec(value)?.[1] : undefined;
  if (!raw || !/^[1-9][0-9]*$/.test(raw)) invalid();
  const version = Number(raw);
  if (!Number.isSafeInteger(version)) invalid();
  return version;
}

export function parseTaskDateAdjustmentHistoryQuery(value: unknown): TaskDateAdjustmentHistoryQuery {
  if (!isRecord(value) || Object.keys(value).some((key) => !["cursor", "limit"].includes(key))) invalid();
  let cursor: string | undefined;
  if (value.cursor !== undefined) {
    if (typeof value.cursor !== "string" || value.cursor.length < 1 || value.cursor.length > 512) invalid();
    cursor = value.cursor;
  }
  let limit: number | undefined;
  if (value.limit !== undefined) {
    const raw = typeof value.limit === "number" ? String(value.limit) : value.limit;
    if (typeof raw !== "string" || !/^[1-9][0-9]*$/.test(raw)) invalid();
    limit = Number(raw);
    if (!Number.isSafeInteger(limit) || limit > 100) invalid();
  }
  return { ...(cursor === undefined ? {} : { cursor }), ...(limit === undefined ? {} : { limit }) };
}
