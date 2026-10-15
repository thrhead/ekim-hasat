import type { VerifiedSubject } from "@ekim-hasat/domain/identity/auth-provider";
import { IrrigationRecordsRepository, type IrrigationRecordCreateOutcome, type IrrigationRecordCreateRequest } from "./irrigation-records.repository.js";

export class IrrigationRecordsService {
  constructor(private readonly repository: IrrigationRecordsRepository) {}

  create(identity: VerifiedSubject, fieldId: string, request: IrrigationRecordCreateRequest): Promise<IrrigationRecordCreateOutcome> {
    return this.repository.create(identity, fieldId, request);
  }
}
