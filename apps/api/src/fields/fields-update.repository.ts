import { randomUUID } from "node:crypto";
import { NotFoundException } from "@nestjs/common";
import { fieldResolutionLocationKey, createFieldRegionContext, type FieldRegionContext, type RegionSuggestion } from "@ekim-hasat/domain/fields/field-region-context";
import type { PointLocation, PolygonLocation } from "@ekim-hasat/domain/fields/field-location";
import type { VerifiedSubject } from "@ekim-hasat/domain/identity/auth-provider";
import type { PrismaClient, Prisma } from "../generated/prisma/client.js";
import { BusinessScopeForbiddenError, MembershipScopeService, type AuthorizedBusinessScope } from "../authorization/membership-scope.service.js";
import type { RegionResolverPort } from "../regions/region-resolver.port.js";
import { UnavailableRegionResolver } from "../regions/unavailable-region-resolver.js";
import { FieldCommandError } from "./fields-command.error.js";
import { FieldsReadRepository } from "./fields-read.repository.js";
import { PrismaExistingFieldRegionRepository, ResolveExistingFieldRegionService } from "./resolve-existing-field-region.service.js";
import type { ValidatedFieldUpdateCommand, FieldUpdateOutcome, FieldUpdateRepositoryPort } from "./fields-update.service.js";

type CurrentField = Readonly<{
  id: string;
  name: string;
  version: number;
  current_boundary_version_id: string | null;
  current_region_context_version_id: string | null;
  representative_point: string;
  boundary_geojson: string | null;
}>;
type PointResult = Readonly<{ valid: boolean; point: string }>;

