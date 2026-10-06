import { validateLocalDate } from "../seasons/local-date.js";

/** Accepted immutable observation; authorization is resolved by the application layer. */
export type FieldObservation = Readonly<{
  id: string;
  businessId: string;
  fieldId: string;
  seasonId: string | null;
  actorUserId: string;
  actorMembershipId: string;
  description: string;
  occurredAt: string;
  acceptedAt: string;
}>;

export function canonicalizeObservationDescription(description: string): string {
  if (typeof description !== "string") throw new TypeError("description must be text");
  // Unicode White_Space includes NEL; retain ECMAScript's BOM trimming too.
  const canonical = description.replace(/^[\p{White_Space}\ufeff]+|[\p{White_Space}\ufeff]+$/gu, "");
  const codePoints = [...canonical].length;
  if (codePoints < 1 || codePoints > 2000) {
    throw new TypeError("description must contain 1..2000 Unicode code points");
  }
  return canonical;
}

export function createFieldObservation(input: FieldObservation): FieldObservation {
  if (typeof input.id !== "string" || !/^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(input.id)) {
    throw new TypeError("id must be a UUID");
  }
  return Object.freeze({
    ...input,
    description: canonicalizeObservationDescription(input.description),
    occurredAt: canonicalAbsoluteInstant(input.occurredAt, "occurredAt"),
    acceptedAt: canonicalAbsoluteInstant(input.acceptedAt, "acceptedAt"),
  });
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
