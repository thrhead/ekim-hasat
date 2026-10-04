import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test, { after, before } from "node:test";
import { Client } from "pg";
import { assertDisposableDatabaseUrl } from "../support/disposable-database.js";

const databaseUrl = process.env.DATABASE_URL;
assertDisposableDatabaseUrl(databaseUrl);
const db = new Client({ connectionString: databaseUrl });
let fixtureBusinessId: string;
let firstFieldId: string;
let secondFieldId: string;
let firstBoundaryId: string;
let tiedBoundaryId: string;
let regionContextId: string;

async function rejectsSql(action: () => Promise<unknown>) {
  await db.query("SAVEPOINT expected_rejection");
  try {
    await assert.rejects(action);
  } finally {
    await db.query("ROLLBACK TO SAVEPOINT expected_rejection");
    await db.query("RELEASE SAVEPOINT expected_rejection");
  }
}

before(async () => {
  await db.connect();
  const target = await db.query<{ database: string; postgis: boolean }>(
    "SELECT current_database() AS database, EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'postgis') AS postgis",
  );
  assert.equal(target.rows[0]?.database, "ekim_hasat_test", "fixture writes require the disposable test database");
  assert.equal(target.rows[0]?.postgis, true, "PostGIS must be enabled before Field geometry fixtures");
  const requiredSchema = await db.query<{ region_context: string | null; current_boundary: string | null; current_region: string | null }>(
    `SELECT to_regclass('public.field_region_context_versions') AS region_context,
            (SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='fields' AND column_name='current_boundary_version_id') AS current_boundary,
            (SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='fields' AND column_name='current_region_context_version_id') AS current_region`,
  );
  assert.equal(requiredSchema.rows[0]?.region_context, "field_region_context_versions", "T007 region context migration must be applied");
  assert.equal(requiredSchema.rows[0]?.current_boundary, "current_boundary_version_id", "T007 current boundary pointer migration must be applied");
  assert.equal(requiredSchema.rows[0]?.current_region, "current_region_context_version_id", "T007 current region pointer migration must be applied");

  fixtureBusinessId = randomUUID();
  firstFieldId = randomUUID();
  secondFieldId = randomUUID();
  firstBoundaryId = randomUUID();
  tiedBoundaryId = randomUUID();
  regionContextId = randomUUID();
  await db.query("BEGIN");
  await db.query("INSERT INTO businesses (id) VALUES ($1)", [fixtureBusinessId]);
  await db.query(`INSERT INTO fields (id, business_id, name, representative_point)
    VALUES ($1, $3, 'Boundary field', ST_SetSRID(ST_MakePoint(29, 41), 4326)),
           ($2, $3, 'Point field', ST_SetSRID(ST_MakePoint(30, 42), 4326))`, [firstFieldId, secondFieldId, fixtureBusinessId]);
  await db.query(`INSERT INTO field_boundary_versions (id, field_id, version, geometry, verification_status)
    VALUES ($1, $3, 7, ST_GeomFromText('POLYGON((29 41,29.1 41,29.1 41.1,29 41.1,29 41))',4326), 'UNVERIFIED'),
           ($2, $3, 7, ST_GeomFromText('POLYGON((29.2 41,29.3 41,29.3 41.1,29.2 41.1,29.2 41))',4326), 'UNVERIFIED')`,
  [firstBoundaryId, tiedBoundaryId, firstFieldId]);
  await db.query(`INSERT INTO field_region_context_versions (id, field_id, version, resolution_location_key)
    VALUES ($1, $2, 1, 'schema-fixture-location-key')`, [regionContextId, firstFieldId]);
  await db.query("UPDATE fields SET current_region_context_version_id=$2 WHERE id=$1", [firstFieldId, regionContextId]);
});

after(async () => {
  try {
    await db.query("ROLLBACK").catch(() => undefined);
  } finally {
    await db.end();
  }
});

