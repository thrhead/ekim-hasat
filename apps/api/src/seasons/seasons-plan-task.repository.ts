import { createHash, randomUUID } from "node:crypto";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { validatePlannedTaskDate } from "@ekim-hasat/domain/seasons/local-date";
import type { VerifiedSubject } from "@ekim-hasat/domain/identity/auth-provider";
import type { PrismaClient, Prisma } from "../generated/prisma/client.js";
import { BusinessScopeForbiddenError, MembershipScopeService, type AuthorizedBusinessScope } from "../authorization/membership-scope.service.js";
import { seasonRecordToResponse, seasonSetupInclude } from "./seasons-read.repository.js";
import type { SeasonSetupResponse } from "./seasons-read.controller.js";
import { LocalDateValidationError } from "@ekim-hasat/domain/seasons/local-date";
import { SeasonCommandError } from "./seasons-command.error.js";

type AddTaskCommand = Readonly<{ title: string; description?: string; plannedLocalDate: string }>;
type EditTaskCommand = Readonly<{ title?: string; description?: string; plannedLocalDate?: string }>;
export type PlanTaskCommandOutcome = Readonly<{ season: SeasonSetupResponse; kind: "updated" | "replayed" }>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function validateTitle(value: unknown): string {
  if (typeof value !== "string") throw new BadRequestException();
  const title = value.trim();
  if (title.length < 1 || title.length > 200) throw new BadRequestException();
  return title;
}

function validateDescription(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length > 2000) throw new BadRequestException();
  return value;
}

export function validateAddPlanTaskCommand(body: unknown): AddTaskCommand {
  if (!isRecord(body) || !hasOnlyKeys(body, ["title", "description", "plannedLocalDate"]) || !("title" in body) || !("plannedLocalDate" in body)) throw new BadRequestException();
  return { title: validateTitle(body.title), ...(body.description === undefined ? {} : { description: validateDescription(body.description) }), plannedLocalDate: validateDateString(body.plannedLocalDate) };
}

export function validateEditPlanTaskCommand(body: unknown): EditTaskCommand {
  if (!isRecord(body) || !hasOnlyKeys(body, ["title", "description", "plannedLocalDate"]) || Object.keys(body).length === 0) throw new BadRequestException();
  if (body.title === undefined && body.description === undefined && body.plannedLocalDate === undefined) throw new BadRequestException();
  return {
    ...(body.title === undefined ? {} : { title: validateTitle(body.title) }),
    ...(body.description === undefined ? {} : { description: validateDescription(body.description) }),
    ...(body.plannedLocalDate === undefined ? {} : { plannedLocalDate: validateDateString(body.plannedLocalDate) }),
  };
}

function validateDateString(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new BadRequestException();
  return value;
}

export function validateExpectedSeasonVersion(value: unknown): number {
  if (typeof value !== "string") throw new BadRequestException();
  const match = /^(?:W\/)?"?([1-9]\d*)"?$/.exec(value);
  if (!match) throw new BadRequestException();
  const version = Number(match[1]);
  if (!Number.isSafeInteger(version)) throw new BadRequestException();
  return version;
}

export function validatePlanTaskIdempotencyKey(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 200) throw new BadRequestException();
  return value;
}

