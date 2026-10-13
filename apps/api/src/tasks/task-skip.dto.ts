import { TaskSkipError } from "./task-skip.error.js";

export type SkipTaskRequest = Readonly<{ skipId: string }>;

const uuidPattern = /^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;

function invalid(): never {
  throw new TaskSkipError("INVALID_REQUEST");
}

export function parseTaskSkipRequest(value: unknown): SkipTaskRequest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid();
  const body = value as Record<string, unknown>;
  if (Object.keys(body).length !== 1 || Object.keys(body)[0] !== "skipId"
    || typeof body.skipId !== "string" || !uuidPattern.test(body.skipId)) invalid();
  return { skipId: body.skipId };
}

export function parseTaskSkipVersion(value: unknown): number {
  const raw = typeof value === "string" ? /^"?([1-9][0-9]*)"?$/.exec(value)?.[1]
    : typeof value === "number" ? String(value) : undefined;
  if (!raw || !/^[1-9][0-9]*$/.test(raw)) invalid();
  const version = Number(raw);
  if (!Number.isSafeInteger(version)) invalid();
  return version;
}
