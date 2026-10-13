import type { VerifiedSubject } from "@ekim-hasat/domain/identity/auth-provider";
import type { SkipTaskRequest } from "./task-skip.dto.js";
import type { TaskSkipOutcome, TaskSkipRepository } from "./task-skip.repository.js";

/** Application boundary for the authenticated Skip command. */
export class TaskSkipService {
  constructor(private readonly repository: Pick<TaskSkipRepository, "skip">) {}

  skip(identity: VerifiedSubject, taskId: string, baseTaskVersion: number, input: SkipTaskRequest): Promise<TaskSkipOutcome> {
    return this.repository.skip(identity, taskId, baseTaskVersion, input);
  }
}
