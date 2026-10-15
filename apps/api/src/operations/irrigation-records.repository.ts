import { ForbiddenException } from "@nestjs/common";
import { createIrrigationRecord } from "@ekim-hasat/domain/operations/irrigation-record";
import type { VerifiedSubject } from "@ekim-hasat/domain/identity/auth-provider";
import type { PrismaClient } from "../generated/prisma/client.js";
import { MembershipScopeService } from "../authorization/membership-scope.service.js";
import { ApiError } from "../observability/api-error.filter.js";
import { resolveBusinessObservationInstant, resolveBusinessTimezone } from "../seasons/business-timezone.js";

export type IrrigationRecordCreateRequest = Readonly<{
  irrigationRecordId: string;
  occurredAtLocal: string;
  occurredAt: string;
  capturedBusinessTimezone: string;
  seasonId?: string;
  method?: string;
  durationMinutes?: number;
  waterVolumeCubicMetres?: string;
  note?: string;
}>;

export type IrrigationRecordPublic = Readonly<{
  id: string;
  fieldId: string;
  seasonId: string | null;
  occurredAt: string;
  businessTimezone: string;
  method: string | null;
  durationMinutes: number | null;
  waterVolumeCubicMetres: string | null;
  note: string | null;
  recordedAt: string;
}>;

export type IrrigationRecordCreateOutcome = Readonly<{
  kind: "accepted" | "replayed";
  record: IrrigationRecordPublic;
}>;

export class IrrigationRecordsRepository {
  private readonly membershipScope: MembershipScopeService;

  constructor(private readonly prisma: PrismaClient, private readonly now: () => Date = () => new Date()) {
    this.membershipScope = new MembershipScopeService(prisma);
  }

