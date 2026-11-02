import { validateLocalDate } from "@ekim-hasat/domain/seasons/local-date";
import type { VerifiedSubject } from "@ekim-hasat/domain/identity/auth-provider";
import type { ManualActiveTaskInput, ManualActiveTaskRepository } from "./manual-active-task.repository.js";
import { ManualTaskCommandError } from "./manual-active-task.error.js";

const uuid = (value: unknown): value is string => typeof value === "string" && /^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(value);
export function parseManualActiveTaskInput(input: unknown): ManualActiveTaskInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new ManualTaskCommandError(400, "INVALID_COMMAND");
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some(key => !["taskId", "mutationId", "title", "description", "plannedLocalDate"].includes(key)) ||
      !uuid(value.taskId) || !uuid(value.mutationId) || typeof value.title !== "string" ||
      (value.description !== undefined && value.description !== null && typeof value.description !== "string")) throw new ManualTaskCommandError(400, "INVALID_COMMAND");
  try { validateLocalDate(value.plannedLocalDate); } catch { throw new ManualTaskCommandError(400, "INVALID_COMMAND"); }
  return { taskId: value.taskId, mutationId: value.mutationId, title: value.title, ...(value.description === undefined ? {} : { description: value.description as string | null }), plannedLocalDate: value.plannedLocalDate as string };
}

export class ManualActiveTaskService {
  constructor(private readonly repository: ManualActiveTaskRepository) {}
  create(identity: VerifiedSubject, seasonId: string, input: unknown) {
    return this.repository.create(identity, seasonId, parseManualActiveTaskInput(input));
  }
}
