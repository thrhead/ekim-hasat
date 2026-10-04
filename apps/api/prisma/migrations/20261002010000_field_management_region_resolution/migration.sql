-- Keep every existing boundary row and snapshot reference. The chosen current
-- pointer is exactly the selector used before SPEC-005, including tied versions.
ALTER TABLE "field_boundary_versions"
  ADD CONSTRAINT "field_boundary_versions_id_field_id_key" UNIQUE ("id", "field_id");

ALTER TABLE "fields"
  ADD COLUMN "current_boundary_version_id" UUID,
  ADD COLUMN "current_region_context_version_id" UUID;

UPDATE "fields" AS field
SET "current_boundary_version_id" = (
  SELECT boundary.id
  FROM "field_boundary_versions" AS boundary
  WHERE boundary.field_id = field.id
  ORDER BY boundary.version DESC, boundary.id ASC
  LIMIT 1
)
WHERE EXISTS (SELECT 1 FROM "field_boundary_versions" AS boundary WHERE boundary.field_id = field.id);

CREATE UNIQUE INDEX "fields_current_boundary_version_id_id_key"
  ON "fields" ("current_boundary_version_id", "id");
CREATE UNIQUE INDEX "fields_current_region_context_version_id_id_key"
  ON "fields" ("current_region_context_version_id", "id");

ALTER TABLE "fields"
  ADD CONSTRAINT "fields_current_boundary_same_field_fkey"
    FOREIGN KEY ("current_boundary_version_id", "id")
    REFERENCES "field_boundary_versions" ("id", "field_id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "field_region_context_versions" (
  "id" UUID NOT NULL,
  "field_id" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "resolution_location_key" TEXT NOT NULL,
  "administrative_state" TEXT NOT NULL DEFAULT 'UNRESOLVED',
  "administrative_code" TEXT,
  "administrative_label" TEXT,
  "administrative_source_id" TEXT,
  "administrative_data_version" TEXT,
  "administrative_confidence" DOUBLE PRECISION,
  "administrative_resolved_at" TIMESTAMPTZ(6),
  "agricultural_state" TEXT NOT NULL DEFAULT 'UNRESOLVED',
  "agricultural_code" TEXT,
  "agricultural_label" TEXT,
  "agricultural_source_id" TEXT,
  "agricultural_data_version" TEXT,
  "agricultural_confidence" DOUBLE PRECISION,
  "agricultural_resolved_at" TIMESTAMPTZ(6),
  "override_code" TEXT,
  "override_label" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "field_region_context_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "field_region_context_versions_id_field_id_key" UNIQUE ("id", "field_id"),
  CONSTRAINT "field_region_context_versions_field_id_version_key" UNIQUE ("field_id", "version"),
  CONSTRAINT "field_region_context_versions_field_id_fkey"
    FOREIGN KEY ("field_id") REFERENCES "fields" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "field_region_context_admin_state_check" CHECK (
    ("administrative_state" = 'RESOLVED'
      AND "administrative_code" IS NOT NULL AND btrim("administrative_code") <> ''
      AND "administrative_label" IS NOT NULL AND btrim("administrative_label") <> ''
      AND "administrative_source_id" IS NOT NULL AND btrim("administrative_source_id") <> ''
      AND "administrative_data_version" IS NOT NULL AND btrim("administrative_data_version") <> ''
      AND "administrative_confidence" IS NOT NULL
      AND "administrative_confidence" BETWEEN 0 AND 1 AND "administrative_resolved_at" IS NOT NULL)
    OR ("administrative_state" = 'UNRESOLVED'
      AND "administrative_code" IS NULL AND "administrative_label" IS NULL
      AND "administrative_source_id" IS NULL AND "administrative_data_version" IS NULL
      AND "administrative_confidence" IS NULL AND "administrative_resolved_at" IS NULL)
  ),
  CONSTRAINT "field_region_context_agricultural_state_check" CHECK (
    ("agricultural_state" = 'RESOLVED'
      AND "agricultural_code" IS NOT NULL AND btrim("agricultural_code") <> ''
      AND "agricultural_label" IS NOT NULL AND btrim("agricultural_label") <> ''
      AND "agricultural_source_id" IS NOT NULL AND btrim("agricultural_source_id") <> ''
      AND "agricultural_data_version" IS NOT NULL AND btrim("agricultural_data_version") <> ''
      AND "agricultural_confidence" IS NOT NULL
      AND "agricultural_confidence" BETWEEN 0 AND 1 AND "agricultural_resolved_at" IS NOT NULL)
    OR ("agricultural_state" = 'UNRESOLVED'
      AND "agricultural_code" IS NULL AND "agricultural_label" IS NULL
      AND "agricultural_source_id" IS NULL AND "agricultural_data_version" IS NULL
      AND "agricultural_confidence" IS NULL AND "agricultural_resolved_at" IS NULL)
  ),
  CONSTRAINT "field_region_context_override_check" CHECK (
    ("override_code" IS NULL AND "override_label" IS NULL)
    OR ("override_code" IS NOT NULL AND btrim("override_code") <> ''
      AND "override_label" IS NOT NULL AND btrim("override_label") <> '')
  )
);