  async create(identity: VerifiedSubject, fieldId: string, input: IrrigationRecordCreateRequest): Promise<IrrigationRecordCreateOutcome> {
    let scope;
    try { scope = await this.membershipScope.resolveDefaultBusinessScope(identity); }
    catch (error) {
      if (error instanceof ForbiddenException) throw forbidden();
      throw error;
    }
    if (!scope) throw forbidden();

    try {
      return await this.prisma.$transaction(async (tx) => {
        const authorized = await tx.$queryRaw<Array<{ id: string }>>`SELECT m.id
          FROM memberships m JOIN application_users u ON u.id=m.user_id
          WHERE m.id=${scope.membershipId}::uuid AND m.business_id=${scope.businessId}::uuid
            AND m.user_id=${scope.userId}::uuid AND m.status='ACTIVE' AND u.default_business_id=m.business_id
          FOR UPDATE OF m,u`;
        if (authorized.length !== 1) throw forbidden();
        const field = await tx.field.findFirst({
          where: { id: fieldId, businessId: scope.businessId },
          select: { id: true, businessId: true, business: { select: { timezone: true } } },
        });
        if (!field) throw notFound();
        if (input.seasonId && !await tx.season.findFirst({
          where: { id: input.seasonId, fieldId, businessId: scope.businessId }, select: { id: true },
        })) throw notFound();

        let businessTimezone: string;
        try { businessTimezone = resolveBusinessTimezone(field.business.timezone); }
        catch { throw invalidRequest(); }
        const existing = await tx.irrigationRecord.findFirst({ where: { businessId: scope.businessId, id: input.irrigationRecordId } });
        if (existing) {
          let submitted;
          try {
            const { occurredAt } = resolveBusinessObservationInstant(input.occurredAtLocal, input.occurredAt, field.business.timezone);
            submitted = createIrrigationRecord({
              id: input.irrigationRecordId, businessId: scope.businessId, fieldId,
              seasonId: input.seasonId ?? null,
              actorUserId: scope.userId, actorMembershipId: scope.membershipId,
              occurredAt: occurredAt.toISOString(), recordedAt: existing.recordedAt.toISOString(),
              method: input.method, durationMinutes: input.durationMinutes,
              waterVolumeCubicMetres: input.waterVolumeCubicMetres, note: input.note,
            });
          } catch { throw identityConflict(); }
          if (existing.fieldId !== fieldId || existing.seasonId !== (input.seasonId ?? null)
            || existing.actorUserId !== scope.userId || existing.actorMembershipId !== scope.membershipId
            || input.capturedBusinessTimezone !== businessTimezone
            || existing.occurredAt.toISOString() !== submitted.occurredAt
            || existing.method !== submitted.method || existing.durationMinutes !== submitted.durationMinutes
            || (existing.waterVolumeCubicMetres?.toFixed(1) ?? null) !== (submitted.waterVolumeCubicMetres === null
              ? null : Number(submitted.waterVolumeCubicMetres).toFixed(1))
            || existing.note !== submitted.note) throw identityConflict();
          return { kind: "replayed" as const, record: this.toPublic(existing, businessTimezone) };
        }
        if (input.capturedBusinessTimezone !== businessTimezone) throw invalidRequest();
        const { occurredAt } = resolveBusinessObservationInstant(input.occurredAtLocal, input.occurredAt, field.business.timezone);
        const recordedAt = this.now();
        if (occurredAt.getTime() > recordedAt.getTime()) throw invalidRequest();
        let canonical: ReturnType<typeof createIrrigationRecord>;
        try {
          canonical = createIrrigationRecord({
            id: input.irrigationRecordId, businessId: scope.businessId, fieldId,
            seasonId: input.seasonId ?? null,
            actorUserId: scope.userId, actorMembershipId: scope.membershipId,
            occurredAt: occurredAt.toISOString(), recordedAt: recordedAt.toISOString(),
            method: input.method, durationMinutes: input.durationMinutes,
            waterVolumeCubicMetres: input.waterVolumeCubicMetres, note: input.note,
          });
        } catch { throw invalidRequest(); }
        const row = await tx.irrigationRecord.create({ data: {
          id: canonical.id, businessId: canonical.businessId, fieldId: canonical.fieldId,
          seasonId: canonical.seasonId,
          actorUserId: canonical.actorUserId, actorMembershipId: canonical.actorMembershipId,
          occurredAt, recordedAt, method: canonical.method, durationMinutes: canonical.durationMinutes,
          waterVolumeCubicMetres: canonical.waterVolumeCubicMetres, note: canonical.note,
        } });
        return { kind: "accepted" as const, record: this.toPublic(row, businessTimezone) };
      }, { isolationLevel: "ReadCommitted" });
    } catch (error) {
      if (!this.isUniqueViolation(error)) throw error;
      const current = await this.membershipScope.resolveDefaultBusinessScope(identity);
      if (!current || current.userId !== scope.userId || current.businessId !== scope.businessId || current.membershipId !== scope.membershipId) throw forbidden();
      const winner = await this.prisma.irrigationRecord.findFirst({ where: { businessId: scope.businessId, id: input.irrigationRecordId } });
      if (!winner) throw error;
      return this.create(identity, fieldId, input);
    }
  }

  private isUniqueViolation(error: unknown): boolean {
    return !!error && typeof error === "object" && "code" in error && (error as { code: unknown }).code === "P2002";
  }

  private toPublic(row: { id: string; fieldId: string; seasonId: string | null; occurredAt: Date; recordedAt: Date;
    method: string | null; durationMinutes: number | null; waterVolumeCubicMetres: { toFixed: (digits: number) => string } | null; note: string | null },
  businessTimezone: string): IrrigationRecordPublic {
    return { id: row.id, fieldId: row.fieldId, seasonId: row.seasonId, occurredAt: row.occurredAt.toISOString(),
      businessTimezone, method: row.method, durationMinutes: row.durationMinutes,
      waterVolumeCubicMetres: row.waterVolumeCubicMetres?.toFixed(1) ?? null, note: row.note,
      recordedAt: row.recordedAt.toISOString() };
  }
}

function forbidden(): ApiError { return new ApiError(403, "FORBIDDEN", "This request is not available"); }
function notFound(): ApiError { return new ApiError(404, "NOT_FOUND", "The requested item is not available"); }
function invalidRequest(): ApiError { return new ApiError(400, "INVALID_REQUEST", "Check the irrigation information and try again"); }
function identityConflict(): ApiError { return new ApiError(409, "IDEMPOTENCY_KEY_REUSED", "This irrigation record ID was already used for different information"); }
