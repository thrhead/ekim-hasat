import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../src/generated/prisma/client.ts";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://ekim_hasat:ekim_hasat_local@localhost:5432/ekim_hasat";
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl }),
});

type Context = { userId: string; businessId: string; membershipId: string };
type RepositoryModule = {
  OnboardingRepository: new (client: PrismaClient) => {
    withAuthorizedDefaultContext<T>(
      identity: { provider: string; subject: string },
      operation: (tx: unknown, context: Context) => Promise<T> | T,
    ): Promise<T>;
  };
};

let repositoryModule: RepositoryModule | undefined;
let repositoryLoadFailure: unknown;
try {
  repositoryModule = (await import("../../src/onboarding/onboarding.repository.ts")) as RepositoryModule;
} catch (error) {
  repositoryLoadFailure = error;
}

const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const subjects: string[] = [];
const businessIds: string[] = [];
const provider = "test-supabase";

function identity(label: string) {
  const subject = `t009-${runId}-${label}`;
  subjects.push(subject);
  return { provider, subject };
}

function getRepository() {
  assert.ok(
    repositoryModule,
    `T009 repository module is not available: ${String(repositoryLoadFailure)}`,
  );
  return new repositoryModule.OnboardingRepository(prisma);
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

test("concurrent bootstrap attempts converge on one user, default business, and OWNER membership", async () => {
  const subject = identity("concurrent");
  const repository = getRepository();

  const contexts = await Promise.all(
    Array.from({ length: 6 }, () =>
      repository.withAuthorizedDefaultContext(subject, async (_tx, context) => {
        businessIds.push(context.businessId);
        return context;
      }),
    ),
  );

  assert.equal(new Set(contexts.map((context) => context.userId)).size, 1);
  assert.equal(new Set(contexts.map((context) => context.businessId)).size, 1);
  assert.equal(new Set(contexts.map((context) => context.membershipId)).size, 1);

  const user = await prisma.applicationUser.findUniqueOrThrow({
    where: { authProvider_authSubject: { authProvider: provider, authSubject: subject.subject } },
    include: { memberships: true },
  });
  assert.equal(user.defaultBusinessId, contexts[0]?.businessId);
  assert.equal(user.memberships.length, 1);
  assert.equal(user.memberships[0]?.businessId, user.defaultBusinessId);
  assert.equal(user.memberships[0]?.role, "OWNER");
  assert.equal(user.memberships[0]?.status, "ACTIVE");
});

test("an existing pointer is accepted only through its active Membership", async () => {
  const subject = identity("active-pointer");
  const business = await createBusiness();
  const user = await prisma.applicationUser.create({
    data: { authProvider: provider, authSubject: subject.subject, defaultBusinessId: business.id },
  });
  const membership = await prisma.membership.create({
    data: { userId: user.id, businessId: business.id, role: "MEMBER", status: "ACTIVE" },
  });
  const businessCountBefore = await prisma.business.count();

  const context = await getRepository().withAuthorizedDefaultContext(
    subject,
    async (_tx, resolved) => resolved,
  );

  assert.equal(context.userId, user.id);
  assert.equal(context.businessId, business.id);
  assert.equal(context.membershipId, membership.id);
  assert.equal(await prisma.business.count(), businessCountBefore);
  assert.equal(await prisma.membership.count({ where: { userId: user.id } }), 1);
});

test("an existing pointer without active membership fails without fallback to another membership", async () => {
  const subject = identity("unauthorized-pointer");
  const businessCountBefore = await prisma.business.count();
  const pointedBusiness = await createBusiness();
  const unrelatedBusiness = await createBusiness();
  const user = await prisma.applicationUser.create({
    data: { authProvider: provider, authSubject: subject.subject, defaultBusinessId: pointedBusiness.id },
  });
  const unrelatedMembership = await prisma.membership.create({
    data: {
      userId: user.id,
      businessId: unrelatedBusiness.id,
      role: "OWNER",
      status: "ACTIVE",
    },
  });
  const inactivePointerMembership = await prisma.membership.create({
    data: {
      userId: user.id,
      businessId: pointedBusiness.id,
      role: "OWNER",
      status: "INACTIVE",
    },
  });
  const beforeMemberships = [unrelatedMembership, inactivePointerMembership].sort((a, b) =>
    a.id.localeCompare(b.id),
  );

  await assert.rejects(
    getRepository().withAuthorizedDefaultContext(subject, async (_tx, context) => context),
  );

  const unchangedUser = await prisma.applicationUser.findUniqueOrThrow({ where: { id: user.id } });
  const memberships = await prisma.membership.findMany({
    where: { userId: user.id },
    orderBy: { id: "asc" },
  });
  assert.equal(unchangedUser.defaultBusinessId, pointedBusiness.id);
  assert.deepEqual(memberships, beforeMemberships);
  assert.equal(await prisma.business.count(), businessCountBefore + 2);
});

test("a missing pointer creates a new default context and leaves unrelated memberships unchanged", async () => {
  const subject = identity("unrelated-membership");
  const oldBusiness = await createBusiness();
  const user = await prisma.applicationUser.create({
    data: { authProvider: provider, authSubject: subject.subject },
  });
  const oldMembership = await prisma.membership.create({
    data: { userId: user.id, businessId: oldBusiness.id, role: "MEMBER", status: "ACTIVE" },
  });

  const context = await getRepository().withAuthorizedDefaultContext(
    subject,
    async (_tx, resolved) => {
      businessIds.push(resolved.businessId);
      return resolved;
    },
  );

  assert.notEqual(context.businessId, oldBusiness.id);
  const refreshedUser = await prisma.applicationUser.findUniqueOrThrow({
    where: { id: user.id },
    include: { memberships: true },
  });
  assert.equal(refreshedUser.defaultBusinessId, context.businessId);
  assert.equal(refreshedUser.memberships.length, 2);
  assert.deepEqual(
    refreshedUser.memberships.find((membership) => membership.id === oldMembership.id),
    oldMembership,
  );
  assert.equal(
    refreshedUser.memberships.filter(
      (membership) => membership.businessId === context.businessId && membership.role === "OWNER",
    ).length,
    1,
  );
});

test("a failure inside the transaction callback rolls back bootstrap user, business, membership, and pointer", async () => {
  const subject = identity("rollback");
  let attemptedContext: Context | undefined;

  await assert.rejects(
    getRepository().withAuthorizedDefaultContext(subject, async (_tx, context) => {
      attemptedContext = context;
      businessIds.push(context.businessId);
      throw new Error("simulated downstream completion failure");
    }),
    /simulated downstream completion failure/,
  );

  assert.equal(
    await prisma.applicationUser.count({
      where: { authProvider: provider, authSubject: subject.subject },
    }),
    0,
  );
  if (attemptedContext) {
    assert.equal(await prisma.business.count({ where: { id: attemptedContext.businessId } }), 0);
    assert.equal(await prisma.membership.count({ where: { id: attemptedContext.membershipId } }), 0);
  }
});
