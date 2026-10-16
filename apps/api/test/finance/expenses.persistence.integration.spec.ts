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
  if (inTransaction) await db.query("SAVEPOINT expense_expected_rejection");
  try {
    await assert.rejects(action, (error: unknown) => {
      if (code) assert.equal((error as { code?: string }).code, code);
      return true;
    });
  } finally {
    if (inTransaction) {
      await db.query("ROLLBACK TO SAVEPOINT expense_expected_rejection");
      await db.query("RELEASE SAVEPOINT expense_expected_rejection");
    }
  }
}

before(async () => {
  await db.connect();
  const target = await db.query<{ database: string; postgis: boolean }>(
    "SELECT current_database() AS database, EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'postgis') AS postgis",
  );
  assert.equal(target.rows[0]?.database, "ekim_hasat_test", "Expense fixtures may write only to the disposable test database");
  assert.equal(target.rows[0]?.postgis, true, "PostGIS must be enabled before Field fixtures");
});

after(async () => {
  try {
    if (inTransaction) await db.query("ROLLBACK");
  } finally {
    await db.end();
  }
});

test("Expense schema preserves tenant relations, exact values, date-only meaning, and history", async () => {
  const table = await db.query<{ name: string | null }>("SELECT to_regclass('public.expenses') AS name");
  assert.equal(table.rows[0]?.name, "expenses", "SPEC-012 Expense migration must be applied");

  const columns = await db.query<{ column_name: string; data_type: string; is_nullable: string; numeric_precision: number | null; numeric_scale: number | null }>(
    `SELECT column_name, data_type, is_nullable, numeric_precision, numeric_scale
       FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'expenses'`,
  );
  const byName = new Map(columns.rows.map((column) => [column.column_name, column]));
  for (const column of ["id", "business_id", "field_id", "actor_user_id", "actor_membership_id", "amount", "currency", "category", "expense_date", "recorded_at"]) {
    assert.equal(byName.get(column)?.is_nullable, "NO", `expenses.${column} must be required`);
  }
  assert.equal(byName.get("season_id")?.is_nullable, "YES");
  assert.equal(byName.get("note")?.is_nullable, "YES");
  assert.equal(byName.get("amount")?.data_type, "numeric");
  assert.equal(byName.get("amount")?.numeric_precision, null, "NUMERIC must not coerce values through a typmod");
  assert.equal(byName.get("amount")?.numeric_scale, null);
  assert.equal(byName.get("expense_date")?.data_type, "date");
  assert.equal(byName.get("note")?.data_type, "text");

  const constraints = await db.query<{ contype: string; definition: string }>(
    `SELECT contype, pg_get_constraintdef(oid) AS definition FROM pg_constraint
      WHERE conrelid = 'public.expenses'::regclass`,
  );
  const definitions = constraints.rows.map(({ definition }) => definition.toLowerCase());
  assert.ok(definitions.some((definition) => definition.includes("primary key (business_id, id)")), "identity is composite by Business");
  assert.ok(definitions.some((definition) => /amount > .*0/.test(definition)), "amount must be positive");
  assert.ok(definitions.some((definition) => /amount < .*1000000000000000000/.test(definition)), "integer range is bounded");
  assert.ok(definitions.some((definition) => definition.includes("scale(amount) <= 6")), "fractional scale is bounded without rounding");
  assert.ok(definitions.some((definition) => definition.includes("currency")), "currency shape is constrained");
  assert.ok(definitions.some((definition) => definition.includes("category")), "category set is constrained");
  assert.ok(constraints.rows.filter((row) => row.contype === "f").some(({ definition }) => /fields/.test(definition)
    && /field_id/.test(definition) && /business_id/.test(definition)), "Field and Business are constrained together");
  assert.ok(constraints.rows.filter((row) => row.contype === "f").some(({ definition }) => /seasons/.test(definition)
    && /season_id/.test(definition) && /field_id/.test(definition) && /business_id/.test(definition)), "Season, Field, and Business are constrained together");
  assert.ok(constraints.rows.filter((row) => row.contype === "f").some(({ definition }) => /memberships/.test(definition)
    && /actor_membership_id/.test(definition) && /actor_user_id/.test(definition)), "actor provenance is constrained");
  assert.ok(constraints.rows.filter((row) => row.contype === "f").every(({ definition }) => !/ON DELETE CASCADE/i.test(definition)), "historical relations are restrictive");

  const indexes = await db.query<{ indexdef: string }>("SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'expenses'");
  const indexDefinitions = indexes.rows.map(({ indexdef }) => indexdef.replace(/\s+/g, " ").toLowerCase());
  assert.ok(indexDefinitions.some((definition) => /\(business_id, field_id, expense_date desc, id desc\)/.test(definition)), "Field diary index exists");
  assert.ok(indexDefinitions.some((definition) => /\(business_id, field_id, season_id, expense_date desc, id desc\)/.test(definition)), "Season diary index exists");
  const triggers = await db.query<{ definition: string }>(
    `SELECT pg_get_triggerdef(oid) AS definition FROM pg_trigger
      WHERE tgrelid = 'public.expenses'::regclass AND NOT tgisinternal`,
  );
  assert.ok(triggers.rows.some(({ definition }) => /UPDATE OR DELETE|DELETE OR UPDATE/i.test(definition)), "accepted Expenses reject mutation");

  await db.query("BEGIN");
  inTransaction = true;
  const businessId = randomUUID();
  const otherBusinessId = randomUUID();
  const userId = randomUUID();
  const membershipId = randomUUID();
  const otherBusinessMembershipId = randomUUID();
  const fieldId = randomUUID();
  const otherBusinessFieldId = randomUUID();
  const seasonId = randomUUID();
  const cropKey = `expense-schema-${randomUUID()}`;
  const cropVersionId = randomUUID();
  const expenseId = randomUUID();
  await db.query("INSERT INTO businesses (id) VALUES ($1), ($2)", [businessId, otherBusinessId]);
  await db.query(`INSERT INTO application_users (id, auth_provider, auth_subject) VALUES ($1::uuid, 'expense-schema', $2)`, [userId, userId]);
  await db.query(`INSERT INTO memberships (id, business_id, user_id, role, status)
    VALUES ($1, $3, $4, 'OWNER', 'ACTIVE'), ($2, $5, $4, 'OWNER', 'ACTIVE')`,
  [membershipId, otherBusinessMembershipId, businessId, userId, otherBusinessId]);
  await db.query(`INSERT INTO fields (id, business_id, name, representative_point)
    VALUES ($1, $3, 'Expense field', ST_SetSRID(ST_MakePoint(29, 41), 4326)),
           ($2, $4, 'Other business field', ST_SetSRID(ST_MakePoint(30, 42), 4326))`,
  [fieldId, otherBusinessFieldId, businessId, otherBusinessId]);
  await db.query(`INSERT INTO crop_definition_versions (id, crop_key, version, display_name) VALUES ($1, $2, '1', 'Expense schema crop')`, [cropVersionId, cropKey]);
  await db.query(`INSERT INTO seasons (id, business_id, field_id, crop_key, crop_definition_version_id, actual_planting_date)
    VALUES ($1, $2, $3, $4, $5, '2026-09-01')`, [seasonId, businessId, fieldId, cropKey, cropVersionId]);

  const insertExpense = (values: { id?: string; business?: string; field?: string; season?: string | null; amount?: string; currency?: string; category?: string; expenseDate?: string; note?: string | null } = {}) => db.query(
    `INSERT INTO expenses (id, business_id, field_id, season_id, actor_user_id, actor_membership_id, amount, currency, category, expense_date, note)
     VALUES ($1, $2, $3, $4, $5, $6, $7::numeric, $8, $9, $10::date, $11)`,
    [values.id ?? expenseId, values.business ?? businessId, values.field ?? fieldId, values.season === undefined ? seasonId : values.season,
      userId, values.business === otherBusinessId ? otherBusinessMembershipId : membershipId, values.amount ?? "123456789012345678.123456",
      values.currency ?? "TRY", values.category ?? "FERTILIZER", values.expenseDate ?? "2026-10-16", values.note === undefined ? "  unchanged note  " : values.note],
  );

  await insertExpense();
  await insertExpense({ business: otherBusinessId, field: otherBusinessFieldId, season: null });
  const stored = await db.query<{ amount: string; expense_date: string; note: string; actor_user_id: string; actor_membership_id: string }>(
    `SELECT amount::text, to_char(expense_date, 'YYYY-MM-DD') AS expense_date, note, actor_user_id, actor_membership_id
       FROM expenses WHERE business_id = $1 AND id = $2`, [businessId, expenseId],
  );
  assert.deepEqual(stored.rows[0], { amount: "123456789012345678.123456", expense_date: "2026-10-16", note: "  unchanged note  ", actor_user_id: userId, actor_membership_id: membershipId });
  await insertExpense({ id: randomUUID(), season: null, amount: "1", expenseDate: "2026-10-17", note: null });
  await rejectsSql(() => insertExpense(), "23505");
  await rejectsSql(() => insertExpense({ id: randomUUID(), amount: "0" }), "23514");
  await rejectsSql(() => insertExpense({ id: randomUUID(), amount: "1.1234567" }), "23514");
  await rejectsSql(() => insertExpense({ id: randomUUID(), field: otherBusinessFieldId }), "23503");
  await rejectsSql(() => insertExpense({ id: randomUUID(), season: randomUUID() }), "23503");
  await rejectsSql(() => insertExpense({ id: randomUUID(), currency: "try" }), "23514");
  await rejectsSql(() => insertExpense({ id: randomUUID(), category: "CUSTOM" }), "23514");
  await rejectsSql(() => db.query("UPDATE expenses SET note = 'changed' WHERE business_id = $1 AND id = $2", [businessId, expenseId]), "23514");
  await rejectsSql(() => db.query("DELETE FROM expenses WHERE business_id = $1 AND id = $2", [businessId, expenseId]), "23514");
  await rejectsSql(() => db.query("DELETE FROM fields WHERE id = $1", [fieldId]), "23503");
  await rejectsSql(() => db.query("DELETE FROM seasons WHERE id = $1", [seasonId]), "23503");
  await rejectsSql(() => db.query("DELETE FROM memberships WHERE id = $1", [membershipId]), "23503");
  await rejectsSql(() => db.query("DELETE FROM application_users WHERE id = $1", [userId]), "23503");
  await db.query("ROLLBACK");
  inTransaction = false;
});
