import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { Client } from "pg";

const databaseUrl = process.env.DATABASE_URL;
assert.ok(databaseUrl, "DATABASE_URL must point to a migrated PostgreSQL/PostGIS database");
const db = new Client({ connectionString: databaseUrl });
const businessId = randomUUID();
const otherBusinessId = randomUUID();
const fieldId = randomUUID();
const userId = randomUUID();
const cropKey = `schema-${randomUUID()}`;
const cropVersionId = randomUUID();
const nextCropVersionId = randomUUID();
const templateId = randomUUID();
const customCropId = randomUUID();
let insideTransaction = false;

async function createSeason(options: {
  id?: string; date?: string; custom?: boolean; business?: string; cropVersion?: string;
} = {}, client = db) {
  const id = options.id ?? randomUUID();
  await client.query(`INSERT INTO seasons
    (id, business_id, field_id, crop_key, crop_definition_version_id, custom_crop_id, actual_planting_date)
    VALUES ($1, $2, $3, $4, $5, $6, $7::date)`, [
    id, options.business ?? businessId, fieldId, options.custom ? null : cropKey,
    options.custom ? null : options.cropVersion ?? cropVersionId,
    options.custom ? customCropId : null, options.date ?? "2026-09-01",
  ]);
  return id;
}

async function createPlan(seasonId: string, source = "MANUAL", templateVersionId: string | null = null) {
  const id = randomUUID();
  await db.query(`INSERT INTO season_plans (id, season_id, source, template_version_id, source_snapshot)
    VALUES ($1, $2, $3, $4, '{}'::jsonb)`, [id, seasonId, source, templateVersionId]);
  return id;
}

async function createTask(planId: string, date: string | null, title = "Tarlayı kontrol et") {
  const id = randomUUID();
  await db.query(`INSERT INTO planned_tasks (id, season_plan_id, title, planned_local_date)
    VALUES ($1, $2, $3, $4::date)`, [id, planId, title, date]);
  return id;
}

async function rejectsSql(action: () => Promise<unknown>, code: string) {
  if (insideTransaction) await db.query("SAVEPOINT expected_rejection");
  try {
    await assert.rejects(action, (error: unknown) => {
      assert.equal((error as { code?: string }).code, code);
      return true;
    });
  } finally {
    if (insideTransaction) {
      await db.query("ROLLBACK TO SAVEPOINT expected_rejection");
      await db.query("RELEASE SAVEPOINT expected_rejection");
    }
  }
}

before(async () => {
  await db.connect();
  // Explicit assertion makes the pre-migration red run diagnose missing persistence.
  const schema = await db.query("SELECT to_regclass('public.seasons') AS seasons");
  assert.equal(schema.rows[0]?.seasons, "seasons", "SPEC-002 seasons schema must exist");
  await db.query("INSERT INTO businesses (id) VALUES ($1), ($2)", [businessId, otherBusinessId]);
  await db.query(`INSERT INTO application_users (id, auth_provider, auth_subject)
    VALUES ($1::uuid, 'schema-test', $1::text)`, [userId]);
  await db.query(`INSERT INTO fields (id, business_id, name, representative_point)
    VALUES ($1, $2, 'Point-only field', ST_SetSRID(ST_MakePoint(29, 41), 4326))`, [fieldId, businessId]);
  await db.query(`INSERT INTO crop_definition_versions (id, crop_key, version, display_name)
    VALUES ($1, $3, '1', 'Test crop'), ($2, $3, '2', 'Test crop v2')`, [cropVersionId, nextCropVersionId, cropKey]);
  await db.query(`INSERT INTO custom_crops (id, business_id, display_name)
    VALUES ($1, $2, 'Yerel ürün')`, [customCropId, businessId]);
  await db.query(`INSERT INTO validated_template_versions
    (id, template_key, version, crop_definition_version_id, task_definitions)
    VALUES ($1, $2, '1', $3, '[{"key":"check","title":"Kontrol","offsetDays":0}]')`,
  [templateId, `template-${cropKey}`, cropVersionId]);
});

