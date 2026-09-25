import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../src/generated/prisma/client.ts";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://ekim_hasat:ekim_hasat_local@localhost:5432/ekim_hasat";
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl }),
});

type CompletionInput = {
  identity: { provider: string; subject: string };
  name: string;
  location: { type: "Point"; coordinates: [number, number] };
  idempotencyKey: string;
  payloadFingerprint: string;
};
type CompletionRepository = {
  persistFirstFieldOnboardingCompletion?: (input: CompletionInput) => Promise<unknown>;
};
type RepositoryModule = {
  OnboardingRepository: new (client: PrismaClient) => CompletionRepository;
};

const repositoryModule = (await import("../../src/onboarding/onboarding.repository.ts")) as RepositoryModule;
const runId = randomUUID().replaceAll("-", "");
const provider = "test-supabase";
const subjects: string[] = [];
const businessIds: string[] = [];

function input(label: string): CompletionInput {
  const subject = `t026-${runId}-${label}`;
  subjects.push(subject);
  return {
    identity: { provider, subject },
    name: `T026 ${label}`,
    location: { type: "Point", coordinates: [29, 41] },
    idempotencyKey: `t026-${runId}-${label}`,
    payloadFingerprint: `fingerprint-${runId}-${label}`,
  };
}

function repository() {
  return new repositoryModule.OnboardingRepository(prisma);
}

function completionOperation(): (command: CompletionInput) => Promise<unknown> {
  const instance = repository();
  const operation = instance.persistFirstFieldOnboardingCompletion;
  assert.equal(
    typeof operation,
    "function",
    "EXPECTED TEST-FIRST RED (T029 absent): persistFirstFieldOnboardingCompletion must enforce Membership-scoped completion",
  );
  return operation.bind(instance);
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
      const users = await prisma.applicationUser.findMany({
        where: { authProvider: provider, authSubject: { in: subjects } },
        select: { id: true, defaultBusinessId: true },
      });
      const userIds = users.map(({ id }) => id);
      const completions = await prisma.onboardingCompletion.findMany({
        where: { userId: { in: userIds } },
        select: { fieldId: true },
      });
      const fieldIds = completions.map(({ fieldId }) => fieldId);
      businessIds.push(...users.flatMap(({ defaultBusinessId }) => defaultBusinessId ? [defaultBusinessId] : []));
      await prisma.idempotencyRecord.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.onboardingCompletion.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.fieldBoundaryVersion.deleteMany({ where: { fieldId: { in: fieldIds } } });
      await prisma.field.deleteMany({ where: { id: { in: fieldIds } } });
      await prisma.applicationUser.updateMany({
        where: { id: { in: userIds } },
        data: { defaultBusinessId: null },
      });
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

test("defaultBusinessId is context only: an active Membership is required to create the first Field", async () => {
  const command = input("pointer-without-membership");
  const pointedBusiness = await createBusiness();
  const user = await prisma.applicationUser.create({
    data: {
      authProvider: provider,
      authSubject: command.identity.subject,
      defaultBusinessId: pointedBusiness.id,
    },
  });
  const beforeBusinesses = await prisma.business.count();

  await assert.rejects(
    completionOperation()(command),
    "pointer without active Membership must not authorize completion",
  );

  assert.equal(await prisma.field.count({ where: { businessId: pointedBusiness.id } }), 0);
  assert.equal(await prisma.onboardingCompletion.count({ where: { userId: user.id } }), 0);
  assert.equal(await prisma.idempotencyRecord.count({ where: { userId: user.id } }), 0);
  assert.equal(await prisma.business.count(), beforeBusinesses);
  assert.equal(await prisma.membership.count({ where: { userId: user.id } }), 0);
  assert.equal(
    (await prisma.applicationUser.findUniqueOrThrow({ where: { id: user.id } })).defaultBusinessId,
    pointedBusiness.id,
  );
});

test("forged pointer cannot fall back to another Membership and leaves all unrelated rows unchanged", async () => {
  const command = input("forged-pointer-no-fallback");
  const pointedBusiness = await createBusiness();
  const unrelatedBusiness = await createBusiness();
  const user = await prisma.applicationUser.create({
    data: {
      authProvider: provider,
      authSubject: command.identity.subject,
      defaultBusinessId: pointedBusiness.id,
    },
  });
  const unrelatedMembership = await prisma.membership.create({
    data: { userId: user.id, businessId: unrelatedBusiness.id, role: "OWNER", status: "ACTIVE" },
  });
  const pointedMembership = await prisma.membership.create({
    data: { userId: user.id, businessId: pointedBusiness.id, role: "MEMBER", status: "INACTIVE" },
  });
  const beforeMemberships = await prisma.membership.findMany({
    where: { userId: user.id },
    orderBy: { id: "asc" },
  });
  const beforeFields = await prisma.field.count();
  const beforeCompletions = await prisma.onboardingCompletion.count();
  const beforeIdempotency = await prisma.idempotencyRecord.count();

  await assert.rejects(
    completionOperation()(command),
    "inactive pointed Membership must not fall back to another Membership",
  );

  assert.equal(await prisma.field.count(), beforeFields);
  assert.equal(await prisma.onboardingCompletion.count(), beforeCompletions);
  assert.equal(await prisma.idempotencyRecord.count(), beforeIdempotency);
  assert.deepEqual(
    await prisma.membership.findMany({ where: { userId: user.id }, orderBy: { id: "asc" } }),
    beforeMemberships,
  );
  assert.ok(beforeMemberships.some((membership) => membership.id === unrelatedMembership.id));
  assert.ok(beforeMemberships.some((membership) => membership.id === pointedMembership.id));
  assert.equal(
    (await prisma.applicationUser.findUniqueOrThrow({ where: { id: user.id } })).defaultBusinessId,
    pointedBusiness.id,
  );
  assert.equal(await prisma.field.count({ where: { businessId: unrelatedBusiness.id } }), 0);
});

test("an absent default pointer creates a separate context without adopting or mutating unrelated Memberships", async () => {
  const command = input("missing-pointer-no-adoption");
  const unrelatedBusiness = await createBusiness();
  const user = await prisma.applicationUser.create({
    data: { authProvider: provider, authSubject: command.identity.subject },
  });
  const unrelatedMembership = await prisma.membership.create({
    data: { userId: user.id, businessId: unrelatedBusiness.id, role: "OWNER", status: "ACTIVE" },
  });
  assert.equal(
    (await prisma.applicationUser.findUniqueOrThrow({ where: { id: user.id } })).defaultBusinessId,
    null,
  );

  await completionOperation()(command);
  const refreshedUser = await prisma.applicationUser.findUniqueOrThrow({
    where: { id: user.id },
    include: { memberships: true },
  });

  assert.ok(refreshedUser.defaultBusinessId);
  assert.notEqual(refreshedUser.defaultBusinessId, unrelatedBusiness.id);
  assert.equal(refreshedUser.memberships.length, 2);
  assert.deepEqual(
    refreshedUser.memberships.find((membership) => membership.id === unrelatedMembership.id),
    unrelatedMembership,
  );
  const field = await prisma.field.findFirstOrThrow({
    where: { name: command.name, businessId: refreshedUser.defaultBusinessId },
  });
  assert.equal(field.businessId, refreshedUser.defaultBusinessId);
  assert.notEqual(field.businessId, unrelatedBusiness.id);
});
