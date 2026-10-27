import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../src/generated/prisma/client.js";
import { HarvestsRepository, type HarvestCreateRequest } from "../../src/harvest/harvests.repository.js";
import { assertDisposableDatabaseUrl } from "../support/disposable-database.js";

type HarvestRow = Readonly<{
  id: string;
  business_id: string;
  field_id: string;
  season_id: string;
  actor_user_id: string;
  actor_membership_id: string;
  harvest_date: string;
  quantity: string;
  unit: string;
  recorded_at: Date;
}>;

const databaseUrl = process.env.DATABASE_URL;
assertDisposableDatabaseUrl(databaseUrl);
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });
const runId = randomUUID();
const businessId = randomUUID(), userId = randomUUID(), membershipId = randomUUID();
const fieldId = randomUUID(), seasonId = randomUUID(), cropDefinitionVersionId = randomUUID();
const provider = "spec013-immutability";
const identity = { provider, subject: runId };
const now = () => new Date("2026-10-16T21:30:00.000Z");
const repository = new HarvestsRepository(prisma, now);

function createRequest(overrides: Partial<HarvestCreateRequest> = {}): HarvestCreateRequest {
  return { harvestId: randomUUID(), seasonId, harvestDate: "2026-10-17", quantity: "12.375", unit: "KG", ...overrides };
}

async function acceptHarvest(request: HarvestCreateRequest = createRequest()) {
  return (await repository.create(identity, fieldId, request)).harvest;
}

async function readHarvest(id: string): Promise<HarvestRow> {
  const rows = await prisma.$queryRaw<HarvestRow[]>`SELECT id::text, business_id::text, field_id::text,
    season_id::text, actor_user_id::text, actor_membership_id::text,
    to_char(harvest_date, 'YYYY-MM-DD') AS harvest_date, quantity::text, unit, recorded_at
    FROM harvests WHERE business_id=${businessId}::uuid AND id=${id}::uuid`;
  assert.equal(rows.length, 1);
  return rows[0]!;
}

function storedIdentity(row: HarvestRow) {
  return [row.id, row.business_id, row.field_id, row.season_id, row.actor_user_id,
    row.actor_membership_id, row.harvest_date, row.quantity, row.unit, row.recorded_at.toISOString()];
}

function acceptedIdentity(harvest: Awaited<ReturnType<typeof acceptHarvest>>) {
  return [harvest.id, harvest.businessId, harvest.fieldId, harvest.seasonId, harvest.actorUserId,
    harvest.actorMembershipId, harvest.harvestDate, harvest.quantity, harvest.unit, harvest.recordedAt];
}

function immutabilityViolation(error: unknown): boolean {
  return error instanceof Error && error.message.includes("Harvests are immutable");
}

before(async () => {
  await prisma.$connect();
  const target = await prisma.$queryRaw<Array<{ database: string }>>`SELECT current_database() AS database`;
  assert.equal(target[0]?.database, "ekim_hasat_test");
  await prisma.business.create({ data: { id: businessId, timezone: "Europe/Istanbul" } });
  await prisma.applicationUser.create({ data: {
    id: userId, authProvider: provider, authSubject: identity.subject, defaultBusinessId: businessId,
  } });
  await prisma.membership.create({ data: {
    id: membershipId, businessId, userId, role: "OWNER", status: "ACTIVE",
  } });
  await prisma.$executeRaw`INSERT INTO fields (id, business_id, name, representative_point)
    VALUES (${fieldId}::uuid, ${businessId}::uuid, 'Original field name', ST_SetSRID(ST_MakePoint(29, 41), 4326))`;
  await prisma.cropDefinitionVersion.create({ data: {
    id: cropDefinitionVersionId, cropKey: `spec013-${runId}`, version: "1", displayName: "SPEC-013 crop",
  } });
  await prisma.season.create({ data: {
    id: seasonId, businessId, fieldId, cropKey: `spec013-${runId}`, cropDefinitionVersionId,
    actualPlantingDate: new Date("2026-10-01T00:00:00.000Z"), status: "ACTIVE",
    activatedAt: new Date("2026-10-02T00:00:00.000Z"),
  } });
});

after(async () => { await prisma.$disconnect(); });

test("accepted Harvest rejects direct UPDATE and keeps every accepted value", async () => {
  const accepted = await acceptHarvest();
  await assert.rejects(
    prisma.$executeRaw`UPDATE harvests SET quantity='13.000'::numeric
      WHERE business_id=${businessId}::uuid AND id=${accepted.id}::uuid`,
    immutabilityViolation,
  );
  assert.deepEqual(storedIdentity(await readHarvest(accepted.id)), acceptedIdentity(accepted));
});

test("accepted Harvest rejects direct DELETE and retains the canonical row", async () => {
  const accepted = await acceptHarvest();
  await assert.rejects(
    prisma.$executeRaw`DELETE FROM harvests WHERE business_id=${businessId}::uuid AND id=${accepted.id}::uuid`,
    immutabilityViolation,
  );
  assert.deepEqual(storedIdentity(await readHarvest(accepted.id)), acceptedIdentity(accepted));
});

test("current Field and Season changes leave accepted Harvest context intact and exact replay works", async () => {
  const request = createRequest();
  const accepted = await acceptHarvest(request);
  const replay = await repository.create(identity, fieldId, request);
  assert.equal(replay.kind, "replayed");
  assert.deepEqual(replay.harvest, accepted);

  await prisma.field.update({ where: { id: fieldId }, data: { name: "Renamed current field" } });
  await prisma.season.update({ where: { id: seasonId }, data: { status: "DRAFT", activatedAt: null } });

  const afterContextChanges = await repository.create(identity, fieldId, request);
  assert.equal(afterContextChanges.kind, "replayed");
  assert.deepEqual(afterContextChanges.harvest, accepted);
  assert.deepEqual(storedIdentity(await readHarvest(accepted.id)), acceptedIdentity(accepted));
});
