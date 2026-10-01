import { validateLocalDate } from "../seasons/local-date.js";

/** The immutable planned intent captured when a completion command is created. */
export type PlannedTaskSnapshot = Readonly<{
  id: string;
  seasonPlanId: string;
  title: string;
  plannedLocalDate: string;
  version: number;
}>;

export type CompletionCommandState = "PENDING" | "ACCEPTED" | "CONFLICTED";

export type CompletionCommand = Readonly<{
  completionId: string;
  task: PlannedTaskSnapshot;
  occurredAt: string;
  baseTaskVersion: number;
  state: CompletionCommandState;
}>;

export type CompletionCommandInput = Readonly<{
  completionId: string;
  task: PlannedTaskSnapshot;
  occurredAt: string;
  baseTaskVersion: number;
}>;

/** Canonical accepted server record; local synchronization state is not persisted here. */
export type TaskCompletionRecord = Readonly<{
  id: string;
  plannedTaskId: string;
  businessId: string;
  seasonId: string;
  fieldId: string;
  actorUserId: string;
  actorMembershipId: string;
  occurredAt: string;
  recordedAt: string;
  baseTaskVersion: number;
  payloadFingerprint: string;
  taskTitleSnapshot: string;
  plannedLocalDateSnapshot: string;
}>;

const UUID = /^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;
const ABSOLUTE_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i;

function assertUuid(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || !UUID.test(value)) throw new TypeError(`${name} must be a UUID`);
}

function assertVersion(value: unknown, name: string): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new TypeError(`${name} must be a positive safe integer`);
}

function assertAbsoluteInstant(value: unknown): asserts value is string {
  if (typeof value !== "string" || !ABSOLUTE_INSTANT.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new TypeError("occurredAt must be an absolute ISO-8601 instant");
  }
  validateLocalDate(value.slice(0, 10));
}

function validateTaskSnapshot(task: PlannedTaskSnapshot): void {
  assertUuid(task.id, "task.id");
  assertUuid(task.seasonPlanId, "task.seasonPlanId");
  assertVersion(task.version, "task.version");
  if (typeof task.title !== "string" || task.title.trim().length === 0) throw new TypeError("task.title is required");
  validateLocalDate(task.plannedLocalDate);
}

export function createCompletionCommand(input: CompletionCommandInput): CompletionCommand {
  assertUuid(input.completionId, "completionId");
  validateTaskSnapshot(input.task);
  assertAbsoluteInstant(input.occurredAt);
  assertVersion(input.baseTaskVersion, "baseTaskVersion");
  if (input.baseTaskVersion !== input.task.version) throw new TypeError("baseTaskVersion must match the captured task version");
  return Object.freeze({
    completionId: input.completionId,
    task: Object.freeze({ ...input.task }),
    occurredAt: input.occurredAt,
    baseTaskVersion: input.baseTaskVersion,
    state: "PENDING",
  });
}

export function transitionCompletionCommand(
  command: CompletionCommand,
  next: Exclude<CompletionCommandState, "PENDING">,
): CompletionCommand {
  if (command.state !== "PENDING") throw new TypeError("only a pending completion command can settle");
  return Object.freeze({ ...command, state: next });
}
