import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { PrismaPg } from "@prisma/adapter-pg";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { PrismaClient } from "../../src/generated/prisma/client.js";
import { ApiError } from "../../src/observability/api-error.filter.js";
import { assertDisposableDatabaseUrl } from "../support/disposable-database.js";

type Identity = Readonly<{ provider: string; subject: string }>;
type Request = Readonly<{
  harvestId: string;
  seasonId: string;
  harvestDate: string;
  quantity: string;
  unit: "KG" | "METRIC_TONNE";
}>;
type Harvest = Readonly<{
  id: string;
  businessId: string;
  fieldId: string;
  seasonId: string;
  actorUserId: string;
  actorMembershipId: string;
  harvestDate: string;
  quantity: string;
  unit: "KG" | "METRIC_TONNE";
  recordedAt: string;
}>;
type Outcome = Readonly<{ kind: "accepted" | "replayed"; harvest: Harvest }>;
type Repository = Readonly<{
  create(identity: Identity, fieldId: string, request: Request): Promise<Outcome>;
}>;

const databaseUrl = process.env.DATABASE_URL;
assertDisposableDatabaseUrl(databaseUrl);
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });
const run = randomUUID();
const provider = "spec013-harvest";
const business = randomUUID(), foreignBusiness = randomUUID();
const owner = randomUUID(), worker = randomUUID(), advisor = randomUUID();
const secondOwner = randomUUID(), foreignOwner = randomUUID(), noScope = randomUUID();
const ownerMembership = randomUUID(), workerMembership = randomUUID(), advisorMembership = randomUUID();
const secondOwnerMembership = randomUUID(), foreignMembership = randomUUID();
const field = randomUUID(), otherField = randomUUID(), foreignField = randomUUID();
const season = randomUUID(), alternateSeason = randomUUID(), draftSeason = randomUUID();
const otherFieldSeason = randomUUID(), foreignSeason = randomUUID(), racingSeason = randomUUID();
const crop = randomUUID(), cropKey = `spec013-${run}`;
const ownerIdentity = { provider, subject: `${run}-owner` };
const workerIdentity = { provider, subject: `${run}-worker` };
const advisorIdentity = { provider, subject: `${run}-advisor` };
const secondOwnerIdentity = { provider, subject: `${run}-second-owner` };
const foreignIdentity = { provider, subject: `${run}-foreign-owner` };
const noScopeIdentity = { provider, subject: `${run}-no-scope` };
const now = () => new Date("2026-10-16T21:30:00.000Z"); // 17 October in Europe/Istanbul.

// A dynamic import keeps this test suite runnable before T008 supplies the repository.
const repositoryPath = "../../src/harvest/harvests.repository.js";
async function repository(): Promise<Repository> {
  const module = await import(repositoryPath) as {
    HarvestsRepository: new (client: PrismaClient, clock: () => Date) => Repository;
  };
  return new module.HarvestsRepository(prisma, now);
}

function request(overrides: Partial<Request> = {}): Request {
  return {
    harvestId: randomUUID(), seasonId: season, harvestDate: "2026-10-17",
    quantity: "12.375", unit: "KG", ...overrides,
  };
}

function isApiError(status: number, code: string) {
  return (error: unknown): boolean => error instanceof ApiError
    && error.getStatus() === status && error.presentation.code === code;
}

async function rejectCreate(identity: Identity, fieldId: string, body: Request, status: number, code: string) {
  await assert.rejects((await repository()).create(identity, fieldId, body), isApiError(status, code));
}

async function countHarvest(harvestId: string, businessId = business): Promise<number> {
  const client = prisma as PrismaClient & {
    harvest: { count(args: { where: { businessId: string; id: string } }): Promise<number> };
  };
  return client.harvest.count({ where: { businessId, id: harvestId } });
}

