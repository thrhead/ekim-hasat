import { createHash, randomUUID } from "node:crypto";
import { NotFoundException } from "@nestjs/common";
import type { FieldComponents } from "@ekim-hasat/api-client";
import type { FieldLocation } from "@ekim-hasat/domain/fields/field-location";
import { fieldResolutionLocationKey } from "@ekim-hasat/domain/fields/field-region-context";
import type { VerifiedSubject } from "@ekim-hasat/domain/identity/auth-provider";
import type { PrismaClient, Prisma } from "../generated/prisma/client.js";
import { BusinessScopeForbiddenError, MembershipScopeService, type AuthorizedBusinessScope } from "../authorization/membership-scope.service.js";
import type { RegionLookupResult, RegionResolverPort } from "../regions/region-resolver.port.js";
import { UnavailableRegionResolver } from "../regions/unavailable-region-resolver.js";
import { FieldCommandError } from "./fields-command.error.js";
import type { ValidatedFieldCreateCommand } from "./fields-create.service.js";

export type FieldCreateOutcome = Readonly<{
  kind: "created" | "replayed";
  field: FieldComponents["schemas"]["FieldDetail"];
}>;
type FieldDetail = FieldComponents["schemas"]["FieldDetail"];
type Point = FieldComponents["schemas"]["Point"];
type RegionContext = FieldComponents["schemas"]["RegionContext"];
type PointRow = Readonly<{ valid?: boolean; point: string }>;
const commandName = "CREATE_FIELD";

