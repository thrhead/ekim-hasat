import type { VerifiedSubject } from "@ekim-hasat/domain/identity/auth-provider";
import { ExpensesRepository, type ExpenseCreateOutcome, type ExpenseCreateRequest, type ExpenseSeasonOption } from "./expenses.repository.js";

export class ExpensesService {
  constructor(private readonly repository: ExpensesRepository) {}

  create(identity: VerifiedSubject, fieldId: string, request: ExpenseCreateRequest): Promise<ExpenseCreateOutcome> {
    return this.repository.create(identity, fieldId, request);
  }

  listAvailableSeasons(identity: VerifiedSubject, fieldId: string): Promise<ReadonlyArray<ExpenseSeasonOption>> {
    return this.repository.listAvailableSeasons(identity, fieldId);
  }
}