test("current boundary pointers are nullable, same-Field, and allow legacy version ties", async () => {
  const duplicates = await db.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM field_boundary_versions WHERE field_id=$1 AND version=7", [firstFieldId],
  );
  assert.equal(duplicates.rows[0]?.count, 2, "migration must not add field/version uniqueness");
  const noBoundary = await db.query<{ pointer: string | null }>(
    "SELECT current_boundary_version_id AS pointer FROM fields WHERE id=$1", [secondFieldId],
  );
  assert.equal(noBoundary.rows[0]?.pointer, null, "point-only Fields retain a null boundary pointer");
  await db.query("UPDATE fields SET current_boundary_version_id=$2 WHERE id=$1", [firstFieldId, firstBoundaryId]);
  await rejectsSql(() => db.query("UPDATE fields SET current_boundary_version_id=$2 WHERE id=$1", [secondFieldId, firstBoundaryId]));
  const current = await db.query<{ pointer: string }>("SELECT current_boundary_version_id AS pointer FROM fields WHERE id=$1", [firstFieldId]);
  assert.equal(current.rows[0]?.pointer, firstBoundaryId);
  const retained = await db.query<{ count: number }>("SELECT count(*)::int AS count FROM field_boundary_versions WHERE field_id=$1", [firstFieldId]);
  assert.equal(retained.rows[0]?.count, 2, "changing the current pointer preserves all historical boundary rows");
});

test("region pointers permit legacy null state and remain same-Field references", async () => {
  const nullPointer = await db.query<{ pointer: string | null }>(
    "SELECT current_region_context_version_id AS pointer FROM fields WHERE id=$1", [secondFieldId],
  );
  assert.equal(nullPointer.rows[0]?.pointer, null);
  const columns = await db.query<{ nullable: string }>(
    `SELECT is_nullable AS nullable FROM information_schema.columns
      WHERE table_schema='public' AND table_name='field_region_context_versions' AND column_name='administrative_state'`,
  );
  assert.equal(columns.rows[0]?.nullable, "NO");
  await rejectsSql(() => db.query("UPDATE fields SET current_region_context_version_id=$2 WHERE id=$1", [secondFieldId, regionContextId]));
});

test("resolved region contexts require complete non-null provenance while unresolved contexts remain valid", async () => {
  const resolvedId = randomUUID();
  await db.query(`INSERT INTO field_region_context_versions (
    id, field_id, version, resolution_location_key, administrative_state,
    administrative_code, administrative_label, administrative_source_id,
    administrative_data_version, administrative_confidence, administrative_resolved_at
  ) VALUES ($1, $2, 1, 'resolved-fixture-location-key', 'RESOLVED',
    'ADM-1', 'Administrative region', 'fixture-source', 'fixture-v1', 0.9, now())`,
  [resolvedId, secondFieldId]);
  assert.equal((await db.query("SELECT administrative_state FROM field_region_context_versions WHERE id=$1", [resolvedId])).rows[0]?.administrative_state, "RESOLVED");

  await rejectsSql(() => db.query(`INSERT INTO field_region_context_versions (
    id, field_id, version, resolution_location_key, administrative_state,
    administrative_code, administrative_label, administrative_source_id,
    administrative_data_version, administrative_confidence, administrative_resolved_at
  ) VALUES ($1, $2, 2, 'missing-confidence-fixture-key', 'RESOLVED',
    'ADM-2', 'Administrative region', 'fixture-source', 'fixture-v1', NULL, now())`,
  [randomUUID(), secondFieldId]));

  const unresolved = await db.query<{ administrative_state: string; administrative_confidence: number | null }>(
    "SELECT administrative_state, administrative_confidence FROM field_region_context_versions WHERE id=$1", [regionContextId],
  );
  assert.deepEqual(unresolved.rows[0], { administrative_state: "UNRESOLVED", administrative_confidence: null });
});

