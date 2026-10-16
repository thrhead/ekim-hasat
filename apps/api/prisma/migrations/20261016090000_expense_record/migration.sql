CREATE TABLE expenses (
  id uuid NOT NULL,
  business_id uuid NOT NULL,
  field_id uuid NOT NULL,
  season_id uuid,
  actor_user_id uuid NOT NULL,
  actor_membership_id uuid NOT NULL,
  amount numeric NOT NULL,
  currency varchar(3) NOT NULL,
  category text NOT NULL,
  expense_date date NOT NULL,
  note text,
  recorded_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT expenses_pkey PRIMARY KEY (business_id, id),
  CONSTRAINT expenses_business_id_fkey
    FOREIGN KEY (business_id) REFERENCES businesses (id) ON DELETE RESTRICT,
  CONSTRAINT expenses_field_id_business_id_fkey
    FOREIGN KEY (field_id, business_id) REFERENCES fields (id, business_id) ON DELETE RESTRICT,
  CONSTRAINT expenses_season_id_business_id_field_id_fkey
    FOREIGN KEY (season_id, business_id, field_id) REFERENCES seasons (id, business_id, field_id) ON DELETE RESTRICT,
  CONSTRAINT expenses_actor_user_id_fkey
    FOREIGN KEY (actor_user_id) REFERENCES application_users (id) ON DELETE RESTRICT,
  CONSTRAINT expenses_actor_membership_id_business_id_actor_user_id_fkey
    FOREIGN KEY (actor_membership_id, business_id, actor_user_id)
    REFERENCES memberships (id, business_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT expenses_amount_positive_check CHECK (amount > 0),
  CONSTRAINT expenses_amount_range_check CHECK (amount < 1000000000000000000),
  CONSTRAINT expenses_amount_scale_check CHECK (scale(amount) <= 6),
  CONSTRAINT expenses_currency_shape_check CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT expenses_category_check CHECK (category IN (
    'SEED_SEEDLING', 'FERTILIZER', 'PESTICIDE', 'FUEL', 'LABOR', 'IRRIGATION', 'OTHER'
  ))
);

CREATE INDEX expenses_field_history_idx
  ON expenses (business_id, field_id, expense_date DESC, id DESC);
CREATE INDEX expenses_field_season_history_idx
  ON expenses (business_id, field_id, season_id, expense_date DESC, id DESC);

CREATE FUNCTION reject_expense_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Expenses are immutable' USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER expenses_immutable
  BEFORE UPDATE OR DELETE ON expenses
  FOR EACH ROW EXECUTE FUNCTION reject_expense_mutation();
