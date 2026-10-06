import { createHash } from "node:crypto";
import { NotFoundException } from "@nestjs/common";
import type { VerifiedSubject } from "@ekim-hasat/domain/identity/auth-provider";
import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import { Prisma as PrismaRuntime } from "../generated/prisma/client.js";
import { BusinessScopeForbiddenError, MembershipScopeService } from "../authorization/membership-scope.service.js";
import { resolveBusinessTimezone } from "../seasons/business-timezone.js";
import { TaskCompletionError } from "./task-completion.error.js";

export type CompleteTaskInput = Readonly<{ completionId: string; occurredAt: string }>;
export type TaskCompletionPublic = Readonly<{
  id: string; taskId: string; seasonId: string; fieldId: string; title: string; plannedLocalDate: string;
  occurredAt: string; sourceKind: "MANUAL" | "VALIDATED_TEMPLATE"; templateVersionId: string | null; businessTimezone: string;
}>;
export type TaskCompletionOutcome = Readonly<{ kind: "accepted" | "replayed"; completion: TaskCompletionPublic }>;
export type TaskCompletionHistoryFilters = Readonly<{ seasonId?: string; cursor?: string; limit?: number }>;
export type TaskCompletionHistoryPage = Readonly<{ items: readonly TaskCompletionPublic[]; businessTimezone: string; nextCursor: string | null }>;
export type TaskCompletionDiaryAfter = Readonly<{ occurredAt: string; kind: "OBSERVATION" | "TASK_COMPLETION"; id: string }>;

const uuidPattern = /^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;
const instantPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i;

type HistoryCursor = Readonly<{ fieldId: string; seasonId: string | null; occurredAt: string; id: string }>;

function decodeHistoryCursor(value: string | undefined, fieldId: string, seasonId: string | undefined): HistoryCursor | null {
  if (value === undefined) return null;
  try {
    if (!value || value.length > 512) throw new Error();
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<HistoryCursor>;
    if (parsed.fieldId !== fieldId || parsed.seasonId !== (seasonId ?? null) || typeof parsed.id !== "string" || !uuidPattern.test(parsed.id)
      || typeof parsed.occurredAt !== "string" || !instantPattern.test(parsed.occurredAt) || !Number.isFinite(Date.parse(parsed.occurredAt))) throw new Error();
    return parsed as HistoryCursor;
  } catch { throw new TaskCompletionError("INVALID_REQUEST"); }
}

function encodeHistoryCursor(value: HistoryCursor): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function validateInput(taskId: string, version: number, input: CompleteTaskInput): void {
  if (!uuidPattern.test(taskId) || !uuidPattern.test(input.completionId) || !Number.isSafeInteger(version) || version < 1 ||
      !instantPattern.test(input.occurredAt) || !Number.isFinite(Date.parse(input.occurredAt))) throw new TaskCompletionError("INVALID_REQUEST");
}

function fingerprint(taskId: string, occurredAt: string, version: number): string {
  return createHash("sha256").update(JSON.stringify({ taskId, occurredAt: new Date(occurredAt).toISOString(), version })).digest("hex");
}

type CompletionRow = Prisma.TaskCompletionGetPayload<{ include: {
  season: { include: { snapshot: true; plan: true; business: { select: { timezone: true } } } };
} }>;

export class TaskCompletionRepository {
  private readonly membershipScope: MembershipScopeService;
  constructor(private readonly prisma: PrismaClient, private readonly now: () => Date = () => new Date()) {
    this.membershipScope = new MembershipScopeService(prisma);
  }

