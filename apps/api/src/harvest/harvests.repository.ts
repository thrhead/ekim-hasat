import { ForbiddenException } from "@nestjs/common";
import { createHarvestRecord, type HarvestRecordInput, type HarvestUnit } from "@ekim-hasat/domain/harvest/harvest-record";
import type { VerifiedSubject } from "@ekim-hasat/domain/identity/auth-provider";
import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import { MembershipScopeService, type AuthorizedBusinessScope } from "../authorization/membership-scope.service.js";
import { ApiError } from "../observability/api-error.filter.js";
import { businessLocalDate, resolveBusinessTimezone } from "../seasons/business-timezone.js";

export type HarvestCreateRequest = Readonly<{
  harvestId: string;
  seasonId: string;
  harvestDate: string;
  quantity: string;
  unit: HarvestUnit;
}>;

export type HarvestCreateOutcome = Readonly<{
  kind: "accepted" | "replayed";
  harvest: HarvestRecordInput & Readonly<{ recordedAt: string }>;
}>;

type HarvestRow = {
  id: string;
  business_id: string;
  field_id: string;
  season_id: string;
  actor_user_id: string;
  actor_membership_id: string;
  harvest_date: string;
  quantity: string;
  unit: string;
  recorded_at: Date;
};

export class HarvestsRepository {
  private readonly membershipScope: MembershipScopeService;

  constructor(private readonly prisma: PrismaClient, private readonly now: () => Date = () => new Date()) {
    this.membershipScope = new MembershipScopeService(prisma);
  }