before(async () => {
  await prisma.$connect();
  const target = await prisma.$queryRaw<Array<{ database: string; postgis: boolean }>>`
    SELECT current_database() AS database,
      EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'postgis') AS postgis`;
  assert.equal(target[0]?.database, "ekim_hasat_test");
  assert.equal(target[0]?.postgis, true);
  await prisma.business.createMany({ data: [
    { id: business, timezone: "Europe/Istanbul" },
    { id: foreignBusiness, timezone: "Europe/Istanbul" },
  ] });
  await prisma.applicationUser.createMany({ data: [
    { id: owner, authProvider: provider, authSubject: ownerIdentity.subject, defaultBusinessId: business },
    { id: worker, authProvider: provider, authSubject: workerIdentity.subject, defaultBusinessId: business },
    { id: advisor, authProvider: provider, authSubject: advisorIdentity.subject, defaultBusinessId: business },
    { id: secondOwner, authProvider: provider, authSubject: secondOwnerIdentity.subject, defaultBusinessId: business },
    { id: foreignOwner, authProvider: provider, authSubject: foreignIdentity.subject, defaultBusinessId: foreignBusiness },
    { id: noScope, authProvider: provider, authSubject: noScopeIdentity.subject },
  ] });
  await prisma.membership.createMany({ data: [
    { id: ownerMembership, businessId: business, userId: owner, role: "OWNER", status: "ACTIVE" },
    { id: workerMembership, businessId: business, userId: worker, role: "WORKER", status: "ACTIVE" },
    { id: advisorMembership, businessId: business, userId: advisor, role: "ADVISOR", status: "ACTIVE" },
    { id: secondOwnerMembership, businessId: business, userId: secondOwner, role: "OWNER", status: "ACTIVE" },
    { id: foreignMembership, businessId: foreignBusiness, userId: foreignOwner, role: "OWNER", status: "ACTIVE" },
  ] });
  await prisma.$executeRaw`INSERT INTO fields (id, business_id, name, representative_point) VALUES
    (${field}::uuid, ${business}::uuid, 'Harvest field', ST_SetSRID(ST_MakePoint(29, 41), 4326)),
    (${otherField}::uuid, ${business}::uuid, 'Other harvest field', ST_SetSRID(ST_MakePoint(30, 41), 4326)),
    (${foreignField}::uuid, ${foreignBusiness}::uuid, 'Private harvest field', ST_SetSRID(ST_MakePoint(31, 41), 4326))`;
  await prisma.cropDefinitionVersion.create({ data: { id: crop, cropKey, version: "1", displayName: "SPEC-013 crop" } });
  const plantingDate = new Date("2026-10-01T00:00:00.000Z");
  const activatedAt = new Date("2026-10-02T00:00:00.000Z");
  await prisma.season.createMany({ data: [
    { id: season, businessId: business, fieldId: field, cropKey, cropDefinitionVersionId: crop,
      actualPlantingDate: plantingDate, status: "ACTIVE", activatedAt },
    { id: alternateSeason, businessId: business, fieldId: field, cropKey, cropDefinitionVersionId: crop,
      actualPlantingDate: new Date("2026-10-02T00:00:00.000Z"), status: "ACTIVE", activatedAt },
    { id: draftSeason, businessId: business, fieldId: field, cropKey, cropDefinitionVersionId: crop,
      actualPlantingDate: new Date("2026-10-03T00:00:00.000Z"), status: "DRAFT" },
    { id: otherFieldSeason, businessId: business, fieldId: otherField, cropKey, cropDefinitionVersionId: crop,
      actualPlantingDate: plantingDate, status: "ACTIVE", activatedAt },
    { id: foreignSeason, businessId: foreignBusiness, fieldId: foreignField, cropKey, cropDefinitionVersionId: crop,
      actualPlantingDate: plantingDate, status: "ACTIVE", activatedAt },
    { id: racingSeason, businessId: business, fieldId: field, cropKey, cropDefinitionVersionId: crop,
      actualPlantingDate: new Date("2026-10-04T00:00:00.000Z"), status: "ACTIVE", activatedAt },
  ] });
});

