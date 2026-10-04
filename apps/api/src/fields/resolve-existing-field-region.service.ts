import type { VerifiedSubject } from "@ekim-hasat/domain/identity/auth-provider";
import { createHash, randomUUID } from "node:crypto";
import {
  applyFieldRegionResolution,
  createFieldRegionContext,
  type FieldRegionContext,
  type RegionSuggestion,
} from "@ekim-hasat/domain/fields/field-region-context";
import { MembershipScopeService, type AuthorizedBusinessScope } from "../authorization/membership-scope.service.js";
import { Prisma, type PrismaClient } from "../generated/prisma/client.js";
import type { RegionResolverPort } from "../regions/region-resolver.port.js";

export type CurrentFieldRegionTarget = Readonly<{
  fieldId: string;
  resolutionLocationKey: string;
  representativePoint: Readonly<{ longitude: number; latitude: number }>;
  regionContext: FieldRegionContext | null;
}>;

/** Implementations must resolve membership and read inside that authorized Business. */
export interface ExistingFieldRegionRepository {
  readAuthorizedCurrent(identity: VerifiedSubject, fieldId: string): Promise<CurrentFieldRegionTarget | null>;
  /** Atomically compare the current key and append at most one context version. */
  appendIfCurrent(input: Readonly<{
    identity: VerifiedSubject;
    fieldId: string;
    expectedLocationKey: string;
    context: FieldRegionContext;
  }>): Promise<"UPDATED" | "UNCHANGED" | "STALE">;
}

type RegionFieldRow = Readonly<{
  field_id: string;
  representative_point: string;
  boundary_id: string | null;
  boundary_geojson: string | null;
  resolution_location_key: string | null;
  administrative_state: string | null;
  administrative_code: string | null;
  administrative_label: string | null;
  administrative_source_id: string | null;
  administrative_confidence: number | null;
  administrative_data_version: string | null;
  administrative_resolved_at: Date | null;
  agricultural_state: string | null;
  agricultural_code: string | null;
  agricultural_label: string | null;
  agricultural_source_id: string | null;
  agricultural_confidence: number | null;
  agricultural_data_version: string | null;
  agricultural_resolved_at: Date | null;
  override_code: string | null;
  override_label: string | null;
}>;

