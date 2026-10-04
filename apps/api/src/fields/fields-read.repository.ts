import { ApiError } from "../observability/api-error.filter.js";
import { Prisma, type PrismaClient } from "../generated/prisma/client.js";
import type { AuthorizedBusinessScope } from "../authorization/membership-scope.service.js";
import type { FieldComponents } from "@ekim-hasat/api-client";

export type FieldPageQuery = Readonly<{ limit: number; cursor?: string }>;
export type FieldPage = FieldComponents["schemas"]["FieldPage"];
export type FieldDetail = FieldComponents["schemas"]["FieldDetail"];

type Cursor = Readonly<{ v: 1; businessId: string; name: string; id: string }>;
type FieldRow = Readonly<{
  id: string;
  name: string;
  version: number;
  representative_point: string;
  has_current_boundary: boolean;
}>;
type FieldDetailRow = FieldRow & Readonly<{
  boundary_geojson: string | null;
  administrative_state: string | null;
  administrative_code: string | null;
  administrative_label: string | null;
  administrative_source_id: string | null;
  administrative_confidence: number | null;
  administrative_data_version: string | null;
  administrative_resolved_at: Date | string | null;
  agricultural_state: string | null;
  agricultural_code: string | null;
  agricultural_label: string | null;
  agricultural_source_id: string | null;
  agricultural_confidence: number | null;
  agricultural_data_version: string | null;
  agricultural_resolved_at: Date | string | null;
  override_code: string | null;
  override_label: string | null;
  active_season_id: string | null;
  active_season_status: string | null;
  crop_label: string | null;
  planting_date: string | null;
}>;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const unresolvedSuggestion = {
  state: "UNRESOLVED" as const,
  code: null,
  label: null,
  sourceId: null,
  confidence: null,
  dataVersion: null,
  resolvedAt: null,
};

function invalidCursor(): never {
  throw new ApiError(400, "INVALID_REQUEST", "Check the Field list cursor and try again");
}

function decodeCursor(value: string, businessId: string): Cursor {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) return invalidCursor();
    const decoded = Buffer.from(value, "base64url").toString("utf8");
    if (Buffer.from(decoded, "utf8").toString("base64url") !== value) return invalidCursor();
    const parsed: unknown = JSON.parse(decoded);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return invalidCursor();
    const candidate = parsed as Record<string, unknown>;
    if (candidate.v !== 1 || candidate.businessId !== businessId || typeof candidate.name !== "string"
      || candidate.name.trim().length === 0 || typeof candidate.id !== "string" || !uuidPattern.test(candidate.id)) return invalidCursor();
    return candidate as Cursor;
  } catch {
    return invalidCursor();
  }
}

function encodeCursor(field: Pick<FieldRow, "id" | "name">, businessId: string): string {
  return Buffer.from(JSON.stringify({ v: 1, businessId, name: field.name, id: field.id } satisfies Cursor)).toString("base64url");
}

function point(value: string): FieldPage["items"][number]["representativePoint"] {
  return JSON.parse(value) as FieldPage["items"][number]["representativePoint"];
}

function suggestion(row: FieldDetailRow, target: "administrative" | "agricultural") {
  const prefix = target === "administrative" ? "administrative" : "agricultural";
  const state = target === "administrative" ? row.administrative_state : row.agricultural_state;
  if (state !== "RESOLVED") return unresolvedSuggestion;
  const code = target === "administrative" ? row.administrative_code : row.agricultural_code;
  const label = target === "administrative" ? row.administrative_label : row.agricultural_label;
  const sourceId = target === "administrative" ? row.administrative_source_id : row.agricultural_source_id;
  const confidence = target === "administrative" ? row.administrative_confidence : row.agricultural_confidence;
  const dataVersion = target === "administrative" ? row.administrative_data_version : row.agricultural_data_version;
  const resolvedAt = target === "administrative" ? row.administrative_resolved_at : row.agricultural_resolved_at;
  if (!code || !label || !sourceId || confidence === null || !dataVersion || !resolvedAt) {
    throw new Error(`Stored ${prefix} region context is incomplete`);
  }
  return {
    state: "RESOLVED" as const,
    code,
    label,
    sourceId,
    confidence,
    dataVersion,
    resolvedAt: resolvedAt instanceof Date ? resolvedAt.toISOString() : new Date(resolvedAt).toISOString(),
  };
}

function localDate(value: string): string {
  return value.slice(0, 10);
}

