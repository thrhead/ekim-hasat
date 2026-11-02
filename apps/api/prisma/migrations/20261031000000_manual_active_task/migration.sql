ALTER TABLE planned_tasks ADD COLUMN origin TEXT NOT NULL DEFAULT 'PLAN_DERIVED';
ALTER TABLE planned_tasks ADD CONSTRAINT planned_task_origin_check CHECK (origin IN ('PLAN_DERIVED', 'POST_ACTIVATION_MANUAL') AND (origin <> 'POST_ACTIVATION_MANUAL' OR source_template_task_key IS NULL));
CREATE TABLE manual_task_creation_receipts (
  task_id UUID PRIMARY KEY, mutation_id UUID NOT NULL, business_id UUID NOT NULL,
  field_id UUID NOT NULL, season_id UUID NOT NULL, season_plan_id UUID NOT NULL,
  actor_user_id UUID NOT NULL, actor_membership_id UUID NOT NULL,
  payload_fingerprint TEXT NOT NULL, accepted_result JSONB NOT NULL,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, mutation_id),
  UNIQUE (task_id, season_plan_id),
  FOREIGN KEY (task_id, season_plan_id) REFERENCES planned_tasks(id, season_plan_id) ON DELETE RESTRICT,
  FOREIGN KEY (season_plan_id, season_id) REFERENCES season_plans(id, season_id) ON DELETE RESTRICT,
  FOREIGN KEY (season_id, business_id, field_id) REFERENCES seasons(id, business_id, field_id) ON DELETE RESTRICT,
  FOREIGN KEY (field_id, business_id) REFERENCES fields(id, business_id) ON DELETE RESTRICT,
  FOREIGN KEY (actor_membership_id, business_id, actor_user_id) REFERENCES memberships(id, business_id, user_id) ON DELETE RESTRICT,
  FOREIGN KEY (actor_user_id) REFERENCES application_users(id) ON DELETE RESTRICT
);
CREATE FUNCTION preserve_manual_task_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Manual task creation receipts are immutable' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER manual_task_receipt_immutable BEFORE UPDATE OR DELETE ON manual_task_creation_receipts
  FOR EACH ROW EXECUTE FUNCTION preserve_manual_task_receipt();
-- Extend the established active-task mutation guard for the append-only Skip
-- event. The repository inserts the TaskSkip in the same transaction before
-- incrementing PlannedTask.version; absent that matching row, this remains a
-- rejected active-task update.
CREATE OR REPLACE FUNCTION check_planned_task_context() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  old_parent seasons%ROWTYPE;
  parent seasons%ROWTYPE;
  old_plan_status text;
  active_date_adjustment boolean := false;
  active_task_skip boolean := false;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.origin IS DISTINCT FROM OLD.origin THEN
      RAISE EXCEPTION 'Task origin is immutable' USING ERRCODE = '23514';
    END IF;
    SELECT s.* INTO old_parent FROM seasons s JOIN season_plans p ON p.season_id = s.id
      WHERE p.id = OLD.season_plan_id FOR UPDATE OF s, p;
    SELECT p.status INTO old_plan_status FROM season_plans p WHERE p.id = OLD.season_plan_id;
    IF old_parent.status <> 'DRAFT' THEN
      active_date_adjustment := old_parent.status = 'ACTIVE'
        AND old_plan_status = 'APPROVED'
        AND NEW.version = OLD.version + 1
        AND NEW.planned_local_date <> OLD.planned_local_date
        AND (to_jsonb(NEW) - 'planned_local_date' - 'version')
          IS NOT DISTINCT FROM (to_jsonb(OLD) - 'planned_local_date' - 'version')
        AND NOT EXISTS (SELECT 1 FROM task_completions c WHERE c.planned_task_id = OLD.id);

      active_task_skip := old_parent.status = 'ACTIVE'
        AND old_plan_status = 'APPROVED'
        AND NEW.version = OLD.version + 1
        AND NEW.planned_local_date = OLD.planned_local_date
        AND (to_jsonb(NEW) - 'version') IS NOT DISTINCT FROM (to_jsonb(OLD) - 'version')
        AND NOT EXISTS (SELECT 1 FROM task_completions c WHERE c.planned_task_id = OLD.id)
        AND EXISTS (
          SELECT 1 FROM task_skips sk
          WHERE sk.planned_task_id = OLD.id
            AND sk.season_plan_id = OLD.season_plan_id
            AND sk.season_id = old_parent.id
            AND sk.business_id = old_parent.business_id
            AND sk.field_id = old_parent.field_id
            AND sk.base_task_version = OLD.version
            AND sk.accepted_task_version = NEW.version
        );

      IF NOT active_date_adjustment AND NOT active_task_skip THEN
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
    IF parent.status <> 'DRAFT' AND NOT (TG_OP = 'UPDATE' AND (active_date_adjustment OR active_task_skip) AND parent.status = 'ACTIVE') AND NOT (TG_OP = 'INSERT' AND parent.status = 'ACTIVE' AND NEW.origin = 'POST_ACTIVATION_MANUAL' AND EXISTS (SELECT 1 FROM season_plans WHERE id = NEW.season_plan_id AND status = 'APPROVED')) THEN
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
