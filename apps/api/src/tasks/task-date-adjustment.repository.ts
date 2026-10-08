import { createHash } from "node:crypto";
import { NotFoundException } from "@nestjs/common";
import type { VerifiedSubject } from "@ekim-hasat/domain/identity/auth-provider";
import {
  TaskDateAdjustmentError as DomainTaskDateAdjustmentError,
  validateTaskDateAdjustment,
} from "@ekim-hasat/domain/tasks/task-date-adjustment";
import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import { BusinessScopeForbiddenError, MembershipScopeService, type AuthorizedBusinessScope } from "../authorization/membership-scope.service.js";
import { TaskDateAdjustmentError } from "./task-date-adjustment.error.js";
import type { TaskDateAdjustmentHistoryQuery } from "./task-date-adjustment.dto.js";

export type AdjustTaskDateInput = Readonly<{ adjustmentId: string; newPlannedLocalDate: string }>;
export type TaskDateAdjustmentPublic = Readonly<{
  adjustmentId: string;
  taskId: string;
  previousPlannedLocalDate: string;
  newPlannedLocalDate: string;
  baseTaskVersion: number;
  acceptedTaskVersion: number;
  adjustedAt: string;
}>;
export type TaskDateAdjustmentOutcome = Readonly<{ kind: "accepted" | "replayed"; adjustment: TaskDateAdjustmentPublic }>;
export type TaskDateAdjustmentHistoryPage = Readonly<{
  task: Readonly<{ taskId: string; plannedLocalDate: string; taskVersion: number; adjustable: boolean }>;
  items: readonly Readonly<{ adjustmentId: string; previousPlannedLocalDate: string; newPlannedLocalDate: string; adjustedAt: string }>[];
  nextCursor: string | null;
}>;

const uuidPattern = /^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;
type AdjustmentCursor = Readonly<{ taskId: string; id: string; adjustedAt: string; acceptedTaskVersion?: number }>;

function dateString(value: Date): string { return value.toISOString().slice(0, 10); }
function dateScalar(value: string): Date { return new Date(`${value}T00:00:00.000Z`); }
function fingerprint(taskId: string, input: AdjustTaskDateInput, baseTaskVersion: number): string {
  return createHash("sha256").update(JSON.stringify({ taskId, newPlannedLocalDate: input.newPlannedLocalDate, baseTaskVersion })).digest("hex");
}
function decodeCursor(value: string | undefined, taskId: string): AdjustmentCursor | null {
  if (value === undefined) return null;
  try {
    if (value.length > 512) throw new Error();
    const cursor = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<AdjustmentCursor>;
    if (cursor.taskId !== taskId || typeof cursor.id !== "string" || !uuidPattern.test(cursor.id)
      || typeof cursor.adjustedAt !== "string" || !Number.isFinite(Date.parse(cursor.adjustedAt))
      || (cursor.acceptedTaskVersion !== undefined && (!Number.isSafeInteger(cursor.acceptedTaskVersion) || cursor.acceptedTaskVersion < 1))) throw new Error();
    return cursor as AdjustmentCursor;
  } catch { throw new TaskDateAdjustmentError("INVALID_REQUEST"); }
}
function encodeCursor(cursor: AdjustmentCursor): string { return Buffer.from(JSON.stringify(cursor)).toString("base64url"); }
function isScopedIdentityUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error) || error.code !== "P2002") return false;
  return JSON.stringify(error).includes("task_date_adjustments_business_id_adjustment_id_key");
}
function publicAdjustment(row: {
  adjustmentId: string; plannedTaskId: string; previousPlannedLocalDate: Date; newPlannedLocalDate: Date;
  baseTaskVersion: number; acceptedTaskVersion: number; adjustedAt: Date;
}): TaskDateAdjustmentPublic {
  return {
    adjustmentId: row.adjustmentId, taskId: row.plannedTaskId,
    previousPlannedLocalDate: dateString(row.previousPlannedLocalDate), newPlannedLocalDate: dateString(row.newPlannedLocalDate),
    baseTaskVersion: row.baseTaskVersion, acceptedTaskVersion: row.acceptedTaskVersion, adjustedAt: row.adjustedAt.toISOString(),
  };
}

