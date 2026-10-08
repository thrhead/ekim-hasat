import assert from "node:assert/strict";
import { Client } from "pg";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { assertDisposableDatabaseUrl } from "../support/disposable-database.js";

const databaseUrl = process.env.DATABASE_URL;
assertDisposableDatabaseUrl(databaseUrl);
const db = new Client({ connectionString: databaseUrl });

test("TaskDateAdjustment persists tenant-scoped identity and retained audit relations", async () => {
  const contract = await readFile(new URL("../../../../specs/008-manual-active-season-task-adjustment/contracts/task-date-adjustments.openapi.yaml", import.meta.url), "utf8");
  const publicAdjustment = /    TaskDateAdjustment:\n[\s\S]*?(?=\n    TaskDateAdjustmentHistoryItem:)/.exec(contract)?.[0];
  assert.ok(publicAdjustment, "public adjustment response schema exists");
  assert.match(publicAdjustment, /adjustmentId:/);
  assert.doesNotMatch(publicAdjustment, /\n\s+(?:id|businessId|actorUserId|actorMembershipId):/,
    "internal row and authorization keys stay out of the public API");

  await db.connect();
  try {
    const table = await db.query("SELECT to_regclass('public.task_date_adjustments') AS name");
    assert.equal(table.rows[0]?.name, "task_date_adjustments", "TaskDateAdjustment migration must be applied");

    const columns = await db.query(`SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'task_date_adjustments'`);
    const byName = new Map(columns.rows.map((column) => [column.column_name, column]));
    for (const column of ["id", "adjustment_id", "planned_task_id", "season_plan_id", "season_id", "field_id",
      "business_id", "actor_user_id", "actor_membership_id", "previous_planned_local_date", "new_planned_local_date",
      "base_task_version", "accepted_task_version", "payload_fingerprint", "adjusted_at"]) {
      assert.ok(byName.has(column), `task_date_adjustments.${column} must be persisted`);
      assert.equal(byName.get(column)?.is_nullable, "NO", `task_date_adjustments.${column} must be required`);
    }
    assert.equal(byName.get("id")?.data_type, "uuid");
    assert.equal(byName.get("previous_planned_local_date")?.data_type, "date");
    assert.equal(byName.get("new_planned_local_date")?.data_type, "date");
    assert.equal(byName.get("adjusted_at")?.data_type, "timestamp with time zone");

    const constraints = await db.query(`SELECT conname, contype, pg_get_constraintdef(oid) AS definition
      FROM pg_constraint WHERE conrelid = 'public.task_date_adjustments'::regclass`);
    const primaryDefs = constraints.rows.filter((row) => row.contype === "p").map((row) => row.definition);
    const uniqueDefs = constraints.rows.filter((row) => row.contype === "u").map((row) => row.definition);
    const foreignDefs = constraints.rows.filter((row) => row.contype === "f").map((row) => row.definition);
    assert.ok(primaryDefs.some((definition) => /\(id\)/.test(definition)), "internal row id is the primary key");
    assert.ok(uniqueDefs.some((definition) => /business_id/.test(definition) && /adjustment_id/.test(definition)),
      "accepted command identity is unique within its Business");
    assert.ok(!uniqueDefs.some((definition) => /\(adjustment_id\)/.test(definition)),
      "public adjustmentId is not globally unique");
    assert.ok(foreignDefs.some((definition) => /planned_tasks/.test(definition) && /season_plan_id/.test(definition)),
      "adjustment references its task and plan together");
    assert.ok(foreignDefs.some((definition) => /seasons/.test(definition) && /business_id/.test(definition)),
      "Season, Business, and Field context is constrained together");
    assert.ok(foreignDefs.some((definition) => /fields/.test(definition) && /business_id/.test(definition)),
      "Field and Business context is constrained together");
    assert.ok(foreignDefs.some((definition) => /memberships/.test(definition) && /actor_membership_id/.test(definition)),
      "actor Membership is retained under its Business and user");
    assert.ok(foreignDefs.some((definition) => /application_users/.test(definition) && /actor_user_id/.test(definition)),
      "actor user is retained");
    assert.ok(foreignDefs.every((definition) => /ON DELETE RESTRICT/i.test(definition)),
      "audit relations prevent deletion of referenced operational history");

    const indexes = await db.query(`SELECT indexdef FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'task_date_adjustments'`);
    assert.ok(!indexes.rows.some((row) => /CREATE UNIQUE INDEX/i.test(row.indexdef)
      && /\(adjustment_id\)/.test(row.indexdef) && !/\(business_id, adjustment_id\)/.test(row.indexdef)),
    "no global unique index exists for public adjustmentId");
  } finally {
    await db.end();
  }
});
