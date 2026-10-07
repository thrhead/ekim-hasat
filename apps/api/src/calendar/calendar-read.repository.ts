import { randomUUID } from "node:crypto";
import { NotFoundException } from "@nestjs/common";
import type { VerifiedSubject } from "@ekim-hasat/domain/identity/auth-provider";
import { BusinessScopeForbiddenError, MembershipScopeService } from "../authorization/membership-scope.service.js";
import type { AuthorizedBusinessScope } from "../authorization/membership-scope.service.js";
import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import { CalendarCursorRepository } from "./calendar-cursor.repository.js";
import { resolveCalendarDates } from "./calendar-date.js";

export type CalendarTaskGroup = "selectedDateTasks" | "overdueTasks";

export type CalendarMonthIndicator = Readonly<{ date: string; hasWork: boolean }>;

export type CalendarTaskGroups<T> = Readonly<{
  selectedDateTasks: T[];
  overdueTasks: T[];
  monthIndicators: CalendarMonthIndicator[];
}>;

type CalendarTaskReadRow = {
  id: string;
  title: string;
  description: string | null;
  plannedLocalDate: Date;
  version: number;
  seasonPlan: {
    source: string;
    sourceSnapshot: Prisma.JsonValue;
    season: {
      id: string;
      fieldId: string;
      snapshot: { cropSnapshot: Prisma.JsonValue; regionContext: Prisma.JsonValue | null; source: string } | null;
      field: { id: string; name: string };
    };
  };
};

/** Partition captured task projections without changing their canonical planned dates. */
export function partitionCalendarProjectionRows<T extends { taskId: string; plannedLocalDate: string }>(
  rows: readonly T[],
  context: { selectedDate: string; businessLocalToday: string; monthStart: string; monthEnd: string },
): CalendarTaskGroups<T> {
  const ordered = [...rows].sort((left, right) =>
    left.plannedLocalDate.localeCompare(right.plannedLocalDate) || left.taskId.localeCompare(right.taskId));
  const overdueTasks: T[] = [];
  const selectedDateTasks: T[] = [];
  const datesWithWork = new Set(rows.map(({ plannedLocalDate }) => plannedLocalDate));

  for (const row of ordered) {
    if (row.plannedLocalDate < context.businessLocalToday) overdueTasks.push(row);
    else if (row.plannedLocalDate === context.selectedDate) selectedDateTasks.push(row);
  }

  const monthIndicators: CalendarMonthIndicator[] = [];
  const start = new Date(`${context.monthStart}T00:00:00.000Z`);
  const end = new Date(`${context.monthEnd}T00:00:00.000Z`);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start > end) {
    throw new Error("Calendar month boundaries are invalid");
  }
  for (const cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const date = cursor.toISOString().slice(0, 10);
    monthIndicators.push({ date, hasWork: datesWithWork.has(date) });
  }

  return { selectedDateTasks, overdueTasks, monthIndicators };
}

/** Canonical Calendar eligibility query; authority is always resolved from the verified identity. */
export class CalendarReadRepository {
  private readonly membershipScope: MembershipScopeService;

  constructor(
    private readonly prisma: PrismaClient,
    membershipScope?: MembershipScopeService,
  ) {
    this.membershipScope = membershipScope ?? new MembershipScopeService(prisma);
  }