  async create(identity: VerifiedSubject, fieldId: string, input: HarvestCreateRequest): Promise<HarvestCreateOutcome> {
    let scope: AuthorizedBusinessScope | null;
    try { scope = await this.membershipScope.resolveDefaultBusinessScope(identity); }
    catch (error) {
      if (error instanceof ForbiddenException) throw forbidden();
      throw error;
    }
    if (!scope || !canRecord(scope.role)) throw forbidden();

    return this.prisma.$transaction(async (tx) => {
      // Scope resolution precedes the transaction, so lock and verify the live
      // user and membership before looking up a Harvest identity.
      const users = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM application_users
        WHERE id=${scope.userId}::uuid AND auth_provider=${identity.provider}
          AND auth_subject=${identity.subject} AND default_business_id=${scope.businessId}::uuid
        FOR UPDATE`;
      if (users.length !== 1) throw forbidden();
      const memberships = await tx.$queryRaw<Array<{ id: string; role: string }>>`SELECT id, role FROM memberships
        WHERE id=${scope.membershipId}::uuid AND user_id=${scope.userId}::uuid
          AND business_id=${scope.businessId}::uuid AND status='ACTIVE' FOR UPDATE`;
      if (memberships.length !== 1 || !canRecord(memberships[0]!.role)) throw forbidden();

      if (!isUuid(fieldId) || !isUuid(input?.harvestId) || !isUuid(input?.seasonId)) throw invalidRequest();
      const fields = await tx.$queryRaw<Array<{ timezone: string | null }>>`SELECT b.timezone
        FROM fields f JOIN businesses b ON b.id=f.business_id
        WHERE f.id=${fieldId}::uuid AND f.business_id=${scope.businessId}::uuid FOR UPDATE OF f,b`;
      if (fields.length !== 1) throw notFound();
      const seasons = await tx.$queryRaw<Array<{ status: string; planting_date: string }>>`SELECT status,
          to_char(actual_planting_date, 'YYYY-MM-DD') AS planting_date
        FROM seasons WHERE id=${input.seasonId}::uuid AND business_id=${scope.businessId}::uuid
          AND field_id=${fieldId}::uuid FOR UPDATE`;
      if (seasons.length !== 1) throw notFound();

      const existing = await this.readRow(tx, scope.businessId, input.harvestId);
      if (existing) {
        const submitted = this.canonical(scope, fieldId, input, true);
        if (!this.matches(existing, submitted)) throw identityConflict();
        return { kind: "replayed" as const, harvest: this.toPublic(existing) };
      }

      if (seasons[0]!.status !== "ACTIVE") throw notFound();
      const submitted = this.canonical(scope, fieldId, input, false);
      let timezone: string;
      try { timezone = resolveBusinessTimezone(fields[0]!.timezone); }
      catch { throw invalidRequest(); }
      const recordedAt = this.now();
      if (submitted.harvestDate < seasons[0]!.planting_date
        || submitted.harvestDate > businessLocalDate(recordedAt, timezone)) throw invalidRequest();

      const rows = await tx.$queryRaw<HarvestRow[]>`INSERT INTO harvests
        (id, business_id, field_id, season_id, actor_user_id, actor_membership_id,
         harvest_date, quantity, unit, recorded_at)
        VALUES (${submitted.id}::uuid, ${submitted.businessId}::uuid, ${submitted.fieldId}::uuid,
          ${submitted.seasonId}::uuid, ${submitted.actorUserId}::uuid, ${submitted.actorMembershipId}::uuid,
          ${submitted.harvestDate}::date, ${submitted.quantity}::numeric, ${submitted.unit}, ${recordedAt})
        RETURNING id::text, business_id::text, field_id::text, season_id::text,
          actor_user_id::text, actor_membership_id::text,
          to_char(harvest_date, 'YYYY-MM-DD') AS harvest_date, quantity::text, unit, recorded_at`;
      const row = rows[0];
      if (!row) throw new Error("Harvest insert did not return its canonical row");
      return { kind: "accepted" as const, harvest: this.toPublic(row) };
    }, { isolationLevel: "ReadCommitted" });
  }

  private canonical(scope: AuthorizedBusinessScope, fieldId: string, input: HarvestCreateRequest, conflict: boolean): HarvestRecordInput {
    try {
      return createHarvestRecord({
        id: input.harvestId, businessId: scope.businessId, fieldId, seasonId: input.seasonId,
        actorUserId: scope.userId, actorMembershipId: scope.membershipId,
        harvestDate: input.harvestDate, quantity: input.quantity, unit: input.unit,
      });
    } catch {
      throw conflict ? identityConflict() : invalidRequest();
    }
  }

  private async readRow(tx: Prisma.TransactionClient, businessId: string, id: string): Promise<HarvestRow | undefined> {
    const rows = await tx.$queryRaw<HarvestRow[]>`SELECT id::text, business_id::text, field_id::text,
      season_id::text, actor_user_id::text, actor_membership_id::text,
      to_char(harvest_date, 'YYYY-MM-DD') AS harvest_date, quantity::text, unit, recorded_at
      FROM harvests WHERE business_id=${businessId}::uuid AND id=${id}::uuid`;
    return rows[0];
  }

  private matches(row: HarvestRow, submitted: HarvestRecordInput): boolean {
    return row.id === submitted.id && row.business_id === submitted.businessId
      && row.field_id === submitted.fieldId && row.season_id === submitted.seasonId
      && row.actor_user_id === submitted.actorUserId && row.actor_membership_id === submitted.actorMembershipId
      && row.harvest_date === submitted.harvestDate && row.quantity === submitted.quantity
      && row.unit === submitted.unit;
  }

  private toPublic(row: HarvestRow): HarvestRecordInput & Readonly<{ recordedAt: string }> {
    return Object.freeze({
      id: row.id, businessId: row.business_id, fieldId: row.field_id, seasonId: row.season_id,
      actorUserId: row.actor_user_id, actorMembershipId: row.actor_membership_id,
      harvestDate: row.harvest_date as HarvestRecordInput["harvestDate"],
      quantity: row.quantity, unit: row.unit as HarvestUnit, recordedAt: row.recorded_at.toISOString(),
    });
  }
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(value);
}
function canRecord(role: string): boolean { return role === "OWNER" || role === "WORKER"; }
function forbidden(): ApiError { return new ApiError(403, "FORBIDDEN", "This request is not available"); }
function notFound(): ApiError { return new ApiError(404, "NOT_FOUND", "The requested item is not available"); }
function invalidRequest(): ApiError { return new ApiError(400, "INVALID_REQUEST", "Check the harvest information and try again"); }
function identityConflict(): ApiError { return new ApiError(409, "IDEMPOTENCY_KEY_REUSED", "This harvest ID was already used for different information"); }
