import { createHash } from "node:crypto";
import { NotFoundException } from "@nestjs/common";
import type { VerifiedSubject } from "@ekim-hasat/domain/identity/auth-provider";
import { assertActivationEligible, ActivationEligibilityError } from "@ekim-hasat/domain/seasons/activation";
import { validateLocalDate } from "@ekim-hasat/domain/seasons/local-date";
import type { ActivationSnapshot, PlanSource } from "@ekim-hasat/domain/seasons/types";
import { Prisma, type PrismaClient } from "../generated/prisma/client.js";
import { BusinessScopeForbiddenError, MembershipScopeService, type AuthorizedBusinessScope } from "../authorization/membership-scope.service.js";
import { SeasonCommandError } from "./seasons-command.error.js";
import { seasonRecordToResponse, seasonSetupInclude } from "./seasons-read.repository.js";
import type { SeasonSetupResponse } from "./seasons-read.controller.js";

export type SeasonActivationOutcome = Readonly<{ season: SeasonSetupResponse; kind: "activated" | "replayed" }>;

export function validateActivationIdempotencyKey(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 200) throw new SeasonCommandError(400, "INVALID_REQUEST");
  return value;
}

export function validateActivationExpectedVersion(value: unknown): number {
  if (typeof value !== "string") throw new SeasonCommandError(400, "INVALID_REQUEST");
  const match = /^(?:W\/)?"?([1-9]\d*)"?$/.exec(value);
  if (!match) throw new SeasonCommandError(400, "INVALID_REQUEST");
  const version = Number(match[1]);
  if (!Number.isSafeInteger(version)) throw new SeasonCommandError(400, "INVALID_REQUEST");
  return version;
}

function fingerprint(seasonId: string, expectedVersion: number): string {
  return createHash("sha256").update(JSON.stringify({ command: "ACTIVATE", seasonId, expectedVersion })).digest("hex");
}