  async readEligibleTasks(
    identity: VerifiedSubject,
    options: { fieldId?: string; transactionClient?: Prisma.TransactionClient } = {},
  ): Promise<{ scope: AuthorizedBusinessScope; tasks: CalendarTaskReadRow[] }> {
    const scope = await this.membershipScope.resolveDefaultBusinessScope(identity, options.transactionClient);
    if (!scope) throw new BusinessScopeForbiddenError();
    const db = options.transactionClient ?? this.prisma;

    if (options.fieldId !== undefined) {
      const field = await db.field.findFirst({
        where: { id: options.fieldId, businessId: scope.businessId },
        select: { id: true },
      });
      if (!field) throw new NotFoundException();
    }

    const tasks = await db.plannedTask.findMany({
      where: {
        completion: null,
        seasonPlan: {
          is: {
            status: "APPROVED",
            season: {
              is: {
                businessId: scope.businessId,
                ...(options.fieldId === undefined ? {} : { fieldId: options.fieldId }),
                status: "ACTIVE",
                field: { is: { businessId: scope.businessId } },
              },
            },
          },
        },
      },
      orderBy: [{ plannedLocalDate: "asc" }, { id: "asc" }],
      select: {
        id: true,
        title: true,
        description: true,
        plannedLocalDate: true,
        version: true,
        seasonPlan: {
          select: {
            source: true,
            sourceSnapshot: true,
            season: {
              select: {
                id: true,
                fieldId: true,
                snapshot: { select: { cropSnapshot: true, regionContext: true, source: true } },
                field: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
    });
    return { scope, tasks: tasks as CalendarTaskReadRow[] };
  }

  async createRead(
    identity: VerifiedSubject,
    request: { selectedDate?: string; fieldId?: string },
  ) {
    return this.prisma.$transaction(async (tx) => {
      const [clock] = await tx.$queryRaw<Array<{ asOf: Date }>>`SELECT statement_timestamp() AS "asOf"`;
      if (!clock?.asOf || !Number.isFinite(clock.asOf.getTime())) throw new Error("Calendar snapshot clock failed");
      const asOf = clock.asOf;

      await tx.$executeRaw`WITH expired AS (
        SELECT read_id FROM calendar_read_snapshots
        WHERE expires_at <= ${asOf}
        ORDER BY expires_at ASC
        LIMIT 20
        FOR UPDATE SKIP LOCKED
      )
      DELETE FROM calendar_read_snapshots parent USING expired
      WHERE parent.read_id = expired.read_id`;

      const scope = await this.membershipScope.resolveDefaultBusinessScope(identity, tx);
      if (!scope) throw new BusinessScopeForbiddenError();
      const business = await tx.business.findFirst({
        where: {
          id: scope.businessId,
          memberships: { some: { id: scope.membershipId, userId: scope.userId, status: "ACTIVE" } },
        },
        select: { timezone: true },
      });
      if (!business) throw new BusinessScopeForbiddenError();

      const dateContext = resolveCalendarDates({
        selectedDate: request.selectedDate,
        timezone: business.timezone,
        asOf,
      });
      const { tasks } = await this.readEligibleTasks(identity, {
        ...(request.fieldId === undefined ? {} : { fieldId: request.fieldId }),
        transactionClient: tx,
      });
      const projected = tasks.map((task) => ({
        taskId: task.id,
        title: task.title,
        description: task.description,
        plannedLocalDate: task.plannedLocalDate.toISOString().slice(0, 10),
        taskVersion: task.version,
        fieldId: task.seasonPlan.season.fieldId,
        fieldName: task.seasonPlan.season.field.name,
        seasonId: task.seasonPlan.season.id,
        seasonContext: {
          source: task.seasonPlan.season.snapshot?.source ?? null,
          crop: task.seasonPlan.season.snapshot?.cropSnapshot ?? {},
          region: task.seasonPlan.season.snapshot?.regionContext ?? null,
        },
        planContext: { source: task.seasonPlan.source, approvedPlan: task.seasonPlan.sourceSnapshot },
        overdue: dateContext.isOverdue(task.plannedLocalDate.toISOString().slice(0, 10)),
      }));
      const groups = partitionCalendarProjectionRows(projected, dateContext);
      const fieldScopeIds = request.fieldId
        ? [request.fieldId]
        : (await tx.field.findMany({ where: { businessId: scope.businessId }, select: { id: true }, orderBy: { id: "asc" } })).map(({ id }) => id);
      const activeSeasonExists = (await tx.season.count({
        where: {
          businessId: scope.businessId,
          status: "ACTIVE",
          ...(request.fieldId === undefined ? {} : { fieldId: request.fieldId }),
        },
      })) > 0;

      const readId = randomUUID();
      const expiresAt = new Date(asOf.getTime() + 15 * 60_000);
      const fieldScopeKind = request.fieldId === undefined ? "ALL_AUTHORIZED" : "ONE_FIELD";
      const readScope = {
        businessId: scope.businessId,
        asOf: asOf.toISOString(),
        businessTimezone: dateContext.timezone,
        businessLocalToday: dateContext.businessLocalToday,
        selectedDate: dateContext.selectedDate,
        monthStart: dateContext.monthStart,
        monthEnd: dateContext.monthEnd,
        fieldScope: {
          mode: request.fieldId === undefined ? "allAuthorized" : "oneField",
          ...(request.fieldId === undefined ? {} : { fieldId: request.fieldId }),
          includedFieldIds: fieldScopeIds,
        },
      };
      const parent = await tx.calendarReadSnapshot.create({
        data: {
          readId,
          userId: scope.userId,
          membershipId: scope.membershipId,
          businessId: scope.businessId,
          fieldScopeKind,
          fieldId: request.fieldId,
          includedFieldIds: fieldScopeIds,
          selectedDate: new Date(`${dateContext.selectedDate}T00:00:00.000Z`),
          businessTimezone: dateContext.timezone,
          businessLocalToday: new Date(`${dateContext.businessLocalToday}T00:00:00.000Z`),
          monthStart: new Date(`${dateContext.monthStart}T00:00:00.000Z`),
          monthEnd: new Date(`${dateContext.monthEnd}T00:00:00.000Z`),
          queryVersion: "SPEC-007-v1",
          monthIndicators: groups.monthIndicators,
          asOf,
          expiresAt,
          state: "READY",
        },
      });

      const taskRows = [...groups.selectedDateTasks.map((task) => ({ ...task, group: "selectedDateTasks" })),
        ...groups.overdueTasks.map((task) => ({ ...task, group: "overdueTasks" }))];
      if (taskRows.length) {
        await tx.calendarReadSnapshotTask.createMany({
          data: taskRows.map((task) => ({
            readId,
            group: task.group,
            taskId: task.taskId,
            title: task.title,
            description: task.description,
            plannedLocalDate: new Date(`${task.plannedLocalDate}T00:00:00.000Z`),
            taskVersion: task.taskVersion,
            fieldId: task.fieldId,
            fieldName: task.fieldName,
            seasonId: task.seasonId,
            seasonContext: task.seasonContext,
            planContext: task.planContext,
            overdue: task.overdue,
          })),
        });
      }

      const cursorRepository = new CalendarCursorRepository(tx);
      const toPage = async (group: CalendarTaskGroup, items: typeof projected) => {
        const hasMore = items.length > 50;
        const pageItems = items.slice(0, 50);
        const last = pageItems.at(-1);
        const nextCursor = hasMore && last
          ? await cursorRepository.issue(readId, group, { plannedLocalDate: last.plannedLocalDate, taskId: last.taskId })
          : undefined;
        return {
          readId,
          readScope,
          group,
          items: pageItems.map((task) => ({
            taskId: task.taskId,
            title: task.title,
            plannedLocalDate: task.plannedLocalDate,
            fieldId: task.fieldId,
            fieldName: task.fieldName,
            seasonId: task.seasonId,
            seasonContext: JSON.stringify(task.seasonContext),
            planContext: JSON.stringify(task.planContext),
            taskVersion: task.taskVersion,
            overdue: task.overdue,
          })),
          complete: !hasMore,
          ...(nextCursor === undefined ? {} : { nextCursor }),
        };
      };

      return {
        readId: parent.readId,
        asOf: parent.asOf.toISOString(),
        expiresAt: parent.expiresAt.toISOString(),
        businessId: scope.businessId,
        businessTimezone: dateContext.timezone,
        businessLocalToday: dateContext.businessLocalToday,
        selectedDate: dateContext.selectedDate,
        monthStart: dateContext.monthStart,
        monthEnd: dateContext.monthEnd,
        fieldScope: readScope.fieldScope,
        activeSeasonExists,
        hasAnyUnfinishedWork: projected.length > 0,
        monthIndicators: groups.monthIndicators,
        monthIndicatorsComplete: true as const,
        selectedDateTasksPage: await toPage("selectedDateTasks", groups.selectedDateTasks),
        overdueTasksPage: await toPage("overdueTasks", groups.overdueTasks),
      };
    }, { isolationLevel: "RepeatableRead" });
  }
}
