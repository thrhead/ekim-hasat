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
const run = randomUUID(), provider = "spec011-auth";
const business = randomUUID(), foreignBusiness = randomUUID();
const user = randomUUID(), foreignUser = randomUUID(), noScopeUser = randomUUID();
const membership = randomUUID(), foreignMembership = randomUUID();
const field = randomUUID(), foreignField = randomUUID();
const identity = { provider, subject: `${run}-active` };
const foreignIdentity = { provider, subject: `${run}-foreign` };
const noScopeIdentity = { provider, subject: `${run}-no-scope` };
const now = () => new Date("2026-10-05T10:00:00.000Z");
const repository = () => new IrrigationRecordsRepository(prisma, now);
const input = (irrigationRecordId = randomUUID()) => ({ irrigationRecordId,
  occurredAtLocal: "2026-10-04T12:30", occurredAt: "2026-10-04T09:30:00Z",
  capturedBusinessTimezone: "Europe/Istanbul" });

before(async () => {
  await prisma.$connect();
  const target = await prisma.$queryRaw<Array<{ database: string; postgis: boolean }>>`SELECT current_database() AS database, EXISTS(SELECT 1 FROM pg_extension WHERE extname='postgis') AS postgis`;
  assert.equal(target[0]?.database, "ekim_hasat_test");
  assert.equal(target[0]?.postgis, true);
  await prisma.business.createMany({ data: [{ id: business, timezone: "Europe/Istanbul" }, { id: foreignBusiness, timezone: "Europe/Istanbul" }] });
  await prisma.applicationUser.createMany({ data: [
    { id: user, authProvider: provider, authSubject: identity.subject, defaultBusinessId: business },
    { id: foreignUser, authProvider: provider, authSubject: foreignIdentity.subject, defaultBusinessId: foreignBusiness },
    { id: noScopeUser, authProvider: provider, authSubject: noScopeIdentity.subject },
  ] });
  await prisma.membership.createMany({ data: [
    { id: membership, businessId: business, userId: user, role: "OWNER", status: "ACTIVE" },
    { id: foreignMembership, businessId: foreignBusiness, userId: foreignUser, role: "OWNER", status: "ACTIVE" },
  ] });
  await prisma.$executeRaw`INSERT INTO fields (id,business_id,name,representative_point) VALUES
    (${field}::uuid,${business}::uuid,'Authorized irrigation field',ST_SetSRID(ST_MakePoint(29,41),4326)),
    (${foreignField}::uuid,${foreignBusiness}::uuid,'Private foreign field',ST_SetSRID(ST_MakePoint(29,41),4326))`;
});

after(async () => {
  try {
    await prisma.$executeRawUnsafe("ALTER TABLE irrigation_records DISABLE TRIGGER USER");
    try { await prisma.irrigationRecord.deleteMany({ where: { businessId: { in: [business, foreignBusiness] } } }); }
    finally { await prisma.$executeRawUnsafe("ALTER TABLE irrigation_records ENABLE TRIGGER USER"); }
    await prisma.$executeRaw`DELETE FROM fields WHERE id IN (${field}::uuid,${foreignField}::uuid)`;
    await prisma.membership.deleteMany({ where: { id: { in: [membership, foreignMembership] } } });
    await prisma.applicationUser.deleteMany({ where: { id: { in: [user, foreignUser, noScopeUser] } } });
    await prisma.business.deleteMany({ where: { id: { in: [business, foreignBusiness] } } });
  } finally { await prisma.$disconnect(); }
});

test("creates only under current active server-resolved Business membership and hides foreign Fields", async () => {
  const created = await repository().create(identity, field, input());
  assert.equal(created.kind, "accepted");
  const row = await prisma.irrigationRecord.findUniqueOrThrow({ where: { businessId_id: { businessId: business, id: created.record.id } } });
  assert.deepEqual([row.businessId, row.fieldId, row.actorUserId, row.actorMembershipId], [business, field, user, membership]);
  await assert.rejects(repository().create(identity, foreignField, input()),
    (error: unknown) => error instanceof ApiError && error.getStatus() === 404 && error.presentation.code === "NOT_FOUND");
  assert.equal(JSON.stringify(await prisma.irrigationRecord.findMany({ where: { id: created.record.id } })).includes("Private foreign"), false);
});

test("requires an active Business membership and does not create after revocation", async () => {
  await assert.rejects(repository().create(noScopeIdentity, field, input()),
    (error: unknown) => error instanceof ApiError && error.getStatus() === 403);
  const request = input();
  await prisma.membership.update({ where: { id: membership }, data: { status: "REVOKED" } });
  try {
    await assert.rejects(repository().create(identity, field, request),
      (error: unknown) => error instanceof ApiError && error.getStatus() === 403);
    assert.equal(await prisma.irrigationRecord.count({ where: { businessId: business, id: request.irrigationRecordId } }), 0);
  } finally { await prisma.membership.update({ where: { id: membership }, data: { status: "ACTIVE" } }); }
});
