import assert from "node:assert/strict";
import test from "node:test";
import {
  createVerifiedSubject,
  type Authenticator,
  type VerifiedSubject,
} from "./auth-provider.ts";

test("verified subject authentication boundary", async (t) => {
  await t.test("accepts and freezes only the minimum provider subject identity", () => {
    const subject = createVerifiedSubject({
      provider: "supabase",
      subject: "auth-user-123",
      businessId: "untrusted-business",
      role: "OWNER",
    });

    assert.deepEqual(subject, { provider: "supabase", subject: "auth-user-123" });
    assert.equal(Object.isFrozen(subject), true);
    assert.equal(subject && "businessId" in subject, false);
    assert.equal(subject && "role" in subject, false);
  });

  await t.test("rejects missing or invalid verified subject values", () => {
    const invalidInputs: unknown[] = [
      undefined,
      null,
      {},
      { provider: "supabase" },
      { subject: "user" },
      { provider: "  ", subject: "user" },
      { provider: "supabase", subject: " " },
    ];
    for (const input of invalidInputs) {
      assert.equal(createVerifiedSubject(input), null);
    }
  });

  await t.test("supports an implementation-neutral verification contract", async () => {
    const authenticator: Authenticator<string> = {
      async verify(credential) {
        return credential === "valid" ? { provider: "test", subject: "user-1" } : null;
      },
    };

    assert.deepEqual(await authenticator.verify("valid"), {
      provider: "test",
      subject: "user-1",
    });
    assert.equal(await authenticator.verify("invalid"), null);
  });

  await t.test("keeps the verified identity contract free of authorization fields", () => {
    const subject: VerifiedSubject = { provider: "test", subject: "user-1" };
    // Compile-time boundary assertion: only provider and subject are required.
    assert.deepEqual(Object.keys(subject).sort(), ["provider", "subject"]);
  });
});
