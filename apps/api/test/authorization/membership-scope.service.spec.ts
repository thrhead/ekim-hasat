import assert from "node:assert/strict";
import test from "node:test";
import {
  BusinessScopeForbiddenError,
  MembershipScopeService,
} from "../../src/authorization/membership-scope.service.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

const identity = { provider: "provider-neutral", subject: "verified-subject" };

function serviceFor(result: {
  user?: { id: string; defaultBusinessId: string | null } | null;
  business?: { id: string } | null;
  membership?: { id: string; role: string; status: string } | null;
}) {
  const calls: string[] = [];
  const transaction = {
    applicationUser: {
      async findUnique() {
        calls.push("user");
        return result.user ?? null;
      },
    },
    business: {
      async findUnique() {
        calls.push("business");
        return result.business ?? null;
      },
    },
    membership: {
      async findUnique() {
        calls.push("membership");
        return result.membership ?? null;
      },
    },
  };
  const prisma = {
    async $transaction<T>(operation: (tx: typeof transaction) => Promise<T>) {
      return operation(transaction);
    },
  } as unknown as PrismaClient;

  return { service: new MembershipScopeService(prisma), calls };
}

test("resolves only the stored default context and trusted Membership role", async () => {
  const { service, calls } = serviceFor({
    user: { id: "user-1", defaultBusinessId: "business-1" },
    business: { id: "business-1" },
    membership: { id: "membership-1", role: "MEMBER", status: "ACTIVE" },
  });
  const forgedIdentity = {
    ...identity,
    businessId: "attacker-business",
    role: "OWNER",
    app_metadata: { role: "OWNER", businessId: "attacker-business" },
  };

  const scope = await service.resolveDefaultBusinessScope(forgedIdentity);

  assert.deepEqual(scope, {
    userId: "user-1",
    businessId: "business-1",
    membershipId: "membership-1",
    role: "MEMBER",
  });
  assert.deepEqual(calls, ["user", "business", "membership"]);
});

test("returns no authorized scope when no default context exists", async () => {
  const { service, calls } = serviceFor({
    user: { id: "user-1", defaultBusinessId: null },
  });

  assert.equal(await service.resolveDefaultBusinessScope(identity), null);
  assert.deepEqual(calls, ["user"]);
});

test("maps missing Business and missing or inactive Membership to one generic denial", async (t) => {
  const cases = [
    { name: "missing Business", business: null, membership: null },
    { name: "missing Membership", business: { id: "business-1" }, membership: null },
    {
      name: "inactive Membership",
      business: { id: "business-1" },
      membership: { id: "membership-1", role: "OWNER", status: "REVOKED" },
    },
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, async () => {
      const { service } = serviceFor({
        user: { id: "user-1", defaultBusinessId: "business-1" },
        business: scenario.business,
        membership: scenario.membership,
      });

      await assert.rejects(service.resolveDefaultBusinessScope(identity), (error: unknown) => {
        assert.ok(error instanceof BusinessScopeForbiddenError);
        assert.equal(error.message, "Business context is unavailable or not authorized");
        return true;
      });
    });
  }
});