test("current boundary selection is deterministic for duplicate version ties", async () => {
  const selected = await db.query<{ id: string }>(
    "SELECT id FROM field_boundary_versions WHERE field_id=$1 ORDER BY version DESC, id ASC LIMIT 1", [firstFieldId],
  );
  assert.equal(selected.rows[0]?.id, [firstBoundaryId, tiedBoundaryId].sort()[0]);
  const migratedPointers = await db.query<{ mismatches: number }>(`SELECT count(*)::int AS mismatches
    FROM fields AS field
    WHERE field.created_at < (SELECT finished_at FROM "_prisma_migrations"
      WHERE migration_name='20261002010000_field_management_region_resolution')
      AND field.current_boundary_version_id IS DISTINCT FROM (
      SELECT boundary.id FROM field_boundary_versions AS boundary
      WHERE boundary.field_id = field.id ORDER BY boundary.version DESC, boundary.id ASC LIMIT 1
    )`);
  assert.equal(migratedPointers.rows[0]?.mismatches, 0, "every pre-migration Field pointer follows the legacy version DESC, id ASC selector");
});

test("boundary and region history rows reject updates and deletes", async () => {
  await rejectsSql(() => db.query("UPDATE field_boundary_versions SET verification_status='VERIFIED' WHERE id=$1", [firstBoundaryId]));
  await rejectsSql(() => db.query("DELETE FROM field_boundary_versions WHERE id=$1", [firstBoundaryId]));
  await rejectsSql(() => db.query("UPDATE field_region_context_versions SET resolution_location_key='rewritten' WHERE id=$1", [regionContextId]));
  await rejectsSql(() => db.query("DELETE FROM field_region_context_versions WHERE id=$1", [regionContextId]));
});

test("append-only Field and Season context guards are never dropped by the ordered migration chain", async () => {
  const migrationsPath = join(process.cwd(), "prisma", "migrations");
  const migrations = readdirSync(migrationsPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({ name: entry.name, sql: readFileSync(join(migrationsPath, entry.name, "migration.sql"), "utf8") }))
    .sort((left, right) => left.name.localeCompare(right.name));
  const fieldGuardIndex = migrations.findIndex(({ name }) => name === "20261002010000_field_management_region_resolution");
  assert.notEqual(fieldGuardIndex, -1, "Field append-only guard migration must be present");
  assert.match(migrations[fieldGuardIndex]!.sql, /CREATE TRIGGER field_boundary_versions_append_only/);
  assert.match(migrations[fieldGuardIndex]!.sql, /CREATE TRIGGER field_region_context_versions_append_only/);
  const subsequentSql = migrations.slice(fieldGuardIndex + 1).map(({ sql }) => sql).join("\n");
  assert.doesNotMatch(subsequentSql, /DROP\s+TRIGGER\s+(?:IF\s+EXISTS\s+)?["`]?field_boundary_versions_append_only/i);
  assert.doesNotMatch(subsequentSql, /DROP\s+TRIGGER\s+(?:IF\s+EXISTS\s+)?["`]?field_region_context_versions_append_only/i);
  assert.doesNotMatch(subsequentSql, /DROP\s+FUNCTION\s+(?:IF\s+EXISTS\s+)?["`]?reject_field_history_mutation/i);

  const seasonGuardMigration = migrations.find(({ name }) => name === "20260928010000_season_snapshot_integrity");
  assert.ok(seasonGuardMigration, "Season snapshot immutability migration must be present");
  assert.match(seasonGuardMigration.sql, /CREATE TRIGGER season_snapshot_context_guard/);
  const seasonDeleteGuardMigration = migrations.find(({ name }) => name === "20260928020000_season_context_preservation");
  assert.ok(seasonDeleteGuardMigration, "Season snapshot deletion guard migration must be present");
  assert.match(seasonDeleteGuardMigration.sql, /CREATE TRIGGER season_snapshot_delete_guard/);
  const laterSeasonSql = migrations.slice(Math.max(migrations.indexOf(seasonGuardMigration), migrations.indexOf(seasonDeleteGuardMigration)) + 1)
    .map(({ sql }) => sql).join("\n");
  assert.doesNotMatch(laterSeasonSql, /DROP\s+TRIGGER\s+(?:IF\s+EXISTS\s+)?["`]?season_snapshot_(?:context|delete)_guard/i);
});
