-- Preserve activation context without adding activation application behavior.
CREATE FUNCTION check_season_snapshot_context() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  parent seasons%ROWTYPE;
  plan season_plans%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Activation context snapshots are immutable' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO parent FROM seasons WHERE id = NEW.season_id FOR UPDATE;
  SELECT * INTO plan FROM season_plans WHERE season_id = NEW.season_id;
  IF parent.status IS DISTINCT FROM 'ACTIVE'
      OR NEW.activated_at IS DISTINCT FROM parent.activated_at
      OR NEW.source IS DISTINCT FROM plan.source
      OR NEW.template_version_id IS DISTINCT FROM plan.template_version_id THEN
    RAISE EXCEPTION 'Snapshot must match active season and plan context' USING ERRCODE = '23514';
  END IF;
  IF NEW.field_boundary_version_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM field_boundary_versions
      WHERE id = NEW.field_boundary_version_id AND field_id = parent.field_id
  ) THEN
    RAISE EXCEPTION 'Snapshot boundary must belong to season field' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = NEW.business_timezone)
      OR NEW.activated_local_date IS DISTINCT FROM (NEW.activated_at AT TIME ZONE NEW.business_timezone)::date THEN
    RAISE EXCEPTION 'Snapshot timezone and local activation date must agree' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER season_snapshot_context_guard BEFORE INSERT OR UPDATE ON season_context_snapshots
  FOR EACH ROW EXECUTE FUNCTION check_season_snapshot_context();
