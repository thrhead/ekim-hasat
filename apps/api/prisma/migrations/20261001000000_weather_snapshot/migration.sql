BEGIN;

CREATE TABLE weather_snapshots (
  id uuid PRIMARY KEY,
  business_id uuid NOT NULL,
  field_id uuid NOT NULL,
  representative_point geometry(Point, 4326) NOT NULL,
  location_fingerprint text NOT NULL,
  business_timezone text NOT NULL,
  coverage_start timestamptz(6) NOT NULL,
  coverage_end timestamptz(6) NOT NULL,
  forecast_local_dates text[] NOT NULL,
  fetched_at timestamptz(6) NOT NULL,
  refresh_started_at timestamptz(6) NOT NULL,
  provider_issued_at timestamptz(6),
  quality_status text NOT NULL DEFAULT 'ACCEPTED',
  observed_at timestamptz(6) NOT NULL,
  condition_code text NOT NULL,
  condition_label text,
  temperature_c double precision NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT weather_snapshots_business_field_key UNIQUE (field_id, business_id),
  CONSTRAINT weather_snapshots_business_id_fkey
    FOREIGN KEY (business_id) REFERENCES businesses (id) ON DELETE RESTRICT,
  CONSTRAINT weather_snapshots_field_id_business_id_fkey
    FOREIGN KEY (field_id, business_id) REFERENCES fields (id, business_id) ON DELETE RESTRICT,
  CONSTRAINT weather_snapshots_fingerprint_check CHECK (length(btrim(location_fingerprint)) > 0),
  CONSTRAINT weather_snapshots_timezone_check CHECK (length(btrim(business_timezone)) > 0),
  CONSTRAINT weather_snapshots_coverage_check CHECK (coverage_start < coverage_end),
  CONSTRAINT weather_snapshots_local_dates_check CHECK (
    cardinality(forecast_local_dates) = 3
    AND array_lower(forecast_local_dates, 1) = 1
    AND array_upper(forecast_local_dates, 1) = 3
    AND forecast_local_dates[1] IS NOT NULL
    AND forecast_local_dates[2] IS NOT NULL
    AND forecast_local_dates[3] IS NOT NULL
    AND forecast_local_dates[2]::date = forecast_local_dates[1]::date + 1
    AND forecast_local_dates[3]::date = forecast_local_dates[2]::date + 1
  ),
  CONSTRAINT weather_snapshots_point_check CHECK (ST_SRID(representative_point) = 4326 AND NOT ST_IsEmpty(representative_point)),
  CONSTRAINT weather_snapshots_quality_check CHECK (quality_status = 'ACCEPTED'),
  CONSTRAINT weather_snapshots_condition_check CHECK (condition_code IN ('CLEAR', 'PARTLY_CLOUDY', 'CLOUDY', 'FOG', 'RAIN', 'SNOW', 'THUNDERSTORM', 'WINDY', 'UNKNOWN')),
  CONSTRAINT weather_snapshots_temperature_finite_check CHECK (temperature_c::text NOT IN ('NaN', 'Infinity', '-Infinity'))
);

CREATE INDEX weather_snapshots_business_fetched_idx ON weather_snapshots (business_id, fetched_at DESC);

CREATE SEQUENCE weather_refresh_states_last_attempt_order_seq AS bigint;

CREATE TABLE weather_refresh_states (
  business_id uuid NOT NULL,
  field_id uuid NOT NULL,
  last_attempted_at timestamptz(6) NOT NULL,
  last_attempt_order bigint NOT NULL DEFAULT nextval('weather_refresh_states_last_attempt_order_seq'),

  CONSTRAINT weather_refresh_states_pkey PRIMARY KEY (field_id, business_id),
  CONSTRAINT weather_refresh_states_field_id_business_id_fkey
    FOREIGN KEY (field_id, business_id) REFERENCES fields (id, business_id) ON DELETE CASCADE
);

ALTER SEQUENCE weather_refresh_states_last_attempt_order_seq OWNED BY weather_refresh_states.last_attempt_order;

