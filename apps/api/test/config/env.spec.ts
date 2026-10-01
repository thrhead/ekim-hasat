import assert from "node:assert/strict";
import test from "node:test";

import { parseEnv } from "../../src/config/env.js";

const validSupabaseEnv = {
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_ANON_KEY: "test-anon-key",
};

test("uses safe development defaults", () => {
  assert.deepEqual(parseEnv({ DATABASE_URL: "postgresql://user:pass@localhost:5432/ekim", ...validSupabaseEnv }), {
    DATABASE_URL: "postgresql://user:pass@localhost:5432/ekim",
    PORT: 3000,
    NODE_ENV: "development",
    ...validSupabaseEnv,
  });
});

test("accepts valid explicit settings", () => {
  assert.deepEqual(parseEnv({
    DATABASE_URL: "postgres://user:pass@localhost:5432/ekim?schema=public",
    PORT: "5432",
    NODE_ENV: "test",
    ...validSupabaseEnv,
  }), {
    DATABASE_URL: "postgres://user:pass@localhost:5432/ekim?schema=public",
    PORT: 5432,
    NODE_ENV: "test",
    ...validSupabaseEnv,
  });
});

test("rejects missing or invalid PostgreSQL URLs", () => {
  for (const DATABASE_URL of [undefined, "", "http://localhost/db", "postgresql://"]) {
    assert.throws(() => parseEnv({ DATABASE_URL, ...validSupabaseEnv }), /DATABASE_URL/);
  }
});

test("rejects invalid ports", () => {
  for (const PORT of ["0", "65536", "3.5", "abc", ""]) {
    assert.throws(() => parseEnv({ DATABASE_URL: "postgres://u:p@localhost/db", PORT, ...validSupabaseEnv }), /PORT/);
  }
});

test("rejects unsupported NODE_ENV values", () => {
  assert.throws(() => parseEnv({
    DATABASE_URL: "postgres://u:p@localhost/db",
    NODE_ENV: "staging",
    ...validSupabaseEnv,
  }), /NODE_ENV/);
});

test("rejects invalid Supabase configuration", () => {
  for (const SUPABASE_URL of [undefined, "", "http://project.supabase.co", "not-a-url"]) {
    assert.throws(() => parseEnv({
      DATABASE_URL: "postgres://u:p@localhost/db",
      SUPABASE_URL,
      SUPABASE_ANON_KEY: validSupabaseEnv.SUPABASE_ANON_KEY,
    }), /SUPABASE_URL/);
  }
  for (const SUPABASE_ANON_KEY of [undefined, "", "   "]) {
    assert.throws(() => parseEnv({
      DATABASE_URL: "postgres://u:p@localhost/db",
      SUPABASE_URL: validSupabaseEnv.SUPABASE_URL,
      SUPABASE_ANON_KEY,
    }), /SUPABASE_ANON_KEY/);
  }
});
