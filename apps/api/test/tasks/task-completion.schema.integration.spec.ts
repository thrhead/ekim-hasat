import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "pg";

const databaseUrl = process.env.DATABASE_URL;
assert.ok(databaseUrl, "DATABASE_URL must point to a migrated PostgreSQL database");
const db = new Client({ connectionString: databaseUrl });

test("TaskCompletion migration enforces identity, tenant context, actor, and append-only fields", async () => {
  await db.connect();
  try {
    const table = await db.query("SELECT to_regclass('public.task_completions') AS name");
    assert.equal(table.rows[0]?.name, "task_completions", "TaskCompletion migration must be applied");

    const columns = await db.query(`SELECT column_name, data_type, is_nullable
      FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'task_completions'`);
    const byName = new Map(columns.rows.map((column) => [column.column_name, column]));
    for (const column of ["id", "planned_task_id", "business_id", "season_id", "field_id", "actor_user_id",
      "actor_membership_id", "occurred_at", "recorded_at", "base_task_version", "payload_fingerprint",
      "task_title_snapshot", "planned_local_date_snapshot"]) {
      assert.ok(byName.has(column), `task_completions.${column} must be persisted`);
      assert.equal(byName.get(column)?.is_nullable, "NO", `task_completions.${column} must be required`);
    }
    assert.equal(byName.get("occurred_at")?.data_type, "timestamp with time zone");
    assert.equal(byName.get("recorded_at")?.data_type, "timestamp with time zone");
    assert.equal(byName.get("planned_local_date_snapshot")?.data_type, "date");

    const constraints = await db.query(`SELECT conname, contype, pg_get_constraintdef(oid) AS definition
      FROM pg_constraint WHERE conrelid = 'public.task_completions'::regclass`);
    const primaryDefs = constraints.rows.filter((row) => row.contype === "p").map((row) => row.definition);
    const uniqueDefs = constraints.rows.filter((row) => row.contype === "u").map((row) => row.definition);
    const foreignDefs = constraints.rows.filter((row) => row.contype === "f").map((row) => row.definition);
    assert.ok(primaryDefs.some((definition) => /\(id\)/.test(definition)), "completion identity is unique");
    assert.ok(uniqueDefs.some((definition) => /\(planned_task_id\)/.test(definition)), "one completion per planned task");
    assert.ok(foreignDefs.some((definition) => /planned_tasks/.test(definition)), "completion references its planned task");
    assert.ok(foreignDefs.some((definition) => /seasons/.test(definition) && /business_id/.test(definition)), "season/business context is constrained together");
    assert.ok(foreignDefs.some((definition) => /fields/.test(definition) && /business_id/.test(definition)), "field/business context is constrained together");
    assert.ok(foreignDefs.some((definition) => /memberships/.test(definition) && /actor_membership_id/.test(definition)), "actor membership is referenced");
    assert.ok(foreignDefs.some((definition) => /application_users/.test(definition) && /actor_user_id/.test(definition)), "actor user is referenced");

    const triggers = await db.query(`SELECT tgname, pg_get_triggerdef(oid) AS definition
      FROM pg_trigger WHERE tgrelid = 'public.task_completions'::regclass AND NOT tgisinternal`);
    assert.ok(triggers.rows.some((trigger) => /(?:UPDATE OR DELETE|DELETE OR UPDATE)/.test(trigger.definition)), "accepted completion rows reject update and delete");
  } finally {
    await db.end();
  }
});