/** Persists the Field, current pointers, resolver context, and replay result atomically. */
export class FieldCreateRepository {
  private readonly membershipScope: MembershipScopeService;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly regionResolver: RegionResolverPort = new UnavailableRegionResolver(),
    private readonly now: () => Date = () => new Date(),
  ) {
    this.membershipScope = new MembershipScopeService(prisma);
  }

  async createField(
    identity: VerifiedSubject,
    command: ValidatedFieldCreateCommand,
    key: string,
  ): Promise<FieldCreateOutcome> {
    const scope = await this.membershipScope.resolveDefaultBusinessScope(identity);
    if (!scope) throw new BusinessScopeForbiddenError();

    const boundaryId = command.location.type === "Polygon" ? randomUUID() : null;
    const representativePoint = await this.representativePoint(command.location);
    const resolutionLocationKey = fieldResolutionLocationKey({
      representativePoint,
      polygon: command.location.type === "Polygon" ? command.location : undefined,
    });
    const context = await this.resolveContext(representativePoint);
    const payloadFingerprint = fingerprint(scope, command);

    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`WITH acquired AS MATERIALIZED (
          SELECT pg_advisory_xact_lock(hashtextextended(${`${scope.userId}:${key}`}, 0))
        ) SELECT 1::int AS lock_acquired FROM acquired`;
        await this.lockCurrentAuthorization(tx, scope);

        const retained = await tx.businessCommandIdempotencyRecord.findFirst({
          where: { userId: scope.userId, key },
          orderBy: { createdAt: "desc" },
        });
        if (retained) {
          if (retained.businessId !== scope.businessId || retained.command !== commandName || retained.payloadFingerprint !== payloadFingerprint) {
            throw new FieldCommandError(409, "IDEMPOTENCY_KEY_REUSED");
          }
          return { kind: "replayed", field: retained.result as unknown as FieldDetail };
        }

        await this.lockBusinessForCreate(tx, scope.businessId);
        const name = command.name ?? await this.nextGeneratedName(tx, scope.businessId);
        const fieldId = randomUUID();
        const createdAt = this.now();
        const locationJson = JSON.stringify(command.location);

        if (command.location.type === "Point") {
          const [longitude, latitude] = command.location.coordinates;
          await tx.$executeRaw`INSERT INTO "fields" ("id", "business_id", "name", "representative_point", "created_at", "version")
            VALUES (${fieldId}::uuid, ${scope.businessId}::uuid, ${name}, ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326), ${createdAt}, 1)`;
        } else {
          await tx.$executeRaw`INSERT INTO "fields" ("id", "business_id", "name", "representative_point", "created_at", "version")
            VALUES (${fieldId}::uuid, ${scope.businessId}::uuid, ${name},
              ST_PointOnSurface(ST_SetSRID(ST_GeomFromGeoJSON(${locationJson}), 4326)), ${createdAt}, 1)`;
          await tx.$executeRaw`INSERT INTO "field_boundary_versions" ("id", "field_id", "version", "geometry", "verification_status", "created_at")
            VALUES (${boundaryId}::uuid, ${fieldId}::uuid, 1, ST_SetSRID(ST_GeomFromGeoJSON(${locationJson}), 4326), 'UNVERIFIED', ${createdAt})`;
        }

        const regionContextId = randomUUID();
        await tx.fieldRegionContextVersion.create({
          data: {
            id: regionContextId,
            fieldId,
            version: 1,
            resolutionLocationKey,
            ...contextValues(context),
            createdAt,
          },
        });
        await tx.$executeRaw`UPDATE "fields" SET "current_boundary_version_id" = ${boundaryId}::uuid,
          "current_region_context_version_id" = ${regionContextId}::uuid WHERE "id" = ${fieldId}::uuid`;

        const field: FieldDetail = {
          id: fieldId,
          name,
          version: 1,
          representativePoint,
          hasCurrentBoundary: boundaryId !== null,
          boundary: command.location.type === "Polygon" ? command.location as FieldComponents["schemas"]["Polygon"] : null,
          activeSeason: null,
          regionContext: toRegionContext(context),
        };
        const retentionHours = Number(process.env.FIELD_IDEMPOTENCY_RETENTION_HOURS ?? "24");
        if (!Number.isFinite(retentionHours) || retentionHours <= 0) throw new Error("Field idempotency retention must be positive");
        await tx.businessCommandIdempotencyRecord.create({
          data: {
            userId: scope.userId,
            businessId: scope.businessId,
            command: commandName,
            key,
            payloadFingerprint,
            fieldId,
            result: field as unknown as Prisma.InputJsonValue,
            createdAt,
            expiresAt: new Date(createdAt.getTime() + retentionHours * 60 * 60 * 1000),
          },
        });
        return { kind: "created", field };
      }, { isolationLevel: "ReadCommitted" });
    } catch (error) {
      if (error instanceof FieldCommandError || error instanceof BusinessScopeForbiddenError || error instanceof NotFoundException) throw error;
      throw error;
    }
  }

  private async representativePoint(location: FieldLocation): Promise<Point> {
    if (location.type === "Point") return { type: "Point", coordinates: location.coordinates };
    const polygon = JSON.stringify(location);
    const rows = await this.prisma.$queryRaw<PointRow[]>`
      SELECT ST_IsValid(geometry) AS valid, ST_AsGeoJSON(ST_PointOnSurface(geometry)) AS point
      FROM (SELECT ST_SetSRID(ST_GeomFromGeoJSON(${polygon}), 4326) AS geometry) AS input`;
    if (rows[0]?.valid !== true || !rows[0]?.point) throw new FieldCommandError(400, "INVALID_REQUEST");
    return JSON.parse(rows[0].point) as Point;
  }

  private async resolveContext(point: Point): Promise<RegionContext> {
    const [administrative, agricultural] = await Promise.all([
      this.regionResolver.resolveAdministrative({ longitude: point.coordinates[0], latitude: point.coordinates[1] })
        .catch((): RegionLookupResult => ({ state: "UNRESOLVED", reason: "SOURCE_UNAVAILABLE" })),
      this.regionResolver.resolveAgricultural({ longitude: point.coordinates[0], latitude: point.coordinates[1] })
        .catch((): RegionLookupResult => ({ state: "UNRESOLVED", reason: "SOURCE_UNAVAILABLE" })),
    ]);
    return {
      administrativeLocation: toSuggestion(administrative),
      agriculturalRegion: toSuggestion(agricultural),
      agriculturalRegionOverride: null,
    };
  }

  private async lockCurrentAuthorization(tx: Prisma.TransactionClient, scope: AuthorizedBusinessScope): Promise<void> {
    const users = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM application_users
      WHERE id = ${scope.userId}::uuid AND default_business_id = ${scope.businessId}::uuid FOR UPDATE`;
    if (users.length !== 1) throw new BusinessScopeForbiddenError();
    const memberships = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM memberships
      WHERE id = ${scope.membershipId}::uuid AND user_id = ${scope.userId}::uuid
        AND business_id = ${scope.businessId}::uuid AND status = 'ACTIVE' FOR UPDATE`;
    if (memberships.length !== 1) throw new BusinessScopeForbiddenError();
  }

  private async nextGeneratedName(tx: Prisma.TransactionClient, businessId: string): Promise<string> {
    const rows = await tx.$queryRaw<Array<{ number: number }>>`SELECT candidate AS number
      FROM generate_series(1, (SELECT count(*)::int + 1 FROM fields WHERE business_id = ${businessId}::uuid AND name ~ '^Tarla [1-9][0-9]*$')) AS candidate
      WHERE NOT EXISTS (SELECT 1 FROM fields WHERE business_id = ${businessId}::uuid AND name = 'Tarla ' || candidate::text)
      ORDER BY candidate LIMIT 1`;
    return `Tarla ${rows[0]?.number ?? 1}`;
  }

  private async lockBusinessForCreate(tx: Prisma.TransactionClient, businessId: string): Promise<void> {
    const businesses = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM businesses WHERE id = ${businessId}::uuid FOR UPDATE`;
    if (businesses.length !== 1) throw new BusinessScopeForbiddenError();
  }
}

function fingerprint(scope: AuthorizedBusinessScope, command: ValidatedFieldCreateCommand): string {
  return createHash("sha256").update(JSON.stringify({
    userId: scope.userId,
    businessId: scope.businessId,
    command: commandName,
    name: command.name,
    location: command.location,
  })).digest("hex");
}

function contextValues(context: RegionContext) {
  const administrative = context.administrativeLocation;
  const agricultural = context.agriculturalRegion;
  return {
    administrativeState: administrative.state,
    administrativeCode: administrative.code ?? null,
    administrativeLabel: administrative.label ?? null,
    administrativeSourceId: administrative.sourceId ?? null,
    administrativeDataVersion: administrative.dataVersion ?? null,
    administrativeConfidence: administrative.confidence ?? null,
    administrativeResolvedAt: administrative.resolvedAt ? new Date(administrative.resolvedAt) : null,
    agriculturalState: agricultural.state,
    agriculturalCode: agricultural.code ?? null,
    agriculturalLabel: agricultural.label ?? null,
    agriculturalSourceId: agricultural.sourceId ?? null,
    agriculturalDataVersion: agricultural.dataVersion ?? null,
    agriculturalConfidence: agricultural.confidence ?? null,
    agriculturalResolvedAt: agricultural.resolvedAt ? new Date(agricultural.resolvedAt) : null,
    overrideCode: context.agriculturalRegionOverride?.code ?? null,
    overrideLabel: context.agriculturalRegionOverride?.label ?? null,
  };
}

function toSuggestion(result: RegionLookupResult): RegionContext["administrativeLocation"] {
  if (result.state === "UNRESOLVED") return { state: "UNRESOLVED", code: null, label: null, sourceId: null, confidence: null, dataVersion: null, resolvedAt: null };
  return { state: "RESOLVED", ...result.candidate };
}

function toRegionContext(context: RegionContext): RegionContext {
  return {
    administrativeLocation: context.administrativeLocation,
    agriculturalRegion: context.agriculturalRegion,
    agriculturalRegionOverride: null,
  };
}