// The database is disposable and each run uses distinct UUIDs. Accepted historical
// rows remain intact, including after T023 introduces the append-only guard.
after(async () => { await prisma.$disconnect(); });

test("OWNER and WORKER create within their current Business scope; ADVISOR and no scope cannot", async () => {
  for (const [identity, userId, membershipId] of [
    [ownerIdentity, owner, ownerMembership], [workerIdentity, worker, workerMembership],
  ] as const) {
    const submitted = request();
    const accepted = await (await repository()).create(identity, field, submitted);
    assert.equal(accepted.kind, "accepted");
    assert.deepEqual(
      [accepted.harvest.id, accepted.harvest.businessId, accepted.harvest.fieldId,
        accepted.harvest.seasonId, accepted.harvest.actorUserId, accepted.harvest.actorMembershipId],
      [submitted.harvestId, business, field, season, userId, membershipId],
    );
  }
  for (const identity of [advisorIdentity, noScopeIdentity]) {
    const submitted = request();
    await rejectCreate(identity, field, submitted, 403, "FORBIDDEN");
    assert.equal(await countHarvest(submitted.harvestId), 0);
  }
});

test("revoked or demoted membership cannot make a first acceptance", async () => {
  for (const change of [{ status: "REVOKED" }, { role: "ADVISOR" }]) {
    await prisma.membership.update({ where: { id: ownerMembership }, data: change });
    const submitted = request();
    try {
      await rejectCreate(ownerIdentity, field, submitted, 403, "FORBIDDEN");
      assert.equal(await countHarvest(submitted.harvestId), 0);
    }
    finally {
      await prisma.membership.update({ where: { id: ownerMembership }, data: { status: "ACTIVE", role: "OWNER" } });
    }
  }
});

test("requires an ACTIVE Season in the authorized Field and hides foreign or missing resources", async () => {
  for (const [identity, pathField, submitted] of [
    [ownerIdentity, field, request({ seasonId: draftSeason })],
    [ownerIdentity, field, request({ seasonId: otherFieldSeason })],
    [ownerIdentity, field, request({ seasonId: foreignSeason })],
    [ownerIdentity, field, request({ seasonId: randomUUID() })],
    [ownerIdentity, foreignField, request({ seasonId: foreignSeason })],
    [ownerIdentity, randomUUID(), request()],
  ] as const) {
    await rejectCreate(identity, pathField, submitted, 404, "NOT_FOUND");
    assert.equal(await countHarvest(submitted.harvestId), 0);
  }
});

test("uses Business-local today and preserves DATE-only planting equality without timezone shifts", async () => {
  const onPlanting = await (await repository()).create(ownerIdentity, field,
    request({ harvestDate: "2026-10-01" }));
  const onLocalToday = await (await repository()).create(ownerIdentity, field,
    request({ harvestDate: "2026-10-17" }));
  assert.equal(onPlanting.harvest.harvestDate, "2026-10-01");
  assert.equal(onLocalToday.harvest.harvestDate, "2026-10-17");
  for (const date of ["2026-09-30", "2026-10-18", "2026-02-30", "2026-10-17T00:00:00Z"]) {
    const submitted = request({ harvestDate: date });
    await rejectCreate(ownerIdentity, field, submitted, 400, "INVALID_REQUEST");
    assert.equal(await countHarvest(submitted.harvestId), 0);
  }
});

