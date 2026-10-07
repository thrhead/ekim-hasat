ALTER TABLE "calendar_read_snapshots"
  ADD COLUMN "included_field_ids" JSONB NOT NULL DEFAULT '[]'::jsonb;
