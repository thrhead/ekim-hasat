import { NotFoundException } from "@nestjs/common";
import type { VerifiedSubject } from "@ekim-hasat/domain/identity/auth-provider";
import type { PrismaClient } from "../generated/prisma/client.js";
import { BusinessScopeForbiddenError, MembershipScopeService } from "../authorization/membership-scope.service.js";
import type { TodayPlannedTasksResponse } from "./today.controller.js";

export const FALLBACK_BUSINESS_TIMEZONE = "Europe/Istanbul";

export function businessLocalDate(now: Date, timezone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
    const part = (type: string) => parts.find((value) => value.type === type)!.value;
    return `${part("year")}-${part("month")}-${part("day")}`;
  } catch { throw new Error("Configured business timezone is invalid"); }
}

function dateScalar(localDate: string): Date { return new Date(`${localDate}T00:00:00.000Z`); }

export class TodayRepository {
  private readonly membershipScope: MembershipScopeService;
  constructor(private readonly prisma: PrismaClient, private readonly now: () => Date = () => new Date()) {
    this.membershipScope = new MembershipScopeService(prisma);
  }

  async readToday(identity: VerifiedSubject): Promise<TodayPlannedTasksResponse> {
    const scope = await this.membershipScope.resolveDefaultBusinessScope(identity);
    if (!scope) throw new BusinessScopeForbiddenError();
    const business = await this.prisma.business.findFirst({ where: { id: scope.businessId,
      memberships: { some: { id: scope.membershipId, userId: scope.userId, status: "ACTIVE" } } }, select: { timezone: true } });
    if (!business) throw new NotFoundException();
    const timezone = business.timezone || FALLBACK_BUSINESS_TIMEZONE;
    const localDate = businessLocalDate(this.now(), timezone);
    const tasks = await this.prisma.plannedTask.findMany({ where: { plannedLocalDate: dateScalar(localDate), seasonPlan: {
      season: { businessId: scope.businessId, status: "ACTIVE", plan: { status: "APPROVED" }, field: { businessId: scope.businessId }, business: {
        memberships: { some: { id: scope.membershipId, userId: scope.userId, status: "ACTIVE" } },
      } },
    } }, orderBy: [{ plannedLocalDate: "asc" }, { id: "asc" }], select: {
      id: true, title: true, plannedLocalDate: true, seasonPlan: { select: { source: true, season: { select: {
        id: true, fieldId: true, cropDefinitionVersion: { select: { displayName: true } }, customCrop: { select: { displayName: true } },
      } } } },
    } });
    return { localDate, tasks: tasks.map((task) => {
      const season = task.seasonPlan.season;
      const cropDisplayName = season.cropDefinitionVersion?.displayName ?? season.customCrop?.displayName;
      if (!cropDisplayName || !["MANUAL", "VALIDATED_TEMPLATE"].includes(task.seasonPlan.source)) throw new Error("Today task integrity failure");
      return { id: task.id, seasonId: season.id, fieldId: season.fieldId, cropDisplayName, title: task.title,
        plannedLocalDate: task.plannedLocalDate.toISOString().slice(0, 10), sourceKind: task.seasonPlan.source as "MANUAL" | "VALIDATED_TEMPLATE" };
    }) };
  }
}
