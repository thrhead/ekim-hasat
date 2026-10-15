import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { Client } from "pg";
import { assertDisposableDatabaseUrl } from "../support/disposable-database.js";

const databaseUrl = process.env.DATABASE_URL;
assertDisposableDatabaseUrl(databaseUrl);
const db = new Client({ connectionString: databaseUrl });
let inTransaction = false;

async function rejectsSql(action: () => Promise<unknown>, code?: string): Promise<void> {
  if (inTransaction) await db.query("SAVEPOINT spec011_expected_rejection");
  try {
    await assert.rejects(action, (error: unknown) => {
      if (code) assert.equal((error as { code?: string }).code, code);
      return true;
    });
  } finally {
    if (inTransaction) {
      await db.query("ROLLBACK TO SAVEPOINT spec011_expected_rejection");
      await db.query("RELEASE SAVEPOINT spec011_expected_rejection");
    }
  }
}

before(async () => {
  await db.connect();
  const target = await db.query<{ database: string; postgis: boolean }>(
    "SELECT current_database() AS database, EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'postgis') AS postgis",
  );
  assert.equal(target.rows[0]?.database, "ekim_hasat_test", "fixture writes require the disposable test database");
  assert.equal(target.rows[0]?.postgis, true, "PostGIS must be enabled before Field fixtures");
});

after(async () => {
  try {
    if (inTransaction) await db.query("ROLLBACK");
  } finally {
    await db.end();
  }
});

