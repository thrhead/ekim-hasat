import { NotFoundException } from "@nestjs/common";
import type { VerifiedSubject } from "@ekim-hasat/domain/identity/auth-provider";
import { selectValidatedTemplate, type PublishedTemplateVersion, type TemplateQualityDiagnostic } from "@ekim-hasat/domain/seasons/template-selection";
import type { PrismaClient, Prisma } from "../generated/prisma/client.js";
import { BusinessScopeForbiddenError, MembershipScopeService, type AuthorizedBusinessScope } from "../authorization/membership-scope.service.js";
import { getRequestContext } from "../observability/request-context.js";
import type { SeasonSetupOptionsResponse, SeasonSetupResponse } from "./seasons-read.controller.js";

export const seasonSetupInclude = { cropDefinitionVersion: true, customCrop: true, plan: { include: { tasks: { orderBy: { id: "asc" as const } } } } } satisfies Prisma.SeasonInclude;
export type SeasonSetupRow = Prisma.SeasonGetPayload<{ include: typeof seasonSetupInclude }>;

/** Shared transport projection for reads and transactional create outcomes. */
export function seasonRecordToResponse(row: SeasonSetupRow): SeasonSetupResponse {
  if (!row.plan) throw new Error("Season plan is missing");
  const cropDisplayName = row.cropDefinitionVersion?.displayName ?? row.customCrop?.displayName;
  if (!cropDisplayName || !["MANUAL", "VALIDATED_TEMPLATE"].includes(row.plan.source)) throw new Error("Season source integrity failure");
  const record = {
    id: row.id, fieldId: row.fieldId, cropDisplayName,
    sowingPlantingDate: row.actualPlantingDate.toISOString().slice(0, 10), version: row.version,
    plan: {
      source: row.plan.source === "MANUAL"
        ? { kind: "MANUAL" as const, validationLabel: "NOT_CENTRALLY_VALIDATED" as const, templateVersionId: null }
        : { kind: "VALIDATED_TEMPLATE" as const, validationLabel: "CENTRALLY_VALIDATED" as const, templateVersionId: row.plan.templateVersionId },
      tasks: row.plan.tasks.map((task) => ({ id: task.id, title: task.title,
        ...(task.description === null ? {} : { description: task.description }),
        plannedLocalDate: task.plannedLocalDate.toISOString().slice(0, 10), version: task.version })),
    },
  };
  if (row.status === "DRAFT") return { ...record, status: "DRAFT" };
  if (row.status === "ACTIVE" && row.activatedAt) return { ...record, status: "ACTIVE", activatedAt: row.activatedAt.toISOString() };
  throw new Error("Season state integrity failure");
}

export function toPublishedTemplate(row: Prisma.ValidatedTemplateVersionGetPayload<Record<string, never>>): PublishedTemplateVersion {
  if (!Array.isArray(row.taskDefinitions)) throw new Error("Template definitions are invalid");
  const taskDefinitions = row.taskDefinitions.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)
      || typeof value.key !== "string" || typeof value.title !== "string"
      || typeof value.offsetDays !== "number" || !Number.isInteger(value.offsetDays)
      || (value.description !== undefined && value.description !== null && typeof value.description !== "string")) throw new Error("Template task definition is invalid");
    return { key: value.key, title: value.title, offsetDays: value.offsetDays,
      ...(value.description === undefined ? {} : { description: value.description as string | null }) };
  });
  return { id: row.id, templateKey: row.templateKey, version: row.version,
    cropDefinitionVersionId: row.cropDefinitionVersionId, regionSelector: row.regionSelector,
    published: row.published, available: row.available, taskDefinitions };
}

/** Emits immutable public-content identifiers only, never farmer or business data. */
export function reportTemplateQualityDiagnostic(diagnostic: TemplateQualityDiagnostic): void {
  console.error(JSON.stringify({ event: "seasons.template_content_quality", ...diagnostic,
    ...(getRequestContext() ? { correlationId: getRequestContext()!.correlationId } : {}) }));
}

export class SeasonReadRepository {
  private readonly membershipScope: MembershipScopeService;
  constructor(private readonly prisma: PrismaClient, private readonly onDiagnostic: (diagnostic: TemplateQualityDiagnostic) => void = reportTemplateQualityDiagnostic) {
    this.membershipScope = new MembershipScopeService(prisma);
  }

  private async authorizedScope(identity: VerifiedSubject): Promise<AuthorizedBusinessScope> {
    const scope = await this.membershipScope.resolveDefaultBusinessScope(identity);
    if (!scope) throw new BusinessScopeForbiddenError();
    return scope;
  }

  async readOptions(identity: VerifiedSubject, fieldId: string): Promise<SeasonSetupOptionsResponse> {
    const scope = await this.authorizedScope(identity);
    const field = await this.prisma.field.findFirst({ where: { id: fieldId, businessId: scope.businessId,
      business: { memberships: { some: { id: scope.membershipId, userId: scope.userId, status: "ACTIVE" } } } }, select: { id: true } });
    if (!field) throw new NotFoundException();
    const crops = await this.prisma.cropDefinitionVersion.findMany({ where: { selectable: true }, orderBy: { id: "asc" }, include: { templates: { where: { published: true, available: true } } } });
    return { fieldId: field.id, customCropAllowed: true, crops: crops.map((crop) => {
      // SPEC-001 point fields have no resolved region. Only generic content applies.
      const selected = selectValidatedTemplate({ kind: "CENTRAL", cropKey: crop.cropKey,
        cropDefinitionVersionId: crop.id, displayName: crop.displayName }, null, crop.templates.map(toPublishedTemplate), this.onDiagnostic);
      if (selected.availability === "AMBIGUOUS_TEMPLATE_VERSIONS") throw new Error("Template applicability is ambiguous");
      return { id: crop.id, displayName: crop.displayName, source: "CENTRAL" as const,
        templateAvailability: selected.availability, manualPlanAllowed: selected.availability !== "AVAILABLE" };
    }) };
  }

  async readSeason(identity: VerifiedSubject, seasonId: string): Promise<SeasonSetupResponse> {
    const scope = await this.authorizedScope(identity);
    const season = await this.prisma.season.findFirst({ where: { id: seasonId, businessId: scope.businessId,
      field: { businessId: scope.businessId }, business: { memberships: { some: { id: scope.membershipId, userId: scope.userId, status: "ACTIVE" } } } }, include: seasonSetupInclude });
    if (!season) throw new NotFoundException();
    return seasonRecordToResponse(season);
  }
}
