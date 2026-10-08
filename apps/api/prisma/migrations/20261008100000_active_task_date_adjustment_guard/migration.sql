CREATE OR REPLACE FUNCTION check_planned_task_context() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  old_parent seasons%ROWTYPE;
  parent seasons%ROWTYPE;
  active_date_adjustment boolean := false;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    SELECT s.* INTO old_parent FROM seasons s JOIN season_plans p ON p.season_id = s.id
      WHERE p.id = OLD.season_plan_id FOR UPDATE OF s;
    IF old_parent.status <> 'DRAFT' THEN
      active_date_adjustment := old_parent.status = 'ACTIVE'
        AND NEW.version = OLD.version + 1
        AND NEW.planned_local_date <> OLD.planned_local_date
        AND (to_jsonb(NEW) - 'planned_local_date' - 'version')
          IS NOT DISTINCT FROM (to_jsonb(OLD) - 'planned_local_date' - 'version');
      IF NOT active_date_adjustment THEN
        RAISE EXCEPTION 'ACTIVE season tasks are read-only except for versioned date adjustment' USING ERRCODE = '23514';
      END IF;
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    SELECT s.* INTO old_parent FROM seasons s JOIN season_plans p ON p.season_id = s.id
      WHERE p.id = OLD.season_plan_id FOR UPDATE OF s;
    IF old_parent.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'ACTIVE season tasks are read-only' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT s.* INTO parent FROM seasons s JOIN season_plans p ON p.season_id = s.id
      WHERE p.id = NEW.season_plan_id FOR UPDATE OF s;
    IF parent.status <> 'DRAFT' AND NOT (TG_OP = 'UPDATE' AND active_date_adjustment AND parent.status = 'ACTIVE') THEN
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