/** Atomically edits current Field state while retaining boundary and region history. */
export class FieldUpdateRepository implements FieldUpdateRepositoryPort {
  private readonly membershipScope: MembershipScopeService;
  private readonly fieldReader: FieldsReadRepository;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly regionResolver: RegionResolverPort = new UnavailableRegionResolver(),
  ) {
    this.membershipScope = new MembershipScopeService(prisma);
    this.fieldReader = new FieldsReadRepository(prisma);
  }

  async updateField(identity: VerifiedSubject, fieldId: string, expectedVersion: number, command: ValidatedFieldUpdateCommand): Promise<FieldUpdateOutcome> {
    const scope = await this.membershipScope.resolveDefaultBusinessScope(identity);
    if (!scope) throw new BusinessScopeForbiddenError();
    await this.prisma.$transaction(async (tx) => {
      await this.lockAuthorizedContext(tx, scope);
      const fields = await tx.$queryRaw<CurrentField[]>`
        SELECT f.id, f.name, f.version, f.current_boundary_version_id, f.current_region_context_version_id,
          ST_AsGeoJSON(f.representative_point) AS representative_point,
          ST_AsGeoJSON(b.geometry) AS boundary_geojson
        FROM fields f
        LEFT JOIN field_boundary_versions b ON b.id=f.current_boundary_version_id AND b.field_id=f.id
        WHERE f.id=${fieldId}::uuid AND f.business_id=${scope.businessId}::uuid
          AND EXISTS (SELECT 1 FROM memberships m WHERE m.id=${scope.membershipId}::uuid
            AND m.user_id=${scope.userId}::uuid AND m.business_id=f.business_id AND m.status='ACTIVE')
        FOR UPDATE OF f`;
      const field = fields[0];
      if (!field) throw new NotFoundException();
      if (field.version !== expectedVersion) throw new FieldCommandError(409, "STALE_VERSION");

      const currentPoint = JSON.parse(field.representative_point) as PointLocation;
      const currentPolygon = field.boundary_geojson ? JSON.parse(field.boundary_geojson) as PolygonLocation : null;
      const currentKey = fieldResolutionLocationKey({ representativePoint: currentPoint, polygon: currentPolygon });
      let nextPoint = currentPoint;
      let nextPolygon = currentPolygon;
      let boundaryId = field.current_boundary_version_id;

      if (command.location) {
        if (command.location.type === "Point") {
          nextPoint = command.location;
          nextPolygon = null;
          boundaryId = null;
        } else {
          const pointRows = await tx.$queryRaw<PointResult[]>`
            SELECT ST_IsValid(shape) AS valid, ST_AsGeoJSON(ST_PointOnSurface(shape)) AS point
            FROM (SELECT ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(command.location)}),4326) AS shape) source`;
          if (!pointRows[0]?.valid || !pointRows[0]?.point) throw new FieldCommandError(400, "INVALID_REQUEST");
          nextPoint = JSON.parse(pointRows[0].point) as PointLocation;
          nextPolygon = command.location;
          const versions = await tx.$queryRaw<Array<{ version: number }>>`
            SELECT COALESCE(MAX(version),0)::int AS version FROM field_boundary_versions WHERE field_id=${fieldId}::uuid`;
          boundaryId = randomUUID();
          await tx.$executeRaw`INSERT INTO field_boundary_versions (id,field_id,version,geometry,verification_status)
            VALUES (${boundaryId}::uuid,${fieldId}::uuid,${(versions[0]?.version ?? 0) + 1},
              ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(command.location)}),4326),'UNVERIFIED')`;
        }
      }

      const nextKey = fieldResolutionLocationKey({ representativePoint: nextPoint, polygon: nextPolygon });
      const oldRegion = field.current_region_context_version_id
        ? await tx.fieldRegionContextVersion.findUnique({ where: { id: field.current_region_context_version_id } })
        : null;
      const currentRegion = oldRegion ? contextFromRow(oldRegion) : unresolvedContext(currentKey);
      const requestedOverride = command.agriculturalRegionOverride;
      const baseContext = nextKey !== currentKey
        ? unresolvedContext(nextKey, requestedOverride === undefined ? currentRegion.agriculturalOverride : requestedOverride)
        : requestedOverride === undefined
          ? currentRegion
          : createFieldRegionContext({ ...currentRegion, agriculturalOverride: requestedOverride });
      const contextChanged = nextKey !== currentKey
        || (oldRegion ? JSON.stringify(baseContext) !== JSON.stringify(currentRegion) : requestedOverride !== undefined);
      let regionContextId = field.current_region_context_version_id;
      if (contextChanged) {
        const maxVersions = await tx.$queryRaw<Array<{ version: number }>>`
          SELECT COALESCE(MAX(version),0)::int AS version FROM field_region_context_versions WHERE field_id=${fieldId}::uuid`;
        regionContextId = randomUUID();
        await tx.fieldRegionContextVersion.create({ data: {
          id: regionContextId,
          fieldId,
          version: (maxVersions[0]?.version ?? 0) + 1,
          resolutionLocationKey: nextKey,
          ...contextValues(baseContext),
        } });
      }

      const pointJson = JSON.stringify(nextPoint);
      const updateRows = await tx.$executeRaw`UPDATE fields SET
        name=${command.name ?? field.name},
        representative_point=ST_SetSRID(ST_GeomFromGeoJSON(${pointJson}),4326),
        current_boundary_version_id=${boundaryId}::uuid,
        current_region_context_version_id=${regionContextId}::uuid,
        version=version+1
        WHERE id=${fieldId}::uuid AND business_id=${scope.businessId}::uuid AND version=${expectedVersion}`;
      if (updateRows !== 1) throw new FieldCommandError(409, "STALE_VERSION");
    }, { isolationLevel: "ReadCommitted" });

    if (command.location) {
      try {
        await new ResolveExistingFieldRegionService(
          new PrismaExistingFieldRegionRepository(this.prisma, this.membershipScope),
          this.regionResolver,
        ).execute(identity, fieldId);
      } catch {
        // Region lookup is optional: a successful Field edit remains committed,
        // with the persisted UNRESOLVED context available for the farmer.
      }
    }

    const field = await this.fieldReader.readDetail(scope, fieldId);
    if (!field) throw new NotFoundException();
    return { field };
  }

  private async lockAuthorizedContext(tx: Prisma.TransactionClient, scope: AuthorizedBusinessScope): Promise<void> {
    const users = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM application_users
      WHERE id=${scope.userId}::uuid AND default_business_id=${scope.businessId}::uuid FOR UPDATE`;
    if (users.length !== 1) throw new BusinessScopeForbiddenError();
    const memberships = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM memberships
      WHERE id=${scope.membershipId}::uuid AND user_id=${scope.userId}::uuid AND business_id=${scope.businessId}::uuid
        AND status='ACTIVE' FOR UPDATE`;
    if (memberships.length !== 1) throw new BusinessScopeForbiddenError();
  }
}

