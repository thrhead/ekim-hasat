-- Season setup does not support changing crop/date/field after creation.
-- Keep status, optimistic version, and activation timestamp updates available
-- for the later transactional activation implementation.
CREATE FUNCTION preserve_season_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.id, NEW.business_id, NEW.field_id, NEW.crop_key,
         NEW.crop_definition_version_id, NEW.custom_crop_id, NEW.actual_planting_date)
      IS DISTINCT FROM
     ROW(OLD.id, OLD.business_id, OLD.field_id, OLD.crop_key,
         OLD.crop_definition_version_id, OLD.custom_crop_id, OLD.actual_planting_date) THEN
    RAISE EXCEPTION 'Season identity and actual planting date are immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER season_identity_guard BEFORE UPDATE ON seasons
  FOR EACH ROW EXECUTE FUNCTION preserve_season_identity();

CREATE FUNCTION preserve_season_plan_parent() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.season_id IS DISTINCT FROM OLD.season_id THEN
    RAISE EXCEPTION 'Season plans cannot be reassigned' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER season_plan_parent_guard BEFORE UPDATE ON season_plans
  FOR EACH ROW EXECUTE FUNCTION preserve_season_plan_parent();

-- The existing UPDATE guard cannot protect a delete/reinsert sequence.
CREATE FUNCTION preserve_season_snapshot_row() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Activation context snapshots cannot be deleted' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER season_snapshot_delete_guard BEFORE DELETE ON season_context_snapshots
  FOR EACH ROW EXECUTE FUNCTION preserve_season_snapshot_row();
