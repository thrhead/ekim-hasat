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

type PointLocation = { type: "Point"; coordinates: [number, number] };
type CompletionInput = {
  identity: { provider: string; subject: string };
  name: string;
  location: PointLocation;
  idempotencyKey: string;
  payloadFingerprint: string;
};
type FirstFieldSummary = {
  id: string;
  name: string;
  representativePoint: PointLocation;
  createdAt: string | Date;
};
type CompletionOutcome = {
  kind: "created" | "replayed" | "already_completed" | "conflict";
  field: FirstFieldSummary;
};
type CompletionRepository = {
  persistFirstFieldOnboardingCompletion(input: CompletionInput): Promise<CompletionOutcome>;
};
type RepositoryModule = {
  OnboardingRepository: new (client: PrismaClient) => CompletionRepository;
};

const repositoryModule = (await import("../../src/onboarding/onboarding.repository.ts")) as RepositoryModule;
const runId = randomUUID().replaceAll("-", "");
const provider = "test-supabase";
const subjects: string[] = [];

function createInput(label: string, overrides: Partial<CompletionInput> = {}): CompletionInput {
  const subject = `t025-${runId}-${label}`;
  subjects.push(subject);
  return {
    identity: { provider, subject },
    name: `Tarla ${label}`,
    location: { type: "Point", coordinates: [29.0, 41.0] },
    idempotencyKey: `t025-${runId}-${label}`,
    payloadFingerprint: `fingerprint-${runId}-${label}`,
    ...overrides,
  };
}

function repository() {
  return new repositoryModule.OnboardingRepository(prisma);
}

async function userFor(input: CompletionInput) {
  return prisma.applicationUser.findUniqueOrThrow({
    where: {
      authProvider_authSubject: {
        authProvider: input.identity.provider,
        authSubject: input.identity.subject,
      },
    },
  });
}

async function assertSingleCompletion(input: CompletionInput, expectedFieldId: string) {
  const user = await userFor(input);
  assert.ok(user.defaultBusinessId);
  const [memberships, fields, completions] = await Promise.all([
    prisma.membership.findMany({ where: { userId: user.id } }),
    prisma.field.findMany({ where: { businessId: user.defaultBusinessId } }),
    prisma.onboardingCompletion.findMany({
      where: { userId: user.id, defaultBusinessId: user.defaultBusinessId },
    }),
  ]);
  assert.equal(memberships.length, 1, "concurrent first completion creates one Membership");
  assert.equal(memberships[0]?.businessId, user.defaultBusinessId);
  assert.equal(memberships[0]?.role, "OWNER");
  assert.equal(memberships[0]?.status, "ACTIVE");
  assert.equal(fields.length, 1, "concurrent first completion creates one Field");
  assert.equal(fields[0]?.id, expectedFieldId);
  assert.equal(completions.length, 1, "one durable completion exists per user/default business");
  assert.equal(completions[0]?.fieldId, expectedFieldId);
}

before(async () => {
  await prisma.$connect();
});

after(async () => {
  try {
    if (subjects.length > 0) {
      const users = await prisma.applicationUser.findMany({
        where: { authProvider: provider, authSubject: { in: subjects } },
        select: { id: true },
      });
      const userIds = users.map(({ id }) => id);
      if (userIds.length > 0) {
        const completions = await prisma.onboardingCompletion.findMany({
          where: { userId: { in: userIds } },
          select: { fieldId: true },
        });
        const fieldIds = completions.map(({ fieldId }) => fieldId);
        const businesses = await prisma.business.findMany({
          where: { defaultUsers: { some: { id: { in: userIds } } } },
          select: { id: true },
        });
        const businessIds = businesses.map(({ id }) => id);
        await prisma.idempotencyRecord.deleteMany({ where: { userId: { in: userIds } } });
        await prisma.onboardingCompletion.deleteMany({ where: { userId: { in: userIds } } });
        if (fieldIds.length > 0) {
          await prisma.fieldBoundaryVersion.deleteMany({ where: { fieldId: { in: fieldIds } } });
          await prisma.field.deleteMany({ where: { id: { in: fieldIds } } });
        }
        await prisma.applicationUser.updateMany({
          where: { id: { in: userIds } },
          data: { defaultBusinessId: null },
        });
        await prisma.applicationUser.deleteMany({ where: { id: { in: userIds } } });
        if (businessIds.length > 0) {
          await prisma.business.deleteMany({ where: { id: { in: businessIds } } });
        }
      }
    }
  } finally {
    await prisma.$disconnect();
  }
});