function unresolvedContext(locationKey: string, override: FieldRegionContext["agriculturalOverride"] = null): FieldRegionContext {
  return createFieldRegionContext({ resolutionLocationKey: locationKey,
    administrative: { state: "UNRESOLVED" }, agricultural: { state: "UNRESOLVED" }, agriculturalOverride: override });
}

function contextFromRow(row: Prisma.FieldRegionContextVersionModel): FieldRegionContext {
  const suggestion = (target: "administrative" | "agricultural"): RegionSuggestion => {
    const administrative = target === "administrative";
    const state = administrative ? row.administrativeState : row.agriculturalState;
    if (state !== "RESOLVED") return { state: "UNRESOLVED" };
    const code = administrative ? row.administrativeCode : row.agriculturalCode;
    const label = administrative ? row.administrativeLabel : row.agriculturalLabel;
    const sourceId = administrative ? row.administrativeSourceId : row.agriculturalSourceId;
    const confidence = administrative ? row.administrativeConfidence : row.agriculturalConfidence;
    const dataVersion = administrative ? row.administrativeDataVersion : row.agriculturalDataVersion;
    const resolvedAt = administrative ? row.administrativeResolvedAt : row.agriculturalResolvedAt;
    if (!code || !label || !sourceId || confidence === null || !dataVersion || !resolvedAt) throw new Error("Stored region provenance is incomplete");
    return { state: "RESOLVED", result: { code, label, sourceId, confidence, dataVersion, resolvedAt: resolvedAt.toISOString() } };
  };
  return createFieldRegionContext({
    resolutionLocationKey: row.resolutionLocationKey,
    administrative: suggestion("administrative"),
    agricultural: suggestion("agricultural"),
    agriculturalOverride: row.overrideCode && row.overrideLabel ? { code: row.overrideCode, label: row.overrideLabel } : null,
  });
}

function contextValues(context: FieldRegionContext) {
  const values = (suggestion: RegionSuggestion) => suggestion.state === "RESOLVED"
    ? { State: "RESOLVED", Code: suggestion.result.code, Label: suggestion.result.label, SourceId: suggestion.result.sourceId,
        DataVersion: suggestion.result.dataVersion, Confidence: suggestion.result.confidence, ResolvedAt: new Date(suggestion.result.resolvedAt) }
    : { State: "UNRESOLVED", Code: null, Label: null, SourceId: null, DataVersion: null, Confidence: null, ResolvedAt: null };
  const administrative = values(context.administrative);
  const agricultural = values(context.agricultural);
  return {
    administrativeState: administrative.State,
    administrativeCode: administrative.Code,
    administrativeLabel: administrative.Label,
    administrativeSourceId: administrative.SourceId,
    administrativeDataVersion: administrative.DataVersion,
    administrativeConfidence: administrative.Confidence,
    administrativeResolvedAt: administrative.ResolvedAt,
    agriculturalState: agricultural.State,
    agriculturalCode: agricultural.Code,
    agriculturalLabel: agricultural.Label,
    agriculturalSourceId: agricultural.SourceId,
    agriculturalDataVersion: agricultural.DataVersion,
    agriculturalConfidence: agricultural.Confidence,
    agriculturalResolvedAt: agricultural.ResolvedAt,
    overrideCode: context.agriculturalOverride?.code ?? null,
    overrideLabel: context.agriculturalOverride?.label ?? null,
  };
}