test("IrrigationRecord migration enforces tenant relationships, history indexes, and append-only history", async () => {
  const table = await db.query<{ name: string | null }>("SELECT to_regclass('public.irrigation_records') AS name");
  assert.equal(table.rows[0]?.name, "irrigation_records", "T003 IrrigationRecord migration must be applied");

  const columns = await db.query<{ column_name: string; data_type: string; is_nullable: string }>(
    `SELECT column_name, data_type, is_nullable FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'irrigation_records'`,
  );
  const byName = new Map(columns.rows.map((column) => [column.column_name, column]));
  for (const column of ["id", "business_id", "field_id", "actor_user_id", "actor_membership_id", "occurred_at", "recorded_at"]) {
    assert.ok(byName.has(column), `irrigation_records.${column} must be persisted`);
    assert.equal(byName.get(column)?.is_nullable, "NO", `irrigation_records.${column} must be required`);
  }
  assert.equal(byName.get("season_id")?.is_nullable, "YES", "Season association must be optional");
  assert.equal(byName.get("method")?.is_nullable, "YES");
  assert.equal(byName.get("duration_minutes")?.is_nullable, "YES");
  assert.equal(byName.get("water_volume_cubic_metres")?.is_nullable, "YES");
  assert.equal(byName.get("note")?.is_nullable, "YES");
  assert.equal(byName.get("water_volume_cubic_metres")?.data_type, "numeric");
  assert.equal(byName.get("occurred_at")?.data_type, "timestamp with time zone");
  assert.equal(byName.get("recorded_at")?.data_type, "timestamp with time zone");

  const constraints = await db.query<{ contype: string; definition: string }>(
    `SELECT contype, pg_get_constraintdef(oid) AS definition FROM pg_constraint
      WHERE conrelid = 'public.irrigation_records'::regclass`,
  );
  const primary = constraints.rows.filter((row) => row.contype === "p").map((row) => row.definition);
  const foreign = constraints.rows.filter((row) => row.contype === "f").map((row) => row.definition);
  assert.ok(primary.some((definition) => /\(business_id, id\)/.test(definition)), "record identity is unique within Business");
  assert.ok(foreign.some((definition) => /businesses/.test(definition) && /business_id/.test(definition)), "Business is referenced");
  assert.ok(foreign.some((definition) => /fields/.test(definition) && /field_id/.test(definition) && /business_id/.test(definition)), "Field and Business are constrained together");
  assert.ok(foreign.some((definition) => /seasons/.test(definition) && /season_id/.test(definition)
    && /business_id/.test(definition) && /field_id/.test(definition)), "optional Season, Field, and Business are constrained together");
  assert.ok(foreign.some((definition) => /memberships/.test(definition) && /actor_membership_id/.test(definition)
    && /business_id/.test(definition) && /actor_user_id/.test(definition)), "actor membership and tenant/user context are constrained together");
  assert.ok(foreign.some((definition) => /application_users/.test(definition) && /actor_user_id/.test(definition)), "actor user is referenced");
  assert.ok(foreign.every((definition) => !/ON DELETE CASCADE/i.test(definition)), "foreign keys protect accepted history");

  const indexes = await db.query<{ indexdef: string }>(
    "SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'irrigation_records'",
  );
  const indexDefinitions = indexes.rows.map(({ indexdef }) => indexdef.replace(/\s+/g, " ").toLowerCase());
  assert.ok(indexDefinitions.some((definition) => /\(business_id, field_id, occurred_at desc, id desc\)/.test(definition)), "Field history keyset index exists");
  assert.ok(indexDefinitions.some((definition) => /\(business_id, field_id, season_id, occurred_at desc, id desc\)/.test(definition)), "Field/Season history keyset index exists");

  const triggers = await db.query<{ definition: string }>(
    `SELECT pg_get_triggerdef(oid) AS definition FROM pg_trigger
      WHERE tgrelid = 'public.irrigation_records'::regclass AND NOT tgisinternal`,
  );
  assert.ok(triggers.rows.some(({ definition }) => /UPDATE OR DELETE|DELETE OR UPDATE/i.test(definition)), "accepted irrigation records reject update and delete");

  await db.query("BEGIN");
  inTransaction = true;
  const businessId = randomUUID();
  const otherBusinessId = randomUUID();
  const userId = randomUUID();
  const otherUserId = randomUUID();
  const membershipId = randomUUID();
  const otherUserSameBusinessMembershipId = randomUUID();
  const otherBusinessMembershipId = randomUUID();
  const fieldId = randomUUID();
  const otherSameBusinessFieldId = randomUUID();
  const otherBusinessFieldId = randomUUID();
  const seasonId = randomUUID();
  const cropKey = `irrigation-schema-${randomUUID()}`;
  const cropVersionId = randomUUID();
  const recordId = randomUUID();

  await db.query("INSERT INTO businesses (id) VALUES ($1), ($2)", [businessId, otherBusinessId]);
  await db.query(`INSERT INTO application_users (id, auth_provider, auth_subject)
    VALUES ($1::uuid, 'schema-test', $1::text), ($2::uuid, 'schema-test', $2::text)`, [userId, otherUserId]);
  await db.query(`INSERT INTO memberships (id, business_id, user_id, role, status)
    VALUES ($1, $3, $5, 'OWNER', 'ACTIVE'), ($2, $3, $6, 'MEMBER', 'ACTIVE'), ($4, $7, $6, 'OWNER', 'ACTIVE')`,
  [membershipId, otherUserSameBusinessMembershipId, businessId, otherBusinessMembershipId, userId, otherUserId, otherBusinessId]);
  await db.query(`INSERT INTO fields (id, business_id, name, representative_point)
    VALUES ($1, $3, 'Irrigation fixture', ST_SetSRID(ST_MakePoint(29, 41), 4326)),
           ($2, $3, 'Same business other field', ST_SetSRID(ST_MakePoint(29.1, 41), 4326)),
           ($4, $5, 'Other business field', ST_SetSRID(ST_MakePoint(30, 42), 4326))`,
  [fieldId, otherSameBusinessFieldId, businessId, otherBusinessFieldId, otherBusinessId]);
  await db.query(`INSERT INTO crop_definition_versions (id, crop_key, version, display_name)
    VALUES ($1, $2, '1', 'Irrigation schema crop')`, [cropVersionId, cropKey]);
  await db.query(`INSERT INTO seasons (id, business_id, field_id, crop_key, crop_definition_version_id, actual_planting_date)
    VALUES ($1, $2, $3, $4, $5, '2026-09-01')`, [seasonId, businessId, fieldId, cropKey, cropVersionId]);

  const insertRecord = (values: {
    id?: string; business?: string; field?: string; season?: string | null; actor?: string; membership?: string;
  } = {}) => db.query(`INSERT INTO irrigation_records
    (id, business_id, field_id, season_id, actor_user_id, actor_membership_id, occurred_at, recorded_at)
    VALUES ($1, $2, $3, $4, $5, $6, now(), now())`,
  [values.id ?? recordId, values.business ?? businessId, values.field ?? fieldId,
    values.season === undefined ? seasonId : values.season, values.actor ?? userId,
    values.membership ?? membershipId]);

  await insertRecord();
  await insertRecord({ id: randomUUID(), season: null });
  await rejectsSql(() => insertRecord(), "23505");
  await rejectsSql(() => insertRecord({ id: randomUUID(), field: otherBusinessFieldId }), "23503");
  await rejectsSql(() => insertRecord({ id: randomUUID(), field: otherSameBusinessFieldId }), "23503");
  await rejectsSql(() => insertRecord({ id: randomUUID(), actor: userId, membership: otherUserSameBusinessMembershipId }), "23503");
  await rejectsSql(() => insertRecord({ id: randomUUID(), business: otherBusinessId, field: otherBusinessFieldId, season: seasonId, actor: otherUserId, membership: otherBusinessMembershipId }), "23503");
  await rejectsSql(() => db.query("UPDATE irrigation_records SET method = 'rewritten' WHERE id = $1", [recordId]));
  await rejectsSql(() => db.query("DELETE FROM irrigation_records WHERE id = $1", [recordId]));
  await rejectsSql(() => db.query("DELETE FROM seasons WHERE id = $1", [seasonId]), "23503");
  await rejectsSql(() => db.query("DELETE FROM fields WHERE id = $1", [fieldId]), "23503");
  await rejectsSql(() => db.query("DELETE FROM memberships WHERE id = $1", [membershipId]), "23503");
  await rejectsSql(() => db.query("DELETE FROM application_users WHERE id = $1", [userId]), "23503");
  await db.query("ROLLBACK");
  inTransaction = false;
});
