BEGIN;

-- Composite candidate keys allow completion scope to be enforced by PostgreSQL FKs.
ALTER TABLE memberships
  ADD CONSTRAINT memberships_id_business_id_user_id_key UNIQUE (id, business_id, user_id);
ALTER TABLE seasons
  ADD CONSTRAINT seasons_id_business_id_field_id_key UNIQUE (id, business_id, field_id);
ALTER TABLE season_plans
  ADD CONSTRAINT season_plans_id_season_id_key UNIQUE (id, season_id);
ALTER TABLE planned_tasks
  ADD CONSTRAINT planned_tasks_id_season_plan_id_key UNIQUE (id, season_plan_id);

CREATE TABLE task_completions (
  id uuid PRIMARY KEY,
  planned_task_id uuid NOT NULL UNIQUE,
  season_plan_id uuid NOT NULL,
  season_id uuid NOT NULL,
  field_id uuid NOT NULL,
  business_id uuid NOT NULL,
  actor_user_id uuid NOT NULL,
  actor_membership_id uuid NOT NULL,
  occurred_at timestamptz(6) NOT NULL,
  recorded_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  base_task_version integer NOT NULL,
  payload_fingerprint text NOT NULL,
  task_title_snapshot text NOT NULL,
  planned_local_date_snapshot date NOT NULL,

  CONSTRAINT task_completions_planned_task_id_season_plan_id_key UNIQUE (planned_task_id, season_plan_id),
  CONSTRAINT task_completions_positive_base_version_check CHECK (base_task_version > 0),
  CONSTRAINT task_completions_fingerprint_check CHECK (length(payload_fingerprint) > 0),
  CONSTRAINT task_completions_title_snapshot_check CHECK (length(btrim(task_title_snapshot)) > 0),
  CONSTRAINT task_completions_planned_task_id_season_plan_id_fkey
    FOREIGN KEY (planned_task_id, season_plan_id) REFERENCES planned_tasks (id, season_plan_id) ON DELETE RESTRICT,
  CONSTRAINT task_completions_season_plan_id_season_id_fkey
    FOREIGN KEY (season_plan_id, season_id) REFERENCES season_plans (id, season_id) ON DELETE RESTRICT,
  CONSTRAINT task_completions_season_id_business_id_field_id_fkey
    FOREIGN KEY (season_id, business_id, field_id) REFERENCES seasons (id, business_id, field_id) ON DELETE RESTRICT,
  CONSTRAINT task_completions_field_id_business_id_fkey
    FOREIGN KEY (field_id, business_id) REFERENCES fields (id, business_id) ON DELETE RESTRICT,
  CONSTRAINT task_completions_season_id_fkey
    FOREIGN KEY (season_id) REFERENCES season_context_snapshots (season_id) ON DELETE RESTRICT,
  CONSTRAINT task_completions_actor_user_id_fkey
    FOREIGN KEY (actor_user_id) REFERENCES application_users (id) ON DELETE RESTRICT,
  CONSTRAINT task_completions_actor_membership_id_business_id_actor_user_id_fkey
    FOREIGN KEY (actor_membership_id, business_id, actor_user_id)
    REFERENCES memberships (id, business_id, user_id) ON DELETE RESTRICT
);

CREATE INDEX task_completions_field_occurred_id_idx
  ON task_completions (field_id, occurred_at DESC, id DESC);
CREATE INDEX task_completions_season_occurred_id_idx
  ON task_completions (season_id, occurred_at DESC, id DESC);
CREATE INDEX task_completions_business_id_idx ON task_completions (business_id);

CREATE FUNCTION prevent_task_completion_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Task completion records are append-only' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER task_completions_append_only_guard
  BEFORE UPDATE OR DELETE ON task_completions
  FOR EACH ROW EXECUTE FUNCTION prevent_task_completion_mutation();

COMMIT;
