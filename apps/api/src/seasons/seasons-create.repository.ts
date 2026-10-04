import { createHash, randomUUID } from "node:crypto";
import { NotFoundException } from "@nestjs/common";
import type { VerifiedSubject } from "@ekim-hasat/domain/identity/auth-provider";
import { CropSelectionError, createCustomCropReference, normalizeCustomCropDisplayName, selectCentralCrop } from "@ekim-hasat/domain/seasons/crop-selection";
import { LocalDateValidationError, validateActualPlantingDate, validateLocalDate } from "@ekim-hasat/domain/seasons/local-date";
import { prepareInitialPlan, selectValidatedTemplate, TemplateSelectionError } from "@ekim-hasat/domain/seasons/template-selection";
import type { components } from "@ekim-hasat/api-client/generated/seasons";
import type { PrismaClient, Prisma } from "../generated/prisma/client.js";
import { BusinessScopeForbiddenError, MembershipScopeService, type AuthorizedBusinessScope } from "../authorization/membership-scope.service.js";
import { SeasonCommandError } from "./seasons-command.error.js";
import { reportTemplateQualityDiagnostic, seasonRecordToResponse, seasonSetupInclude, toPublishedTemplate } from "./seasons-read.repository.js";
import type { SeasonSetupResponse } from "./seasons-read.controller.js";