after(async () => {
  try {
    if ((await db.query("SELECT to_regclass('public.seasons') AS seasons")).rows[0]?.seasons) {
      await db.query("DELETE FROM business_command_idempotency_records WHERE user_id = $1", [userId]);
      // Remove fixtures in DRAFT; the active write guard preserves operational rows.
      await db.query("UPDATE seasons SET status = 'DRAFT', activated_at = NULL WHERE business_id = $1", [businessId]);
      await db.query("DELETE FROM planned_tasks WHERE season_plan_id IN (SELECT p.id FROM season_plans p JOIN seasons s ON s.id = p.season_id WHERE s.business_id = $1)", [businessId]);
      await db.query("DELETE FROM season_plans WHERE season_id IN (SELECT id FROM seasons WHERE business_id = $1)", [businessId]);
      await db.query("DELETE FROM seasons WHERE business_id = $1", [businessId]);
      await db.query("DELETE FROM validated_template_versions WHERE id = $1", [templateId]);
      await db.query("DELETE FROM crop_definition_versions WHERE crop_key = $1", [cropKey]);
      await db.query("DELETE FROM custom_crops WHERE id = $1", [customCropId]);
      await db.query("DELETE FROM fields WHERE id = $1", [fieldId]);
      await db.query("DELETE FROM application_users WHERE id = $1", [userId]);
      await db.query("DELETE FROM businesses WHERE id = ANY($1::uuid[])", [[businessId, otherBusinessId]]);
    }
  } finally {
    await db.end();
  }
});

test("point-only field accepts a season with DATE semantics and no boundary requirement", async () => {
  const seasonId = await createSeason();
  const planId = await createPlan(seasonId);
  await createTask(planId, "2026-09-01");
  await createTask(planId, "2026-09-10");
  await createTask(planId, "2026-09-03");
  await db.query("SET TIME ZONE 'Pacific/Honolulu'");
  const dates = await db.query(`SELECT actual_planting_date::text AS date,
    pg_typeof(actual_planting_date)::text AS type FROM seasons WHERE id = $1`, [seasonId]);
  assert.deepEqual(dates.rows[0], { date: "2026-09-01", type: "date" });
  assert.equal((await db.query("SELECT COUNT(*)::int AS count FROM field_boundary_versions WHERE field_id = $1", [fieldId])).rows[0].count, 0);
});

test("same-business field and custom crop relationships reject cross-business inserts", async () => {
  await rejectsSql(() => createSeason({ business: otherBusinessId, date: "2026-08-01" }), "23503");
  const foreignCropId = randomUUID();
  await db.query("INSERT INTO custom_crops (id, business_id, display_name) VALUES ($1, $2, 'Foreign crop')", [foreignCropId, otherBusinessId]);
  try {
    await rejectsSql(() => db.query(`INSERT INTO seasons (id, business_id, field_id, custom_crop_id, actual_planting_date)
      VALUES ($1, $2, $3, $4, '2026-08-01')`, [randomUUID(), businessId, fieldId, foreignCropId]), "23503");
  } finally {
    await db.query("DELETE FROM custom_crops WHERE id = $1", [foreignCropId]);
  }
});

test("crop identity XOR and stable key/version consistency are database enforced", async () => {
  await rejectsSql(() => db.query(`INSERT INTO seasons (id, business_id, field_id, actual_planting_date)
    VALUES ($1, $2, $3, '2026-08-02')`, [randomUUID(), businessId, fieldId]), "23514");
  await rejectsSql(() => db.query(`INSERT INTO seasons (id, business_id, field_id, crop_key, crop_definition_version_id, custom_crop_id, actual_planting_date)
    VALUES ($1, $2, $3, $4, $5, $6, '2026-08-02')`, [randomUUID(), businessId, fieldId, cropKey, cropVersionId, customCropId]), "23514");
  await rejectsSql(() => db.query(`INSERT INTO seasons (id, business_id, field_id, crop_key, crop_definition_version_id, actual_planting_date)
    VALUES ($1, $2, $3, 'wrong-key', $4, '2026-08-02')`, [randomUUID(), businessId, fieldId, cropVersionId]), "23503");
});

test("plan source/template consistency and one-plan-per-season are constrained", async () => {
  const seasonId = await createSeason({ date: "2026-08-03" });
  await rejectsSql(() => createPlan(seasonId, "MANUAL", templateId), "23514");
  await rejectsSql(() => createPlan(seasonId, "VALIDATED_TEMPLATE"), "23514");
  await createPlan(seasonId, "VALIDATED_TEMPLATE", templateId);
  await rejectsSql(() => createPlan(seasonId), "23505");
  const customSeason = await createSeason({ custom: true, date: "2026-08-03" });
  await rejectsSql(() => createPlan(customSeason, "VALIDATED_TEMPLATE", templateId), "23514");
});

test("required task title/date and planting lower bound reject invalid rows", async () => {
  const planId = await createPlan(await createSeason({ date: "2026-08-04" }));
  await rejectsSql(() => createTask(planId, null), "23502");
  await rejectsSql(() => createTask(planId, "2026-08-03"), "23514");
  await rejectsSql(() => createTask(planId, "2026-08-04", "   "), "23514");
  await createTask(planId, "2026-08-04");
});

