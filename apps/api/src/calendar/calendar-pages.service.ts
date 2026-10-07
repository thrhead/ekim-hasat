import { ForbiddenException, GoneException, NotFoundException } from "@nestjs/common";
import type { VerifiedSubject } from "@ekim-hasat/domain/identity/auth-provider";
import { BusinessScopeForbiddenError, MembershipScopeService } from "../authorization/membership-scope.service.js";
import { Prisma, type PrismaClient } from "../generated/prisma/client.js";
import { ApiError } from "../observability/api-error.filter.js";
import { CalendarCursorRepository } from "./calendar-cursor.repository.js";
import type { CalendarTaskGroup } from "./calendar-read.repository.js";

type CalendarPageRequest = Readonly<{
  readId: string;
  group: CalendarTaskGroup;
  cursor: string;
}>;

export class CalendarPagesService {
  private readonly membershipScope: MembershipScopeService;
  private readonly now: () => Date;

  constructor(
    private readonly prisma: PrismaClient,
    membershipScope?: MembershipScopeService,
    options: { now?: () => Date } = {},
  ) {
    this.membershipScope = membershipScope ?? new MembershipScopeService(prisma);
    this.now = options.now ?? (() => new Date());
  }

  async read(identity: VerifiedSubject, request: CalendarPageRequest) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT statement_timestamp()`;
      const scope = await this.membershipScope.resolveDefaultBusinessScope(identity, tx);
      if (!scope) throw new BusinessScopeForbiddenError();

      const parent = await tx.calendarReadSnapshot.findUnique({ where: { readId: request.readId } });
      if (!parent || parent.userId !== scope.userId || parent.membershipId !== scope.membershipId || parent.businessId !== scope.businessId) {
        throw new NotFoundException();
      }
      if (parent.state !== "READY" || parent.expiresAt.getTime() <= this.now().getTime()) throw new GoneException();

      if (parent.fieldScopeKind === "ONE_FIELD") {
        if (!parent.fieldId) throw new NotFoundException();
        const field = await tx.field.findFirst({
          where: { id: parent.fieldId, businessId: scope.businessId },
          select: { id: true },
        });
        if (!field) throw new ForbiddenException();
      }

      const cursors = new CalendarCursorRepository(tx);
      const position = await cursors.resolve(request.readId, request.group, request.cursor);
      if (!position) throw new ApiError(400, "INVALID_REQUEST", "Calendar page cursor is invalid");

      const rows = await tx.calendarReadSnapshotTask.findMany({
        where: {
          readId: request.readId,
          group: request.group,
          OR: [
            { plannedLocalDate: { gt: dateScalar(position.plannedLocalDate) } },
            { plannedLocalDate: dateScalar(position.plannedLocalDate), taskId: { gt: position.taskId } },
          ],
        },
        orderBy: [{ plannedLocalDate: "asc" }, { taskId: "asc" }],
        take: 51,
      });
      const hasMore = rows.length > 50;
      const pageRows = hasMore ? rows.slice(0, 50) : rows;
      const last = pageRows.at(-1);
      const nextCursor = hasMore && last
        ? await cursors.issue(request.readId, request.group, {
          plannedLocalDate: last.plannedLocalDate.toISOString().slice(0, 10),
          taskId: last.taskId,
        })
        : undefined;

      const includedFieldIds = Array.isArray(parent.includedFieldIds)
        ? parent.includedFieldIds.filter((id): id is string => typeof id === "string")
        : [];
      const fieldScope = {
        mode: parent.fieldScopeKind === "ONE_FIELD" ? "oneField" : "allAuthorized",
        ...(parent.fieldId === null ? {} : { fieldId: parent.fieldId }),
        includedFieldIds,
      };
      const readScope = {
        businessId: parent.businessId,
        asOf: parent.asOf.toISOString(),
        businessTimezone: parent.businessTimezone,
        businessLocalToday: parent.businessLocalToday.toISOString().slice(0, 10),
        selectedDate: parent.selectedDate.toISOString().slice(0, 10),
        monthStart: parent.monthStart.toISOString().slice(0, 10),
        monthEnd: parent.monthEnd.toISOString().slice(0, 10),
        fieldScope,
      };
      return {
        readId: request.readId,
        readScope,
        group: request.group,
        requestedCursor: request.cursor,
        items: pageRows.map((row) => ({
          taskId: row.taskId,
          title: row.title,
          plannedLocalDate: row.plannedLocalDate.toISOString().slice(0, 10),
          fieldId: row.fieldId,
          fieldName: row.fieldName,
          seasonId: row.seasonId,
          seasonContext: JSON.stringify(row.seasonContext),
          planContext: JSON.stringify(row.planContext),
          ...(row.taskVersion === null ? {} : { taskVersion: row.taskVersion }),
          overdue: row.overdue,
        })),
        complete: !hasMore,
        ...(nextCursor === undefined ? {} : { nextCursor }),
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }
}

function dateScalar(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}
