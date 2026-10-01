import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../src/generated/prisma/client.ts";
import {
  BusinessScopeForbiddenError,
  MembershipScopeService,
} from "../../src/authorization/membership-scope.service.ts";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://ekim_hasat:ekim_hasat_local@localhost:5432/ekim_hasat";
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const scopeService = new MembershipScopeService(prisma);
const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const provider = "t012-test-provider";
const subjects: string[] = [];
const businessIds: string[] = [];

function newSubject(label: string) {
  const subject = `t012-${runId}-${label}`;
  subjects.push(subject);
  return { provider, subject };
}

async function createBusiness() {
  const business = await prisma.business.create({ data: {} });
  businessIds.push(business.id);
  return business;
}

before(async () => {
  await prisma.$connect();
});

after(async () => {
  try {
    if (subjects.length > 0) {
      await prisma.applicationUser.deleteMany({
        where: { authProvider: provider, authSubject: { in: subjects } },
      });
    }
    if (businessIds.length > 0) {
      await prisma.business.deleteMany({ where: { id: { in: businessIds } } });
    }
  } finally {
    await prisma.$disconnect();
  }
});

test("an ACTIVE Membership authorizes only the saved default Business", async () => {
  const identity = newSubject("active");
  const business = await createBusiness();
  const user = await prisma.applicationUser.create({
    data: { authProvider: provider, authSubject: identity.subject, defaultBusinessId: business.id },
  });
  const membership = await prisma.membership.create({
    data: { businessId: business.id, userId: user.id, role: "MEMBER", status: "ACTIVE" },
  });

  const scope = await scopeService.resolveDefaultBusinessScope({
    ...identity,
    businessId: "client-forged-business",
    role: "OWNER",
    app_metadata: { role: "OWNER", businessId: "metadata-business" },
  });

  assert.deepEqual(scope, {
    userId: user.id,
    businessId: business.id,
    membershipId: membership.id,
    role: "MEMBER",
  });
});

test("missing Membership denies without adopting an unrelated active OWNER Membership", async () => {
  const identity = newSubject("missing-membership");
  const pointedBusiness = await createBusiness();
  const unrelatedBusiness = await createBusiness();
  const user = await prisma.applicationUser.create({
    data: {
      authProvider: provider,
      authSubject: identity.subject,
      defaultBusinessId: pointedBusiness.id,
    },
  });
  const unrelatedMembership = await prisma.membership.create({
    data: {
      businessId: unrelatedBusiness.id,
      userId: user.id,
      role: "OWNER",
      status: "ACTIVE",
    },
  });

  await assert.rejects(scopeService.resolveDefaultBusinessScope(identity), (error: unknown) => {
    assert.ok(error instanceof BusinessScopeForbiddenError);
    assert.equal(error.message, "Business context is unavailable or not authorized");
    return true;
  });

  assert.deepEqual(await prisma.membership.findMany({ where: { userId: user.id } }), [
    unrelatedMembership,
  ]);
});

test("inactive or revoked Membership denies without fallback to another Membership", async () => {
  const identity = newSubject("inactive-membership");
  const pointedBusiness = await createBusiness();
  const unrelatedBusiness = await createBusiness();
  const user = await prisma.applicationUser.create({
    data: {
      authProvider: provider,
      authSubject: identity.subject,
      defaultBusinessId: pointedBusiness.id,
    },
  });
  const inactiveMembership = await prisma.membership.create({
    data: {
      businessId: pointedBusiness.id,
      userId: user.id,
      role: "OWNER",
      status: "REVOKED",
    },
  });
  const otherActiveMembership = await prisma.membership.create({
    data: {
      businessId: unrelatedBusiness.id,
      userId: user.id,
      role: "OWNER",
      status: "ACTIVE",
    },
  });

  await assert.rejects(scopeService.resolveDefaultBusinessScope(identity), (error: unknown) => {
    assert.ok(error instanceof BusinessScopeForbiddenError);
    assert.equal(error.message, "Business context is unavailable or not authorized");
    return true;
  });
  assert.deepEqual(
    await prisma.membership.findMany({ where: { userId: user.id }, orderBy: { businessId: "asc" } }),
    [inactiveMembership, otherActiveMembership].sort((a, b) =>
      a.businessId.localeCompare(b.businessId),
    ),
  );
});

test("no default pointer returns no authorized scope and does not select another Membership", async () => {
  const identity = newSubject("missing-pointer");
  const unrelatedBusiness = await createBusiness();
  const user = await prisma.applicationUser.create({
    data: { authProvider: provider, authSubject: identity.subject },
  });
  await prisma.membership.create({
    data: {
      businessId: unrelatedBusiness.id,
      userId: user.id,
      role: "OWNER",
      status: "ACTIVE",
    },
  });

  assert.equal(await scopeService.resolveDefaultBusinessScope(identity), null);
});
