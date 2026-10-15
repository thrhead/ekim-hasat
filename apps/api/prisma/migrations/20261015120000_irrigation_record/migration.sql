CREATE TABLE irrigation_records (
  id uuid NOT NULL,
  business_id uuid NOT NULL,
  field_id uuid NOT NULL,
  season_id uuid,
  actor_user_id uuid NOT NULL,
  actor_membership_id uuid NOT NULL,
  occurred_at timestamptz(6) NOT NULL,
  recorded_at timestamptz(6) NOT NULL,
  method text,
  duration_minutes integer,
  water_volume_cubic_metres numeric(12, 1),
  note text,
  CONSTRAINT irrigation_records_pkey PRIMARY KEY (business_id, id),
  CONSTRAINT irrigation_records_business_id_fkey
    FOREIGN KEY (business_id) REFERENCES businesses (id) ON DELETE RESTRICT,
  CONSTRAINT irrigation_records_field_id_business_id_fkey
    FOREIGN KEY (field_id, business_id) REFERENCES fields (id, business_id) ON DELETE RESTRICT,
  CONSTRAINT irrigation_records_season_id_business_id_field_id_fkey
    FOREIGN KEY (season_id, business_id, field_id) REFERENCES seasons (id, business_id, field_id) ON DELETE RESTRICT,
  CONSTRAINT irrigation_records_actor_user_id_fkey
    FOREIGN KEY (actor_user_id) REFERENCES application_users (id) ON DELETE RESTRICT,
  CONSTRAINT irrigation_records_actor_membership_id_business_id_actor_user_id_fkey
    FOREIGN KEY (actor_membership_id, business_id, actor_user_id)
    REFERENCES memberships (id, business_id, user_id) ON DELETE RESTRICT
);

CREATE INDEX irrigation_records_field_history_idx
  ON irrigation_records (business_id, field_id, occurred_at DESC, id DESC);
CREATE INDEX irrigation_records_field_season_history_idx
  ON irrigation_records (business_id, field_id, season_id, occurred_at DESC, id DESC);

CREATE FUNCTION reject_irrigation_record_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Irrigation records are append-only' USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER irrigation_records_append_only
  BEFORE UPDATE OR DELETE ON irrigation_records
  FOR EACH ROW EXECUTE FUNCTION reject_irrigation_record_mutation();
