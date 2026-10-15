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
const provider = "spec010-offline-timezone";
const business = randomUUID(), otherBusiness = randomUUID();
const user = randomUUID(), otherUser = randomUUID();
const membership = randomUUID(), otherMembership = randomUUID();
const field = randomUUID(), secondField = randomUUID(), otherBusinessField = randomUUID();
const crop = randomUUID(), season = randomUUID(), otherFieldSeason = randomUUID(), otherBusinessSeason = randomUUID();
const identity = { provider, subject: `${run}-farmer` };
const otherIdentity = { provider, subject: `${run}-other-business` };
const repository = () => new ObservationCreateRepository(prisma, () => new Date("2026-10-05T10:00:00.000Z"));
const input = (observationId: string, overrides: Partial<CreateObservationRequest> = {}): CreateObservationRequest => ({
  observationId, description: "Inspect the north row", occurredAtLocal: "2026-10-04T12:30",
  occurredAt: "2026-10-04T09:30:00Z", capturedBusinessTimezone: "Europe/Istanbul", seasonId: season, ...overrides,
});

before(async () => {
  await prisma.$connect();
  const target = await prisma.$queryRaw<Array<{ database: string; postgis: boolean }>>`SELECT current_database() AS database, EXISTS(SELECT 1 FROM pg_extension WHERE extname='postgis') AS postgis`;
  assert.equal(target[0]?.database, "ekim_hasat_test");
  assert.equal(target[0]?.postgis, true);
  await prisma.business.createMany({ data: [
    { id: business, timezone: "Europe/Istanbul" }, { id: otherBusiness, timezone: "Europe/Istanbul" },
  ] });
  await prisma.applicationUser.createMany({ data: [
    { id: user, authProvider: provider, authSubject: identity.subject, defaultBusinessId: business },
    { id: otherUser, authProvider: provider, authSubject: otherIdentity.subject, defaultBusinessId: otherBusiness },
  ] });
  await prisma.membership.createMany({ data: [
    { id: membership, businessId: business, userId: user, role: "OWNER", status: "ACTIVE" },
    { id: otherMembership, businessId: otherBusiness, userId: otherUser, role: "OWNER", status: "ACTIVE" },
  ] });
  await prisma.$executeRaw`INSERT INTO fields (id,business_id,name,representative_point) VALUES
    (${field}::uuid,${business}::uuid,'Primary',ST_SetSRID(ST_MakePoint(29,41),4326)),
    (${secondField}::uuid,${business}::uuid,'Second',ST_SetSRID(ST_MakePoint(29,41),4326)),
    (${otherBusinessField}::uuid,${otherBusiness}::uuid,'Other business',ST_SetSRID(ST_MakePoint(29,41),4326))`;
  await prisma.cropDefinitionVersion.create({ data: { id: crop, cropKey: `spec010-${run}`, version: "1", displayName: "Test crop" } });
  await prisma.season.createMany({ data: [
    { id: season, businessId: business, fieldId: field, cropKey: `spec010-${run}`, cropDefinitionVersionId: crop,
      actualPlantingDate: new Date("2026-10-01T00:00:00.000Z"), status: "DRAFT", version: 1 },
    { id: otherFieldSeason, businessId: business, fieldId: secondField, cropKey: `spec010-${run}`, cropDefinitionVersionId: crop,
      actualPlantingDate: new Date("2026-10-01T00:00:00.000Z"), status: "DRAFT", version: 1 },
    { id: otherBusinessSeason, businessId: otherBusiness, fieldId: otherBusinessField, cropKey: `spec010-${run}`, cropDefinitionVersionId: crop,
      actualPlantingDate: new Date("2026-10-01T00:00:00.000Z"), status: "DRAFT", version: 1 },
  ] });
});

after(async () => {
  try {
    await prisma.$executeRawUnsafe("ALTER TABLE field_observations DISABLE TRIGGER USER");
    try { await prisma.$executeRaw`DELETE FROM field_observations WHERE business_id IN (${business}::uuid,${otherBusiness}::uuid)`; }
    finally { await prisma.$executeRawUnsafe("ALTER TABLE field_observations ENABLE TRIGGER USER"); }
    await prisma.season.deleteMany({ where: { id: { in: [season, otherFieldSeason, otherBusinessSeason] } } });
    await prisma.cropDefinitionVersion.delete({ where: { id: crop } });
    await prisma.$executeRaw`DELETE FROM fields WHERE id IN (${field}::uuid,${secondField}::uuid,${otherBusinessField}::uuid)`;
    await prisma.membership.deleteMany({ where: { id: { in: [membership, otherMembership] } } });
    await prisma.applicationUser.deleteMany({ where: { id: { in: [user, otherUser] } } });
    await prisma.business.deleteMany({ where: { id: { in: [business, otherBusiness] } } });
  } finally { await prisma.$disconnect(); }
});

test("exact replay after a Business timezone change retains the accepted absolute occurrence instant", async () => {
  const payload = input(randomUUID());
  const accepted = await repository().create(identity, field, payload);
  assert.equal(accepted.kind, "accepted");
  await prisma.business.update({ where: { id: business }, data: { timezone: "Europe/Berlin" } });
  try {
    const replay = await repository().create(identity, field, payload);
    assert.equal(replay.kind, "replayed");
    assert.equal(replay.observation.occurredAt, accepted.observation.occurredAt);
    const stored = await prisma.fieldObservation.findUniqueOrThrow({ where: { businessId_id: { businessId: business, id: payload.observationId } } });
    assert.equal(stored.occurredAt.toISOString(), accepted.observation.occurredAt);
  } finally { await prisma.business.update({ where: { id: business }, data: { timezone: "Europe/Istanbul" } }); }
});

test("timezone mismatch before first acceptance rejects even when the local instant still maps", async () => {
  await prisma.business.update({ where: { id: business }, data: { timezone: "Europe/Moscow" } });
  try {
    const payload = input(randomUUID());
    await assert.rejects(repository().create(identity, field, payload), (error: unknown) => error instanceof ApiError
      && error.getStatus() === 400 && error.presentation.code === "INVALID_REQUEST");
    assert.equal(await prisma.fieldObservation.count({ where: { id: payload.observationId } }), 0);
  } finally { await prisma.business.update({ where: { id: business }, data: { timezone: "Europe/Istanbul" } }); }
});

test("create and replay recheck current Membership, Field, and Season authorization", async () => {
  const payload = input(randomUUID());
  await repository().create(identity, field, payload);
  const newPayload = input(randomUUID());
  await prisma.membership.update({ where: { id: membership }, data: { status: "REVOKED" } });
  try {
    for (const attempt of [
      () => repository().create(identity, field, payload),
      () => repository().create(identity, field, newPayload),
    ]) await assert.rejects(attempt(), (error: unknown) => error instanceof ApiError && error.getStatus() === 403);
  } finally { await prisma.membership.update({ where: { id: membership }, data: { status: "ACTIVE" } }); }

  for (const [requestedField, requestedSeason] of [
    [otherBusinessField, otherBusinessSeason], [field, otherFieldSeason],
  ] as const) {
    await assert.rejects(repository().create(identity, requestedField, input(randomUUID(), { seasonId: requestedSeason })),
      (error: unknown) => error instanceof ApiError && error.getStatus() === 404);
    await assert.rejects(repository().create(identity, requestedField, { ...payload, seasonId: requestedSeason }),
      (error: unknown) => error instanceof ApiError && error.getStatus() === 404);
  }
  await assert.rejects(repository().create(otherIdentity, field, input(randomUUID())),
    (error: unknown) => error instanceof ApiError && error.getStatus() === 404);
});