/** Prisma/PostGIS persistence for exactly one currently authorized Field. */
export class PrismaExistingFieldRegionRepository implements ExistingFieldRegionRepository {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly membershipScope: MembershipScopeService = new MembershipScopeService(prisma),
  ) {}

  async readAuthorizedCurrent(identity: VerifiedSubject, fieldId: string): Promise<CurrentFieldRegionTarget | null> {
    const scope = await this.membershipScope.resolveDefaultBusinessScope(identity);
    if (!scope) return null;
    const row = await this.readRow(this.prisma, scope, fieldId);
    return row ? this.toTarget(row) : null;
  }

  async appendIfCurrent(input: Parameters<ExistingFieldRegionRepository["appendIfCurrent"]>[0]): Promise<"UPDATED" | "UNCHANGED" | "STALE"> {
    const scope = await this.membershipScope.resolveDefaultBusinessScope(input.identity);
    if (!scope) return "STALE";
    return this.prisma.$transaction(async (tx) => {
      // Recheck and lock server-owned authorization in the write transaction.
      const userRows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM application_users
        WHERE id = ${scope.userId}::uuid AND default_business_id = ${scope.businessId}::uuid FOR UPDATE`;
      if (userRows.length !== 1) return "STALE";
      const memberships = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM memberships
        WHERE id = ${scope.membershipId}::uuid AND user_id = ${scope.userId}::uuid
          AND business_id = ${scope.businessId}::uuid AND status = 'ACTIVE' FOR UPDATE`;
      if (memberships.length !== 1) return "STALE";

      // Lock only this Field, then read geometry and current context in a fresh
      // statement snapshot so a just-completed edit cannot be mistaken as current.
      const fieldRows = await tx.$queryRaw<Array<{ id: string }>>`SELECT f.id FROM fields f
        WHERE f.id = ${input.fieldId}::uuid AND f.business_id = ${scope.businessId}::uuid
        FOR UPDATE OF f`;
      if (fieldRows.length !== 1) return "STALE";
      const row = await this.readRow(tx, scope, input.fieldId);
      if (!row) return "STALE";
      const target = this.toTarget(row);
      if (target.resolutionLocationKey !== input.expectedLocationKey
        || input.context.resolutionLocationKey !== input.expectedLocationKey) return "STALE";

      const current = contextForCurrentLocation(target);
      // Merge suggestions into the latest persisted state so a manual override
      // changed while lookup was in flight is retained.
      let next = current;
      for (const targetName of ["administrative", "agricultural"] as const) {
        const update = input.context[targetName];
        const result = update.state === "RESOLVED"
          ? { target: targetName, resolutionLocationKey: target.resolutionLocationKey, state: "RESOLVED" as const, result: update.result }
          : { target: targetName, resolutionLocationKey: target.resolutionLocationKey, state: "UNRESOLVED" as const };
        const applied = applyFieldRegionResolution(next, result);
        if (applied.kind === "stale") return "STALE";
        next = applied.context;
      }
      if (next.administrative === current.administrative && next.agricultural === current.agricultural) return "UNCHANGED";

      const version = await tx.fieldRegionContextVersion.aggregate({
        where: { fieldId: input.fieldId },
        _max: { version: true },
      });
      const created = await tx.fieldRegionContextVersion.create({
        data: {
          id: randomUUID(),
          fieldId: input.fieldId,
          version: (version._max.version ?? 0) + 1,
          resolutionLocationKey: next.resolutionLocationKey,
          ...persistedContext(next),
        },
      });
      await tx.field.update({
        where: { id: input.fieldId },
        data: { currentRegionContextVersionId: created.id },
      });
      return "UPDATED";
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }

  private async readRow(
    db: PrismaClient | Prisma.TransactionClient,
    scope: AuthorizedBusinessScope,
    fieldId: string,
  ): Promise<RegionFieldRow | null> {
    const rows = await db.$queryRaw<RegionFieldRow[]>(Prisma.sql`
      SELECT f."id"::text AS field_id,
        ST_AsGeoJSON(f."representative_point") AS representative_point,
        b."id"::text AS boundary_id,
        ST_AsGeoJSON(b."geometry") AS boundary_geojson,
        r."resolution_location_key",
        r."administrative_state", r."administrative_code", r."administrative_label",
        r."administrative_source_id", r."administrative_confidence", r."administrative_data_version",
        r."administrative_resolved_at", r."agricultural_state", r."agricultural_code", r."agricultural_label",
        r."agricultural_source_id", r."agricultural_confidence", r."agricultural_data_version",
        r."agricultural_resolved_at", r."override_code", r."override_label"
      FROM "fields" f
      LEFT JOIN "field_boundary_versions" b
        ON b."id" = f."current_boundary_version_id" AND b."field_id" = f."id"
      LEFT JOIN "field_region_context_versions" r
        ON r."id" = f."current_region_context_version_id" AND r."field_id" = f."id"
      WHERE f."id" = ${fieldId}::uuid AND f."business_id" = ${scope.businessId}::uuid
        AND EXISTS (
          SELECT 1 FROM "memberships" m
          WHERE m."id" = ${scope.membershipId}::uuid
            AND m."user_id" = ${scope.userId}::uuid
            AND m."business_id" = f."business_id" AND m."status" = 'ACTIVE'
        )
      LIMIT 1
    `);
    return rows[0] ?? null;
  }

  private toTarget(row: RegionFieldRow): CurrentFieldRegionTarget {
    const representativePoint = JSON.parse(row.representative_point) as { coordinates: [number, number] };
    const polygon = row.boundary_geojson ? JSON.parse(row.boundary_geojson) as { type: "Polygon"; coordinates: [number, number][][] } : null;
    const derivedLocationKey = createHash("sha256")
      .update(JSON.stringify({ representativePoint, boundaryId: row.boundary_id, boundary: polygon }))
      .digest("hex");
    // A persisted current context is the canonical key produced by the Field
    // write. Legacy Fields without one derive a key from their live geometry.
    const resolutionLocationKey = row.resolution_location_key ?? derivedLocationKey;
    const context = row.resolution_location_key ? createFieldRegionContext({
      resolutionLocationKey: row.resolution_location_key,
      administrative: suggestionFromRow(row, "administrative"),
      agricultural: suggestionFromRow(row, "agricultural"),
      agriculturalOverride: row.override_code && row.override_label
        ? { code: row.override_code, label: row.override_label }
        : null,
    }) : null;
    return {
      fieldId: row.field_id,
      resolutionLocationKey,
      representativePoint: { longitude: representativePoint.coordinates[0], latitude: representativePoint.coordinates[1] },
      regionContext: context,
    };
  }
}

function suggestionFromRow(row: RegionFieldRow, target: "administrative" | "agricultural"): RegionSuggestion {
  const prefix = target;
  const state = target === "administrative" ? row.administrative_state : row.agricultural_state;
  if (state !== "RESOLVED") return { state: "UNRESOLVED" };
  const code = target === "administrative" ? row.administrative_code : row.agricultural_code;
  const label = target === "administrative" ? row.administrative_label : row.agricultural_label;
  const sourceId = target === "administrative" ? row.administrative_source_id : row.agricultural_source_id;
  const confidence = target === "administrative" ? row.administrative_confidence : row.agricultural_confidence;
  const dataVersion = target === "administrative" ? row.administrative_data_version : row.agricultural_data_version;
  const resolvedAt = target === "administrative" ? row.administrative_resolved_at : row.agricultural_resolved_at;
  if (!code || !label || !sourceId || confidence === null || !dataVersion || !resolvedAt) {
    throw new Error(`Stored ${prefix} region context is incomplete`);
  }
  return { state: "RESOLVED", result: {
    code, label, sourceId, confidence, dataVersion, resolvedAt: resolvedAt.toISOString(),
  } };
}

function persistedContext(context: FieldRegionContext) {
  const administrative = context.administrative;
  const agricultural = context.agricultural;
  return {
    administrativeState: administrative.state,
    administrativeCode: administrative.state === "RESOLVED" ? administrative.result.code : null,
    administrativeLabel: administrative.state === "RESOLVED" ? administrative.result.label : null,
    administrativeSourceId: administrative.state === "RESOLVED" ? administrative.result.sourceId : null,
    administrativeConfidence: administrative.state === "RESOLVED" ? administrative.result.confidence : null,
    administrativeDataVersion: administrative.state === "RESOLVED" ? administrative.result.dataVersion : null,
    administrativeResolvedAt: administrative.state === "RESOLVED" ? new Date(administrative.result.resolvedAt) : null,
    agriculturalState: agricultural.state,
    agriculturalCode: agricultural.state === "RESOLVED" ? agricultural.result.code : null,
    agriculturalLabel: agricultural.state === "RESOLVED" ? agricultural.result.label : null,
    agriculturalSourceId: agricultural.state === "RESOLVED" ? agricultural.result.sourceId : null,
    agriculturalConfidence: agricultural.state === "RESOLVED" ? agricultural.result.confidence : null,
    agriculturalDataVersion: agricultural.state === "RESOLVED" ? agricultural.result.dataVersion : null,
    agriculturalResolvedAt: agricultural.state === "RESOLVED" ? new Date(agricultural.result.resolvedAt) : null,
    overrideCode: context.agriculturalOverride?.code ?? null,
    overrideLabel: context.agriculturalOverride?.label ?? null,
  };
}

export type ExistingFieldRegionResolutionResult =
  | Readonly<{ kind: "NOT_FOUND" }>
  | Readonly<{ kind: "STALE" }>
  | Readonly<{ kind: "UNCHANGED" }>
  | Readonly<{ kind: "UPDATED" }>;

/** Resolves exactly one authorized current Field and relies on an atomic key guard at persistence. */
export class ResolveExistingFieldRegionService {
  constructor(
    private readonly repository: ExistingFieldRegionRepository,
    private readonly resolver: RegionResolverPort,
  ) {}

  async execute(identity: VerifiedSubject, fieldId: string): Promise<ExistingFieldRegionResolutionResult> {
    const field = await this.repository.readAuthorizedCurrent(identity, fieldId);
    if (!field) return { kind: "NOT_FOUND" };

    const current = contextForCurrentLocation(field);

    const [administrative, agricultural] = await Promise.all([
      this.resolver.resolveAdministrative(field.representativePoint).catch(() => ({ state: "UNRESOLVED" as const, reason: "SOURCE_UNAVAILABLE" as const })),
      this.resolver.resolveAgricultural(field.representativePoint).catch(() => ({ state: "UNRESOLVED" as const, reason: "SOURCE_UNAVAILABLE" as const })),
    ]);
    let next = current;
    let changed = false;
    for (const [target, result] of [["administrative", administrative], ["agricultural", agricultural]] as const) {
      const update = result.state === "RESOLVED"
        ? { target, resolutionLocationKey: field.resolutionLocationKey, state: "RESOLVED" as const, result: result.candidate }
        : { target, resolutionLocationKey: field.resolutionLocationKey, state: "UNRESOLVED" as const };
      const applied = applyFieldRegionResolution(next, update);
      if (applied.kind === "stale") return { kind: "STALE" };
      if (applied.kind === "applied") changed = true;
      next = applied.context;
    }
    if (!changed) return { kind: "UNCHANGED" };

    const persisted = await this.repository.appendIfCurrent({
      identity,
      fieldId,
      expectedLocationKey: field.resolutionLocationKey,
      context: next,
    });
    if (persisted === "STALE") return { kind: "STALE" };
    return persisted === "UNCHANGED" ? { kind: "UNCHANGED" } : { kind: "UPDATED" };
  }
}

function contextForCurrentLocation(target: CurrentFieldRegionTarget): FieldRegionContext {
  const persisted = target.regionContext;
  if (persisted?.resolutionLocationKey === target.resolutionLocationKey) return persisted;
  // A context attached to an older location must not leak suggestions into the
  // current Field. Preserve the explicit farmer choice across that boundary.
  return createFieldRegionContext({
    resolutionLocationKey: target.resolutionLocationKey,
    administrative: { state: "UNRESOLVED" },
    agricultural: { state: "UNRESOLVED" },
    agriculturalOverride: persisted?.agriculturalOverride ?? null,
  });
}