test("task inserts, updates and deletes reject ACTIVE parents", async () => {
  const seasonId = await createSeason({ date: "2026-08-05" });
  const planId = await createPlan(seasonId);
  const taskId = await createTask(planId, "2026-08-05");
  await db.query("UPDATE seasons SET status = 'ACTIVE', activated_at = now() WHERE id = $1", [seasonId]);
  await rejectsSql(() => createTask(planId, "2026-08-06"), "23514");
  await rejectsSql(() => db.query("UPDATE planned_tasks SET title = 'changed' WHERE id = $1", [taskId]), "23514");
  await rejectsSql(() => db.query("DELETE FROM planned_tasks WHERE id = $1", [taskId]), "23514");
});

test("logical identity survives crop definition changes and ACTIVE state", async () => {
  const date = "2026-08-11";
  const seasonId = await createSeason({ date });
  await rejectsSql(() => createSeason({ date, cropVersion: nextCropVersionId }), "23505");
  await db.query("UPDATE seasons SET status = 'ACTIVE', activated_at = now() WHERE id = $1", [seasonId]);
  await rejectsSql(() => createSeason({ date }), "23505");
  await createSeason({ date: "2026-08-06" });
  await createSeason({ custom: true, date: "2026-08-06" });
});

test("concurrent inserts enforce one central and one custom logical season", async () => {
  for (const custom of [false, true]) {
    const clients = [new Client({ connectionString: databaseUrl }), new Client({ connectionString: databaseUrl })];
    await Promise.all(clients.map((client) => client.connect()));
    try {
      const outcomes = await Promise.allSettled(clients.map((client) => createSeason({ custom, date: "2026-08-07" }, client)));
      assert.equal(outcomes.filter((result) => result.status === "fulfilled").length, 1);
      const loser = outcomes.find((result) => result.status === "rejected");
      assert.equal(loser?.status === "rejected" && loser.reason.code, "23505");
    } finally {
      await Promise.all(clients.map((client) => client.end()));
    }
  }
});

test("failed multi-record transaction rolls back season, plan, task and command outcome", async () => {
  const seasonId = randomUUID();
  await db.query("BEGIN");
  try {
    await createSeason({ id: seasonId, date: "2026-08-08" });
    const planId = await createPlan(seasonId);
    await createTask(planId, "2026-08-08");
    await db.query(`INSERT INTO business_command_idempotency_records
      (id, user_id, business_id, command, key, payload_fingerprint, season_id, result, expires_at)
      VALUES ($1, $2, $3, 'CREATE', 'rollback', 'fingerprint', $4, '{}'::jsonb, now() + interval '1 day')`,
    [randomUUID(), userId, businessId, seasonId]);
    await rejectsSql(() => createTask(planId, "2026-08-07"), "23514");
  } finally {
    await db.query("ROLLBACK");
  }
  assert.equal((await db.query("SELECT count(*)::int AS count FROM seasons WHERE id = $1", [seasonId])).rows[0].count, 0);
  assert.equal((await db.query("SELECT count(*)::int AS count FROM business_command_idempotency_records WHERE season_id = $1", [seasonId])).rows[0].count, 0);
});

test("command outcome uniqueness includes authorized business and command scope", async () => {
  const seasonId = await createSeason({ date: "2026-08-09" });
  const insert = (command: string) => db.query(`INSERT INTO business_command_idempotency_records
    (id, user_id, business_id, command, key, payload_fingerprint, season_id, result, expires_at)
    VALUES ($1, $2, $3, $4, 'same-key', 'fingerprint', $5, '{}'::jsonb, now() + interval '1 day')`,
  [randomUUID(), userId, businessId, command, seasonId]);
  await insert("CREATE");
  await rejectsSql(() => insert("CREATE"), "23505");
  await insert("ACTIVATE");
  await rejectsSql(() => db.query(`INSERT INTO business_command_idempotency_records
    (id, user_id, business_id, command, key, payload_fingerprint, season_id, result, expires_at)
    VALUES ($1, $2, $3, 'CREATE', 'wrong-scope', 'fingerprint', $4, '{}'::jsonb, now() + interval '1 day')`,
  [randomUUID(), userId, otherBusinessId, seasonId]), "23503");
});

test("immutable runtime definitions allow availability changes without rewriting content", async () => {
  await rejectsSql(() => db.query("UPDATE crop_definition_versions SET display_name = 'changed' WHERE id = $1", [cropVersionId]), "23514");
  await rejectsSql(() => db.query("UPDATE validated_template_versions SET task_definitions = '[]' WHERE id = $1", [templateId]), "23514");
  await db.query("UPDATE crop_definition_versions SET selectable = false WHERE id = $1", [cropVersionId]);
  await db.query("UPDATE validated_template_versions SET available = false WHERE id = $1", [templateId]);
  const content = await db.query("SELECT jsonb_array_length(task_definitions) AS count FROM validated_template_versions WHERE id = $1", [templateId]);
  assert.equal(content.rows[0].count, 1);
});