function dateScalar(value: string): Date { return new Date(`${value}T00:00:00.000Z`); }
function businessLocalDate(now: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (type: string) => parts.find((item) => item.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
function idempotencyExpiry(now: Date): Date {
  const configured = process.env.SEASON_IDEMPOTENCY_RETENTION_HOURS ?? "24";
  const hours = Number(configured);
  if (!Number.isInteger(hours) || hours < 1 || hours > 720) throw new Error("Season command retention must be between 1 and 720 hours");
  return new Date(now.getTime() + hours * 3600000);
}

const activationInclude = { ...seasonSetupInclude, plan: { include: { tasks: { orderBy: { id: "asc" as const } }, templateVersion: true } } } satisfies Prisma.SeasonInclude;
type ActivationRow = Prisma.SeasonGetPayload<{ include: typeof activationInclude }>;
function planSource(season: ActivationRow): PlanSource {
  const plan = season.plan;
  if (!plan) throw new Error("Season plan is missing");
  if (plan.source === "MANUAL" && plan.templateVersionId === null) return { source: "MANUAL", templateProvenance: null };
  if (plan.source !== "VALIDATED_TEMPLATE" || !plan.templateVersionId || !plan.templateVersion) throw new Error("Season plan provenance integrity failure");
  return { source: "VALIDATED_TEMPLATE", templateProvenance: {
    templateKey: plan.templateVersion.templateKey,
    templateVersionId: plan.templateVersion.id,
    version: plan.templateVersion.version,
    cropDefinitionVersionId: plan.templateVersion.cropDefinitionVersionId,
    regionSelector: plan.templateVersion.regionSelector,
  } };
}

function cropSnapshot(season: ActivationRow) {
  if (season.cropDefinitionVersion && season.cropKey) return {
    kind: "CENTRAL", cropKey: season.cropKey, cropDefinitionVersionId: season.cropDefinitionVersion.id,
    displayName: season.cropDefinitionVersion.displayName,
  } as const;
  if (season.customCrop) return { kind: "CUSTOM", businessId: season.businessId, customCropId: season.customCrop.id,
    displayName: season.customCrop.displayName } as const;
  throw new Error("Season crop integrity failure");
}

export class SeasonActivationRepository {
  private readonly membershipScope: MembershipScopeService;
  constructor(private readonly prisma: PrismaClient, private readonly now: () => Date = () => new Date()) {
    this.membershipScope = new MembershipScopeService(prisma);
  }

  private async authorizedScope(identity: VerifiedSubject): Promise<AuthorizedBusinessScope> {
    const scope = await this.membershipScope.resolveDefaultBusinessScope(identity);
    if (!scope) throw new BusinessScopeForbiddenError();
    return scope;
  }

  async activate(identity: VerifiedSubject, seasonId: string, expectedVersion: number, key: string): Promise<SeasonActivationOutcome> {
    const scope = await this.authorizedScope(identity);
    const commandFingerprint = fingerprint(seasonId, expectedVersion);
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.lockAuthorizedContext(tx, scope);
        const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM seasons
          WHERE id = ${seasonId}::uuid AND business_id = ${scope.businessId}::uuid FOR UPDATE`;
        if (locked.length !== 1) throw new NotFoundException();

        const retained = await tx.seasonCommandIdempotencyRecord.findUnique({ where: {
          userId_businessId_command_key: { userId: scope.userId, businessId: scope.businessId, command: "ACTIVATE", key },
        } });
        if (retained) {
          if (retained.payloadFingerprint !== commandFingerprint) throw new SeasonCommandError(409, "IDEMPOTENCY_KEY_REUSED");
          return { kind: "replayed", season: retained.result as unknown as SeasonSetupResponse };
        }

        const season = await tx.season.findFirst({ where: {
          id: seasonId, businessId: scope.businessId, field: { businessId: scope.businessId },
        }, include: activationInclude });
        if (!season) throw new NotFoundException();
        if (season.status !== "DRAFT" || season.plan?.status !== "DRAFT") throw new SeasonCommandError(409, "SEASON_STATE_CONFLICT");
        if (season.version !== expectedVersion) throw new SeasonCommandError(409, "STALE_VERSION");

        const source = planSource(season);
        try {
          assertActivationEligible({ seasonStatus: season.status as "DRAFT" | "ACTIVE", planStatus: season.plan.status as "DRAFT" | "APPROVED",
          planId: season.plan.id, actualPlantingDate: validateLocalDate(season.actualPlantingDate.toISOString().slice(0, 10)),
            source: source.source, templateProvenance: source.templateProvenance,
            tasks: season.plan.tasks.map((task) => ({ ...task, plannedLocalDate: validateLocalDate(task.plannedLocalDate.toISOString().slice(0, 10)) })) });
        } catch (error) {
          if (error instanceof ActivationEligibilityError && error.code === "PLAN_HAS_NO_VALID_TASKS") throw new SeasonCommandError(422, "PLAN_HAS_NO_VALID_TASKS");
          throw error;
        }

        const business = await tx.business.findUniqueOrThrow({ where: { id: scope.businessId }, select: { timezone: true } });
        const timezone = business.timezone ?? process.env.SEASON_DEFAULT_TIMEZONE ?? "Europe/Istanbul";
        const activatedAt = this.now();
        const activatedLocalDate = businessLocalDate(activatedAt, timezone);
        const taskSnapshot = season.plan.tasks.map((task) => ({ id: task.id, seasonPlanId: task.seasonPlanId, title: task.title,
          description: task.description, plannedLocalDate: validateLocalDate(task.plannedLocalDate.toISOString().slice(0, 10)),
          sourceTemplateTaskKey: task.sourceTemplateTaskKey, version: task.version }));
        const snapshot: ActivationSnapshot = { seasonId, fieldBoundaryVersionId: null, regionContext: null,
          crop: cropSnapshot(season), actualPlantingDate: validateLocalDate(season.actualPlantingDate.toISOString().slice(0, 10)),
          businessTimezone: timezone, activatedAt: activatedAt.toISOString(), approvedTasks: taskSnapshot, ...source };
        const boundary = await tx.fieldBoundaryVersion.findFirst({ where: { fieldId: season.fieldId }, orderBy: [{ version: "desc" }, { id: "asc" }], select: { id: true } });
        const finalSnapshot = { ...snapshot, fieldBoundaryVersionId: boundary?.id ?? null };

        const updated = await tx.season.updateMany({ where: { id: season.id, businessId: scope.businessId, status: "DRAFT", version: expectedVersion },
          data: { status: "ACTIVE", activatedAt, version: { increment: 1 } } });
        if (updated.count !== 1) throw new SeasonCommandError(409, "STALE_VERSION");
        await tx.seasonPlan.update({ where: { id: season.plan.id }, data: { status: "APPROVED" } });
        await tx.seasonContextSnapshot.create({ data: {
          seasonId, fieldBoundaryVersionId: finalSnapshot.fieldBoundaryVersionId,
          regionContext: Prisma.DbNull,
          cropSnapshot: { ...finalSnapshot.crop, templateProvenance: finalSnapshot.templateProvenance,
            approvedTasks: finalSnapshot.approvedTasks } as unknown as Prisma.InputJsonValue,
          source: source.source, templateVersionId: source.templateProvenance?.templateVersionId ?? null,
          activatedAt, businessTimezone: timezone, activatedLocalDate: dateScalar(activatedLocalDate),
        } });
        const row = await tx.season.findUniqueOrThrow({ where: { id: seasonId }, include: seasonSetupInclude });
        const response = seasonRecordToResponse(row);
        await tx.seasonCommandIdempotencyRecord.create({ data: {
          userId: scope.userId, businessId: scope.businessId, command: "ACTIVATE", key, payloadFingerprint: commandFingerprint,
          seasonId, result: response as unknown as Prisma.InputJsonValue, createdAt: activatedAt, expiresAt: idempotencyExpiry(activatedAt),
        } });
        return { kind: "activated", season: response };
      }, { isolationLevel: "ReadCommitted" });
    } catch (error) {
      if (error instanceof ActivationEligibilityError) throw new SeasonCommandError(error.code === "SEASON_NOT_DRAFT" ? 409 : 422,
        error.code === "SEASON_NOT_DRAFT" ? "SEASON_STATE_CONFLICT" : "PLAN_HAS_NO_VALID_TASKS");
      throw error;
    }
  }

  private async lockAuthorizedContext(tx: Prisma.TransactionClient, scope: AuthorizedBusinessScope): Promise<void> {
    const users = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM application_users
      WHERE id = ${scope.userId}::uuid AND default_business_id = ${scope.businessId}::uuid FOR UPDATE`;
    if (users.length !== 1) throw new BusinessScopeForbiddenError();
    const memberships = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM memberships
      WHERE id = ${scope.membershipId}::uuid AND user_id = ${scope.userId}::uuid
        AND business_id = ${scope.businessId}::uuid AND status = 'ACTIVE' FOR UPDATE`;
    if (memberships.length !== 1) throw new BusinessScopeForbiddenError();
  }
}
