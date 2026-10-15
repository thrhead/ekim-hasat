import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../src/generated/prisma/client.js";
import type { CreateObservationRequest } from "../../src/observations/observation.controller.js";
import { ObservationCreateRepository } from "../../src/observations/observation.repository.js";
import { ApiError } from "../../src/observability/api-error.filter.js";
import { assertDisposableDatabaseUrl } from "../support/disposable-database.js";

const databaseUrl = process.env.DATABASE_URL;
assertDisposableDatabaseUrl(databaseUrl);
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });
const run = randomUUID();
const provider = "spec010-offline-authorization";
const business = randomUUID(), foreignBusiness = randomUUID();
const user = randomUUID(), foreignUser = randomUUID();
const membership = randomUUID(), foreignMembership = randomUUID();
const field = randomUUID(), foreignField = randomUUID();
const crop = randomUUID(), season = randomUUID(), foreignSeason = randomUUID();
const identity = { provider, subject: `${run}-farmer` };
const foreignIdentity = { provider, subject: `${run}-foreign-farmer` };
const repository = () => new ObservationCreateRepository(prisma, () => new Date("2026-10-15T10:00:00.000Z"));
const input = (observationId: string, overrides: Partial<CreateObservationRequest> = {}): CreateObservationRequest => ({
  observationId, description: "North row observation", occurredAtLocal: "2026-10-14T12:30",
  occurredAt: "2026-10-14T09:30:00Z", ...overrides,
});

before(async () => {
  await prisma.$connect();
  const target = await prisma.$queryRaw<Array<{ database: string; postgis: boolean }>>`SELECT current_database() AS database, EXISTS(SELECT 1 FROM pg_extension WHERE extname='postgis') AS postgis`;
  assert.equal(target[0]?.database, "ekim_hasat_test");
  assert.equal(target[0]?.postgis, true);
  await prisma.business.createMany({ data: [
    { id: business, timezone: "Europe/Istanbul" }, { id: foreignBusiness, timezone: "Europe/Istanbul" },
  ] });
  await prisma.applicationUser.createMany({ data: [
    { id: user, authProvider: provider, authSubject: identity.subject, defaultBusinessId: business },
    { id: foreignUser, authProvider: provider, authSubject: foreignIdentity.subject, defaultBusinessId: foreignBusiness },
  ] });
  await prisma.membership.createMany({ data: [
    { id: membership, businessId: business, userId: user, role: "OWNER", status: "ACTIVE" },
    { id: foreignMembership, businessId: foreignBusiness, userId: foreignUser, role: "OWNER", status: "ACTIVE" },
  ] });
  await prisma.$executeRaw`INSERT INTO fields (id,business_id,name,representative_point) VALUES
    (${field}::uuid,${business}::uuid,'Authorized field',ST_SetSRID(ST_MakePoint(29,41),4326)),
    (${foreignField}::uuid,${foreignBusiness}::uuid,'Private foreign field',ST_SetSRID(ST_MakePoint(29,41),4326))`;
  await prisma.cropDefinitionVersion.create({ data: { id: crop, cropKey: `spec010-auth-${run}`, version: "1", displayName: "Test crop" } });
  await prisma.season.createMany({ data: [
    { id: season, businessId: business, fieldId: field, cropKey: `spec010-auth-${run}`, cropDefinitionVersionId: crop,
      actualPlantingDate: new Date("2026-10-01T00:00:00.000Z"), status: "DRAFT", version: 1 },
    { id: foreignSeason, businessId: foreignBusiness, fieldId: foreignField, cropKey: `spec010-auth-${run}`, cropDefinitionVersionId: crop,
      actualPlantingDate: new Date("2026-10-01T00:00:00.000Z"), status: "DRAFT", version: 1 },
  ] });
});

