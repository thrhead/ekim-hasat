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
const run = randomUUID();
const provider = "spec011-timezone";
const business = randomUUID(), user = randomUUID(), membership = randomUUID(), field = randomUUID();
const identity = { provider, subject: `${run}-farmer` };
const now = () => new Date("2026-10-05T10:00:00.000Z");
const repository = () => new IrrigationRecordsRepository(prisma, now);
type Input = {
  irrigationRecordId: string;
  occurredAtLocal: string;
  occurredAt: string;
  capturedBusinessTimezone: string;
};
const input = (overrides: Partial<Input> = {}): Input => ({
  irrigationRecordId: randomUUID(),
  occurredAtLocal: "2026-10-04T12:30",
  occurredAt: "2026-10-04T09:30:00.000Z",
  capturedBusinessTimezone: "Europe/Istanbul",
  ...overrides,
});

before(async () => {
  await prisma.$connect();
  const target = await prisma.$queryRaw<Array<{ database: string; postgis: boolean }>>`SELECT current_database() AS database, EXISTS(SELECT 1 FROM pg_extension WHERE extname='postgis') AS postgis`;
  assert.equal(target[0]?.database, "ekim_hasat_test");
  assert.equal(target[0]?.postgis, true);
  await prisma.business.create({ data: { id: business, timezone: "Europe/Istanbul" } });
  await prisma.applicationUser.create({ data: { id: user, authProvider: provider, authSubject: identity.subject, defaultBusinessId: business } });
  await prisma.membership.create({ data: { id: membership, businessId: business, userId: user, role: "OWNER", status: "ACTIVE" } });
  await prisma.$executeRaw`INSERT INTO fields (id,business_id,name,representative_point)
    VALUES (${field}::uuid,${business}::uuid,'Timezone fixture',ST_SetSRID(ST_MakePoint(29,41),4326))`;
});

after(async () => {
  try {
    await prisma.$executeRawUnsafe("ALTER TABLE irrigation_records DISABLE TRIGGER USER");
    try { await prisma.irrigationRecord.deleteMany({ where: { businessId: business } }); }
    finally { await prisma.$executeRawUnsafe("ALTER TABLE irrigation_records ENABLE TRIGGER USER"); }
    await prisma.$executeRaw`DELETE FROM fields WHERE id=${field}::uuid`;
    await prisma.membership.delete({ where: { id: membership } });
    await prisma.applicationUser.delete({ where: { id: user } });
    await prisma.business.delete({ where: { id: business } });
  } finally { await prisma.$disconnect(); }
});

test("interprets local occurrence time in the current Business timezone", async () => {
  const created = await repository().create(identity, field, input());
  assert.equal(created.kind, "accepted");
  assert.equal(created.record.occurredAt, "2026-10-04T09:30:00.000Z");
  assert.equal(created.record.businessTimezone, "Europe/Istanbul");
});

test("uses Europe/Istanbul when Business timezone is unset", async () => {
  await prisma.business.update({ where: { id: business }, data: { timezone: null } });
  try {
    const created = await repository().create(identity, field, input());
    assert.equal(created.record.occurredAt, "2026-10-04T09:30:00.000Z");
    assert.equal(created.record.businessTimezone, "Europe/Istanbul");
  } finally {
    await prisma.business.update({ where: { id: business }, data: { timezone: "Europe/Istanbul" } });
  }
});

test("rejects local-time and absolute-instant mismatches without persistence", async () => {
  const request = input({ occurredAt: "2026-10-04T10:30:00.000Z" });
  await assert.rejects(repository().create(identity, field, request),
    (error: unknown) => error instanceof ApiError && error.getStatus() === 400 && error.presentation.code === "INVALID_REQUEST");
  assert.equal(await prisma.irrigationRecord.count({ where: { businessId: business, id: request.irrigationRecordId } }), 0);
});

test("rejects future occurrence instants without persistence", async () => {
  const request = input({ occurredAtLocal: "2026-10-05T14:00", occurredAt: "2026-10-05T11:00:00.000Z" });
  await assert.rejects(repository().create(identity, field, request),
    (error: unknown) => error instanceof ApiError && error.getStatus() === 400 && error.presentation.code === "INVALID_REQUEST");
  assert.equal(await prisma.irrigationRecord.count({ where: { businessId: business, id: request.irrigationRecordId } }), 0);
});

test("rejects ambiguous and nonexistent local times in a daylight-saving Business timezone", async () => {
  await prisma.business.update({ where: { id: business }, data: { timezone: "America/New_York" } });
  try {
    const ambiguous = input({
      occurredAtLocal: "2026-11-01T01:30",
      occurredAt: "2026-11-01T05:30:00.000Z",
      capturedBusinessTimezone: "America/New_York",
    });
    const nonexistent = input({
      occurredAtLocal: "2026-03-08T02:30",
      occurredAt: "2026-03-08T07:30:00.000Z",
      capturedBusinessTimezone: "America/New_York",
    });
    for (const request of [ambiguous, nonexistent]) {
      await assert.rejects(repository().create(identity, field, request),
        (error: unknown) => error instanceof ApiError && error.getStatus() === 400 && error.presentation.code === "INVALID_REQUEST");
      assert.equal(await prisma.irrigationRecord.count({ where: { businessId: business, id: request.irrigationRecordId } }), 0);
    }
  } finally {
    await prisma.business.update({ where: { id: business }, data: { timezone: "Europe/Istanbul" } });
  }
});

test("rejects a stale captured Business timezone for a new record", async () => {
  const request = input({ capturedBusinessTimezone: "Europe/Moscow" });
  await assert.rejects(repository().create(identity, field, request),
    (error: unknown) => error instanceof ApiError && error.getStatus() === 400 && error.presentation.code === "INVALID_REQUEST");
  assert.equal(await prisma.irrigationRecord.count({ where: { businessId: business, id: request.irrigationRecordId } }), 0);
});
