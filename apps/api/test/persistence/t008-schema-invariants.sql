\set ON_ERROR_STOP on

-- T008 PostgreSQL/PostGIS integration checks. Run with:
--   psql "$DATABASE_URL" -f apps/api/test/persistence/t008-schema-invariants.sql
-- All fixture rows are inside this transaction and are rolled back at the end.
BEGIN;

DO $test$
DECLARE
  table_name text;
  wanted_columns text[];
  wanted_unique boolean;
  found boolean;
BEGIN
  -- The provider subject uniquely identifies one server-side ApplicationUser.
  SELECT EXISTS (
    SELECT 1 FROM pg_index i
    JOIN pg_class t ON t.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = current_schema() AND t.relname = 'application_users'
      AND i.indisunique AND i.indisvalid
      AND (SELECT array_agg(a.attname::text ORDER BY k.ord)
           FROM unnest(i.indkey) WITH ORDINALITY k(attnum, ord)
           JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
           WHERE k.ord <= i.indnkeyatts) = ARRAY['auth_provider','auth_subject']::text[]
  ) INTO found;
  IF NOT found THEN RAISE EXCEPTION 'missing unique application_users(auth_provider, auth_subject)'; END IF;

  -- Membership is the authorization relationship and has both a business/user
  -- uniqueness rule and an index for active membership resolution.
  SELECT EXISTS (
    SELECT 1 FROM pg_index i
    JOIN pg_class t ON t.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = current_schema() AND t.relname = 'memberships'
      AND i.indisunique AND i.indisvalid
      AND (SELECT array_agg(a.attname::text ORDER BY k.ord)
           FROM unnest(i.indkey) WITH ORDINALITY k(attnum, ord)
           JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
           WHERE k.ord <= i.indnkeyatts) = ARRAY['business_id','user_id']::text[]
  ) INTO found;
  IF NOT found THEN RAISE EXCEPTION 'missing unique memberships(business_id, user_id)'; END IF;

  SELECT EXISTS (
    SELECT 1 FROM pg_index i
    JOIN pg_class t ON t.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = current_schema() AND t.relname = 'memberships'
      AND NOT i.indisunique AND i.indisvalid AND i.indpred IS NULL
      AND (SELECT array_agg(a.attname::text ORDER BY k.ord)
           FROM unnest(i.indkey) WITH ORDINALITY k(attnum, ord)
           JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
           WHERE k.ord <= i.indnkeyatts) = ARRAY['user_id','business_id','status']::text[]
  ) INTO found;
  IF NOT found THEN RAISE EXCEPTION 'missing membership authorization lookup index (user_id, business_id, status)'; END IF;

  -- Durable completion uniqueness is independent of idempotency retention.
  SELECT EXISTS (
    SELECT 1 FROM pg_index i
    JOIN pg_class t ON t.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = current_schema() AND t.relname = 'onboarding_completions'
      AND i.indisunique AND i.indisvalid
      AND (SELECT array_agg(a.attname::text ORDER BY k.ord)
           FROM unnest(i.indkey) WITH ORDINALITY k(attnum, ord)
           JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
           WHERE k.ord <= i.indnkeyatts) = ARRAY['user_id','default_business_id']::text[]
  ) INTO found;
  IF NOT found THEN RAISE EXCEPTION 'missing unique onboarding_completions(user_id, default_business_id)'; END IF;

  -- Retained idempotency lookup and conflict scope is per authenticated user.
  SELECT EXISTS (
    SELECT 1 FROM pg_index i
    JOIN pg_class t ON t.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = current_schema() AND t.relname = 'idempotency_records'
      AND i.indisunique AND i.indisvalid
      AND (SELECT array_agg(a.attname::text ORDER BY k.ord)
           FROM unnest(i.indkey) WITH ORDINALITY k(attnum, ord)
           JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
           WHERE k.ord <= i.indnkeyatts) = ARRAY['user_id','key']::text[]
  ) INTO found;
  IF NOT found THEN RAISE EXCEPTION 'missing unique idempotency_records(user_id, key)'; END IF;

  -- default_business_id is a pointer to context, not an authorization grant;
  -- the pointer relationship must exist, and completion remains membership-scoped.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.conrelid = 'application_users'::regclass AND c.contype = 'f'
      AND c.conname = 'application_users_default_business_id_fkey'
      AND c.confrelid = 'businesses'::regclass AND c.confdeltype = 'r'
  ) THEN RAISE EXCEPTION 'missing RESTRICT default business pointer foreign key'; END IF;

  -- Required ownership and durable-history foreign keys must be present and
  -- protect completed data from cascading deletion.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='memberships'::regclass AND contype='f' AND conname='memberships_business_id_fkey')
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='memberships'::regclass AND contype='f' AND conname='memberships_user_id_fkey')
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='fields'::regclass AND contype='f' AND conname='fields_business_id_fkey' AND confdeltype='r')
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='field_boundary_versions'::regclass AND contype='f' AND conname='field_boundary_versions_field_id_fkey' AND confdeltype='r')
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='onboarding_completions'::regclass AND contype='f' AND confdeltype='r' GROUP BY conrelid HAVING count(*) = 3)
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='idempotency_records'::regclass AND contype='f' AND conname='idempotency_records_user_id_fkey')
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='idempotency_records'::regclass AND contype='f' AND conname='idempotency_records_field_id_fkey' AND confdeltype='r')
  THEN RAISE EXCEPTION 'required onboarding foreign key or RESTRICT delete action is missing'; END IF;

  -- Geometry typmods enforce Point and Polygon only, with WGS84 SRID.
  IF (SELECT format_type(a.atttypid, a.atttypmod) FROM pg_attribute a
      WHERE a.attrelid='fields'::regclass AND a.attname='representative_point' AND NOT a.attisdropped)
      <> 'geometry(Point,4326)' THEN RAISE EXCEPTION 'representative_point must be geometry(Point,4326)'; END IF;
  IF (SELECT format_type(a.atttypid, a.atttypmod) FROM pg_attribute a
      WHERE a.attrelid='field_boundary_versions'::regclass AND a.attname='geometry' AND NOT a.attisdropped)
      <> 'geometry(Polygon,4326)' THEN RAISE EXCEPTION 'boundary geometry must be geometry(Polygon,4326)'; END IF;