export class TaskDateAdjustmentRepository {
  private readonly membershipScope: MembershipScopeService;
  constructor(private readonly prisma: PrismaClient, private readonly now: () => Date = () => new Date()) {
    this.membershipScope = new MembershipScopeService(prisma);
  }

  adjust(identity: VerifiedSubject, taskId: string, baseTaskVersion: number, input: AdjustTaskDateInput): Promise<TaskDateAdjustmentOutcome> {
    return this.adjustAttempt(identity, taskId, baseTaskVersion, input, true);
  }

  private async adjustAttempt(identity: VerifiedSubject, taskId: string, baseTaskVersion: number, input: AdjustTaskDateInput, recoverRace: boolean): Promise<TaskDateAdjustmentOutcome> {
    if (!uuidPattern.test(taskId) || !uuidPattern.test(input.adjustmentId) || !Number.isSafeInteger(baseTaskVersion) || baseTaskVersion < 1) {
      throw new TaskDateAdjustmentError("INVALID_REQUEST");
    }
    const scope = await this.membershipScope.resolveDefaultBusinessScope(identity);
    if (!scope) throw new BusinessScopeForbiddenError();
    const payloadFingerprint = fingerprint(taskId, input, baseTaskVersion);
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.lockAuthorizedContext(tx, scope);
        const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT pt.id FROM planned_tasks pt
          JOIN season_plans sp ON sp.id = pt.season_plan_id
          JOIN seasons s ON s.id = sp.season_id
          WHERE pt.id = ${taskId}::uuid AND s.business_id = ${scope.businessId}::uuid
          FOR UPDATE OF s, sp, pt`;
        if (locked.length !== 1) throw new NotFoundException();

        const task = await tx.plannedTask.findFirst({
          where: { id: taskId, seasonPlan: { season: { businessId: scope.businessId, field: { businessId: scope.businessId } } } },
          include: { completion: true, seasonPlan: { include: { season: { include: { snapshot: true } } } } },
        });
        if (!task) throw new NotFoundException();

        // This is deliberately a compound Business-scoped lookup. Never look up public IDs globally.
        const existing = await tx.taskDateAdjustment.findUnique({
          where: { businessId_adjustmentId: { businessId: scope.businessId, adjustmentId: input.adjustmentId } },
        });
        if (existing) {
          if (existing.plannedTaskId !== taskId || existing.actorUserId !== scope.userId || existing.seasonId !== task.seasonPlan.seasonId
            || existing.payloadFingerprint !== payloadFingerprint) throw new TaskDateAdjustmentError("IDEMPOTENCY_KEY_REUSED");
          return { kind: "replayed", adjustment: publicAdjustment(existing) };
        }

        const season = task.seasonPlan.season;
        let validated;
        try {
          validated = validateTaskDateAdjustment({
            seasonStatus: season.status, planStatus: task.seasonPlan.status, completed: task.completion !== null,
            currentPlannedLocalDate: dateString(task.plannedLocalDate), actualPlantingDate: dateString(season.actualPlantingDate),
            currentTaskVersion: task.version, expectedTaskVersion: baseTaskVersion, newPlannedLocalDate: input.newPlannedLocalDate,
          });
        } catch (error) {
          if (error instanceof DomainTaskDateAdjustmentError) throw new TaskDateAdjustmentError(error.code);
          if (error instanceof Error && "code" in error) throw new TaskDateAdjustmentError("INVALID_REQUEST");
          throw error;
        }
        if (!season.snapshot) throw new TaskDateAdjustmentError("TASK_NOT_ACTIONABLE");

        const updated = await tx.plannedTask.updateMany({
          where: { id: taskId, seasonPlanId: task.seasonPlanId, version: baseTaskVersion },
          data: { plannedLocalDate: dateScalar(validated.newPlannedLocalDate), version: { increment: 1 } },
        });
        if (updated.count !== 1) throw new TaskDateAdjustmentError("TASK_VERSION_CONFLICT");
        const row = await tx.taskDateAdjustment.create({ data: {
          adjustmentId: input.adjustmentId, plannedTaskId: task.id, seasonPlanId: task.seasonPlanId,
          seasonId: season.id, fieldId: season.fieldId, businessId: scope.businessId,
          actorUserId: scope.userId, actorMembershipId: scope.membershipId,
          previousPlannedLocalDate: dateScalar(validated.previousPlannedLocalDate),
          newPlannedLocalDate: dateScalar(validated.newPlannedLocalDate),
          baseTaskVersion: validated.baseTaskVersion, acceptedTaskVersion: validated.acceptedTaskVersion,
          payloadFingerprint, adjustedAt: this.now(),
        } });
        return { kind: "accepted", adjustment: publicAdjustment(row) };
      }, { isolationLevel: "ReadCommitted" });
    } catch (error) {
      if (error instanceof TaskDateAdjustmentError || error instanceof BusinessScopeForbiddenError || error instanceof NotFoundException) throw error;
      if (recoverRace && isScopedIdentityUniqueViolation(error)) return this.adjustAttempt(identity, taskId, baseTaskVersion, input, false);
      throw error;
    }
  }

  async readHistory(identity: VerifiedSubject, taskId: string, query: TaskDateAdjustmentHistoryQuery = {}): Promise<TaskDateAdjustmentHistoryPage> {
    if (!uuidPattern.test(taskId) || (query.limit !== undefined && (!Number.isSafeInteger(query.limit) || query.limit < 1 || query.limit > 100))) {
      throw new TaskDateAdjustmentError("INVALID_REQUEST");
    }
    const scope = await this.membershipScope.resolveDefaultBusinessScope(identity);
    if (!scope) throw new BusinessScopeForbiddenError();
    const cursor = decodeCursor(query.cursor, taskId);
    const task = await this.prisma.plannedTask.findFirst({
      where: { id: taskId, seasonPlan: { season: { businessId: scope.businessId, field: { businessId: scope.businessId }, business: {
        memberships: { some: { id: scope.membershipId, userId: scope.userId, status: "ACTIVE" } },
      } } } },
      include: { completion: { select: { id: true } }, seasonPlan: { include: { season: { select: { status: true, businessId: true } } } } },
    });
    if (!task) throw new NotFoundException();
    const limit = query.limit ?? 50;
    const legacyCursor = cursor !== null && cursor.acceptedTaskVersion === undefined;
    const rows = await this.prisma.taskDateAdjustment.findMany({
      where: { plannedTaskId: taskId, businessId: scope.businessId,
        ...(cursor ? { OR: legacyCursor
          ? [{ adjustedAt: { lt: new Date(cursor.adjustedAt) } }, { adjustedAt: new Date(cursor.adjustedAt), id: { lt: cursor.id } }]
          : [{ adjustedAt: { lt: new Date(cursor.adjustedAt) } },
            { adjustedAt: new Date(cursor.adjustedAt), acceptedTaskVersion: { lt: cursor.acceptedTaskVersion! } },
            { adjustedAt: new Date(cursor.adjustedAt), acceptedTaskVersion: cursor.acceptedTaskVersion!, id: { lt: cursor.id } }] } : {}),
      },
      orderBy: legacyCursor ? [{ adjustedAt: "desc" }, { id: "desc" }]
        : [{ adjustedAt: "desc" }, { acceptedTaskVersion: "desc" }, { id: "desc" }], take: limit + 1,
      select: { id: true, adjustmentId: true, previousPlannedLocalDate: true, newPlannedLocalDate: true, adjustedAt: true, acceptedTaskVersion: true },
    });
    const hasNext = rows.length > limit;
    const pageRows = rows.slice(0, limit);
    const last = pageRows.at(-1);
    return {
      task: { taskId, plannedLocalDate: dateString(task.plannedLocalDate), taskVersion: task.version,
        adjustable: task.completion === null && task.seasonPlan.season.status === "ACTIVE" && task.seasonPlan.status === "APPROVED" },
      items: pageRows.map((row) => ({ adjustmentId: row.adjustmentId, previousPlannedLocalDate: dateString(row.previousPlannedLocalDate),
        newPlannedLocalDate: dateString(row.newPlannedLocalDate), adjustedAt: row.adjustedAt.toISOString() })),
      nextCursor: hasNext && last ? encodeCursor({ taskId, id: last.id, adjustedAt: last.adjustedAt.toISOString(), acceptedTaskVersion: last.acceptedTaskVersion }) : null,
    };
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
