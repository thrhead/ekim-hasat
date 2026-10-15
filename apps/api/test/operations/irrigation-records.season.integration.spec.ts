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
const run = randomUUID(), provider = "spec011-season";
const business = randomUUID(), foreignBusiness = randomUUID(), user = randomUUID();
const membership = randomUUID(), foreignMembership = randomUUID();
const field = randomUUID(), otherField = randomUUID(), foreignField = randomUUID();
const season = randomUUID(), alternateSeason = randomUUID(), otherFieldSeason = randomUUID(), foreignBusinessSeason = randomUUID();
const crop = randomUUID();
const identity = { provider, subject: `${run}-farmer` };
const now = () => new Date("2026-10-05T10:00:00.000Z");
const repository = () => new IrrigationRecordsRepository(prisma, now);
const input = (irrigationRecordId: string, seasonId?: string) => ({ irrigationRecordId,
  occurredAtLocal: "2026-10-04T12:30", occurredAt: "2026-10-04T09:30:00Z",
  capturedBusinessTimezone: "Europe/Istanbul", ...(seasonId ? { seasonId } : {}) });

before(async () => {
  await prisma.$connect();
  const target = await prisma.$queryRaw<Array<{ database: string; postgis: boolean }>>`SELECT current_database() AS database, EXISTS(SELECT 1 FROM pg_extension WHERE extname='postgis') AS postgis`;
  assert.equal(target[0]?.database, "ekim_hasat_test");
  assert.equal(target[0]?.postgis, true);
  await prisma.business.createMany({ data: [
    { id: business, timezone: "Europe/Istanbul" }, { id: foreignBusiness, timezone: "Europe/Istanbul" },
  ] });
  await prisma.applicationUser.create({ data: { id: user, authProvider: provider, authSubject: identity.subject, defaultBusinessId: business } });
  await prisma.membership.createMany({ data: [
    { id: membership, businessId: business, userId: user, role: "OWNER", status: "ACTIVE" },
    { id: foreignMembership, businessId: foreignBusiness, userId: user, role: "OWNER", status: "ACTIVE" },
  ] });
  await prisma.$executeRaw`INSERT INTO fields (id,business_id,name,representative_point) VALUES
    (${field}::uuid,${business}::uuid,'Season field',ST_SetSRID(ST_MakePoint(29,41),4326)),
    (${otherField}::uuid,${business}::uuid,'Other field',ST_SetSRID(ST_MakePoint(29,41),4326)),
    (${foreignField}::uuid,${foreignBusiness}::uuid,'Foreign business field',ST_SetSRID(ST_MakePoint(29,41),4326))`;
  await prisma.cropDefinitionVersion.create({ data: { id: crop, cropKey: `spec011-${run}`, version: "1", displayName: "Test crop" } });
  await prisma.season.createMany({ data: [
    { id: season, businessId: business, fieldId: field, cropKey: `spec011-${run}`, cropDefinitionVersionId: crop, actualPlantingDate: new Date("2026-10-01T00:00:00Z"), status: "DRAFT" },
    { id: alternateSeason, businessId: business, fieldId: field, cropKey: `spec011-${run}`, cropDefinitionVersionId: crop, actualPlantingDate: new Date("2026-10-02T00:00:00Z"), status: "DRAFT" },
    { id: otherFieldSeason, businessId: business, fieldId: otherField, cropKey: `spec011-${run}`, cropDefinitionVersionId: crop, actualPlantingDate: new Date("2026-10-03T00:00:00Z"), status: "DRAFT" },
    { id: foreignBusinessSeason, businessId: foreignBusiness, fieldId: foreignField, cropKey: `spec011-${run}`, cropDefinitionVersionId: crop, actualPlantingDate: new Date("2026-10-04T00:00:00Z"), status: "DRAFT" },
  ] });
});

after(async () => {
  try {
    await prisma.$executeRawUnsafe("ALTER TABLE irrigation_records DISABLE TRIGGER USER");
    try { await prisma.irrigationRecord.deleteMany({ where: { businessId: { in: [business, foreignBusiness] } } }); }
    finally { await prisma.$executeRawUnsafe("ALTER TABLE irrigation_records ENABLE TRIGGER USER"); }
    await prisma.season.deleteMany({ where: { id: { in: [season, alternateSeason, otherFieldSeason, foreignBusinessSeason] } } });
    await prisma.cropDefinitionVersion.delete({ where: { id: crop } });
    await prisma.$executeRaw`DELETE FROM fields WHERE id IN (${field}::uuid,${otherField}::uuid,${foreignField}::uuid)`;
    await prisma.membership.deleteMany({ where: { id: { in: [membership, foreignMembership] } } });
    await prisma.applicationUser.delete({ where: { id: user } });
    await prisma.business.deleteMany({ where: { id: { in: [business, foreignBusiness] } } });
  } finally { await prisma.$disconnect(); }
});

test("accepts and retains a same-Field, same-Business Season while keeping Season optional", async () => {
  const associated = await repository().create(identity, field, input(randomUUID(), season));
  const fieldOnly = await repository().create(identity, field, input(randomUUID()));
  assert.equal(associated.record.seasonId, season);
  assert.equal(fieldOnly.record.seasonId, null);
  const stored = await prisma.irrigationRecord.findUniqueOrThrow({
    where: { businessId_id: { businessId: business, id: associated.record.id } },
  });
  assert.equal(stored.seasonId, season);
});

test("hides cross-Field and cross-Business Seasons and conflicts when a retry changes Season", async () => {
  const id = randomUUID(), payload = input(id, season);
  const accepted = await repository().create(identity, field, payload);
  assert.equal(accepted.kind, "accepted");
  await assert.rejects(repository().create(identity, field, input(id, alternateSeason)),
    (error: unknown) => error instanceof ApiError && error.getStatus() === 409
      && error.presentation.code === "IDEMPOTENCY_KEY_REUSED");
  for (const invalidSeason of [otherFieldSeason, foreignBusinessSeason]) {
    await assert.rejects(repository().create(identity, field, input(randomUUID(), invalidSeason)),
      (error: unknown) => error instanceof ApiError && error.getStatus() === 404
        && error.presentation.code === "NOT_FOUND");
  }
  assert.equal(await prisma.irrigationRecord.count({ where: { businessId: business, seasonId: { in: [otherFieldSeason, foreignBusinessSeason] } } }), 0);
});