  async complete(identity: VerifiedSubject, taskId: string, baseTaskVersion: number, input: CompleteTaskInput): Promise<TaskCompletionOutcome> {
    validateInput(taskId, baseTaskVersion, input);
    const scope = await this.membershipScope.resolveDefaultBusinessScope(identity);
    if (!scope) throw new BusinessScopeForbiddenError();
    const payloadFingerprint = fingerprint(taskId, input.occurredAt, baseTaskVersion);
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.lockAuthorizedContext(tx, scope);
        const taskLock = await tx.$queryRaw<Array<{ id: string }>>`SELECT pt.id FROM planned_tasks pt
          JOIN season_plans sp ON sp.id = pt.season_plan_id
          JOIN seasons s ON s.id = sp.season_id
          WHERE pt.id = ${taskId}::uuid AND s.business_id = ${scope.businessId}::uuid FOR UPDATE OF s, sp, pt`;
        if (taskLock.length !== 1) throw new NotFoundException();

        const task = await tx.plannedTask.findFirst({ where: { id: taskId, seasonPlan: { season: {
          businessId: scope.businessId, field: { businessId: scope.businessId },
        } } }, include: { seasonPlan: { include: { season: { include: { snapshot: true, business: { select: { timezone: true } } } } } } } });
        if (!task) throw new NotFoundException();

        const existingById = await tx.taskCompletion.findUnique({ where: { id: input.completionId }, include: { season: { include: { snapshot: true, plan: true, business: { select: { timezone: true } } } } } });
        if (existingById) {
          if (existingById.plannedTaskId !== taskId || existingById.payloadFingerprint !== payloadFingerprint ||
              existingById.actorUserId !== scope.userId || existingById.businessId !== scope.businessId || existingById.seasonId !== task.seasonPlan.seasonId) {
            throw new TaskCompletionError("IDEMPOTENCY_KEY_REUSED");
          }
          return { kind: "replayed", completion: this.toPublic(existingById) };
        }

        const season = task.seasonPlan.season;
        if (season.status !== "ACTIVE" || task.seasonPlan.status !== "APPROVED" || !season.snapshot) throw new TaskCompletionError("TASK_NOT_ACTIONABLE");
        if (task.version !== baseTaskVersion) throw new TaskCompletionError("TASK_VERSION_CONFLICT");
        const existingForTask = await tx.taskCompletion.findUnique({ where: { plannedTaskId: taskId }, include: { season: { include: { snapshot: true, plan: true } } } });
        if (existingForTask) throw new TaskCompletionError("TASK_ALREADY_COMPLETED");

        const row = await tx.taskCompletion.create({ data: {
          id: input.completionId, plannedTaskId: task.id, seasonPlanId: task.seasonPlanId, seasonId: season.id,
          fieldId: season.fieldId, businessId: scope.businessId, actorUserId: scope.userId, actorMembershipId: scope.membershipId,
          occurredAt: new Date(input.occurredAt), recordedAt: this.now(), baseTaskVersion, payloadFingerprint,
          taskTitleSnapshot: task.title, plannedLocalDateSnapshot: task.plannedLocalDate,
        }, include: { season: { include: { snapshot: true, plan: true, business: { select: { timezone: true } } } } } });
        return { kind: "accepted", completion: this.toPublic(row) };
      }, { isolationLevel: "ReadCommitted" });
    } catch (error) {
      if (error instanceof TaskCompletionError || error instanceof BusinessScopeForbiddenError || error instanceof NotFoundException) throw error;
      if (this.isUniqueViolation(error)) return this.recoverUniqueConflict(identity, scope, taskId, input, payloadFingerprint);
      throw error;
    }
  }

  async readHistory(identity: VerifiedSubject, fieldId: string, filters: TaskCompletionHistoryFilters = {}): Promise<TaskCompletionHistoryPage> {
    if (!uuidPattern.test(fieldId) || (filters.seasonId !== undefined && !uuidPattern.test(filters.seasonId))
      || (filters.limit !== undefined && (!Number.isSafeInteger(filters.limit) || filters.limit < 1 || filters.limit > 100))) {
      throw new TaskCompletionError("INVALID_REQUEST");
    }
    const scope = await this.membershipScope.resolveDefaultBusinessScope(identity);
    if (!scope) throw new BusinessScopeForbiddenError();
    const seasonId = filters.seasonId;
    const cursor = decodeHistoryCursor(filters.cursor, fieldId, seasonId);
    const [field, business] = await Promise.all([
      this.prisma.field.findFirst({ where: { id: fieldId, businessId: scope.businessId,
        business: { memberships: { some: { id: scope.membershipId, userId: scope.userId, status: "ACTIVE" } } } }, select: { id: true } }),
      this.prisma.business.findFirst({ where: { id: scope.businessId,
        memberships: { some: { id: scope.membershipId, userId: scope.userId, status: "ACTIVE" } } }, select: { timezone: true } }),
    ]);
    if (!field || !business) throw new NotFoundException();
    if (seasonId) {
      const season = await this.prisma.season.findFirst({ where: { id: seasonId, fieldId, businessId: scope.businessId }, select: { id: true } });
      if (!season) throw new NotFoundException();
    }
    const limit = filters.limit ?? 50;
    const rows = await this.prisma.taskCompletion.findMany({
      where: {
        fieldId, businessId: scope.businessId, ...(seasonId ? { seasonId } : {}),
        field: { business: { memberships: { some: { id: scope.membershipId, userId: scope.userId, status: "ACTIVE" } } } },
        ...(cursor ? { OR: [{ occurredAt: { lt: new Date(cursor.occurredAt) } }, { occurredAt: new Date(cursor.occurredAt), id: { lt: cursor.id } }] } : {}),
      },
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }], take: limit + 1,
      select: { id: true, plannedTaskId: true, seasonId: true, fieldId: true, occurredAt: true, plannedLocalDateSnapshot: true,
        taskTitleSnapshot: true, seasonPlan: { select: { source: true, templateVersionId: true } } },
    });
    const hasNext = rows.length > limit;
    const pageRows = rows.slice(0, limit);
    const timezone = resolveBusinessTimezone(business.timezone);
    const items = pageRows.map((row) => ({
      id: row.id, taskId: row.plannedTaskId, seasonId: row.seasonId, fieldId: row.fieldId,
      title: row.taskTitleSnapshot, plannedLocalDate: row.plannedLocalDateSnapshot.toISOString().slice(0, 10),
      occurredAt: row.occurredAt.toISOString(), sourceKind: row.seasonPlan.source as "MANUAL" | "VALIDATED_TEMPLATE",
      templateVersionId: row.seasonPlan.templateVersionId, businessTimezone: timezone,
    }));
    const last = pageRows.at(-1);
    return {
      items, businessTimezone: timezone,
      nextCursor: hasNext && last ? encodeHistoryCursor({ fieldId, seasonId: seasonId ?? null, occurredAt: last.occurredAt.toISOString(), id: last.id }) : null,
    };
  }

  /** Bounded canonical completion candidates for the mixed Field diary. */
  async readDiaryCandidates(identity: VerifiedSubject, fieldId: string, seasonId: string | undefined,
    after: TaskCompletionDiaryAfter | null, take: number): Promise<readonly Omit<TaskCompletionPublic, "businessTimezone">[]> {
    if (!uuidPattern.test(fieldId) || (seasonId !== undefined && !uuidPattern.test(seasonId))
      || !Number.isSafeInteger(take) || take < 1 || take > 101) throw new TaskCompletionError("INVALID_REQUEST");
    const scope = await this.membershipScope.resolveDefaultBusinessScope(identity);
    if (!scope) throw new BusinessScopeForbiddenError();
    const field = await this.prisma.field.findFirst({ where: { id: fieldId, businessId: scope.businessId,
      business: { memberships: { some: { id: scope.membershipId, userId: scope.userId, status: "ACTIVE" } } } }, select: { id: true } });
    if (!field) throw new NotFoundException();
    if (seasonId && !await this.prisma.season.findFirst({ where: { id: seasonId, fieldId, businessId: scope.businessId }, select: { id: true } })) throw new NotFoundException();
    const boundary = after ? new Date(after.occurredAt) : undefined;
    if (after && (!Number.isFinite(boundary!.getTime()) || !uuidPattern.test(after.id))) throw new TaskCompletionError("INVALID_REQUEST");
    const afterFilter = !after ? {} : { OR: [
      { occurredAt: { lt: boundary } },
      ...(after.kind === "OBSERVATION" ? [{ occurredAt: boundary }] : [{ occurredAt: boundary, id: { lt: after.id } }]),
    ] };
    const rows = await this.prisma.taskCompletion.findMany({
      where: { fieldId, businessId: scope.businessId, ...(seasonId ? { seasonId } : {}),
        field: { business: { memberships: { some: { id: scope.membershipId, userId: scope.userId, status: "ACTIVE" } } } },
        ...afterFilter },
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }], take,
      select: { id: true, plannedTaskId: true, seasonId: true, fieldId: true, occurredAt: true,
        plannedLocalDateSnapshot: true, taskTitleSnapshot: true, seasonPlan: { select: { source: true, templateVersionId: true } } },
    });
    return rows.map((row) => ({ id: row.id, taskId: row.plannedTaskId, seasonId: row.seasonId, fieldId: row.fieldId,
      title: row.taskTitleSnapshot, plannedLocalDate: row.plannedLocalDateSnapshot.toISOString().slice(0, 10),
      occurredAt: row.occurredAt.toISOString(), sourceKind: row.seasonPlan.source as "MANUAL" | "VALIDATED_TEMPLATE",
      templateVersionId: row.seasonPlan.templateVersionId }));
  }

  private async recoverUniqueConflict(identity: VerifiedSubject, scope: { userId: string; businessId: string; membershipId: string }, taskId: string,
    input: CompleteTaskInput, payloadFingerprint: string): Promise<TaskCompletionOutcome> {
    // The competing transaction may have won the completion-ID constraint while holding a different task lock.
    // Re-resolve current membership before any record lookup so a revoked actor cannot replay or inspect it.
    const current = await this.membershipScope.resolveDefaultBusinessScope(identity);
    if (!current || current.userId !== scope.userId || current.businessId !== scope.businessId || current.membershipId !== scope.membershipId) throw new BusinessScopeForbiddenError();
    return this.prisma.$transaction(async (tx) => {
      await this.lockAuthorizedContext(tx, current);
      const taskLock = await tx.$queryRaw<Array<{ id: string }>>`SELECT pt.id FROM planned_tasks pt
        JOIN season_plans sp ON sp.id = pt.season_plan_id JOIN seasons s ON s.id = sp.season_id
        WHERE pt.id = ${taskId}::uuid AND s.business_id = ${scope.businessId}::uuid FOR UPDATE OF s, sp, pt`;
      if (taskLock.length !== 1) throw new NotFoundException();
      const task = await tx.plannedTask.findFirst({ where: { id: taskId, seasonPlan: { season: { businessId: scope.businessId, field: { businessId: scope.businessId } } } }, select: { id: true, seasonPlan: { select: { seasonId: true, status: true, season: { select: { status: true, snapshot: true } } } } } });
      if (!task) throw new NotFoundException();
      const byId = await tx.taskCompletion.findUnique({ where: { id: input.completionId } });
      if (byId) {
        if (byId.plannedTaskId === taskId && byId.payloadFingerprint === payloadFingerprint && byId.actorUserId === scope.userId && byId.businessId === scope.businessId && byId.seasonId === task.seasonPlan.seasonId && task.seasonPlan.season.status === "ACTIVE" && task.seasonPlan.status === "APPROVED" && !!task.seasonPlan.season.snapshot) {
          const row = await tx.taskCompletion.findUniqueOrThrow({ where: { id: input.completionId }, include: { season: { include: { snapshot: true, plan: true, business: { select: { timezone: true } } } } } });
          return { kind: "replayed", completion: this.toPublic(row) };
        }
        throw new TaskCompletionError("IDEMPOTENCY_KEY_REUSED");
      }
      if (task.seasonPlan.season.status !== "ACTIVE" || task.seasonPlan.status !== "APPROVED" || !task.seasonPlan.season.snapshot) throw new TaskCompletionError("TASK_NOT_ACTIONABLE");
      const forTask = await tx.taskCompletion.findUnique({ where: { plannedTaskId: taskId } });
      if (forTask) throw new TaskCompletionError("TASK_ALREADY_COMPLETED");
      throw new TaskCompletionError("IDEMPOTENCY_KEY_REUSED");
    }, { isolationLevel: "ReadCommitted" });
  }

  private async lockAuthorizedContext(tx: Prisma.TransactionClient, scope: { userId: string; businessId: string; membershipId: string }): Promise<void> {
    const users = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM application_users
      WHERE id = ${scope.userId}::uuid AND default_business_id = ${scope.businessId}::uuid FOR UPDATE`;
    if (users.length !== 1) throw new BusinessScopeForbiddenError();
    const memberships = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM memberships
      WHERE id = ${scope.membershipId}::uuid AND user_id = ${scope.userId}::uuid
        AND business_id = ${scope.businessId}::uuid AND status = 'ACTIVE' FOR UPDATE`;
    if (memberships.length !== 1) throw new BusinessScopeForbiddenError();
  }

  private isUniqueViolation(error: unknown): boolean {
    return error instanceof PrismaRuntime.PrismaClientKnownRequestError && error.code === "P2002" ||
      !!error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "23505";
  }

  private toPublic(row: CompletionRow): TaskCompletionPublic {
    const source = row.season.plan?.source;
    if (source !== "MANUAL" && source !== "VALIDATED_TEMPLATE") throw new Error("Accepted completion has invalid plan source");
    return { id: row.id, taskId: row.plannedTaskId, seasonId: row.seasonId, fieldId: row.fieldId,
      title: row.taskTitleSnapshot, plannedLocalDate: row.plannedLocalDateSnapshot.toISOString().slice(0, 10),
      occurredAt: row.occurredAt.toISOString(), sourceKind: source, templateVersionId: row.season.snapshot?.templateVersionId ?? null,
      businessTimezone: row.season.snapshot?.businessTimezone ?? row.season.business.timezone ?? "Europe/Istanbul" };
  }
}