export type CreateSeasonCommand = components["schemas"]["CreateSeasonDraftRequest"];
export type SeasonCreateOutcome = { kind: "created" | "replayed" | "existing"; season: SeasonSetupResponse };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isObject(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function invalid(): never { throw new SeasonCommandError(400, "INVALID_REQUEST"); }
export function validateSeasonIdempotencyKey(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 200) invalid();
  return value;
}
/** Mirrors the additive OpenAPI boundary; no client business/template identity is accepted. */
export function validateCreateSeasonCommand(value: unknown): CreateSeasonCommand {
  if (!isObject(value) || Object.keys(value).some((key) => !["crop", "sowingPlantingDate", "planSource"].includes(key))) invalid();
  if (!isObject(value.crop) || Object.keys(value.crop).length !== 1) invalid();
  const crop = value.crop;
  if ("centralCropId" in crop) { if (typeof crop.centralCropId !== "string" || !uuid.test(crop.centralCropId)) invalid(); }
  else if ("customCropName" in crop) {
    if (typeof crop.customCropName !== "string" || !crop.customCropName || Array.from(crop.customCropName).length > 120) invalid();
    try { normalizeCustomCropDisplayName(crop.customCropName); } catch { invalid(); }
  } else invalid();
  if (value.planSource !== undefined && value.planSource !== "MANUAL") invalid();
  try { validateLocalDate(value.sowingPlantingDate); } catch { invalid(); }
  return value as CreateSeasonCommand;
}
function fingerprint(fieldId: string, command: CreateSeasonCommand): string {
  // Preserve exact command values, including raw custom name whitespace. JSON
  // property ordering is transport syntax and never changes command equality.
  return createHash("sha256").update(JSON.stringify({ fieldId, crop: command.crop,
    sowingPlantingDate: command.sowingPlantingDate, planSource: command.planSource ?? null })).digest("hex");
}
function dateScalar(value: string): Date { return new Date(`${value}T00:00:00.000Z`); }
function businessToday(now: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (type: string) => parts.find((value) => value.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export class SeasonCreateRepository {
  private readonly membershipScope: MembershipScopeService;
  constructor(private readonly prisma: PrismaClient, private readonly now: () => Date = () => new Date()) {
    this.membershipScope = new MembershipScopeService(prisma);
  }

  async createDraft(identity: VerifiedSubject, fieldId: string, body: unknown, key: string): Promise<SeasonCreateOutcome> {
    const command = validateCreateSeasonCommand(body);
    const idempotencyKey = validateSeasonIdempotencyKey(key);
    const scope = await this.membershipScope.resolveDefaultBusinessScope(identity);
    if (!scope) throw new BusinessScopeForbiddenError();
    const payloadFingerprint = fingerprint(fieldId, command);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const timezone = await this.lockAuthorizedField(tx, scope, fieldId);
        const retained = await tx.businessCommandIdempotencyRecord.findUnique({ where: {
          userId_businessId_command_key: { userId: scope.userId, businessId: scope.businessId, command: "CREATE", key: idempotencyKey },
        } });
        // Committed snapshots replay unchanged, even if the plan was later edited,
        // activated, or the runtime crop/template availability changed.
        if (retained) {
          if (retained.payloadFingerprint !== payloadFingerprint) throw new SeasonCommandError(409, "IDEMPOTENCY_KEY_REUSED");
          return { kind: "replayed", season: retained.result as unknown as SeasonSetupResponse };
        }
        const actual = validateActualPlantingDate(command.sowingPlantingDate, businessToday(this.now(), timezone));
        const catalog = "centralCropId" in command.crop
          ? await tx.cropDefinitionVersion.findMany({ where: { id: command.crop.centralCropId } }) : [];
        // Existing logical identities remain recoverable when an older runtime
        // version becomes unselectable. Selectability gates new creation only.
        if (catalog[0]) {
          const existing = await tx.season.findFirst({ where: { businessId: scope.businessId, fieldId,
            cropKey: catalog[0].cropKey, actualPlantingDate: dateScalar(actual) }, include: seasonSetupInclude });
          if (existing) {
            const season = seasonRecordToResponse(existing);
            await this.recordOutcome(tx, scope, idempotencyKey, payloadFingerprint, season);
            return { kind: "existing", season };
          }
        }
        const crop = "centralCropId" in command.crop
          ? selectCentralCrop(command.crop.centralCropId, catalog)
          : createCustomCropReference(randomUUID(), scope.businessId, command.crop.customCropName);
        const templates = crop.kind === "CENTRAL" ? await tx.validatedTemplateVersion.findMany({ where: {
          cropDefinitionVersionId: crop.cropDefinitionVersionId, published: true, available: true }, orderBy: { id: "asc" } }) : [];
        // SPEC-001 fields have no resolved region; generic published content is
        // the applicable seam until region data exists in an approved feature.
        const selection = selectValidatedTemplate(crop, null, templates.map(toPublishedTemplate), reportTemplateQualityDiagnostic);
        const plan = prepareInitialPlan(selection, command.planSource === "MANUAL", actual);
        if (crop.kind === "CUSTOM") await tx.customCrop.create({ data: { id: crop.customCropId,
          businessId: scope.businessId, displayName: crop.displayName } });
        const row = await tx.season.create({ data: {
          businessId: scope.businessId, fieldId, actualPlantingDate: dateScalar(actual),
          ...(crop.kind === "CENTRAL" ? { cropKey: crop.cropKey, cropDefinitionVersionId: crop.cropDefinitionVersionId } : { customCropId: crop.customCropId }),
          plan: { create: { source: plan.source, templateVersionId: plan.templateProvenance?.templateVersionId ?? null,
            sourceSnapshot: { source: plan.source, templateProvenance: plan.templateProvenance },
            tasks: { create: plan.tasks.map((task) => ({ ...task, plannedLocalDate: dateScalar(task.plannedLocalDate) })) } } },
        }, include: seasonSetupInclude });
        const season = seasonRecordToResponse(row);
        await this.recordOutcome(tx, scope, idempotencyKey, payloadFingerprint, season);
        return { kind: "created", season };
      }, { isolationLevel: "ReadCommitted" });
    } catch (error) {
      if (error instanceof LocalDateValidationError) throw new SeasonCommandError(400,
        error.code === "FUTURE_ACTUAL_PLANTING_DATE" ? "SEASON_DATE_IN_FUTURE" : "INVALID_REQUEST");
      if (error instanceof CropSelectionError) throw new SeasonCommandError(400, "INVALID_REQUEST");
      if (error instanceof TemplateSelectionError) {
        if (error.code === "MANUAL_PLAN_CHOICE_REQUIRED") throw new SeasonCommandError(409, "MANUAL_PLAN_CHOICE_REQUIRED");
        if (error.code === "VALIDATED_TEMPLATE_REQUIRED") throw new SeasonCommandError(400, "INVALID_REQUEST");
        // Malformed or ambiguous production content is a server failure, never
        // a farmer input error and never a silent conversion to a manual plan.
      }
      throw error;
    }
  }

  private async lockAuthorizedField(tx: Prisma.TransactionClient, scope: AuthorizedBusinessScope, fieldId: string): Promise<string> {
    const users = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM application_users
      WHERE id = ${scope.userId}::uuid AND default_business_id = ${scope.businessId}::uuid FOR UPDATE`;
    if (users.length !== 1) throw new BusinessScopeForbiddenError();
    const memberships = await tx.$queryRaw<Array<{ id: string; role: string }>>`SELECT id, role FROM memberships
      WHERE id = ${scope.membershipId}::uuid AND user_id = ${scope.userId}::uuid
        AND business_id = ${scope.businessId}::uuid AND status = 'ACTIVE' FOR UPDATE`;
    if (memberships.length !== 1) throw new BusinessScopeForbiddenError();
    // Field locking serializes logical identity checks across different users
    // and different keys. Database partial unique indexes remain the invariant.
    const fields = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM fields
      WHERE id = ${fieldId}::uuid AND business_id = ${scope.businessId}::uuid FOR UPDATE`;
    if (fields.length !== 1) throw new NotFoundException();
    const business = await tx.business.findUniqueOrThrow({ where: { id: scope.businessId }, select: { timezone: true } });
    return business.timezone ?? process.env.SEASON_DEFAULT_TIMEZONE ?? "Europe/Istanbul";
  }
  private async recordOutcome(tx: Prisma.TransactionClient, scope: AuthorizedBusinessScope, key: string, payloadFingerprint: string, season: SeasonSetupResponse): Promise<void> {
    const retentionHours = Number(process.env.SEASON_IDEMPOTENCY_RETENTION_HOURS ?? "24");
    if (!Number.isFinite(retentionHours) || retentionHours <= 0) throw new Error("Season idempotency retention must be positive");
    const createdAt = this.now();
    await tx.businessCommandIdempotencyRecord.create({ data: { userId: scope.userId, businessId: scope.businessId,
      command: "CREATE", key, payloadFingerprint, seasonId: season.id, result: season as unknown as Prisma.InputJsonValue,
      createdAt, expiresAt: new Date(createdAt.getTime() + retentionHours * 3600000) } });
  }
}
