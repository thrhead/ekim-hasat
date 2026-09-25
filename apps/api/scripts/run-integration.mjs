import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { Client } from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl?.trim()) {
  console.error("DATABASE_URL must point to a migrated PostgreSQL/PostGIS database");
  process.exit(1);
}

const apiRoot = process.cwd();
const testRunner = resolve(apiRoot, "../../scripts/run-node-tests.mjs");
const testResult = spawnSync(process.execPath, [testRunner, "api-integration"], {
  cwd: apiRoot,
  env: process.env,
  stdio: "inherit",
});

if (testResult.error) throw testResult.error;
if (testResult.status !== 0) process.exit(testResult.status ?? 1);

const sqlPath = resolve(apiRoot, "test/persistence/t008-schema-invariants.sql");
const psqlScript = await readFile(sqlPath, "utf8");
const sql = psqlScript.replace(/^\\set ON_ERROR_STOP on\s*$/m, "");
if (sql === psqlScript) {
  throw new Error(`Expected psql ON_ERROR_STOP directive in ${sqlPath}`);
}

const client = new Client({ connectionString: databaseUrl });
try {
  await client.connect();
  await client.query(sql);
} finally {
  await client.end();
}