test("concurrent first-field completions converge on one business, membership, Field, and durable completion", async () => {
  const input = createInput("concurrent");
  const concurrentInputs = [
    input,
    { ...input, idempotencyKey: `${input.idempotencyKey}-parallel-2` },
  ];

  const results = await Promise.all(
    concurrentInputs.map((candidate) => repository().persistFirstFieldOnboardingCompletion(candidate)),
  );

  assert.equal(results[0]?.field.id, results[1]?.field.id);
  assert.deepEqual(new Set(results.map((result) => result.kind)), new Set(["created", "already_completed"]));
  await assertSingleCompletion(input, results[0]!.field.id);
});

test("retry after a lost response replays the original result for the retained same key and payload", async () => {
  const input = createInput("lost-response");
  const first = await repository().persistFirstFieldOnboardingCompletion(input);
  // Model a committed response lost in transit: the caller submits the identical command again.
  const retry = await repository().persistFirstFieldOnboardingCompletion(input);

  assert.equal(first.kind, "created");
  assert.equal(retry.kind, "replayed");
  assert.deepEqual(retry.field, first.field);
  await assertSingleCompletion(input, first.field.id);
  const user = await userFor(input);
  assert.equal(await prisma.idempotencyRecord.count({ where: { userId: user.id } }), 1);
});

test("a retained idempotency key reused with a different payload conflicts without mutation", async () => {
  const input = createInput("retained-key-conflict");
  const first = await repository().persistFirstFieldOnboardingCompletion(input);
  const user = await userFor(input);
  const before = {
    fields: await prisma.field.count({ where: { businessId: user.defaultBusinessId! } }),
    completions: await prisma.onboardingCompletion.count({ where: { userId: user.id } }),
    idempotencyRecords: await prisma.idempotencyRecord.count({ where: { userId: user.id } }),
  };

  const conflict = await repository().persistFirstFieldOnboardingCompletion({
    ...input,
    name: `${input.name} changed`,
    payloadFingerprint: `${input.payloadFingerprint}-different`,
  });

  assert.equal(first.kind, "created");
  assert.equal(conflict.kind, "conflict", "upper layer maps a retained-key payload mismatch to HTTP 409");
  assert.deepEqual(
    {
      fields: await prisma.field.count({ where: { businessId: user.defaultBusinessId! } }),
      completions: await prisma.onboardingCompletion.count({ where: { userId: user.id } }),
      idempotencyRecords: await prisma.idempotencyRecord.count({ where: { userId: user.id } }),
    },
    before,
  );
});

test("after the retained key expires, the durable completion returns the existing summary without mutation", async () => {
  const input = createInput("expired-key");
  const first = await repository().persistFirstFieldOnboardingCompletion(input);
  const user = await userFor(input);
  const expiredAt = new Date(Date.now() - 60_000);
  await prisma.idempotencyRecord.update({
    where: { userId_key: { userId: user.id, key: input.idempotencyKey } },
    data: { expiresAt: expiredAt },
  });

  const before = {
    fields: await prisma.field.count({ where: { businessId: user.defaultBusinessId! } }),
    boundaries: await prisma.fieldBoundaryVersion.count({ where: { field: { businessId: user.defaultBusinessId! } } }),
    completions: await prisma.onboardingCompletion.count({ where: { userId: user.id } }),
    idempotencyRecords: await prisma.idempotencyRecord.count({ where: { userId: user.id } }),
  };
  const retry = await repository().persistFirstFieldOnboardingCompletion(input);

  assert.equal(first.kind, "created");
  assert.equal(retry.kind, "already_completed", "the completion command maps this outcome to HTTP 200");
  assert.deepEqual(retry.field, first.field);
  assert.deepEqual(
    {
      fields: await prisma.field.count({ where: { businessId: user.defaultBusinessId! } }),
      boundaries: await prisma.fieldBoundaryVersion.count({ where: { field: { businessId: user.defaultBusinessId! } } }),
      completions: await prisma.onboardingCompletion.count({ where: { userId: user.id } }),
      idempotencyRecords: await prisma.idempotencyRecord.count({ where: { userId: user.id } }),
    },
    before,
  );
});
