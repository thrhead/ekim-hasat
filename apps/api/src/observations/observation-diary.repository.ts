import { ForbiddenException } from "@nestjs/common";
import type { VerifiedSubject } from "@ekim-hasat/domain/identity/auth-provider";
import type { PrismaClient } from "../generated/prisma/client.js";
import { MembershipScopeService } from "../authorization/membership-scope.service.js";
import { ApiError } from "../observability/api-error.filter.js";
import { resolveBusinessTimezone } from "../seasons/business-timezone.js";
import { TaskCompletionRepository } from "../tasks/task-completion.repository.js";
import { TaskSkipRepository } from "../tasks/task-skip.repository.js";
import type { ObservationDiaryFilters, ObservationDiaryPage } from "./observation.controller.js";
import { decodeDiaryCursor, diaryLimit, pageDiaryCandidates, type DiaryEntry, type DiarySortKey, type DiaryV2Cursor } from "./diary-query.js";
import { ExpenseDiaryReader } from "../finance/expense-diary-reader.js";

export class ObservationDiaryRepository {
  private readonly membershipScope: MembershipScopeService;
  private readonly expenses: ExpenseDiaryReader;

  constructor(private readonly prisma: PrismaClient, private readonly taskCompletions: TaskCompletionRepository, private readonly taskSkips?: TaskSkipRepository) {
    this.membershipScope = new MembershipScopeService(prisma);
    this.expenses = new ExpenseDiaryReader(prisma);
  }

  async read(identity: VerifiedSubject, fieldId: string, filters: ObservationDiaryFilters = {}): Promise<ObservationDiaryPage> {
    const limit = diaryLimit(filters.limit);
    const seasonId = filters.seasonId;
    let cursor: DiarySortKey | null = filters.includeExpenses
      ? null : decodeDiaryCursor(filters.cursor, fieldId, seasonId ?? null, filters.includeIrrigation === true);
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

    const businessTimezone = resolveBusinessTimezone(field.business.timezone);
    if (filters.includeExpenses) {
      cursor = decodeDiaryCursor(filters.cursor, fieldId, seasonId ?? null, filters.includeIrrigation === true, true, businessTimezone);
    }
    const v1Cursor = cursor?.version === 1 ? cursor : null;
    const v2Cursor = cursor?.version === 2 ? cursor : null;
    const timestampAfter = v2Cursor ? v2TimestampAfter(v2Cursor, businessTimezone) : v1Cursor;

    const observationAfter = diaryTimestampFilter(timestampAfter, "OBSERVATION");
    const [observations, completions, skips, irrigationRecords] = await Promise.all([
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
      this.taskCompletions.readDiaryCandidates(identity, fieldId, seasonId, timestampAfter ? {
        occurredAt: timestampAfter.occurredAt, kind: timestampAfter.kind, id: timestampAfter.id,
      } : null, limit + 1),
      this.taskSkips?.readDiaryCandidates(identity, fieldId, seasonId, timestampAfter ? {
        occurredAt: timestampAfter.occurredAt, kind: timestampAfter.kind, id: timestampAfter.id,
      } : null, limit + 1) ?? Promise.resolve([]),
      filters.includeIrrigation ? this.prisma.irrigationRecord.findMany({
        where: { businessId: scope.businessId, fieldId,
          field: { business: { memberships: { some: { id: scope.membershipId, userId: scope.userId, status: "ACTIVE" } } } },
          ...(seasonId ? { seasonId } : {}),
          ...diaryTimestampFilter(timestampAfter, "IRRIGATION") },
        orderBy: [{ occurredAt: "desc" }, { id: "desc" }], take: limit + 1,
        select: { id: true, fieldId: true, seasonId: true, occurredAt: true, recordedAt: true,
          method: true, durationMinutes: true, waterVolumeCubicMetres: true, note: true },
      }) : Promise.resolve([]),
    ]);
    const expenseRows = filters.includeExpenses
      ? await this.expenses.readDiaryCandidates(identity, fieldId, seasonId, v2Cursor, limit + 1)
      : [];
    const entries: DiaryEntry[] = [
      ...observations.map((row) => ({ kind: "OBSERVATION" as const, id: row.id, fieldId: row.fieldId,
        seasonId: row.seasonId, description: row.description, occurredAt: row.occurredAt.toISOString() })),
      ...completions.map((row) => ({ kind: "TASK_COMPLETION" as const, ...row })),
      ...skips,
      ...irrigationRecords.map((row) => ({ kind: "IRRIGATION" as const, id: row.id, fieldId: row.fieldId,
        seasonId: row.seasonId, occurredAt: row.occurredAt.toISOString(), businessTimezone,
        method: row.method, durationMinutes: row.durationMinutes,
        waterVolumeCubicMetres: row.waterVolumeCubicMetres?.toFixed(1) ?? null,
        note: row.note, recordedAt: row.recordedAt.toISOString() })),
      ...expenseRows,
    ];
    const page = pageDiaryCandidates(entries, limit, fieldId, seasonId ?? null, cursor, filters.includeIrrigation === true,
      filters.includeExpenses === true, businessTimezone);
    return { items: [...page.items], nextCursor: page.nextCursor, businessTimezone };
  }
}

const lowerBoundUuid = "00000000-0000-4000-8000-000000000000";
type TimestampAfter = Readonly<{ occurredAt: string; kind: "IRRIGATION" | "OBSERVATION" | "TASK_COMPLETION" | "TASK_SKIPPED"; id: string }>;

function diaryTimestampFilter(after: TimestampAfter | null, sourceKind: TimestampAfter["kind"]): object {
  if (!after) return {};
  const boundary = new Date(after.occurredAt);
  const kindOrder = sourceKind.localeCompare(after.kind);
  return { OR: [
    { occurredAt: { lt: boundary } },
    ...(kindOrder > 0 ? [{ occurredAt: boundary }] : kindOrder === 0 ? [{ occurredAt: boundary, id: { lt: after.id } }] : []),
  ] };
}

function v2TimestampAfter(cursor: DiaryV2Cursor, timezone: string): TimestampAfter {
  if (cursor.precision === "TIMED") return { occurredAt: cursor.occurredAt!, kind: cursor.kind as TimestampAfter["kind"], id: cursor.id };
  return { occurredAt: localDateStart(cursor.localDate, timezone).toISOString(), kind: "TASK_SKIPPED", id: lowerBoundUuid };
}

function localDateStart(localDate: string, timezone: string): Date {
  const [year, month, day] = localDate.split("-").map(Number);
  const target = Date.UTC(year!, month! - 1, day!);
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  for (let offset = -14 * 60; offset <= 14 * 60; offset++) {
    const candidate = new Date(target + offset * 60_000);
    const parts = Object.fromEntries(formatter.formatToParts(candidate).map(({ type, value }) => [type, value]));
    if (parts.year === String(year).padStart(4, "0") && parts.month === String(month).padStart(2, "0")
      && parts.day === String(day).padStart(2, "0") && parts.hour === "00" && parts.minute === "00" && parts.second === "00") return candidate;
  }
  throw new Error("Business-local date has no midnight boundary");
}

function forbidden(): ApiError { return new ApiError(403, "FORBIDDEN", "This request is not available"); }
function notFound(): ApiError { return new ApiError(404, "NOT_FOUND", "The requested item is not available"); }
