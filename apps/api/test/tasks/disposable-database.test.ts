import assert from "node:assert/strict";
import test from "node:test";
import { assertDisposableDatabaseUrl } from "../support/disposable-database.js";

const sharedDevelopmentUrl = "postgresql://ekim_hasat:ekim_hasat_local@127.0.0.1:5432/ekim_hasat";

test("rejects shared development database URL before fixtures can run", () => {
  assert.throws(() => assertDisposableDatabaseUrl(sharedDevelopmentUrl), /ekim_hasat_test/);
});

test("accepts only the named disposable test database", () => {
  assert.doesNotThrow(() => assertDisposableDatabaseUrl("postgresql://user:pass@127.0.0.1:5432/ekim_hasat_test"));
  assert.throws(() => assertDisposableDatabaseUrl(undefined), /ekim_hasat_test/);
});
