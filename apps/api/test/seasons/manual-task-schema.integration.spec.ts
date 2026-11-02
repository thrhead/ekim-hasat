import assert from "node:assert/strict";
import { test } from "node:test";
import { Client } from "pg";

// Read-only pre-migration assertion: setup failures cannot masquerade as RED.
test("manual active task origin and durable receipt schema are installed", async () => {
  assert.ok(process.env.DATABASE_URL, "DATABASE_URL is required");
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    const target = await db.query<{ database: string }>("SELECT current_database() AS database");
    assert.equal(target.rows[0]?.database, "ekim_hasat_test");
    const baseline = await db.query<{ task_table: string | null; season_table: string | null }>(
      "SELECT to_regclass('public.planned_tasks')::text AS task_table, to_regclass('public.seasons')::text AS season_table",
    );
    assert.deepEqual(baseline.rows[0], { task_table: "planned_tasks", season_table: "seasons" }, "baseline migrations must be installed");
    const schema = await db.query<{ origin: boolean; receipt: string | null }>(`SELECT
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'planned_tasks' AND column_name = 'origin') AS origin,
      to_regclass('public.manual_task_creation_receipts')::text AS receipt`);
    assert.equal(schema.rows[0]?.origin, true, "planned task origin discriminator must exist");
    assert.equal(schema.rows[0]?.receipt, "manual_task_creation_receipts", "durable creation receipt must exist");
  } finally {
    await db.end();
  }
});

test("manual task origin and receipt enforce tenant-safe immutable identity", async () => {
  assert.ok(process.env.DATABASE_URL, "DATABASE_URL is required");
  const { randomUUID } = await import("node:crypto");
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const check = async () => assert.equal((await db.query("SELECT current_database() AS name")).rows[0]?.name, "ekim_hasat_test");
  const write = async (sql: string, values: unknown[] = []) => { await check(); return db.query(sql, values); };
  let begun = false;
  try {
    await check();
    const ready = await db.query("SELECT to_regclass('public.manual_task_creation_receipts') AS receipt");
    assert.ok(ready.rows[0]?.receipt, "receipt schema must exist before fixture writes");
    await write("BEGIN"); begun = true;
    const business = randomUUID(), otherBusiness = randomUUID(), user = randomUUID(), membership = randomUUID();
    const field = randomUUID(), crop = randomUUID(), season = randomUUID(), plan = randomUUID(), legacy = randomUUID(), manual = randomUUID(), mutation = randomUUID();
    await write("INSERT INTO businesses(id) VALUES ($1),($2)", [business, otherBusiness]);
    await write("INSERT INTO application_users(id, auth_provider, auth_subject) VALUES ($1::uuid, 'test', $1::uuid::text)", [user]);
    await write("INSERT INTO memberships(id,business_id,user_id,role,status) VALUES ($1,$2,$3,'OWNER','ACTIVE')", [membership,business,user]);
    await write("INSERT INTO fields(id,business_id,name,representative_point) VALUES ($1,$2,'test',ST_SetSRID(ST_MakePoint(29,41),4326))", [field,business]);
    await write("INSERT INTO custom_crops(id,business_id,display_name) VALUES ($1,$2,'test')", [crop,business]);
    await write("INSERT INTO seasons(id,business_id,field_id,custom_crop_id,actual_planting_date) VALUES ($1,$2,$3,$4,'2024-01-01')", [season,business,field,crop]);
    await write("INSERT INTO season_plans(id,season_id,source,source_snapshot) VALUES ($1,$2,'MANUAL','{}')", [plan,season]);
    await write("INSERT INTO planned_tasks(id,season_plan_id,title,planned_local_date) VALUES ($1,$2,'legacy','2024-01-01')", [legacy,plan]);
    assert.equal((await db.query("SELECT origin FROM planned_tasks WHERE id=$1", [legacy])).rows[0]?.origin, "PLAN_DERIVED");
    await write("UPDATE season_plans SET status='APPROVED' WHERE id=$1", [plan]);
    await write("UPDATE seasons SET status='ACTIVE',activated_at=now() WHERE id=$1", [season]);
    await write("INSERT INTO planned_tasks(id,season_plan_id,title,planned_local_date,origin) VALUES ($1,$2,'manual','2024-01-01','POST_ACTIVATION_MANUAL')", [manual,plan]);
    const reject = async (sql: string, params: unknown[], code: string) => {
      await write("SAVEPOINT expected_failure");
      await assert.rejects(() => write(sql, params), (error: unknown) => (error as { code?: string }).code === code);
      await db.query("ROLLBACK TO SAVEPOINT expected_failure");
      await write("RELEASE SAVEPOINT expected_failure");
    };
    await reject("UPDATE planned_tasks SET origin='PLAN_DERIVED' WHERE id=$1", [manual], "23514");
    await reject("INSERT INTO planned_tasks(id,season_plan_id,title,planned_local_date,origin,source_template_task_key) VALUES ($1,$2,'bad','2024-01-01','POST_ACTIVATION_MANUAL','key')", [randomUUID(),plan], "23514");
    const insert = `INSERT INTO manual_task_creation_receipts(task_id,mutation_id,business_id,field_id,season_id,season_plan_id,actor_user_id,actor_membership_id,payload_fingerprint,accepted_result)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'fingerprint','{}')`;
    const values = [manual,mutation,business,field,season,plan,user,membership];
    await write(insert, values);
    await reject(insert, values, "23505");
    const otherTask = randomUUID();
    await write("INSERT INTO planned_tasks(id,season_plan_id,title,planned_local_date,origin) VALUES ($1,$2,'other','2024-01-01','POST_ACTIVATION_MANUAL')", [otherTask,plan]);
    await reject(insert, [otherTask,mutation,business,field,season,plan,user,membership], "23505");
    await reject(insert, [otherTask,randomUUID(),otherBusiness,field,season,plan,user,membership], "23503");
    await write("UPDATE planned_tasks SET planned_local_date='2024-01-02',version=version+1 WHERE id=$1", [manual]);
    assert.equal((await db.query("SELECT origin FROM planned_tasks WHERE id=$1", [manual])).rows[0]?.origin, "POST_ACTIVATION_MANUAL");
    await reject("UPDATE manual_task_creation_receipts SET payload_fingerprint='changed' WHERE task_id=$1", [manual], "23514");
    await reject("DELETE FROM manual_task_creation_receipts WHERE task_id=$1", [manual], "23514");
  } finally {
    if (begun) await db.query("ROLLBACK");
    await db.end();
  }
});
