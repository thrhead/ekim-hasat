import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "pg";
import { assertDisposableDatabaseUrl } from "../support/disposable-database.js";

const databaseUrl = process.env.DATABASE_URL;
assertDisposableDatabaseUrl(databaseUrl);
const db = new Client({ connectionString: databaseUrl });

test("TaskSkip migration retains one tenant-scoped, versioned outcome with bounded history reads", async () => {
  await db.connect();
  try {
    const table = await db.query<{ name: string | null }>(
      "SELECT to_regclass('public.task_skips') AS name",
    );
    assert.equal(table.rows[0]?.name, "task_skips", "TaskSkip migration must be applied");

    const columns = await db.query<{ column_name: string; data_type: string; is_nullable: string }>(
      `SELECT column_name, data_type, is_nullable FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'task_skips'`,
    );
    const byName = new Map(columns.rows.map((column) => [column.column_name, column]));
    for (const column of [
      "id", "skip_id", "planned_task_id", "season_plan_id", "season_id", "field_id", "business_id",
      "actor_user_id", "actor_membership_id", "skipped_at", "base_task_version", "accepted_task_version",
      "payload_fingerprint", "task_title_snapshot", "planned_local_date_snapshot",
    ]) {
      assert.ok(byName.has(column), `task_skips.${column} must be persisted`);
      assert.equal(byName.get(column)?.is_nullable, "NO", `task_skips.${column} must be required`);
    }
    for (const column of [
      "id", "skip_id", "planned_task_id", "season_plan_id", "season_id", "field_id", "business_id",
      "actor_user_id", "actor_membership_id",
    ]) {
      assert.equal(byName.get(column)?.data_type, "uuid", `task_skips.${column} must be a UUID`);
    }
    assert.equal(byName.get("skipped_at")?.data_type, "timestamp with time zone");
    assert.equal(byName.get("base_task_version")?.data_type, "integer");
    assert.equal(byName.get("accepted_task_version")?.data_type, "integer");
    assert.equal(byName.get("planned_local_date_snapshot")?.data_type, "date");

    const constraints = await db.query<{ contype: string; definition: string }>(
      `SELECT contype, pg_get_constraintdef(oid) AS definition FROM pg_constraint
       WHERE conrelid = 'public.task_skips'::regclass`,
    );
    const definitions = (type: string) => constraints.rows
      .filter((row) => row.contype === type)
      .map((row) => row.definition.replace(/\s+/g, " ").toLowerCase());
    const primary = definitions("p");
    const unique = definitions("u");
    const foreign = definitions("f");
    const checks = definitions("c");
    assert.ok(primary.some((definition) => /primary key \(id\)/.test(definition)), "internal row id is the primary key");
    assert.ok(unique.some((definition) => /unique \(business_id, skip_id\)/.test(definition)),
      "Skip command identity is unique within its Business");
    assert.ok(unique.some((definition) => /unique \(planned_task_id\)/.test(definition)),
      "a planned task has at most one Skip outcome");
    assert.ok(!unique.some((definition) => /unique \(skip_id\)/.test(definition)),
      "Skip command identity is not globally unique");

    const globalSkipIdIndexes = await db.query(
      `SELECT indexrelid FROM pg_index
       WHERE indrelid = 'public.task_skips'::regclass
         AND indisunique AND indpred IS NULL AND indnkeyatts = 1
         AND pg_get_indexdef(indexrelid, 1, true) = 'skip_id'`,
    );
    assert.equal(globalSkipIdIndexes.rowCount, 0,
      "no standalone global unique index may prevent the same skip_id in another Business");

    for (const [columns, reference] of [
      ["planned_task_id, season_plan_id", "planned_tasks(id, season_plan_id)"],
      ["season_plan_id, season_id", "season_plans(id, season_id)"],
      ["season_id, business_id, field_id", "seasons(id, business_id, field_id)"],
      ["field_id, business_id", "fields(id, business_id)"],
      ["actor_membership_id, business_id, actor_user_id", "memberships(id, business_id, user_id)"],
    ] as const) {
      assert.ok(foreign.some((definition) => definition.includes(`foreign key (${columns}) references ${reference}`)),
        `TaskSkip must constrain ${columns} to ${reference}`);
    }
    assert.ok(foreign.some((definition) => definition.includes("foreign key (actor_user_id) references application_users(id)")),
      "actor user is retained");
    assert.ok(foreign.length >= 6 && foreign.every((definition) => definition.includes("on delete restrict")),
      "every historical reference restricts deletion");
    assert.ok(checks.some((definition) => /base_task_version > 0/.test(definition)),
      "base task version must be positive");
    assert.ok(checks.some((definition) => /accepted_task_version = \(base_task_version \+ 1\)|accepted_task_version = base_task_version \+ 1/.test(definition)),
      "accepted task version must advance exactly once");
    assert.ok(checks.some((definition) => /(?:length|char_length)\(payload_fingerprint\) > 0/.test(definition)),
      "payload fingerprint must be non-empty");

    const indexes = await db.query<{ indexdef: string }>(
      "SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'task_skips'",
    );
    const indexDefinitions = indexes.rows.map(({ indexdef }) => indexdef.replace(/\s+/g, " ").toLowerCase());
    assert.ok(indexDefinitions.some((definition) => /\(field_id, skipped_at desc, id desc\)/.test(definition)),
      "Field Task History and Diary reads have a bounded keyset index");
    assert.ok(indexDefinitions.some((definition) => /\(season_id, skipped_at desc, id desc\)/.test(definition)),
      "Season Task History and Diary reads have a bounded keyset index");
  } finally {
    await db.end();
  }
});
