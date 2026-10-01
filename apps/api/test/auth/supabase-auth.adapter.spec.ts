import assert from "node:assert/strict";
import test from "node:test";
import {
  AuthenticationFailure,
  SupabaseAuthAdapter,
} from "../../src/auth/supabase-auth.adapter.js";

function adapterWith(result: unknown, failure?: Error) {
  return new SupabaseAuthAdapter(
    { url: "https://project.supabase.co", anonKey: "test-anon-key" },
    {
      async getUser() {
        if (failure) throw failure;
        return result as never;
      },
    } as never,
  );
}

test("maps a verified Supabase user to only provider and subject", async () => {
  const adapter = adapterWith({
    data: {
      user: {
        id: "auth-user-1",
        app_metadata: { role: "OWNER", businessId: "business-secret" },
        user_metadata: { role: "ADMIN", tenant: "other" },
      },
      session: { access_token: "secret-access-token", refresh_token: "secret-refresh-token" },
    },
    error: null,
  });

  const identity = await adapter.verify("valid-access-token");
  assert.deepEqual(identity, { provider: "supabase", subject: "auth-user-1" });
  assert.deepEqual(Object.keys(identity).sort(), ["provider", "subject"]);
  assert.equal("role" in identity, false);
  assert.equal("businessId" in identity, false);
  assert.equal("session" in identity, false);
});

test("maps invalid, expired, and malformed credentials to authentication failure", async () => {
  const invalidToken = adapterWith({ data: { user: null }, error: { message: "expired" } });
  await assert.rejects(invalidToken.verify("expired-token"), AuthenticationFailure);

  const malformedCredential = adapterWith({ data: { user: null }, error: { message: "invalid" } });
  await assert.rejects(malformedCredential.verify(" "), AuthenticationFailure);
});

test("rejects a provider response without a usable subject", async () => {
  const missingSubject = adapterWith({ data: { user: { id: "  " } }, error: null });
  await assert.rejects(missingSubject.verify("valid-token"), AuthenticationFailure);
});

test("normalizes provider verification failures without leaking provider errors", async () => {
  const providerError = new Error("provider details containing sensitive payload");
  const adapter = adapterWith(undefined, providerError);

  await assert.rejects(adapter.verify("secret-token"), (error: unknown) => {
    assert.ok(error instanceof AuthenticationFailure);
    assert.equal(error.message, "Authentication failed");
    assert.equal(error.cause, undefined);
    return true;
  });
});
