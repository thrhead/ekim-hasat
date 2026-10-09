import { createHash } from "node:crypto";
import { NotFoundException } from "@nestjs/common";
import type { VerifiedSubject } from "@ekim-hasat/domain/identity/auth-provider";
import { TaskSkipError as DomainTaskSkipError, validateTaskSkip } from "@ekim-hasat/domain/tasks/task-skip";
import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import { BusinessScopeForbiddenError, MembershipScopeService, type AuthorizedBusinessScope } from "../authorization/membership-scope.service.js";
import { TaskSkipError } from "./task-skip.error.js";

export type SkipTaskInput = Readonly<{ skipId: string }>;
export type TaskSkipPublic = Readonly<{
  skipId: string;
  taskId: string;
  taskTitle: string;
  seasonId: string;
  fieldId: string;
  plannedLocalDate: string;
  baseTaskVersion: number;
  acceptedTaskVersion: number;
  skippedAt: string;
}>;
export type TaskSkipOutcome = Readonly<{ kind: "accepted" | "replayed"; skip: TaskSkipPublic }>;

const uuidPattern = /^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;

function fingerprint(taskId: string, scope: AuthorizedBusinessScope, baseTaskVersion: number): string {
  return createHash("sha256").update(JSON.stringify({
    taskId, businessId: scope.businessId, actorUserId: scope.userId,
    actorMembershipId: scope.membershipId, baseTaskVersion,
  })).digest("hex");
}

function dateString(value: Date): string { return value.toISOString().slice(0, 10); }

function publicSkip(row: {
  skipId: string; plannedTaskId: string; taskTitleSnapshot: string; seasonId: string; fieldId: string;
  plannedLocalDateSnapshot: Date; baseTaskVersion: number; acceptedTaskVersion: number; skippedAt: Date;
}): TaskSkipPublic {
  return {
    skipId: row.skipId, taskId: row.plannedTaskId, taskTitle: row.taskTitleSnapshot,
    seasonId: row.seasonId, fieldId: row.fieldId, plannedLocalDate: dateString(row.plannedLocalDateSnapshot),
    baseTaskVersion: row.baseTaskVersion, acceptedTaskVersion: row.acceptedTaskVersion,
    skippedAt: row.skippedAt.toISOString(),
  };
}

function isTaskSkipUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error) || error.code !== "P2002") return false;
  const details = JSON.stringify(error);
  return details.includes("task_skips_business_id_skip_id_key") || details.includes("task_skips_planned_task_id_key")
    || details.includes("task_skips_planned_task_id_season_plan_id_key")
    || details.includes("businessId\",\"skipId") || details.includes("plannedTaskId\",\"seasonPlanId");
}

export class TaskSkipRepository {
  private readonly membershipScope: MembershipScopeService;

  constructor(private readonly prisma: PrismaClient, private readonly now: () => Date = () => new Date()) {
    this.membershipScope = new MembershipScopeService(prisma);
  }

  skip(identity: VerifiedSubject, taskId: string, baseTaskVersion: number, input: SkipTaskInput): Promise<TaskSkipOutcome> {
    return this.skipAttempt(identity, taskId, baseTaskVersion, input, true);
  }

  private async skipAttempt(identity: VerifiedSubject, taskId: string, baseTaskVersion: number, input: SkipTaskInput, recoverRace: boolean): Promise<TaskSkipOutcome> {
    if (!uuidPattern.test(taskId) || !uuidPattern.test(input.skipId) || !Number.isSafeInteger(baseTaskVersion) || baseTaskVersion < 1) {
      throw new TaskSkipError("INVALID_REQUEST");
    }
    const scope = await this.membershipScope.resolveDefaultBusinessScope(identity);
    if (!scope) throw new BusinessScopeForbiddenError();
    const payloadFingerprint = fingerprint(taskId, scope, baseTaskVersion);

    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.lockAuthorizedContext(tx, scope);

        // Identity lookup precedes all live eligibility/version checks so a confirmed
        // command can be replayed after its accepted version has moved forward.
        const existingById = await tx.taskSkip.findUnique({
          where: { businessId_skipId: { businessId: scope.businessId, skipId: input.skipId } },
        });
        if (existingById) {
          if (existingById.plannedTaskId !== taskId || existingById.actorUserId !== scope.userId
            || existingById.actorMembershipId !== scope.membershipId || existingById.payloadFingerprint !== payloadFingerprint) {
            throw new TaskSkipError("IDEMPOTENCY_KEY_REUSED");
          }
          return { kind: "replayed", skip: publicSkip(existingById) };
        }

        const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT pt.id FROM planned_tasks pt
          JOIN season_plans sp ON sp.id = pt.season_plan_id
          JOIN seasons s ON s.id = sp.season_id
          WHERE pt.id = ${taskId}::uuid AND s.business_id = ${scope.businessId}::uuid
          FOR UPDATE OF s, sp, pt`;
        if (locked.length !== 1) throw new NotFoundException();

        const task = await tx.plannedTask.findFirst({
          where: { id: taskId, seasonPlan: { season: { businessId: scope.businessId, field: { businessId: scope.businessId } } } },
          include: { completion: { select: { id: true } }, skip: { select: { id: true } },
            seasonPlan: { include: { season: { include: { snapshot: true } } } } },
        });
        if (!task) throw new NotFoundException();

        // A different command identity cannot turn an accepted terminal outcome into a replay.
        if (task.skip) throw new TaskSkipError("TASK_ALREADY_SKIPPED");

        const season = task.seasonPlan.season;
        let validated;
        try {
          validated = validateTaskSkip({
            seasonStatus: season.status, planStatus: task.seasonPlan.status,
            hasActivationSnapshot: season.snapshot !== null, completed: task.completion !== null,
            skipped: false, plannedLocalDate: dateString(task.plannedLocalDate),
            currentTaskVersion: task.version, expectedTaskVersion: baseTaskVersion,
          });
        } catch (error) {
          if (error instanceof DomainTaskSkipError) throw new TaskSkipError(error.code);
          throw error;
        }

        // Insert first in this transaction so the existing database guard can
        // validate the version increment against its exact accepted event.
        const row = await tx.taskSkip.create({ data: {
          skipId: input.skipId, plannedTaskId: task.id, seasonPlanId: task.seasonPlanId,
          seasonId: season.id, fieldId: season.fieldId, businessId: scope.businessId,
          actorUserId: scope.userId, actorMembershipId: scope.membershipId, skippedAt: this.now(),
          baseTaskVersion: validated.baseTaskVersion, acceptedTaskVersion: validated.acceptedTaskVersion,
          payloadFingerprint, taskTitleSnapshot: task.title,
          plannedLocalDateSnapshot: new Date(`${validated.plannedLocalDateSnapshot}T00:00:00.000Z`),
        } });

        const updated = await tx.plannedTask.updateMany({
          where: { id: taskId, seasonPlanId: task.seasonPlanId, version: baseTaskVersion },
          data: { version: { increment: 1 } },
        });
        if (updated.count !== 1) throw new TaskSkipError("TASK_VERSION_CONFLICT");

        return { kind: "accepted", skip: publicSkip(row) };
      }, { isolationLevel: "ReadCommitted" });
    } catch (error) {
      if (error instanceof TaskSkipError || error instanceof BusinessScopeForbiddenError || error instanceof NotFoundException) throw error;
      if (recoverRace && isTaskSkipUniqueViolation(error)) return this.skipAttempt(identity, taskId, baseTaskVersion, input, false);
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