function dateScalar(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function fingerprint(seasonId: string, expectedVersion: number, command: AddTaskCommand): string {
  return createHash("sha256").update(JSON.stringify({ seasonId, expectedVersion, command })).digest("hex");
}

function idempotencyExpiry(now: Date): Date {
  const configured = process.env.SEASON_IDEMPOTENCY_RETENTION_HOURS ?? "24";
  const hours = Number(configured);
  if (!Number.isInteger(hours) || hours < 1 || hours > 720) throw new Error("Season command retention must be between 1 and 720 hours");
  return new Date(now.getTime() + hours * 60 * 60 * 1000);
}

function validateAndDate(value: string, actualPlantingDate: Date): Date {
  try {
    const actual = actualPlantingDate.toISOString().slice(0, 10);
    return dateScalar(validatePlannedTaskDate(value, actual));
  } catch (error) {
    if (error instanceof LocalDateValidationError) throw new SeasonCommandError(400, "INVALID_REQUEST");
    throw error;
  }
}

export class SeasonPlanTaskRepository {
  private readonly membershipScope: MembershipScopeService;

  constructor(private readonly prisma: PrismaClient, private readonly now: () => Date = () => new Date()) {
    this.membershipScope = new MembershipScopeService(prisma);
  }

  private async authorizedScope(identity: VerifiedSubject): Promise<AuthorizedBusinessScope> {
    const scope = await this.membershipScope.resolveDefaultBusinessScope(identity);
    if (!scope) throw new BusinessScopeForbiddenError();
    return scope;
  }

  async addTask(identity: VerifiedSubject, seasonId: string, expectedVersion: number, key: string, body: unknown): Promise<PlanTaskCommandOutcome> {
    const command = validateAddPlanTaskCommand(body);
    const scope = await this.authorizedScope(identity);
    const payloadFingerprint = fingerprint(seasonId, expectedVersion, command);
    return this.mutate(identity, scope, seasonId, expectedVersion, async (tx, season) => {
      const retained = await tx.seasonCommandIdempotencyRecord.findUnique({ where: {
        userId_businessId_command_key: { userId: scope.userId, businessId: scope.businessId, command: "ADD_PLAN_TASK", key },
      } });
      if (retained) {
        if (retained.payloadFingerprint !== payloadFingerprint) throw new SeasonCommandError(409, "IDEMPOTENCY_KEY_REUSED");
        return { response: retained.result as unknown as SeasonSetupResponse, kind: "replayed" };
      }
      this.assertDraftVersion(season, expectedVersion);
      const plan = season.plan;
      if (!plan) throw new Error("Season plan is missing");
      const plannedDate = validateAndDate(command.plannedLocalDate, season.actualPlantingDate);
      await this.claimVersion(tx, season, scope, expectedVersion);
      await tx.plannedTask.create({ data: {
        id: randomUUID(), seasonPlanId: plan.id, title: command.title,
        description: command.description ?? null, plannedLocalDate: plannedDate,
      } });
      const row = await tx.season.findUniqueOrThrow({ where: { id: season.id }, include: seasonSetupInclude });
      const response = seasonRecordToResponse(row);
      const now = this.now();
      await tx.seasonCommandIdempotencyRecord.create({ data: {
        userId: scope.userId, businessId: scope.businessId, seasonId: season.id,
        command: "ADD_PLAN_TASK", key, payloadFingerprint, result: response as unknown as Prisma.InputJsonValue,
        createdAt: now, expiresAt: idempotencyExpiry(now),
      } });
      return { response, kind: "updated" };
    });
  }

  async editTask(identity: VerifiedSubject, seasonId: string, taskId: string, expectedVersion: number, body: unknown): Promise<PlanTaskCommandOutcome> {
    const patch = validateEditPlanTaskCommand(body);
    const scope = await this.authorizedScope(identity);
    return this.mutate(identity, scope, seasonId, expectedVersion, async (tx, season) => {
      const plan = season.plan;
      this.assertDraftVersion(season, expectedVersion);
      if (!plan) throw new Error("Season plan is missing");
      const task = plan.tasks.find((candidate) => candidate.id === taskId);
      if (!task) throw new NotFoundException();
      const plannedDate = patch.plannedLocalDate === undefined ? undefined : validateAndDate(patch.plannedLocalDate, season.actualPlantingDate);
      await this.claimVersion(tx, season, scope, expectedVersion);
      await tx.plannedTask.update({ where: { id: task.id }, data: {
        ...(patch.title === undefined ? {} : { title: patch.title }),
        ...(patch.description === undefined ? {} : { description: patch.description }),
        ...(plannedDate === undefined ? {} : { plannedLocalDate: plannedDate }),
        version: { increment: 1 },
      } });
      const row = await tx.season.findUniqueOrThrow({ where: { id: season.id }, include: seasonSetupInclude });
      return { response: seasonRecordToResponse(row), kind: "updated" };
    });
  }

  async removeTask(identity: VerifiedSubject, seasonId: string, taskId: string, expectedVersion: number): Promise<PlanTaskCommandOutcome> {
    const scope = await this.authorizedScope(identity);
    return this.mutate(identity, scope, seasonId, expectedVersion, async (tx, season) => {
      const plan = season.plan;
      this.assertDraftVersion(season, expectedVersion);
      if (!plan) throw new Error("Season plan is missing");
      const task = plan.tasks.find((candidate) => candidate.id === taskId);
      if (!task) throw new NotFoundException();
      await this.claimVersion(tx, season, scope, expectedVersion);
      await tx.plannedTask.delete({ where: { id: task.id } });
      const row = await tx.season.findUniqueOrThrow({ where: { id: season.id }, include: seasonSetupInclude });
      return { response: seasonRecordToResponse(row), kind: "updated" };
    });
  }

  private async mutate(
    identity: VerifiedSubject,
    scope: AuthorizedBusinessScope,
    seasonId: string,
    expectedVersion: number,
    operation: (tx: Prisma.TransactionClient, season: Prisma.SeasonGetPayload<{ include: typeof seasonSetupInclude }>) => Promise<{ response: SeasonSetupResponse; kind: "updated" | "replayed" }>,
  ): Promise<PlanTaskCommandOutcome> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const season = await tx.season.findFirst({ where: {
          id: seasonId,
          businessId: scope.businessId,
          field: { businessId: scope.businessId },
          business: { memberships: { some: { id: scope.membershipId, userId: scope.userId, status: "ACTIVE" } } },
        }, include: seasonSetupInclude });
        if (!season) throw new NotFoundException();
        const outcome = await operation(tx, season);
        return { season: outcome.response, kind: outcome.kind };
      }, { isolationLevel: "ReadCommitted" });
    } catch (error) {
      if (error instanceof LocalDateValidationError) throw new SeasonCommandError(400, "INVALID_REQUEST");
      throw error;
    }
  }

  private assertDraftVersion(season: Prisma.SeasonGetPayload<{ include: typeof seasonSetupInclude }>, expectedVersion: number): void {
    if (season.status !== "DRAFT" || !season.plan || season.plan.status !== "DRAFT") throw new SeasonCommandError(409, "SEASON_NOT_DRAFT");
    if (season.version !== expectedVersion) throw new SeasonCommandError(409, "STALE_SEASON_VERSION");
  }

  private async claimVersion(tx: Prisma.TransactionClient, season: Prisma.SeasonGetPayload<{ include: typeof seasonSetupInclude }>, scope: AuthorizedBusinessScope, expectedVersion: number): Promise<void> {
    const claimed = await tx.season.updateMany({ where: {
      id: season.id, businessId: scope.businessId, status: "DRAFT", version: expectedVersion,
      business: { memberships: { some: { id: scope.membershipId, userId: scope.userId, status: "ACTIVE" } } },
    }, data: { version: { increment: 1 } } });
    if (claimed.count === 1) return;
    const current = await tx.season.findFirst({ where: { id: season.id, businessId: scope.businessId,
      business: { memberships: { some: { id: scope.membershipId, userId: scope.userId, status: "ACTIVE" } } } }, select: { status: true } });
    if (!current) throw new NotFoundException();
    if (current.status !== "DRAFT") throw new SeasonCommandError(409, "SEASON_NOT_DRAFT");
    throw new SeasonCommandError(409, "STALE_SEASON_VERSION");
  }
}