CREATE INDEX weather_refresh_states_attempt_order_idx ON weather_refresh_states (last_attempt_order);

CREATE TABLE weather_daily_forecasts (
  id uuid PRIMARY KEY,
  snapshot_id uuid NOT NULL,
  local_date date NOT NULL,
  condition_code text NOT NULL,
  condition_label text,
  temperature_high_c double precision NOT NULL,
  temperature_low_c double precision NOT NULL,
  precipitation_chance_percent double precision NOT NULL,
  wind_speed_kph double precision NOT NULL,

  CONSTRAINT weather_daily_forecasts_snapshot_local_date_key UNIQUE (snapshot_id, local_date),
  CONSTRAINT weather_daily_forecasts_snapshot_id_fkey
    FOREIGN KEY (snapshot_id) REFERENCES weather_snapshots (id) ON DELETE CASCADE,
  CONSTRAINT weather_daily_forecasts_condition_check CHECK (condition_code IN ('CLEAR', 'PARTLY_CLOUDY', 'CLOUDY', 'FOG', 'RAIN', 'SNOW', 'THUNDERSTORM', 'WINDY', 'UNKNOWN')),
  CONSTRAINT weather_daily_forecasts_temperature_finite_check CHECK (
    temperature_high_c::text NOT IN ('NaN', 'Infinity', '-Infinity')
    AND temperature_low_c::text NOT IN ('NaN', 'Infinity', '-Infinity')
  ),
  CONSTRAINT weather_daily_forecasts_temperature_range_check CHECK (temperature_high_c >= temperature_low_c),
  CONSTRAINT weather_daily_forecasts_precipitation_finite_check CHECK (
    precipitation_chance_percent::text NOT IN ('NaN', 'Infinity', '-Infinity')
    AND precipitation_chance_percent BETWEEN 0 AND 100
  ),
  CONSTRAINT weather_daily_forecasts_wind_finite_check CHECK (
    wind_speed_kph::text NOT IN ('NaN', 'Infinity', '-Infinity')
    AND wind_speed_kph >= 0
  )
);

CREATE INDEX weather_daily_forecasts_local_date_idx ON weather_daily_forecasts (local_date);

CREATE FUNCTION assert_weather_snapshot_has_three_forecasts(target_snapshot_id uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  forecast_count integer;
  forecast_dates date[];
  required_dates date[];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM weather_snapshots WHERE id = target_snapshot_id) THEN
    RETURN;
  END IF;
  SELECT forecast_local_dates::date[] INTO required_dates FROM weather_snapshots WHERE id = target_snapshot_id;
  SELECT count(*), array_agg(local_date ORDER BY local_date)
    INTO forecast_count, forecast_dates
    FROM weather_daily_forecasts WHERE snapshot_id = target_snapshot_id;
  IF forecast_count <> 3 OR forecast_dates IS DISTINCT FROM required_dates THEN
    RAISE EXCEPTION 'Weather snapshot daily forecast dates must match its three covered local dates'
      USING ERRCODE = '23514', CONSTRAINT = 'weather_snapshots_forecast_dates_check';
  END IF;
END;
$$;

CREATE FUNCTION check_weather_snapshot_forecast_count() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM assert_weather_snapshot_has_three_forecasts(NEW.id);
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER weather_snapshots_three_forecasts_guard
  AFTER INSERT OR UPDATE ON weather_snapshots
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_weather_snapshot_forecast_count();

CREATE FUNCTION check_weather_daily_forecast_count() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    PERFORM assert_weather_snapshot_has_three_forecasts(OLD.snapshot_id);
  END IF;
  IF TG_OP <> 'DELETE' AND (TG_OP = 'INSERT' OR NEW.snapshot_id IS DISTINCT FROM OLD.snapshot_id) THEN
    PERFORM assert_weather_snapshot_has_three_forecasts(NEW.snapshot_id);
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER weather_daily_forecasts_three_guard
  AFTER INSERT OR UPDATE OR DELETE ON weather_daily_forecasts
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_weather_daily_forecast_count();

COMMIT;