export class FieldsReadRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async readPage(scope: AuthorizedBusinessScope, query: FieldPageQuery): Promise<FieldPage> {
    if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 100) {
      throw new ApiError(400, "INVALID_REQUEST", "Choose between 1 and 100 Fields per page");
    }
    const cursor = query.cursor === undefined ? undefined : decodeCursor(query.cursor, scope.businessId);
    const cursorWhere = cursor
      ? Prisma.sql`AND (f."name" > ${cursor.name} OR (f."name" = ${cursor.name} AND f."id" > ${cursor.id}::uuid))`
      : Prisma.empty;
    const rows = await this.prisma.$queryRaw<FieldRow[]>(Prisma.sql`
      SELECT f."id", f."name", f."version",
        ST_AsGeoJSON(f."representative_point") AS representative_point,
        (f."current_boundary_version_id" IS NOT NULL) AS has_current_boundary
      FROM "fields" f
      WHERE f."business_id" = ${scope.businessId}::uuid
        AND EXISTS (
          SELECT 1 FROM "memberships" m
          WHERE m."id" = ${scope.membershipId}::uuid
            AND m."user_id" = ${scope.userId}::uuid
            AND m."business_id" = f."business_id"
            AND m."status" = 'ACTIVE'
        )
        ${cursorWhere}
      ORDER BY f."name" ASC, f."id" ASC
      LIMIT ${query.limit + 1}
    `);
    const hasNext = rows.length > query.limit;
    const pageRows = hasNext ? rows.slice(0, query.limit) : rows;
    const items = pageRows.map((row) => ({
      id: row.id,
      name: row.name,
      version: row.version,
      representativePoint: point(row.representative_point),
      hasCurrentBoundary: row.has_current_boundary,
    }));
    const last = pageRows.at(-1);
    return { items, nextCursor: hasNext && last ? encodeCursor(last, scope.businessId) : null };
  }

  async readDetail(scope: AuthorizedBusinessScope, fieldId: string): Promise<FieldDetail | null> {
    const rows = await this.prisma.$queryRaw<FieldDetailRow[]>`
      SELECT f."id", f."name", f."version",
        ST_AsGeoJSON(f."representative_point") AS representative_point,
        (f."current_boundary_version_id" IS NOT NULL) AS has_current_boundary,
        ST_AsGeoJSON(b."geometry") AS boundary_geojson,
        r."administrative_state", r."administrative_code", r."administrative_label",
        r."administrative_source_id", r."administrative_confidence", r."administrative_data_version",
        r."administrative_resolved_at", r."agricultural_state", r."agricultural_code", r."agricultural_label",
        r."agricultural_source_id", r."agricultural_confidence", r."agricultural_data_version",
        r."agricultural_resolved_at", r."override_code", r."override_label",
        active."id" AS active_season_id, active."status" AS active_season_status,
        active."crop_label", active."planting_date"
      FROM "fields" f
      LEFT JOIN "field_boundary_versions" b
        ON b."id" = f."current_boundary_version_id" AND b."field_id" = f."id"
      LEFT JOIN "field_region_context_versions" r
        ON r."id" = f."current_region_context_version_id" AND r."field_id" = f."id"
      LEFT JOIN LATERAL (
        SELECT s."id", s."status", COALESCE(c."display_name", cc."display_name") AS crop_label,
          to_char(s."actual_planting_date", 'YYYY-MM-DD') AS planting_date
        FROM "seasons" s
        LEFT JOIN "crop_definition_versions" c ON c."id" = s."crop_definition_version_id" AND c."crop_key" = s."crop_key"
        LEFT JOIN "custom_crops" cc ON cc."id" = s."custom_crop_id" AND cc."business_id" = s."business_id"
        WHERE s."field_id" = f."id" AND s."business_id" = f."business_id" AND s."status" = 'ACTIVE'
        ORDER BY s."activated_at" DESC NULLS LAST, s."id" ASC
        LIMIT 1
      ) active ON TRUE
      WHERE f."id" = ${fieldId}::uuid AND f."business_id" = ${scope.businessId}::uuid
        AND EXISTS (
          SELECT 1 FROM "memberships" m
          WHERE m."id" = ${scope.membershipId}::uuid
            AND m."user_id" = ${scope.userId}::uuid
            AND m."business_id" = f."business_id"
            AND m."status" = 'ACTIVE'
        )
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) return null;
    const administrative = suggestion(row, "administrative");
    const agricultural = suggestion(row, "agricultural");
    if ((row.override_code === null) !== (row.override_label === null)) {
      throw new Error("Stored agricultural region override is incomplete");
    }
    const activeSeason = row.active_season_id
      ? row.active_season_status === "ACTIVE"
        ? { id: row.active_season_id, status: "ACTIVE" as const, cropLabel: row.crop_label, plantingDate: row.planting_date ? localDate(row.planting_date) : null }
        : (() => { throw new Error("Stored active Season state is invalid"); })()
      : null;
    return {
      id: row.id,
      name: row.name,
      version: row.version,
      representativePoint: point(row.representative_point),
      hasCurrentBoundary: row.has_current_boundary,
      regionContext: {
        administrativeLocation: administrative,
        agriculturalRegion: agricultural,
        agriculturalRegionOverride: row.override_code && row.override_label ? { code: row.override_code, label: row.override_label } : null,
      },
      boundary: row.boundary_geojson ? JSON.parse(row.boundary_geojson) as FieldDetail["boundary"] : null,
      activeSeason,
    };
  }
}