CREATE INDEX "field_region_context_versions_field_id_resolution_location_key_idx"
  ON "field_region_context_versions" ("field_id", "resolution_location_key");
ALTER TABLE "fields"
  ADD CONSTRAINT "fields_current_region_context_same_field_fkey"
    FOREIGN KEY ("current_region_context_version_id", "id")
    REFERENCES "field_region_context_versions" ("id", "field_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Boundary and region versions are append-only history. Point transitions clear
-- only the Field pointer; neither operation erases historical rows.
CREATE FUNCTION reject_field_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Field history is append-only' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER field_boundary_versions_append_only
  BEFORE UPDATE OR DELETE ON "field_boundary_versions"
  FOR EACH ROW EXECUTE FUNCTION reject_field_history_mutation();
CREATE TRIGGER field_region_context_versions_append_only
  BEFORE UPDATE OR DELETE ON "field_region_context_versions"
  FOR EACH ROW EXECUTE FUNCTION reject_field_history_mutation();

-- Generalize the existing Season command store in place so existing replay
-- records/results survive. Onboarding's separate IdempotencyRecord is unchanged.
ALTER TABLE "season_command_idempotency_records" RENAME TO "business_command_idempotency_records";
ALTER TABLE "business_command_idempotency_records" RENAME CONSTRAINT "season_command_idempotency_records_pkey" TO "business_command_idempotency_records_pkey";
ALTER TABLE "business_command_idempotency_records" RENAME CONSTRAINT "season_command_check" TO "business_command_check";
ALTER TABLE "business_command_idempotency_records" DROP CONSTRAINT "business_command_check";
ALTER TABLE "business_command_idempotency_records"
  ADD CONSTRAINT "business_command_check" CHECK ("command" IN ('CREATE', 'ACTIVATE', 'ADD_PLAN_TASK', 'CREATE_FIELD'));
ALTER TABLE "business_command_idempotency_records" RENAME CONSTRAINT "season_command_expiry_check" TO "business_command_expiry_check";
ALTER TABLE "business_command_idempotency_records" ALTER COLUMN "season_id" DROP NOT NULL;
ALTER TABLE "business_command_idempotency_records" ADD COLUMN "field_id" UUID;
ALTER TABLE "business_command_idempotency_records"
  ADD CONSTRAINT "business_command_exactly_one_target_check"
    CHECK (("field_id" IS NOT NULL)::integer + ("season_id" IS NOT NULL)::integer = 1);
ALTER TABLE "business_command_idempotency_records"
  ADD CONSTRAINT "business_command_field_business_fkey"
    FOREIGN KEY ("field_id", "business_id") REFERENCES "fields" ("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER INDEX "season_commands_user_business_command_key" RENAME TO "business_command_user_business_command_key";
ALTER INDEX "season_command_idempotency_records_season_id_idx" RENAME TO "business_command_idempotency_records_season_id_idx";
ALTER INDEX "season_command_idempotency_records_expires_at_idx" RENAME TO "business_command_idempotency_records_expires_at_idx";
CREATE INDEX "business_command_idempotency_records_field_id_idx"
  ON "business_command_idempotency_records" ("field_id");
