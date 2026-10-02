import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after, before } from "node:test";
import { Client } from "pg";

import { assertDisposableDatabaseUrl } from "../support/disposable-database.js";

const databaseUrl = process.env.DATABASE_URL;
assertDisposableDatabaseUrl(databaseUrl);
const db = new Client({ connectionString: databaseUrl });

before(async () => db.connect());
after(async () => db.end());

test("weather snapshot schema is additive, tenant-bound, and preserves existing feature tables", async () => {
  const relations = await db.query<{ table_name: string }>(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1::text[])",
    [["weather_snapshots", "weather_daily_forecasts", "businesses", "fields", "seasons", "planned_tasks", "task_completions"]],
  );
  const names = new Set(relations.rows.map((row) => row.table_name));
  for (const table of ["weather_snapshots", "weather_daily_forecasts", "businesses", "fields", "seasons", "planned_tasks", "task_completions"]) {
    assert.ok(names.has(table), `${table} remains present`);
  }

  const constraints = await db.query<{ table_name: string; constraint_name: string; definition: string }>(
    `SELECT pg_class.relname AS table_name, pg_constraint.conname AS constraint_name, pg_get_constraintdef(pg_constraint.oid) AS definition
       FROM pg_constraint JOIN pg_class ON pg_class.oid = conrelid
       JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
       WHERE nspname = 'public' AND pg_class.relname IN ('weather_snapshots', 'weather_daily_forecasts')`,
  );
  const definitions = constraints.rows.map((row) => `${row.table_name} ${row.constraint_name} ${row.definition}`).join("\n");
  assert.match(definitions, /UNIQUE \((business_id, field_id|field_id, business_id)\)/i);
  assert.match(definitions, /FOREIGN KEY \(field_id, business_id\) REFERENCES fields\s*\(id, business_id\)/i);
  assert.match(definitions, /UNIQUE \(snapshot_id, local_date\)/i);
  assert.match(definitions, /FOREIGN KEY \(snapshot_id\) REFERENCES weather_snapshots/i);
  assert.match(definitions, /cardinality\(forecast_local_dates\) = 3/i);
  assert.match(definitions, /coverage_start < coverage_end/i);
  assert.match(definitions, /weather_daily_forecasts_temperature_range_check/i);
  assert.match(definitions, /weather_daily_forecasts_precipitation_finite_check/i);
  assert.match(definitions, /weather_daily_forecasts_wind_finite_check/i);
});

test("database accepts exactly three unique forecast dates in the same field business", async () => {
  const businessId = randomUUID();
  const otherBusinessId = randomUUID();
  const fieldId = randomUUID();
  const snapshotId = randomUUID();
  const insertSnapshot = async (business: string, id = snapshotId) => db.query(`
    INSERT INTO weather_snapshots (
      id, business_id, field_id, representative_point, location_fingerprint, business_timezone,
      coverage_start, coverage_end, forecast_local_dates, fetched_at, refresh_started_at,
      quality_status, observed_at, condition_code, temperature_c
    ) VALUES (
      $1::uuid, $2::uuid, $3::uuid, ST_SetSRID(ST_MakePoint(29, 41), 4326), '29.000000,41.000000',
      'Europe/Istanbul', '2026-10-01T00:00:00Z', '2026-10-04T00:00:00Z',
      ARRAY['2026-10-01', '2026-10-02', '2026-10-03'], '2026-10-01T06:00:00Z',
      '2026-10-01T05:55:00Z', 'ACCEPTED', '2026-10-01T05:30:00Z', 'CLEAR', 18
    )`, [id, business, fieldId]);
  const insertDay = (id: string, localDate: string) => db.query(`
    INSERT INTO weather_daily_forecasts (
      id, snapshot_id, local_date, condition_code, temperature_high_c, temperature_low_c,
      precipitation_chance_percent, wind_speed_kph
    ) VALUES ($1::uuid, $2::uuid, $3::date, 'CLEAR', 22, 12, 10, 8)
  `, [randomUUID(), id, localDate]);
  const insertDayWithValues = (localDate: string, high: number, low: number, precipitation: number, wind: number) => db.query(`
    INSERT INTO weather_daily_forecasts (
      id, snapshot_id, local_date, condition_code, temperature_high_c, temperature_low_c,
      precipitation_chance_percent, wind_speed_kph
    ) VALUES ($1::uuid, $2::uuid, $3::date, 'CLEAR', $4, $5, $6, $7)
  `, [randomUUID(), snapshotId, localDate, high, low, precipitation, wind]);

  await db.query("BEGIN");
  try {
    await db.query("INSERT INTO businesses (id) VALUES ($1), ($2)", [businessId, otherBusinessId]);
    await db.query("INSERT INTO fields (id, business_id, name, representative_point) VALUES ($1, $2, 'Weather field', ST_SetSRID(ST_MakePoint(29, 41), 4326))", [fieldId, businessId]);

    await insertSnapshot(businessId);
    await insertDay(snapshotId, "2026-10-01");
    await insertDay(snapshotId, "2026-10-02");
    await assert.rejects(db.query("COMMIT"));
    await db.query("ROLLBACK");

    await db.query("BEGIN");
    await db.query("INSERT INTO businesses (id) VALUES ($1), ($2)", [businessId, otherBusinessId]);
    await db.query("INSERT INTO fields (id, business_id, name, representative_point) VALUES ($1, $2, 'Weather field', ST_SetSRID(ST_MakePoint(29, 41), 4326))", [fieldId, businessId]);
    await insertSnapshot(businessId);
    await insertDay(snapshotId, "2026-10-01");
    await insertDay(snapshotId, "2026-10-02");
    await insertDay(snapshotId, "2026-10-03");
    await db.query("COMMIT");
    const accepted = await db.query("SELECT count(*)::int AS days FROM weather_daily_forecasts WHERE snapshot_id = $1", [snapshotId]);
    assert.equal(accepted.rows[0]?.days, 3);

    await assert.rejects(insertDay(snapshotId, "2026-10-03"));
    await assert.rejects(insertDayWithValues("2026-10-04", 1, 2, 10, 8));
    await assert.rejects(insertDayWithValues("2026-10-04", 22, 12, 101, 8));
    await assert.rejects(insertDayWithValues("2026-10-04", 22, 12, 10, -1));
    await assert.rejects(insertSnapshot(otherBusinessId, randomUUID()));
  } finally {
    await db.query("ROLLBACK").catch(() => undefined);
    await db.query("DELETE FROM weather_snapshots WHERE id = $1", [snapshotId]).catch(() => undefined);
    await db.query("DELETE FROM fields WHERE id = $1", [fieldId]).catch(() => undefined);
    await db.query("DELETE FROM businesses WHERE id = ANY($1::uuid[])", [[businessId, otherBusinessId]]).catch(() => undefined);
  }
});

