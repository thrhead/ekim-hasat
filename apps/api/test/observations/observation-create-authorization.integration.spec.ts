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
const provider = "spec006-auth";
const business = randomUUID(), foreignBusiness = randomUUID();
const user = randomUUID(), noScopeUser = randomUUID(), foreignUser = randomUUID();
const membership = randomUUID(), foreignMembership = randomUUID();
const field = randomUUID(), foreignField = randomUUID(), season = randomUUID(), crop = randomUUID();
const identity = { provider, subject: `${run}-active` };
const noScopeIdentity = { provider, subject: `${run}-no-scope` };
const foreignIdentity = { provider, subject: `${run}-foreign` };
const repository = () => new ObservationCreateRepository(prisma, () => new Date("2026-10-05T10:00:00.000Z"));
const input = (overrides: Partial<CreateObservationRequest> = {}): CreateObservationRequest => ({
  observationId: randomUUID(), description: "  inspected north row  ", occurredAtLocal: "2026-10-04T12:30",
  occurredAt: "2026-10-04T09:30:00Z", ...overrides,
});

before(async () => {
  await prisma.$connect();
  const target = await prisma.$queryRaw<Array<{ database: string; postgis: boolean }>>`SELECT current_database() AS database, EXISTS(SELECT 1 FROM pg_extension WHERE extname='postgis') AS postgis`;
  assert.equal(target[0]?.database, "ekim_hasat_test");
  assert.equal(target[0]?.postgis, true);
  await prisma.business.createMany({ data: [{ id: business, timezone: "Europe/Istanbul" }, { id: foreignBusiness, timezone: "Pacific/Honolulu" }] });
  await prisma.applicationUser.createMany({ data: [
    { id: user, authProvider: provider, authSubject: identity.subject, defaultBusinessId: business },
    { id: noScopeUser, authProvider: provider, authSubject: noScopeIdentity.subject },
    { id: foreignUser, authProvider: provider, authSubject: foreignIdentity.subject, defaultBusinessId: foreignBusiness },
  ] });
  await prisma.membership.createMany({ data: [
    { id: membership, businessId: business, userId: user, role: "MEMBER", status: "ACTIVE" },
    { id: foreignMembership, businessId: foreignBusiness, userId: foreignUser, role: "OWNER", status: "ACTIVE" },
  ] });
  await prisma.$executeRaw`INSERT INTO fields (id,business_id,name,representative_point) VALUES
    (${field}::uuid,${business}::uuid,'Authorized',ST_SetSRID(ST_MakePoint(29,41),4326)),
    (${foreignField}::uuid,${foreignBusiness}::uuid,'Foreign',ST_SetSRID(ST_MakePoint(29,41),4326))`;
  await prisma.cropDefinitionVersion.create({ data: { id: crop, cropKey: `spec006-${run}`, version: "1", displayName: "Test crop" } });
  await prisma.season.create({ data: { id: season, businessId: business, fieldId: field,
    cropKey: `spec006-${run}`, cropDefinitionVersionId: crop,
    actualPlantingDate: new Date("2026-10-01T00:00:00.000Z"), status: "DRAFT", version: 1 } });
});

after(async () => {
  try {
    await prisma.$executeRawUnsafe("ALTER TABLE field_observations DISABLE TRIGGER USER");
    try { await prisma.$executeRaw`DELETE FROM field_observations WHERE business_id IN (${business}::uuid,${foreignBusiness}::uuid)`; }
    finally { await prisma.$executeRawUnsafe("ALTER TABLE field_observations ENABLE TRIGGER USER"); }
    await prisma.season.delete({ where: { id: season } });
    await prisma.cropDefinitionVersion.delete({ where: { id: crop } });
    await prisma.$executeRaw`DELETE FROM fields WHERE id IN (${field}::uuid,${foreignField}::uuid)`;
    await prisma.membership.deleteMany({ where: { id: { in: [membership, foreignMembership] } } });
    await prisma.applicationUser.deleteMany({ where: { id: { in: [user, noScopeUser, foreignUser] } } });
    await prisma.business.deleteMany({ where: { id: { in: [business, foreignBusiness] } } });
  } finally { await prisma.$disconnect(); }
});

test("create derives tenant and actor from active membership and hides missing/cross-Business fields", async () => {
  const created = await repository().create(identity, field, input());
  assert.equal(created.kind, "accepted");
  const row = await prisma.fieldObservation.findUniqueOrThrow({ where: { businessId_id: { businessId: business, id: created.observation.id } } });
  assert.deepEqual([row.businessId, row.fieldId, row.actorUserId, row.actorMembershipId], [business, field, user, membership]);
  const inSeason = await repository().create(identity, field, input({ seasonId: season }));
  assert.equal((await prisma.fieldObservation.findUniqueOrThrow({ where: { businessId_id: { businessId: business, id: inSeason.observation.id } } })).seasonId, season);
  await assert.rejects(repository().create(identity, foreignField, input()), (error: unknown) => error instanceof ApiError && error.getStatus() === 404 && error.presentation.code === "NOT_FOUND");
  await assert.rejects(repository().create(identity, randomUUID(), input()), (error: unknown) => error instanceof ApiError && error.getStatus() === 404 && error.presentation.code === "NOT_FOUND");
});

test("same-Business reuse with changed Season context is an idempotency conflict", async () => {
  const observationId = randomUUID();
  await repository().create(identity, field, input({ observationId }));
  await assert.rejects(repository().create(identity, field, input({ observationId, seasonId: season })),
    (error: unknown) => error instanceof ApiError && error.getStatus() === 409 && error.presentation.code === "IDEMPOTENCY_KEY_REUSED");
});

test("creation requires current active Business scope and a Season in that Field and Business", async () => {
  await assert.rejects(repository().create(noScopeIdentity, field, input()), (error: unknown) => error instanceof ApiError && error.getStatus() === 403);
  const existing = await prisma.membership.findUniqueOrThrow({ where: { businessId_userId: { businessId: business, userId: user } } });
  await prisma.membership.update({ where: { id: membership }, data: { status: "REVOKED" } });
  try { await assert.rejects(repository().create(identity, field, input()), (error: unknown) => error instanceof ApiError && error.getStatus() === 403); }
  finally { await prisma.membership.update({ where: { id: existing.id }, data: { status: "ACTIVE" } }); }
  await assert.rejects(repository().create(identity, field, input({ seasonId: randomUUID() })), (error: unknown) => error instanceof ApiError && error.getStatus() === 404);
});