test("rejects nonpositive, oversized, malformed, and over-scale quantity without rounding", async () => {
  for (const quantity of ["0", "0.000", "-1", "100000000000", "123456789012", "1.0001", "1e3", " 1", "+1"]) {
    const submitted = request({ quantity });
    await rejectCreate(ownerIdentity, field, submitted, 400, "INVALID_REQUEST");
    assert.equal(await countHarvest(submitted.harvestId), 0);
  }
  await rejectCreate(ownerIdentity, field, request({ unit: "TON" as Request["unit"] }), 400, "INVALID_REQUEST");
  const precise = await (await repository()).create(ownerIdentity, field,
    request({ quantity: "99999999999.999", unit: "METRIC_TONNE" }));
  assert.equal(precise.harvest.quantity, "99999999999.999");
  assert.equal(precise.harvest.unit, "METRIC_TONNE");
});

test("keeps distinct Harvests and each selected unit with actor and server acceptance provenance", async () => {
  const first = await (await repository()).create(ownerIdentity, field,
    request({ quantity: "12.375", unit: "KG" }));
  const second = await (await repository()).create(ownerIdentity, field,
    request({ quantity: "2.125", unit: "METRIC_TONNE" }));
  assert.notEqual(first.harvest.id, second.harvest.id);
  assert.deepEqual([first.harvest.quantity, first.harvest.unit], ["12.375", "KG"]);
  assert.deepEqual([second.harvest.quantity, second.harvest.unit], ["2.125", "METRIC_TONNE"]);
  for (const result of [first, second]) {
    assert.equal(result.harvest.harvestDate, "2026-10-17");
    assert.equal(result.harvest.actorUserId, owner);
    assert.equal(result.harvest.actorMembershipId, ownerMembership);
    assert.match(result.harvest.recordedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.notEqual(result.harvest.recordedAt.slice(0, 10), result.harvest.harvestDate);
  }
});

test("exact retry returns the original fact; changed payload, Field, Season, or actor conflicts", async () => {
  const submitted = request();
  const first = await (await repository()).create(ownerIdentity, field, submitted);
  const replay = await (await repository()).create(ownerIdentity, field, { ...submitted });
  assert.deepEqual([first.kind, replay.kind], ["accepted", "replayed"]);
  assert.deepEqual(replay.harvest, first.harvest);
  for (const [identity, pathField, changed] of [
    [ownerIdentity, field, { ...submitted, quantity: "12.376" }],
    [ownerIdentity, field, { ...submitted, harvestDate: "2026-10-16" }],
    [ownerIdentity, field, { ...submitted, unit: "METRIC_TONNE" }],
    [ownerIdentity, field, { ...submitted, seasonId: alternateSeason }],
    [ownerIdentity, otherField, { ...submitted, seasonId: otherFieldSeason }],
    [secondOwnerIdentity, field, submitted],
  ] as const) {
    await rejectCreate(identity, pathField, changed as Request, 409, "IDEMPOTENCY_KEY_REUSED");
  }
});

test("authorization and ACTIVE Season are rechecked before an exact replay", async () => {
  const submitted = request();
  const first = await (await repository()).create(ownerIdentity, field, submitted);
  await prisma.membership.update({ where: { id: ownerMembership }, data: { status: "REVOKED" } });
  try { await rejectCreate(ownerIdentity, field, submitted, 403, "FORBIDDEN"); }
  finally { await prisma.membership.update({ where: { id: ownerMembership }, data: { status: "ACTIVE" } }); }
  await prisma.membership.update({ where: { id: ownerMembership }, data: { role: "ADVISOR" } });
  try { await rejectCreate(ownerIdentity, field, submitted, 403, "FORBIDDEN"); }
  finally { await prisma.membership.update({ where: { id: ownerMembership }, data: { role: "OWNER" } }); }
  await prisma.season.update({ where: { id: season }, data: { status: "DRAFT", activatedAt: null } });
  try { await rejectCreate(ownerIdentity, field, submitted, 404, "NOT_FOUND"); }
  finally { await prisma.season.update({ where: { id: season }, data: { status: "ACTIVE", activatedAt: now() } }); }
  const replay = await (await repository()).create(ownerIdentity, field, submitted);
  assert.deepEqual(replay.harvest, first.harvest);
});

test("same UUID is independent across Businesses, and concurrent exact submissions converge", async () => {
  const id = randomUUID(), local = request({ harvestId: id });
  const foreign = request({ harvestId: id, seasonId: foreignSeason });
  const [first, second] = await Promise.all([
    (await repository()).create(ownerIdentity, field, local),
    (await repository()).create(foreignIdentity, foreignField, foreign),
  ]);
  assert.equal(first.kind, "accepted");
  assert.equal(second.kind, "accepted");
  assert.notEqual(first.harvest.businessId, second.harvest.businessId);
  const concurrent = request();
  const [left, right] = await Promise.all([
    (await repository()).create(ownerIdentity, field, concurrent),
    (await repository()).create(ownerIdentity, field, concurrent),
  ]);
  assert.deepEqual([left.kind, right.kind].sort(), ["accepted", "replayed"]);
  assert.deepEqual(left.harvest, right.harvest);
  assert.equal(await countHarvest(concurrent.harvestId), 1);
});

test("a Season status transition racing first acceptance cannot accept against stale ACTIVE state", async () => {
  const store = await repository();
  let releaseTransition!: () => void;
  let signalLocked!: () => void;
  const locked = new Promise<void>((resolve) => { signalLocked = resolve; });
  const release = new Promise<void>((resolve) => { releaseTransition = resolve; });
  const transition = prisma.$transaction(async (tx) => {
    await tx.season.update({ where: { id: racingSeason }, data: { status: "DRAFT", activatedAt: null } });
    signalLocked();
    await release;
  });
  await locked;
  const submitted = request({ seasonId: racingSeason });
  let createSettled = false;
  const attempt = store.create(ownerIdentity, field, submitted).then(
    (value) => ({ value }), (error: unknown) => ({ error }),
  ).finally(() => { createSettled = true; });
  try {
    let lockWaitSeen = false;
    for (let poll = 0; poll < 100 && !lockWaitSeen && !createSettled; poll += 1) {
      const rows = await prisma.$queryRaw<Array<{ waiting: boolean }>>`
        SELECT EXISTS (
          SELECT 1 FROM pg_stat_activity
          WHERE datname = current_database() AND pid <> pg_backend_pid() AND wait_event_type = 'Lock'
        ) AS waiting`;
      lockWaitSeen = rows[0]?.waiting ?? false;
      if (!lockWaitSeen && !createSettled) await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.ok(lockWaitSeen || createSettled, "create did not reach a database result or lock wait");
    releaseTransition();
    await transition;
    const outcome = await attempt;
    assert.ok("error" in outcome && isApiError(404, "NOT_FOUND")(outcome.error));
    assert.equal(await countHarvest(submitted.harvestId), 0);
  } finally {
    releaseTransition();
    await transition;
    await prisma.season.update({ where: { id: racingSeason }, data: { status: "ACTIVE", activatedAt: now() } });
  }
});

test("the HTTP create path rejects an unsupported note without writing a Harvest", async () => {
  const modulePath = "../../src/harvest/harvests.module.js";
  const module = await import(modulePath) as {
    createHarvestsApp(dependencies: {
      verify(token: string): Promise<Identity | null>;
      create(identity: Identity, fieldId: string, body: Request): Promise<Outcome>;
    }): Promise<NestFastifyApplication>;
  };
  const app = await module.createHarvestsApp({
    verify: async (token) => token === "owner" ? ownerIdentity : null,
    create: async (identity, fieldId, body) => (await repository()).create(identity, fieldId, body),
  });
  try {
    await app.init();
    const submitted = request();
    const response = await app.getHttpAdapter().getInstance().inject({
      method: "POST", url: `/v1/fields/${field}/harvests`,
      headers: { authorization: "Bearer owner" },
      payload: { ...submitted, note: "Unsupported" },
    });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error.code, "INVALID_REQUEST");
    assert.equal(await countHarvest(submitted.harvestId), 0);
  } finally { await app.close(); }
});