test("database rejects three child dates that differ from parent coverage dates", async () => {
  const businessId = randomUUID();
  const fieldId = randomUUID();
  const snapshotId = randomUUID();
  const beginSnapshot = async () => {
    await db.query("BEGIN");
    await db.query("INSERT INTO businesses (id) VALUES ($1)", [businessId]);
    await db.query("INSERT INTO fields (id, business_id, name, representative_point) VALUES ($1, $2, 'Coverage field', ST_SetSRID(ST_MakePoint(29, 41), 4326))", [fieldId, businessId]);
    await db.query(`INSERT INTO weather_snapshots (
      id, business_id, field_id, representative_point, location_fingerprint, business_timezone,
      coverage_start, coverage_end, forecast_local_dates, fetched_at, refresh_started_at,
      quality_status, observed_at, condition_code, temperature_c
    ) VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint(29, 41), 4326), '29.000000,41.000000',
      'Europe/Istanbul', '2026-10-01T00:00:00Z', '2026-10-04T00:00:00Z',
      ARRAY['2026-10-01', '2026-10-02', '2026-10-03'], '2026-10-01T06:00:00Z',
      '2026-10-01T05:55:00Z', 'ACCEPTED', '2026-10-01T05:30:00Z', 'CLEAR', 18)`, [snapshotId, businessId, fieldId]);
  };
  const insertForecasts = async (childDates: readonly string[]) => {
    for (const localDate of childDates) await db.query(`INSERT INTO weather_daily_forecasts (
      id, snapshot_id, local_date, condition_code, temperature_high_c, temperature_low_c,
      precipitation_chance_percent, wind_speed_kph
    ) VALUES ($1, $2, $3::date, 'CLEAR', 22, 12, 10, 8)`, [randomUUID(), snapshotId, localDate]);
  };

  try {
    await beginSnapshot();
    await insertForecasts(["2026-10-01", "2026-10-02", "2026-10-04"]);
    await assert.rejects(db.query("COMMIT"), /Weather snapshot daily forecast dates must match its three covered local dates/i);
    await db.query("ROLLBACK");
    const absent = await db.query("SELECT 1 FROM weather_snapshots WHERE id = $1", [snapshotId]);
    assert.equal(absent.rowCount, 0, "mismatched snapshot transaction did not commit");

    await beginSnapshot();
    await insertForecasts(["2026-10-01", "2026-10-02", "2026-10-03"]);
    await db.query("COMMIT");
    const accepted = await db.query("SELECT local_date::text FROM weather_daily_forecasts WHERE snapshot_id = $1 ORDER BY local_date", [snapshotId]);
    assert.deepEqual(accepted.rows.map((row) => row.local_date), ["2026-10-01", "2026-10-02", "2026-10-03"]);
  } finally {
    await db.query("ROLLBACK").catch(() => undefined);
    await db.query("DELETE FROM weather_snapshots WHERE id = $1", [snapshotId]).catch(() => undefined);
    await db.query("DELETE FROM fields WHERE id = $1", [fieldId]).catch(() => undefined);
    await db.query("DELETE FROM businesses WHERE id = $1", [businessId]).catch(() => undefined);
  }
});
