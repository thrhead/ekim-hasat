import { ForbiddenException } from "@nestjs/common";
import type { VerifiedSubject } from "@ekim-hasat/domain/identity/auth-provider";
import type { PrismaClient } from "../generated/prisma/client.js";
import { MembershipScopeService } from "../authorization/membership-scope.service.js";
import { ApiError } from "../observability/api-error.filter.js";
import { resolveBusinessTimezone } from "../seasons/business-timezone.js";
import { TaskCompletionRepository } from "../tasks/task-completion.repository.js";
import type { ObservationDiaryFilters, ObservationDiaryPage } from "./observation.controller.js";
import { decodeDiaryCursor, diaryLimit, pageDiaryCandidates, type DiaryEntry } from "./diary-query.js";

export class ObservationDiaryRepository {
  private readonly membershipScope: MembershipScopeService;

  constructor(private readonly prisma: PrismaClient, private readonly taskCompletions: TaskCompletionRepository) {
    this.membershipScope = new MembershipScopeService(prisma);
  }

  async read(identity: VerifiedSubject, fieldId: string, filters: ObservationDiaryFilters = {}): Promise<ObservationDiaryPage> {
    const limit = diaryLimit(filters.limit);
    const seasonId = filters.seasonId;
    const cursor = decodeDiaryCursor(filters.cursor, fieldId, seasonId ?? null);
    let scope;
    try { scope = await this.membershipScope.resolveDefaultBusinessScope(identity); }
    catch (error) { if (error instanceof ForbiddenException) throw forbidden(); throw error; }
    if (!scope) throw forbidden();
    const field = await this.prisma.field.findFirst({
      where: { id: fieldId, businessId: scope.businessId,
        business: { memberships: { some: { id: scope.membershipId, userId: scope.userId, status: "ACTIVE" } } } },
      select: { id: true, business: { select: { timezone: true } } },
    });
    if (!field) throw notFound();
    if (seasonId && !await this.prisma.season.findFirst({ where: { id: seasonId, fieldId, businessId: scope.businessId }, select: { id: true } })) throw notFound();

    const observationAfter = !cursor ? {} : { OR: [
      { occurredAt: { lt: new Date(cursor.occurredAt) } },
      ...(cursor.kind === "OBSERVATION" ? [{ occurredAt: new Date(cursor.occurredAt), id: { lt: cursor.id } }] : []),
    ] };
    const [observations, completions] = await Promise.all([
      this.prisma.fieldObservation.findMany({
        where: {
          businessId: scope.businessId,
          fieldId,
          field: { business: { memberships: { some: { id: scope.membershipId, userId: scope.userId, status: "ACTIVE" } } } },
          ...(seasonId ? { seasonId } : {}),
          ...observationAfter,
        },
        orderBy: [{ occurredAt: "desc" }, { id: "desc" }], take: limit + 1,
        select: { id: true, fieldId: true, seasonId: true, description: true, occurredAt: true },
      }),
      this.taskCompletions.readDiaryCandidates(identity, fieldId, seasonId, cursor ? {
        occurredAt: cursor.occurredAt, kind: cursor.kind, id: cursor.id,
      } : null, limit + 1),
    ]);
    const entries: DiaryEntry[] = [
      ...observations.map((row) => ({ kind: "OBSERVATION" as const, id: row.id, fieldId: row.fieldId,
        seasonId: row.seasonId, description: row.description, occurredAt: row.occurredAt.toISOString() })),
      ...completions.map((row) => ({ kind: "TASK_COMPLETION" as const, ...row })),
    ];
    const page = pageDiaryCandidates(entries, limit, fieldId, seasonId ?? null, cursor);
    return { items: [...page.items], nextCursor: page.nextCursor, businessTimezone: resolveBusinessTimezone(field.business.timezone) };
  }
}

function forbidden(): ApiError { return new ApiError(403, "FORBIDDEN", "This request is not available"); }
function notFound(): ApiError { return new ApiError(404, "NOT_FOUND", "The requested item is not available"); }
