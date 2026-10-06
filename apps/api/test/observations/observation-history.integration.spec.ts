import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../src/generated/prisma/client.js";
import { ObservationCreateRepository } from "../../src/observations/observation.repository.js";
import { createObservationApp } from "../../src/observations/observation.controller.js";
import { assertDisposableDatabaseUrl } from "../support/disposable-database.js";

const databaseUrl = process.env.DATABASE_URL;
assertDisposableDatabaseUrl(databaseUrl);
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });
const run = randomUUID(), businessId = randomUUID(), userId = randomUUID(), fieldId = randomUUID(), seasonId = randomUUID(), cropId = randomUUID();
const identity = { provider: "spec006-history", subject: run };
const repository = new ObservationCreateRepository(prisma, () => new Date("2026-10-05T10:00:00.000Z"));

before(async () => {
  await prisma.$connect();
  const target = await prisma.$queryRaw<Array<{ database: string; postgis: boolean }>>`SELECT current_database() AS database, EXISTS(SELECT 1 FROM pg_extension WHERE extname='postgis') AS postgis`;
  assert.equal(target[0]?.database, "ekim_hasat_test");
  assert.equal(target[0]?.postgis, true);
  await prisma.business.create({ data: { id: businessId, timezone: "Europe/Istanbul" } });
  await prisma.applicationUser.create({ data: { id: userId, authProvider: identity.provider, authSubject: identity.subject, defaultBusinessId: businessId } });
  await prisma.membership.create({ data: { businessId, userId, role: "OWNER", status: "ACTIVE" } });
  await prisma.$executeRaw`INSERT INTO fields (id,business_id,name,representative_point) VALUES (${fieldId}::uuid,${businessId}::uuid,'Original name',ST_SetSRID(ST_MakePoint(29,41),4326))`;
  await prisma.cropDefinitionVersion.create({ data: { id: cropId, cropKey: `history-${run}`, version: "1", displayName: "History crop" } });
  await prisma.season.create({ data: { id: seasonId, businessId, fieldId, cropKey: `history-${run}`, cropDefinitionVersionId: cropId,
    actualPlantingDate: new Date("2026-10-01T00:00:00Z"), status: "DRAFT", version: 1 } });
});

after(async () => {
  try {
    await prisma.$executeRawUnsafe("ALTER TABLE field_observations DISABLE TRIGGER USER");
    try { await prisma.$executeRaw`DELETE FROM field_observations WHERE business_id=${businessId}::uuid`; }
    finally { await prisma.$executeRawUnsafe("ALTER TABLE field_observations ENABLE TRIGGER USER"); }
    await prisma.season.delete({ where: { id: seasonId } });
    await prisma.cropDefinitionVersion.delete({ where: { id: cropId } });
    await prisma.$executeRaw`DELETE FROM fields WHERE id=${fieldId}::uuid`;
    await prisma.membership.deleteMany({ where: { businessId, userId } });
    await prisma.applicationUser.delete({ where: { id: userId } });
    await prisma.business.delete({ where: { id: businessId } });
  } finally { await prisma.$disconnect(); }
});

test("accepted text, time, Field, and Season context stay immutable; correction appends a new identity", async () => {
  const input = { observationId: randomUUID(), description: "Leaves turning yellow", seasonId,
    occurredAtLocal: "2026-10-04T12:30", occurredAt: "2026-10-04T09:30:00Z" };
  const accepted = await repository.create(identity, fieldId, input);
  const original = await prisma.fieldObservation.findUniqueOrThrow({ where: { businessId_id: { businessId, id: input.observationId } } });
  await prisma.field.update({ where: { id: fieldId }, data: { name: "Renamed field", version: { increment: 1 } } });
  await prisma.season.update({ where: { id: seasonId }, data: { version: { increment: 1 } } });
  const afterContextChanges = await prisma.fieldObservation.findUniqueOrThrow({ where: { businessId_id: { businessId, id: input.observationId } } });
  assert.deepEqual(afterContextChanges, original);
  await assert.rejects(prisma.fieldObservation.update({ where: { businessId_id: { businessId, id: input.observationId } }, data: { description: "Changed" } }));
  await assert.rejects(prisma.fieldObservation.delete({ where: { businessId_id: { businessId, id: input.observationId } } }));
  const correction = await repository.create(identity, fieldId, { ...input, observationId: randomUUID(), description: "Leaves turning yellow near the gate" });
  assert.notEqual(correction.observation.id, accepted.observation.id);
  assert.equal(await prisma.fieldObservation.count({ where: { fieldId } }), 2);
});

test("the observation API has no update or delete route", async () => {
  const app = await createObservationApp({ verify: async () => identity,
    create: async () => { throw new Error("unexpected write"); }, readDiary: async () => ({ items: [], businessTimezone: "Europe/Istanbul", nextCursor: null }) });
  await app.init(); await app.getHttpAdapter().getInstance().ready();
  try {
    for (const method of ["PATCH", "PUT", "DELETE"] as const) {
      const response = await app.inject({ method, url: `/v1/fields/${fieldId}/observations/${inputId}` });
      assert.equal(response.statusCode, 404);
    }
  } finally { await app.close(); }
});

const inputId = randomUUID();
