import { validateLocalDate } from "../seasons/local-date.js";

export type IrrigationRecord = Readonly<{
  id: string;
  businessId: string;
  fieldId: string;
  seasonId: string | null;
  actorUserId: string;
  actorMembershipId: string;
  occurredAt: string;
  recordedAt: string;
  method: string | null;
  durationMinutes: number | null;
  waterVolumeCubicMetres: string | null;
  note: string | null;
}>;

export type CreateIrrigationRecordInput = Omit<IrrigationRecord,
  "seasonId" | "method" | "durationMinutes" | "waterVolumeCubicMetres" | "note"
> & Partial<Pick<IrrigationRecord,
  "seasonId" | "method" | "durationMinutes" | "waterVolumeCubicMetres" | "note"
>>;

export function createIrrigationRecord(input: CreateIrrigationRecordInput): IrrigationRecord {
  requireUuid(input.id, "id");
  requireUuid(input.businessId, "businessId");
  requireUuid(input.fieldId, "fieldId");
  if (input.seasonId !== undefined && input.seasonId !== null) requireUuid(input.seasonId, "seasonId");
  requireUuid(input.actorUserId, "actorUserId");
  requireUuid(input.actorMembershipId, "actorMembershipId");
  if (input.method !== undefined && input.method !== null
    && (typeof input.method !== "string" || [...input.method].length > 120)) {
    throw new TypeError("method must contain at most 120 characters");
  }
  if (input.durationMinutes !== undefined && input.durationMinutes !== null
    && (!Number.isInteger(input.durationMinutes) || input.durationMinutes <= 0)) {
    throw new TypeError("durationMinutes must be a positive whole number of minutes");
  }
  if (input.waterVolumeCubicMetres !== undefined && input.waterVolumeCubicMetres !== null
    && (typeof input.waterVolumeCubicMetres !== "string"
      || !/^\d+(?:\.\d)?$/.test(input.waterVolumeCubicMetres)
      || !/[1-9]/.test(input.waterVolumeCubicMetres))) {
    throw new TypeError("waterVolumeCubicMetres must be a positive decimal with at most one decimal place");
  }

  return Object.freeze({
    ...input,
    seasonId: input.seasonId ?? null,
    occurredAt: canonicalAbsoluteInstant(input.occurredAt, "occurredAt"),
    recordedAt: canonicalAbsoluteInstant(input.recordedAt, "recordedAt"),
    method: input.method ?? null,
    durationMinutes: input.durationMinutes ?? null,
    waterVolumeCubicMetres: input.waterVolumeCubicMetres ?? null,
    note: canonicalOptionalNote(input.note),
  });
}

function canonicalOptionalNote(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new TypeError("note must be text");
  const note = value.trim();
  if ([...note].length > 2000) throw new TypeError("note must contain at most 2000 characters");
  return note || null;
}

function requireUuid(value: string, name: string): void {
  if (typeof value !== "string" || !/^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(value)) {
    throw new TypeError(`${name} must be a UUID`);
  }
}

function canonicalAbsoluteInstant(value: string, name: string): string {
  if (typeof value !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i.test(value)
    || !Number.isFinite(Date.parse(value))) {
    throw new TypeError(`${name} must be an absolute ISO-8601 instant`);
  }
  try {
    validateLocalDate(value.slice(0, 10));
  } catch {
    throw new TypeError(`${name} must be an absolute ISO-8601 instant`);
  }
  return new Date(value).toISOString();
}
