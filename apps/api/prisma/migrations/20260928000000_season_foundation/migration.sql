-- AlterTable
ALTER TABLE "businesses" ADD COLUMN     "timezone" TEXT;

-- CreateTable
CREATE TABLE "crop_definition_versions" (
    "id" UUID NOT NULL,
    "crop_key" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "production_type" TEXT,
    "selectable" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "crop_definition_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custom_crops" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "display_name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "custom_crops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "validated_template_versions" (
    "id" UUID NOT NULL,
    "template_key" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "crop_definition_version_id" UUID NOT NULL,
    "region_selector" TEXT,
    "task_definitions" JSONB NOT NULL,
    "published" BOOLEAN NOT NULL DEFAULT true,
    "available" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "validated_template_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seasons" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "field_id" UUID NOT NULL,
    "crop_key" TEXT,
    "crop_definition_version_id" UUID,
    "custom_crop_id" UUID,
    "actual_planting_date" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activated_at" TIMESTAMPTZ(6),

    CONSTRAINT "seasons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "season_plans" (
    "id" UUID NOT NULL,
    "season_id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "template_version_id" UUID,
    "source_snapshot" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',

    CONSTRAINT "season_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "planned_tasks" (
    "id" UUID NOT NULL,
    "season_plan_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "planned_local_date" DATE NOT NULL,
    "source_template_task_key" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "planned_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "season_context_snapshots" (
    "season_id" UUID NOT NULL,
    "field_boundary_version_id" UUID,
    "region_context" JSONB,
    "crop_snapshot" JSONB NOT NULL,
    "source" TEXT NOT NULL,
    "template_version_id" UUID,
    "activated_at" TIMESTAMPTZ(6) NOT NULL,
    "business_timezone" TEXT NOT NULL,
    "activated_local_date" DATE NOT NULL,

    CONSTRAINT "season_context_snapshots_pkey" PRIMARY KEY ("season_id")
);

-- CreateTable
CREATE TABLE "season_command_idempotency_records" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "command" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "payload_fingerprint" TEXT NOT NULL,
    "season_id" UUID NOT NULL,
    "result" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "season_command_idempotency_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "crop_definition_versions_crop_key_version_key" ON "crop_definition_versions"("crop_key", "version");

-- CreateIndex
CREATE UNIQUE INDEX "crop_definition_versions_id_crop_key_key" ON "crop_definition_versions"("id", "crop_key");

-- CreateIndex
CREATE INDEX "custom_crops_business_id_idx" ON "custom_crops"("business_id");

-- CreateIndex
CREATE UNIQUE INDEX "custom_crops_id_business_id_key" ON "custom_crops"("id", "business_id");

-- CreateIndex
CREATE INDEX "validated_template_versions_crop_definition_version_id_avai_idx" ON "validated_template_versions"("crop_definition_version_id", "available");

-- CreateIndex
CREATE UNIQUE INDEX "validated_template_versions_template_key_version_key" ON "validated_template_versions"("template_key", "version");

-- CreateIndex
CREATE INDEX "seasons_business_id_status_idx" ON "seasons"("business_id", "status");

-- CreateIndex
CREATE INDEX "seasons_field_id_idx" ON "seasons"("field_id");

-- CreateIndex
CREATE UNIQUE INDEX "seasons_id_business_id_key" ON "seasons"("id", "business_id");

-- CreateIndex
CREATE UNIQUE INDEX "season_plans_season_id_key" ON "season_plans"("season_id");

-- CreateIndex
CREATE INDEX "season_plans_template_version_id_idx" ON "season_plans"("template_version_id");

-- CreateIndex
CREATE INDEX "planned_tasks_season_plan_id_planned_local_date_idx" ON "planned_tasks"("season_plan_id", "planned_local_date");

-- CreateIndex
CREATE INDEX "season_context_snapshots_field_boundary_version_id_idx" ON "season_context_snapshots"("field_boundary_version_id");

-- CreateIndex
CREATE INDEX "season_context_snapshots_template_version_id_idx" ON "season_context_snapshots"("template_version_id");

-- CreateIndex
CREATE INDEX "season_command_idempotency_records_season_id_idx" ON "season_command_idempotency_records"("season_id");

-- CreateIndex
CREATE INDEX "season_command_idempotency_records_expires_at_idx" ON "season_command_idempotency_records"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "season_commands_user_business_command_key" ON "season_command_idempotency_records"("user_id", "business_id", "command", "key");

-- CreateIndex
CREATE UNIQUE INDEX "fields_id_business_id_key" ON "fields"("id", "business_id");

-- AddForeignKey
ALTER TABLE "custom_crops" ADD CONSTRAINT "custom_crops_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "validated_template_versions" ADD CONSTRAINT "validated_template_versions_crop_definition_version_id_fkey" FOREIGN KEY ("crop_definition_version_id") REFERENCES "crop_definition_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seasons" ADD CONSTRAINT "seasons_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seasons" ADD CONSTRAINT "seasons_field_id_business_id_fkey" FOREIGN KEY ("field_id", "business_id") REFERENCES "fields"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seasons" ADD CONSTRAINT "seasons_crop_definition_version_id_crop_key_fkey" FOREIGN KEY ("crop_definition_version_id", "crop_key") REFERENCES "crop_definition_versions"("id", "crop_key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seasons" ADD CONSTRAINT "seasons_custom_crop_id_business_id_fkey" FOREIGN KEY ("custom_crop_id", "business_id") REFERENCES "custom_crops"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "season_plans" ADD CONSTRAINT "season_plans_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "seasons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "season_plans" ADD CONSTRAINT "season_plans_template_version_id_fkey" FOREIGN KEY ("template_version_id") REFERENCES "validated_template_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planned_tasks" ADD CONSTRAINT "planned_tasks_season_plan_id_fkey" FOREIGN KEY ("season_plan_id") REFERENCES "season_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "season_context_snapshots" ADD CONSTRAINT "season_context_snapshots_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "seasons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "season_context_snapshots" ADD CONSTRAINT "season_context_snapshots_field_boundary_version_id_fkey" FOREIGN KEY ("field_boundary_version_id") REFERENCES "field_boundary_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "season_context_snapshots" ADD CONSTRAINT "season_context_snapshots_template_version_id_fkey" FOREIGN KEY ("template_version_id") REFERENCES "validated_template_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "season_command_idempotency_records" ADD CONSTRAINT "season_command_idempotency_records_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "application_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "season_command_idempotency_records" ADD CONSTRAINT "season_command_idempotency_records_season_id_business_id_fkey" FOREIGN KEY ("season_id", "business_id") REFERENCES "seasons"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Additive persistence foundation only. No production agronomic content is seeded.
-- Prisma cannot express CHECK constraints, partial indexes, or these cross-row guards.
ALTER TABLE crop_definition_versions ADD CONSTRAINT crop_definition_text_check
  CHECK (btrim(crop_key) <> '' AND btrim(version) <> '' AND btrim(display_name) <> '');
ALTER TABLE custom_crops ADD CONSTRAINT custom_crop_name_check
  CHECK (display_name = btrim(display_name) AND display_name <> '');
ALTER TABLE validated_template_versions ADD CONSTRAINT template_definitions_array_check
  CHECK (jsonb_typeof(task_definitions) = 'array');
ALTER TABLE seasons ADD CONSTRAINT season_crop_identity_check CHECK (
  (crop_key IS NOT NULL AND crop_definition_version_id IS NOT NULL AND custom_crop_id IS NULL)
  OR (crop_key IS NULL AND crop_definition_version_id IS NULL AND custom_crop_id IS NOT NULL)
);
ALTER TABLE seasons ADD CONSTRAINT season_lifecycle_check CHECK (
  (status = 'DRAFT' AND activated_at IS NULL) OR (status = 'ACTIVE' AND activated_at IS NOT NULL)
);
ALTER TABLE seasons ADD CONSTRAINT season_version_check CHECK (version > 0);
CREATE UNIQUE INDEX seasons_central_logical_identity_key
  ON seasons (business_id, field_id, crop_key, actual_planting_date) WHERE crop_key IS NOT NULL;
CREATE UNIQUE INDEX seasons_custom_logical_identity_key
  ON seasons (business_id, field_id, custom_crop_id, actual_planting_date) WHERE custom_crop_id IS NOT NULL;
ALTER TABLE season_plans ADD CONSTRAINT season_plan_source_check CHECK (
  (source = 'MANUAL' AND template_version_id IS NULL)
  OR (source = 'VALIDATED_TEMPLATE' AND template_version_id IS NOT NULL)
);
ALTER TABLE season_plans ADD CONSTRAINT season_plan_status_check CHECK (status IN ('DRAFT', 'APPROVED'));
ALTER TABLE planned_tasks ADD CONSTRAINT planned_task_title_check CHECK (btrim(title) <> '');
ALTER TABLE planned_tasks ADD CONSTRAINT planned_task_version_check CHECK (version > 0);
ALTER TABLE season_context_snapshots ADD CONSTRAINT season_snapshot_source_check CHECK (
  (source = 'MANUAL' AND template_version_id IS NULL)
  OR (source = 'VALIDATED_TEMPLATE' AND template_version_id IS NOT NULL)
);
ALTER TABLE season_context_snapshots ADD CONSTRAINT season_snapshot_timezone_check CHECK (btrim(business_timezone) <> '');
ALTER TABLE season_command_idempotency_records ADD CONSTRAINT season_command_check CHECK (command IN ('CREATE', 'ACTIVATE'));
ALTER TABLE season_command_idempotency_records ADD CONSTRAINT season_command_expiry_check CHECK (expires_at > created_at);

-- A template-backed plan must pin a template for this exact immutable crop version.
CREATE FUNCTION check_season_plan_template() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.source = 'VALIDATED_TEMPLATE' AND NOT EXISTS (
    SELECT 1 FROM seasons s JOIN validated_template_versions t
      ON t.crop_definition_version_id = s.crop_definition_version_id
    WHERE s.id = NEW.season_id AND t.id = NEW.template_version_id
  ) THEN
    RAISE EXCEPTION 'Plan template must match season crop definition' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER season_plan_template_guard BEFORE INSERT OR UPDATE ON season_plans
  FOR EACH ROW EXECUTE FUNCTION check_season_plan_template();

-- Lock the parent season so task writes serialize with later activation transactions.
CREATE FUNCTION check_planned_task_context() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  parent seasons%ROWTYPE;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT s.* INTO parent FROM seasons s JOIN season_plans p ON p.season_id = s.id
      WHERE p.id = OLD.season_plan_id FOR UPDATE OF s;
    IF parent.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'ACTIVE season tasks are read-only' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT s.* INTO parent FROM seasons s JOIN season_plans p ON p.season_id = s.id
      WHERE p.id = NEW.season_plan_id FOR UPDATE OF s;
    IF parent.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'ACTIVE season tasks are read-only' USING ERRCODE = '23514';
    END IF;
    IF NEW.planned_local_date < parent.actual_planting_date THEN
      RAISE EXCEPTION 'Planned date precedes actual planting date' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  RETURN OLD;
END;
$$;
CREATE TRIGGER planned_task_context_guard BEFORE INSERT OR UPDATE OR DELETE ON planned_tasks
  FOR EACH ROW EXECUTE FUNCTION check_planned_task_context();

-- Runtime definitions are immutable; availability flags remain operational metadata.
CREATE FUNCTION preserve_crop_definition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - 'selectable') IS DISTINCT FROM (to_jsonb(OLD) - 'selectable') THEN
    RAISE EXCEPTION 'Crop definition versions are immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER crop_definition_immutable BEFORE UPDATE ON crop_definition_versions
  FOR EACH ROW EXECUTE FUNCTION preserve_crop_definition();
CREATE FUNCTION preserve_template_definition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - 'available') IS DISTINCT FROM (to_jsonb(OLD) - 'available') THEN
    RAISE EXCEPTION 'Published template versions are immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER template_definition_immutable BEFORE UPDATE ON validated_template_versions
  FOR EACH ROW EXECUTE FUNCTION preserve_template_definition();
