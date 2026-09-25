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
type PolygonLocation = { type: "Polygon"; coordinates: [number, number][][] };
type CompletionInput = {
  identity: { provider: string; subject: string };
  name: string;
  location: PointLocation | PolygonLocation;
  idempotencyKey: string;
  payloadFingerprint: string;
};
type FirstFieldSummary = {
  id: string;
  name: string;
  representativePoint: PointLocation;
  createdAt: string | Date;
  boundary?: {
    id: string;
    version: number;
    geometry: PolygonLocation;
    verificationStatus: string;
  };
};
type CompletionOutcome = {
  kind: "created" | "replayed" | "already_completed";
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
const businessIds: string[] = [];
const failureTrigger = `t024_fail_${runId}`;
const failureFunction = `t024_raise_${runId}`;

function identity(label: string) {
  const subject = `t024-${runId}-${label}`;
  subjects.push(subject);
  return { provider, subject };
}

function createInput(
  label: string,
  location: PointLocation | PolygonLocation = {
    type: "Point",
    coordinates: [29.0, 41.0],
  },
): CompletionInput {
  return {
    identity: identity(label),
    name: `Tarla ${label}`,
    location,
    idempotencyKey: `t024-${runId}-${label}`,
    payloadFingerprint: `fingerprint-${runId}-${label}`,
  };
}

function repository() {
  return new repositoryModule.OnboardingRepository(prisma);
}

async function createBusiness() {
  const business = await prisma.business.create({ data: {} });
  businessIds.push(business.id);
  return business;
}

async function assertNoCompletionState(input: CompletionInput) {
  const user = await prisma.applicationUser.findUnique({
    where: {
      authProvider_authSubject: {
        authProvider: input.identity.provider,
        authSubject: input.identity.subject,
      },
    },
    include: { memberships: true },
  });
  const [fields, boundaries, completions, idempotencyRecords] = await Promise.all([
    prisma.field.count({ where: { name: input.name } }),
    prisma.fieldBoundaryVersion.count({ where: { field: { name: input.name } } }),
    prisma.onboardingCompletion.count({ where: { field: { name: input.name } } }),
    prisma.idempotencyRecord.count({ where: { key: input.idempotencyKey } }),
  ]);
  assert.equal(fields, 0, "failed operation must leave no first Field");
  assert.equal(boundaries, 0, "failed operation must leave no boundary");
  assert.equal(completions, 0, "failed operation must leave no durable completion");
  assert.equal(idempotencyRecords, 0, "failed operation must leave no idempotency result");
  assert.equal(user, null, "failed bootstrap must not retain its application User");
}

before(async () => {
  await prisma.$connect();
});

after(async () => {
  try {
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${failureTrigger}" ON "fields"`);
    await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${failureFunction}"()`);
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

test("completion atomically persists a new authorized default context, Field, boundary, completion, and idempotency result", async () => {
  const polygon: PolygonLocation = {
    type: "Polygon",
    coordinates: [[
      [29.0, 41.0],
      [29.02, 41.0],
      [29.02, 41.02],
      [29.0, 41.02],
      [29.0, 41.0],
    ]],
  };
  const input = createInput("success", polygon);
  const result = await repository().persistFirstFieldOnboardingCompletion(input);

  assert.equal(result.kind, "created");
  assert.equal(result.field.name, input.name);
  assert.ok(result.field.id);
  assert.ok(new Date(result.field.createdAt).getTime() > 0);
  assert.equal(result.field.representativePoint.type, "Point");
  assert.ok(result.field.representativePoint.coordinates.every(Number.isFinite));
  assert.ok(result.field.boundary?.id);
  assert.equal(result.field.boundary?.verificationStatus.toLowerCase(), "unverified");
  assert.equal(result.field.boundary?.version, 1);

  const user = await prisma.applicationUser.findUniqueOrThrow({
    where: {
      authProvider_authSubject: {
        authProvider: input.identity.provider,
        authSubject: input.identity.subject,
      },
    },
    include: { memberships: true },
  });
  assert.ok(user.defaultBusinessId);
  assert.equal(user.memberships.length, 1);
  assert.equal(user.memberships[0]?.businessId, user.defaultBusinessId);
  assert.equal(user.memberships[0]?.role, "OWNER");
  assert.equal(user.memberships[0]?.status, "ACTIVE");
  businessIds.push(user.defaultBusinessId);

  const field = await prisma.field.findUniqueOrThrow({
    where: { id: result.field.id },
    include: { boundaryVersions: true },
  });
  assert.equal(field.businessId, user.defaultBusinessId);
  assert.equal(field.name, input.name);
  assert.equal(field.boundaryVersions.length, 1);

  const spatialRows = await prisma.$queryRaw<Array<{
    point_srid: number;
    point_inside_polygon: boolean;
    boundary_srid: number;
    boundary_valid: boolean;
  }>>`
    SELECT
      ST_SRID(f.representative_point) AS point_srid,
      ST_Contains(ST_GeomFromGeoJSON(${JSON.stringify(polygon)}), f.representative_point) AS point_inside_polygon,
      ST_SRID(b.geometry) AS boundary_srid,
      ST_IsValid(b.geometry) AS boundary_valid
    FROM "fields" f
    JOIN "field_boundary_versions" b ON b.field_id = f.id
    WHERE f.id = ${result.field.id}::uuid
  `;
  assert.equal(spatialRows[0]?.point_srid, 4326);
  assert.equal(spatialRows[0]?.point_inside_polygon, true);
  assert.equal(spatialRows[0]?.boundary_srid, 4326);
  assert.equal(spatialRows[0]?.boundary_valid, true);

  const completion = await prisma.onboardingCompletion.findUniqueOrThrow({
    where: {
      userId_defaultBusinessId: {
        userId: user.id,
        defaultBusinessId: user.defaultBusinessId,
      },
    },
  });
  assert.equal(completion.fieldId, result.field.id);
  const idempotency = await prisma.idempotencyRecord.findUniqueOrThrow({
    where: { userId_key: { userId: user.id, key: input.idempotencyKey } },
  });
  assert.equal(idempotency.fieldId, result.field.id);
  assert.equal(idempotency.payloadFingerprint, input.payloadFingerprint);
});

test("completion uses an existing default pointer only when an active Membership authorizes it", async () => {
  const input = createInput("active-pointer");
  const business = await createBusiness();
  const user = await prisma.applicationUser.create({
    data: {
      authProvider: input.identity.provider,
      authSubject: input.identity.subject,
      defaultBusinessId: business.id,
    },
  });
  await prisma.membership.create({
    data: { userId: user.id, businessId: business.id, role: "MEMBER", status: "ACTIVE" },
  });

  const result = await repository().persistFirstFieldOnboardingCompletion(input);
  assert.equal(result.kind, "created");
  assert.equal(result.field.name, input.name);
  assert.equal(await prisma.field.count({ where: { businessId: business.id } }), 1);
  assert.equal(await prisma.onboardingCompletion.count({ where: { userId: user.id } }), 1);
  assert.equal(await prisma.idempotencyRecord.count({ where: { userId: user.id } }), 1);
});

test("completion creates a new default context and leaves an unrelated Membership unchanged", async () => {
  const input = createInput("unrelated-membership");
  const unrelatedBusiness = await createBusiness();
  const user = await prisma.applicationUser.create({
    data: {
      authProvider: input.identity.provider,
      authSubject: input.identity.subject,
    },
  });
  const unrelatedMembership = await prisma.membership.create({
    data: {
      userId: user.id,
      businessId: unrelatedBusiness.id,
      role: "MEMBER",
      status: "ACTIVE",
    },
  });

  const result = await repository().persistFirstFieldOnboardingCompletion(input);
  const refreshedUser = await prisma.applicationUser.findUniqueOrThrow({
    where: { id: user.id },
    include: { memberships: true },
  });

  assert.equal(result.kind, "created");
  assert.ok(refreshedUser.defaultBusinessId);
  assert.notEqual(refreshedUser.defaultBusinessId, unrelatedBusiness.id);
  assert.equal(refreshedUser.memberships.length, 2);
  assert.deepEqual(
    refreshedUser.memberships.find((membership) => membership.id === unrelatedMembership.id),
    unrelatedMembership,
  );
  assert.equal(
    refreshedUser.memberships.filter(
      (membership) => membership.businessId === refreshedUser.defaultBusinessId
        && membership.role === "OWNER"
        && membership.status === "ACTIVE",
    ).length,
    1,
  );
  assert.equal(await prisma.field.count({ where: { businessId: refreshedUser.defaultBusinessId } }), 1);
});

test("unauthorized default pointer fails without adopting another Membership or persisting completion state", async () => {
  const input = createInput("unauthorized-pointer");
  const pointedBusiness = await createBusiness();
  const unrelatedBusiness = await createBusiness();
  const user = await prisma.applicationUser.create({
    data: {
      authProvider: input.identity.provider,
      authSubject: input.identity.subject,
      defaultBusinessId: pointedBusiness.id,
    },
  });
  await prisma.membership.create({
    data: { userId: user.id, businessId: unrelatedBusiness.id, role: "OWNER", status: "ACTIVE" },
  });

  await assert.rejects(repository().persistFirstFieldOnboardingCompletion(input));
  assert.equal(await prisma.field.count({ where: { businessId: pointedBusiness.id } }), 0);
  assert.equal(await prisma.field.count({ where: { businessId: unrelatedBusiness.id } }), 0);
  assert.equal(await prisma.onboardingCompletion.count({ where: { userId: user.id } }), 0);
  assert.equal(await prisma.idempotencyRecord.count({ where: { userId: user.id } }), 0);
  const unchangedUser = await prisma.applicationUser.findUniqueOrThrow({
    where: { id: user.id },
    include: { memberships: true },
  });
  assert.equal(unchangedUser.defaultBusinessId, pointedBusiness.id);
  assert.equal(unchangedUser.memberships.length, 1);
  assert.equal(unchangedUser.memberships[0]?.businessId, unrelatedBusiness.id);
});

test("a database-side failure after Field insertion rolls back every completion write", async () => {
  const input = createInput("rollback");
  input.name = `t024-fail-${runId}`;

  await prisma.$executeRawUnsafe(`
    CREATE FUNCTION "${failureFunction}"() RETURNS trigger AS $$
    BEGIN
      IF NEW.name = '${input.name}' THEN
        RAISE EXCEPTION 'T024 deterministic rollback fixture' USING ERRCODE = 'P0001';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER "${failureTrigger}"
    AFTER INSERT ON "fields"
    FOR EACH ROW EXECUTE FUNCTION "${failureFunction}"()
  `);

  try {
    await assert.rejects(
      repository().persistFirstFieldOnboardingCompletion(input),
      /T024 deterministic rollback fixture/,
    );
  } finally {
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${failureTrigger}" ON "fields"`);
    await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${failureFunction}"()`);
  }

  await assertNoCompletionState(input);
});