after(async () => {
  try {
    await prisma.$executeRawUnsafe("ALTER TABLE field_observations DISABLE TRIGGER USER");
    try { await prisma.$executeRaw`DELETE FROM field_observations WHERE business_id IN (${business}::uuid,${foreignBusiness}::uuid)`; }
    finally { await prisma.$executeRawUnsafe("ALTER TABLE field_observations ENABLE TRIGGER USER"); }
    await prisma.season.deleteMany({ where: { id: { in: [season, foreignSeason] } } });
    await prisma.cropDefinitionVersion.delete({ where: { id: crop } });
    await prisma.$executeRaw`DELETE FROM fields WHERE id IN (${field}::uuid,${foreignField}::uuid)`;
    await prisma.membership.deleteMany({ where: { id: { in: [membership, foreignMembership] } } });
    await prisma.applicationUser.deleteMany({ where: { id: { in: [user, foreignUser] } } });
    await prisma.business.deleteMany({ where: { id: { in: [business, foreignBusiness] } } });
  } finally { await prisma.$disconnect(); }
});

function assertPrivateDenial(error: unknown, status: number, protectedValues: string[]): asserts error is ApiError {
  assert.ok(error instanceof ApiError);
  assert.equal(error.getStatus(), status);
  assert.equal(error.presentation.message, status === 403 ? "This request is not available" : "The requested item is not available");
  const publicError = JSON.stringify(error.presentation);
  for (const value of protectedValues) assert.equal(publicError.includes(value), false);
}

test("revoked Membership denies first create and exact replay without changing or disclosing accepted history", async () => {
  const accepted = input(randomUUID(), { description: "Private accepted note" });
  const deniedFirst = input(randomUUID(), { description: "Private denied note" });
  const first = await repository().create(identity, field, accepted);
  assert.equal(first.kind, "accepted");
  await prisma.membership.update({ where: { id: membership }, data: { status: "REVOKED" } });
  try {
    for (const command of [accepted, deniedFirst]) {
      await assert.rejects(repository().create(identity, field, command), (error: unknown) => {
        assertPrivateDenial(error, 403, [business, field, accepted.description, deniedFirst.description]);
        return true;
      });
    }
    assert.equal(await prisma.fieldObservation.count({ where: { businessId: business, id: accepted.observationId } }), 1);
    assert.equal(await prisma.fieldObservation.count({ where: { businessId: business, id: deniedFirst.observationId } }), 0);
  } finally { await prisma.membership.update({ where: { id: membership }, data: { status: "ACTIVE" } }); }
});

test("foreign Business Field and Season are denied on first create and replay without disclosure or new rows", async () => {
  const foreignAccepted = input(randomUUID(), { seasonId: foreignSeason, description: "Foreign private observation" });
  await repository().create(foreignIdentity, foreignField, foreignAccepted);
  const rejectedFirst = input(randomUUID(), { description: "Private denied foreign-field note" });
  const rejectedSeasonFirst = input(randomUUID(), { seasonId: foreignSeason });
  const sameBusinessAccepted = input(randomUUID());
  await repository().create(identity, field, sameBusinessAccepted);

  const attempts: Array<{ attempt: () => Promise<unknown>; id: string; status: number; expectedLocalRows: number }> = [
    { attempt: () => repository().create(identity, foreignField, rejectedFirst), id: rejectedFirst.observationId, status: 404, expectedLocalRows: 0 },
    { attempt: () => repository().create(identity, foreignField, foreignAccepted), id: foreignAccepted.observationId, status: 404, expectedLocalRows: 0 },
    { attempt: () => repository().create(identity, field, rejectedSeasonFirst), id: rejectedSeasonFirst.observationId, status: 404, expectedLocalRows: 0 },
    { attempt: () => repository().create(identity, field, { ...sameBusinessAccepted, seasonId: foreignSeason }), id: sameBusinessAccepted.observationId, status: 404, expectedLocalRows: 1 },
  ];
  for (const { attempt, id, status, expectedLocalRows } of attempts) {
    await assert.rejects(attempt(), (error: unknown) => {
      assertPrivateDenial(error, status, [foreignBusiness, foreignField, foreignSeason, "Foreign private observation"]);
      return true;
    });
    assert.equal(await prisma.fieldObservation.count({ where: { businessId: business, id } }), expectedLocalRows);
  }
  assert.equal(await prisma.fieldObservation.count({ where: { businessId: foreignBusiness, id: foreignAccepted.observationId } }), 1);
  assert.equal(await prisma.fieldObservation.count({ where: { businessId: business, id: sameBusinessAccepted.observationId } }), 1);
});
