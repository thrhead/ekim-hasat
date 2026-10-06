import { createHash } from "node:crypto";
import { ForbiddenException } from "@nestjs/common";
import { canonicalizeObservationDescription, createFieldObservation } from "@ekim-hasat/domain/observations/field-observation";
import type { VerifiedSubject } from "@ekim-hasat/domain/identity/auth-provider";
import type { PrismaClient } from "../generated/prisma/client.js";
import { MembershipScopeService } from "../authorization/membership-scope.service.js";
import { ApiError } from "../observability/api-error.filter.js";
import { resolveBusinessObservationInstant, resolveBusinessTimezone } from "../seasons/business-timezone.js";
import type { CreateObservationRequest, ObservationCreateOutcome, ObservationPublic } from "./observation.controller.js";

export class ObservationCreateRepository {
  private readonly membershipScope: MembershipScopeService;

  constructor(private readonly prisma: PrismaClient, private readonly now: () => Date = () => new Date()) {
    this.membershipScope = new MembershipScopeService(prisma);
  }

  async create(identity: VerifiedSubject, fieldId: string, input: CreateObservationRequest): Promise<ObservationCreateOutcome> {
    let scope;
    try { scope = await this.membershipScope.resolveDefaultBusinessScope(identity); }
    catch (error) {
      if (error instanceof ForbiddenException) throw forbidden();
      throw error;
    }
    if (!scope) throw forbidden();

    let payloadFingerprint: string | null = null;
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

        let description: string;
        try { description = canonicalizeObservationDescription(input.description); }
        catch { throw invalidRequest(); }
        const { occurredAt, businessTimezone } = resolveBusinessObservationInstant(input.occurredAtLocal, input.occurredAt, field.business.timezone);
        const acceptedAt = this.now();
        if (occurredAt.getTime() > acceptedAt.getTime()) throw invalidRequest();
        const canonical = createFieldObservation({
          id: input.observationId, businessId: scope.businessId, fieldId, seasonId: input.seasonId ?? null,
          actorUserId: scope.userId, actorMembershipId: scope.membershipId,
          description, occurredAt: occurredAt.toISOString(), acceptedAt: acceptedAt.toISOString(),
        });
        payloadFingerprint = createHash("sha256").update(JSON.stringify({
          businessId: canonical.businessId, fieldId: canonical.fieldId, seasonId: canonical.seasonId,
          actorUserId: canonical.actorUserId, actorMembershipId: canonical.actorMembershipId,
          description: canonical.description, occurredAt: canonical.occurredAt,
        })).digest("hex");
        const row = await tx.fieldObservation.create({ data: {
          id: canonical.id, businessId: canonical.businessId, fieldId: canonical.fieldId, seasonId: canonical.seasonId,
          actorUserId: canonical.actorUserId, actorMembershipId: canonical.actorMembershipId,
          description: canonical.description, occurredAt, acceptedAt, payloadFingerprint,
        } });
        return { kind: "accepted" as const, observation: this.toPublic(row, businessTimezone) };
      }, { isolationLevel: "ReadCommitted" });
    } catch (error) {
      if (!this.isUniqueViolation(error)) throw error;
      const current = await this.membershipScope.resolveDefaultBusinessScope(identity);
      if (!current || current.userId !== scope.userId || current.businessId !== scope.businessId || current.membershipId !== scope.membershipId) throw forbidden();
      const winner = await this.prisma.fieldObservation.findFirst({ where: { businessId: scope.businessId, id: input.observationId } });
      if (!winner) throw error;
      if (winner.payloadFingerprint !== payloadFingerprint) throw identityConflict();
      const timezone = await this.prisma.business.findUnique({ where: { id: scope.businessId }, select: { timezone: true } });
      if (!timezone) throw notFound();
      let businessTimezone: string;
      try { businessTimezone = resolveBusinessTimezone(timezone.timezone); }
      catch { throw invalidRequest(); }
      return { kind: "replayed", observation: this.toPublic(winner, businessTimezone) };
    }
  }

  private isUniqueViolation(error: unknown): boolean {
    return !!error && typeof error === "object" && "code" in error && (error as { code: unknown }).code === "P2002";
  }

  private toPublic(row: { id: string; fieldId: string; seasonId: string | null; description: string; occurredAt: Date }, businessTimezone: string): ObservationPublic {
    return { id: row.id, fieldId: row.fieldId, seasonId: row.seasonId, description: row.description,
      occurredAt: row.occurredAt.toISOString(), businessTimezone };
  }
}

function forbidden(): ApiError { return new ApiError(403, "FORBIDDEN", "This request is not available"); }
function notFound(): ApiError { return new ApiError(404, "NOT_FOUND", "The requested item is not available"); }
function invalidRequest(): ApiError { return new ApiError(400, "INVALID_REQUEST", "Check the observation information and try again"); }
function identityConflict(): ApiError { return new ApiError(409, "IDEMPOTENCY_KEY_REUSED", "This observation ID was already used for different information"); }
