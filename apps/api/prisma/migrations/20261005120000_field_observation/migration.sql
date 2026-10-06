CREATE TABLE field_observations (
  id uuid NOT NULL,
  business_id uuid NOT NULL,
  field_id uuid NOT NULL,
  season_id uuid,
  actor_user_id uuid NOT NULL,
  actor_membership_id uuid NOT NULL,
  description text NOT NULL,
  occurred_at timestamptz(6) NOT NULL,
  accepted_at timestamptz(6) NOT NULL,
  payload_fingerprint text NOT NULL,
  CONSTRAINT field_observations_payload_fingerprint_check CHECK (length(payload_fingerprint) > 0),
  CONSTRAINT field_observations_pkey PRIMARY KEY (business_id, id),
  CONSTRAINT field_observations_business_id_fkey
    FOREIGN KEY (business_id) REFERENCES businesses (id) ON DELETE RESTRICT,
  CONSTRAINT field_observations_field_id_business_id_fkey
    FOREIGN KEY (field_id, business_id) REFERENCES fields (id, business_id) ON DELETE RESTRICT,
  CONSTRAINT field_observations_season_id_business_id_field_id_fkey
    FOREIGN KEY (season_id, business_id, field_id) REFERENCES seasons (id, business_id, field_id) ON DELETE RESTRICT,
  CONSTRAINT field_observations_actor_user_id_fkey
    FOREIGN KEY (actor_user_id) REFERENCES application_users (id) ON DELETE RESTRICT,
  CONSTRAINT field_observations_actor_membership_id_business_id_actor_user_id_fkey
    FOREIGN KEY (actor_membership_id, business_id, actor_user_id)
    REFERENCES memberships (id, business_id, user_id) ON DELETE RESTRICT
);

CREATE INDEX field_observations_field_diary_idx
  ON field_observations (business_id, field_id, occurred_at DESC, id DESC);
CREATE INDEX field_observations_season_diary_idx
  ON field_observations (business_id, season_id, occurred_at DESC, id DESC);

CREATE FUNCTION reject_field_observation_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Field observations are append-only' USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER field_observations_append_only
  BEFORE UPDATE OR DELETE ON field_observations
  FOR EACH ROW EXECUTE FUNCTION reject_field_observation_mutation();