test("activation snapshot validates parent source and same-field boundary while supporting point-only fields", async () => {
  await db.query("BEGIN");
  insideTransaction = true;
  try {
    const seasonId = await createSeason({ date: "2026-08-10" });
    const planId = await createPlan(seasonId);
    await createTask(planId, "2026-08-10");
    const insert = (source: string, templateVersionId: string | null = null, boundaryId: string | null = null) => db.query(`INSERT INTO season_context_snapshots
      (season_id, field_boundary_version_id, crop_snapshot, source, template_version_id, activated_at, business_timezone, activated_local_date)
      SELECT id, $2, '{}'::jsonb, $3, $4, activated_at, 'Europe/Istanbul', (activated_at AT TIME ZONE 'Europe/Istanbul')::date
        FROM seasons WHERE id = $1`, [seasonId, boundaryId, source, templateVersionId]);
    await db.query("UPDATE seasons SET status = 'ACTIVE', activated_at = now() WHERE id = $1", [seasonId]);
    await rejectsSql(() => insert("VALIDATED_TEMPLATE", templateId), "23514");
    const foreignFieldId = randomUUID();
    const foreignBoundaryId = randomUUID();
    await db.query(`INSERT INTO fields (id, business_id, name, representative_point)
      VALUES ($1, $2, 'Unrelated field', ST_SetSRID(ST_MakePoint(29,41),4326))`, [foreignFieldId, otherBusinessId]);
    await db.query(`INSERT INTO field_boundary_versions (id, field_id, version, geometry)
      VALUES ($1, $2, 1, ST_GeomFromText('POLYGON((29 41,29.01 41,29.01 41.01,29 41.01,29 41))',4326))`, [foreignBoundaryId, foreignFieldId]);
    await rejectsSql(() => insert("MANUAL", null, foreignBoundaryId), "23514");
    await insert("MANUAL");
    await rejectsSql(() => db.query("UPDATE season_context_snapshots SET crop_snapshot = '{\"changed\":true}' WHERE season_id = $1", [seasonId]), "23514");
    // Check DELETE itself: update immutability alone cannot protect delete/reinsert.
    await rejectsSql(() => db.query("DELETE FROM season_context_snapshots WHERE season_id = $1", [seasonId]), "23514");
    assert.deepEqual((await db.query("SELECT crop_snapshot FROM season_context_snapshots WHERE season_id = $1", [seasonId])).rows[0].crop_snapshot, {});
  } finally {
    insideTransaction = false;
    await db.query("ROLLBACK");
  }
});

test("season identity and actual planting date remain immutable after creation", async () => {
  const seasonId = await createSeason({ date: "2026-08-12" });
  const planId = await createPlan(seasonId, "VALIDATED_TEMPLATE", templateId);
  await createTask(planId, "2026-08-12");
  await rejectsSql(() => db.query("UPDATE seasons SET actual_planting_date = '2026-08-13' WHERE id = $1", [seasonId]), "23514");
  await rejectsSql(() => db.query("UPDATE seasons SET crop_definition_version_id = $2 WHERE id = $1", [seasonId, nextCropVersionId]), "23514");
  await rejectsSql(() => db.query("UPDATE seasons SET crop_key = NULL, crop_definition_version_id = NULL, custom_crop_id = $2 WHERE id = $1", [seasonId, customCropId]), "23514");
  const targetFieldId = randomUUID();
  await db.query(`INSERT INTO fields (id, business_id, name, representative_point)
    VALUES ($1, $2, 'Target field', ST_SetSRID(ST_MakePoint(29,41),4326))`, [targetFieldId, otherBusinessId]);
  try {
    await rejectsSql(() => db.query("UPDATE seasons SET business_id = $2, field_id = $3 WHERE id = $1", [seasonId, otherBusinessId, targetFieldId]), "23514");
  } finally {
    await db.query("DELETE FROM fields WHERE id = $1", [targetFieldId]);
  }
  await db.query("UPDATE seasons SET version = version + 1, status = 'ACTIVE', activated_at = now() WHERE id = $1", [seasonId]);
  const row = (await db.query("SELECT version, status, actual_planting_date::text AS date FROM seasons WHERE id = $1", [seasonId])).rows[0];
  assert.deepEqual(row, { version: 2, status: "ACTIVE", date: "2026-08-12" });
});

test("season plans cannot move their tasks to another season", async () => {
  const firstId = await createSeason({ date: "2026-08-15" });
  const secondId = await createSeason({ date: "2026-08-16" });
  const planId = await createPlan(firstId);
  await createTask(planId, "2026-08-15");
  await rejectsSql(() => db.query("UPDATE season_plans SET season_id = $2 WHERE id = $1", [planId, secondId]), "23514");
  const row = (await db.query("SELECT season_id FROM season_plans WHERE id = $1", [planId])).rows[0];
  assert.equal(row.season_id, firstId);
});
