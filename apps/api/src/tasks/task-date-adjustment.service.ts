import type { VerifiedSubject } from "@ekim-hasat/domain/identity/auth-provider";
import type { TaskDateAdjustmentHistoryQuery } from "./task-date-adjustment.dto.js";
import type {
  AdjustTaskDateInput,
  TaskDateAdjustmentHistoryPage,
  TaskDateAdjustmentOutcome,
  TaskDateAdjustmentRepository,
} from "./task-date-adjustment.repository.js";

/** Application boundary shared by the REST command and task-scoped read. */
export class TaskDateAdjustmentService {
  constructor(private readonly repository: TaskDateAdjustmentRepository) {}

  adjust(identity: VerifiedSubject, taskId: string, baseTaskVersion: number, input: AdjustTaskDateInput): Promise<TaskDateAdjustmentOutcome> {
    return this.repository.adjust(identity, taskId, baseTaskVersion, input);
  }

  readHistory(identity: VerifiedSubject, taskId: string, query: TaskDateAdjustmentHistoryQuery): Promise<TaskDateAdjustmentHistoryPage> {
    return this.repository.readHistory(identity, taskId, query);
  }
}