END
$test$;

CREATE TEMP TABLE t008_fixture_ids (user_id uuid, business_id uuid, field_id uuid) ON COMMIT DROP;
INSERT INTO t008_fixture_ids VALUES (gen_random_uuid(), gen_random_uuid(), gen_random_uuid());

INSERT INTO businesses(id) SELECT business_id FROM t008_fixture_ids;
INSERT INTO application_users(id, auth_provider, auth_subject, default_business_id)
SELECT user_id, 't008-test', user_id::text, business_id FROM t008_fixture_ids;
INSERT INTO memberships(id, business_id, user_id, role, status)
SELECT gen_random_uuid(), business_id, user_id, 'OWNER', 'ACTIVE' FROM t008_fixture_ids;
INSERT INTO fields(id, business_id, name, representative_point)
SELECT field_id, business_id, 't008-fixture', ST_SetSRID(ST_MakePoint(0, 0), 4326) FROM t008_fixture_ids;

DO $test$
DECLARE fixture record;
BEGIN
  SELECT * INTO fixture FROM t008_fixture_ids;
  BEGIN
    INSERT INTO application_users(id, auth_provider, auth_subject)
    VALUES (gen_random_uuid(), 't008-test', fixture.user_id::text);
    RAISE EXCEPTION 'duplicate provider subject unexpectedly accepted';
  EXCEPTION WHEN unique_violation THEN NULL; END;

  BEGIN
    INSERT INTO memberships(id, business_id, user_id, role, status)
    VALUES (gen_random_uuid(), fixture.business_id, fixture.user_id, 'OWNER', 'ACTIVE');
    RAISE EXCEPTION 'duplicate membership unexpectedly accepted';
  EXCEPTION WHEN unique_violation THEN NULL; END;

  INSERT INTO onboarding_completions(id, user_id, default_business_id, field_id)
  VALUES (gen_random_uuid(), fixture.user_id, fixture.business_id, fixture.field_id);
  BEGIN
    INSERT INTO onboarding_completions(id, user_id, default_business_id, field_id)
    VALUES (gen_random_uuid(), fixture.user_id, fixture.business_id, fixture.field_id);
    RAISE EXCEPTION 'duplicate durable completion unexpectedly accepted';
  EXCEPTION WHEN unique_violation THEN NULL; END;

  INSERT INTO idempotency_records(id, user_id, key, payload_fingerprint, field_id, expires_at)
  VALUES (gen_random_uuid(), fixture.user_id, 't008-key', 'fingerprint-a', fixture.field_id, now() + interval '1 hour');
  BEGIN
    INSERT INTO idempotency_records(id, user_id, key, payload_fingerprint, field_id, expires_at)
    VALUES (gen_random_uuid(), fixture.user_id, 't008-key', 'fingerprint-b', fixture.field_id, now() + interval '1 hour');
    RAISE EXCEPTION 'duplicate retained per-user idempotency key unexpectedly accepted';
  EXCEPTION WHEN unique_violation THEN NULL; END;

  INSERT INTO field_boundary_versions(id, field_id, version, geometry)
  VALUES (gen_random_uuid(), fixture.field_id, 1,
          ST_GeomFromText('POLYGON((0 0,1 0,1 1,0 1,0 0))', 4326));
END
$test$;

ROLLBACK;
