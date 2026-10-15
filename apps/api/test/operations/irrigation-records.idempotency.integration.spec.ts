import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../src/generated/prisma/client.js";
import { ApiError } from "../../src/observability/api-error.filter.js";
import { IrrigationRecordsRepository } from "../../src/operations/irrigation-records.repository.js";
import { assertDisposableDatabaseUrl } from "../support/disposable-database.js";

const databaseUrl = process.env.DATABASE_URL;
assertDisposableDatabaseUrl(databaseUrl);
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });
const run = randomUUID(), provider = "spec011-idempotency";
const business = randomUUID(), user = randomUUID(), otherUser = randomUUID();
const membership = randomUUID(), otherMembership = randomUUID();
const field = randomUUID(), otherField = randomUUID();
const season = randomUUID(), alternateSeason = randomUUID(), foreignSeason = randomUUID();
const crop = randomUUID();
const identity = { provider, subject: `${run}-farmer` };
const otherIdentity = { provider, subject: `${run}-teammate` };
const now = () => new Date("2026-10-05T10:00:00.000Z");
const repository = () => new IrrigationRecordsRepository(prisma, now);
const base = (irrigationRecordId: string) => ({ irrigationRecordId,
  occurredAtLocal: "2026-10-04T12:30", occurredAt: "2026-10-04T09:30:00Z",
  capturedBusinessTimezone: "Europe/Istanbul", method: "Drip", durationMinutes: 30 });

before(async () => {
  await prisma.$connect();
  const target = await prisma.$queryRaw<Array<{ database: string; postgis: boolean }>>`SELECT current_database() AS database, EXISTS(SELECT 1 FROM pg_extension WHERE extname='postgis') AS postgis`;
  assert.equal(target[0]?.database, "ekim_hasat_test");
  assert.equal(target[0]?.postgis, true);
  await prisma.business.create({ data: { id: business, timezone: "Europe/Istanbul" } });
  await prisma.applicationUser.createMany({ data: [
    { id: user, authProvider: provider, authSubject: identity.subject, defaultBusinessId: business },
    { id: otherUser, authProvider: provider, authSubject: otherIdentity.subject, defaultBusinessId: business },
  ] });
  await prisma.membership.createMany({ data: [
    { id: membership, businessId: business, userId: user, role: "OWNER", status: "ACTIVE" },
    { id: otherMembership, businessId: business, userId: otherUser, role: "MEMBER", status: "ACTIVE" },
  ] });
  await prisma.$executeRaw`INSERT INTO fields (id,business_id,name,representative_point) VALUES
    (${field}::uuid,${business}::uuid,'Primary',ST_SetSRID(ST_MakePoint(29,41),4326)),
    (${otherField}::uuid,${business}::uuid,'Other authorized',ST_SetSRID(ST_MakePoint(29,41),4326))`;
  await prisma.cropDefinitionVersion.create({ data: { id: crop, cropKey: `spec011-${run}`, version: "1", displayName: "Test crop" } });
  await prisma.season.createMany({ data: [
    { id: season, businessId: business, fieldId: field, cropKey: `spec011-${run}`, cropDefinitionVersionId: crop, actualPlantingDate: new Date("2026-10-01T00:00:00Z"), status: "DRAFT" },
    { id: alternateSeason, businessId: business, fieldId: field, cropKey: `spec011-${run}`, cropDefinitionVersionId: crop, actualPlantingDate: new Date("2026-10-02T00:00:00Z"), status: "DRAFT" },
    { id: foreignSeason, businessId: business, fieldId: otherField, cropKey: `spec011-${run}`, cropDefinitionVersionId: crop, actualPlantingDate: new Date("2026-10-03T00:00:00Z"), status: "DRAFT" },
  ] });
});

after(async () => {
  try {
    await prisma.$executeRawUnsafe("ALTER TABLE irrigation_records DISABLE TRIGGER USER");
    try { await prisma.irrigationRecord.deleteMany({ where: { businessId: business } }); }
    finally { await prisma.$executeRawUnsafe("ALTER TABLE irrigation_records ENABLE TRIGGER USER"); }
    await prisma.season.deleteMany({ where: { id: { in: [season, alternateSeason, foreignSeason] } } });
    await prisma.cropDefinitionVersion.delete({ where: { id: crop } });
    await prisma.$executeRaw`DELETE FROM fields WHERE id IN (${field}::uuid,${otherField}::uuid)`;
    await prisma.membership.deleteMany({ where: { id: { in: [membership, otherMembership] } } });
    await prisma.applicationUser.deleteMany({ where: { id: { in: [user, otherUser] } } });
    await prisma.business.delete({ where: { id: business } });
  } finally { await prisma.$disconnect(); }
});

test("exact retry returns the accepted record; changed payload, Field, or actor conflicts", async () => {
  const id = randomUUID(), payload = { ...base(id), waterVolumeCubicMetres: "2" };
  const first = await repository().create(identity, field, payload);
  const replay = await repository().create(identity, field, { ...payload });
  assert.equal(first.kind, "accepted");
  assert.equal(replay.kind, "replayed");
  assert.deepEqual(replay.record, first.record);
  const conflicts = [
    () => repository().create(identity, field, { ...payload, method: "Sprinkler" }),
    () => repository().create(identity, field, { ...payload, waterVolumeCubicMetres: "2.1" }),
    () => repository().create(identity, field, { ...payload, capturedBusinessTimezone: "Europe/London" }),
    () => repository().create(identity, otherField, payload),
    () => repository().create(otherIdentity, field, payload),
  ];
  for (const attempt of conflicts) await assert.rejects(attempt, (error: unknown) => error instanceof ApiError
    && error.getStatus() === 409 && error.presentation.code === "IDEMPOTENCY_KEY_REUSED");
});

test("concurrent exact creates produce one canonical record and one exact replay", async () => {
  const id = randomUUID(), payload = base(id);
  const [left, right] = await Promise.all([
    repository().create(identity, field, payload),
    repository().create(identity, field, payload),
  ]);
  assert.deepEqual([left.kind, right.kind].sort(), ["accepted", "replayed"]);
  assert.deepEqual(left.record, right.record);
  assert.equal(await prisma.irrigationRecord.count({ where: { businessId: business, id } }), 1);
});

test("changed Season conflicts, current authorization is rechecked, and a foreign Field Season is hidden", async () => {
  const id = randomUUID();
  const payload = { ...base(id), seasonId: season };
  const accepted = await repository().create(identity, field, payload);
  assert.equal(accepted.record.seasonId, season);
  await assert.rejects(repository().create(identity, field, { ...payload, seasonId: alternateSeason }),
    (error: unknown) => error instanceof ApiError && error.getStatus() === 409 && error.presentation.code === "IDEMPOTENCY_KEY_REUSED");
  await assert.rejects(repository().create(identity, field, { ...payload, seasonId: foreignSeason }),
    (error: unknown) => error instanceof ApiError && error.getStatus() === 404 && error.presentation.code === "NOT_FOUND");

  await prisma.membership.update({ where: { id: membership }, data: { status: "REVOKED" } });
  try {
    await assert.rejects(repository().create(identity, field, payload),
      (error: unknown) => error instanceof ApiError && error.getStatus() === 403 && error.presentation.code === "FORBIDDEN");
  } finally { await prisma.membership.update({ where: { id: membership }, data: { status: "ACTIVE" } }); }
});
