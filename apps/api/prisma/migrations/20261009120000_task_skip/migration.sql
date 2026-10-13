BEGIN;

CREATE TABLE task_skips (
  id uuid PRIMARY KEY,
  skip_id uuid NOT NULL,
  planned_task_id uuid NOT NULL,
  season_plan_id uuid NOT NULL,
  season_id uuid NOT NULL,
  field_id uuid NOT NULL,
  business_id uuid NOT NULL,
  actor_user_id uuid NOT NULL,
  actor_membership_id uuid NOT NULL,
  skipped_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  base_task_version integer NOT NULL,
  accepted_task_version integer NOT NULL,
  payload_fingerprint text NOT NULL,
  task_title_snapshot text NOT NULL,
  planned_local_date_snapshot date NOT NULL,

  CONSTRAINT task_skips_business_id_skip_id_key UNIQUE (business_id, skip_id),
  CONSTRAINT task_skips_planned_task_id_key UNIQUE (planned_task_id),
  CONSTRAINT task_skips_planned_task_id_season_plan_id_key UNIQUE (planned_task_id, season_plan_id),
  CONSTRAINT task_skips_positive_base_version_check CHECK (base_task_version > 0),
  CONSTRAINT task_skips_next_version_check CHECK (accepted_task_version = base_task_version + 1),
  CONSTRAINT task_skips_fingerprint_check CHECK (length(payload_fingerprint) > 0),
  CONSTRAINT task_skips_planned_task_id_season_plan_id_fkey
    FOREIGN KEY (planned_task_id, season_plan_id) REFERENCES planned_tasks (id, season_plan_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT task_skips_season_plan_id_season_id_fkey
    FOREIGN KEY (season_plan_id, season_id) REFERENCES season_plans (id, season_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT task_skips_season_id_business_id_field_id_fkey
    FOREIGN KEY (season_id, business_id, field_id) REFERENCES seasons (id, business_id, field_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT task_skips_field_id_business_id_fkey
    FOREIGN KEY (field_id, business_id) REFERENCES fields (id, business_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT task_skips_business_id_fkey
    FOREIGN KEY (business_id) REFERENCES businesses (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT task_skips_actor_user_id_fkey
    FOREIGN KEY (actor_user_id) REFERENCES application_users (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT task_skips_actor_membership_id_business_id_actor_user_id_fkey
    FOREIGN KEY (actor_membership_id, business_id, actor_user_id)
    REFERENCES memberships (id, business_id, user_id) ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX task_skips_field_id_skipped_at_id_idx
  ON task_skips (field_id, skipped_at DESC, id DESC);

CREATE INDEX task_skips_season_id_skipped_at_id_idx
  ON task_skips (season_id, skipped_at DESC, id DESC);

COMMIT;
