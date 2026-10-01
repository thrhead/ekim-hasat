import type { VerifiedSubject } from "@ekim-hasat/domain/identity/auth-provider";
import type {
  CompleteTaskInput,
  TaskCompletionHistoryFilters,
  TaskCompletionOutcome,
  TaskCompletionHistoryPage,
  TaskCompletionRepository,
} from "./task-completion.repository.js";

/** Application boundary for the two canonical task completion operations. */
export class TaskCompletionService {
  constructor(private readonly repository: TaskCompletionRepository) {}

  complete(identity: VerifiedSubject, taskId: string, baseTaskVersion: number, input: CompleteTaskInput): Promise<TaskCompletionOutcome> {
    return this.repository.complete(identity, taskId, baseTaskVersion, input);
  }

  readHistory(identity: VerifiedSubject, fieldId: string, filters: TaskCompletionHistoryFilters): Promise<TaskCompletionHistoryPage> {
    return this.repository.readHistory(identity, fieldId, filters);
  }
}
