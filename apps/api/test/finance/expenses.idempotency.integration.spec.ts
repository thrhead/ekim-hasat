import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../src/generated/prisma/client.js";
import { ApiError } from "../../src/observability/api-error.filter.js";
import { ExpensesRepository } from "../../src/finance/expenses.repository.js";
import { assertDisposableDatabaseUrl } from "../support/disposable-database.js";

const databaseUrl = process.env.DATABASE_URL;
assertDisposableDatabaseUrl(databaseUrl);
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });
const run = randomUUID(), provider = "spec012-idempotency";
const business = randomUUID(), otherBusiness = randomUUID();
const user = randomUUID(), otherUser = randomUUID(), secondOwner = randomUUID();
const membership = randomUUID(), otherMembership = randomUUID(), secondOwnerMembership = randomUUID();
const field = randomUUID(), otherField = randomUUID(), otherBusinessField = randomUUID();
const season = randomUUID(), alternateSeason = randomUUID(), otherFieldSeason = randomUUID();
const crop = randomUUID(), cropKey = `spec012-${run}`;
const identity = { provider, subject: `${run}-owner` };
const otherIdentity = { provider, subject: `${run}-other-owner` };
const secondOwnerIdentity = { provider, subject: `${run}-second-owner` };
const now = () => new Date("2026-10-16T10:00:00.000Z");
const repository = () => new ExpensesRepository(prisma, now);
const request = (expenseId: string) => ({
  expenseId, amount: "250.123456", currency: "TRY", category: "FUEL", expenseDate: "2026-10-15", seasonId: season,
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
    { id: secondOwner, authProvider: provider, authSubject: secondOwnerIdentity.subject, defaultBusinessId: business },
  ] });
  await prisma.membership.createMany({ data: [
    { id: membership, businessId: business, userId: user, role: "OWNER", status: "ACTIVE" },
    { id: otherMembership, businessId: otherBusiness, userId: otherUser, role: "OWNER", status: "ACTIVE" },
    { id: secondOwnerMembership, businessId: business, userId: secondOwner, role: "OWNER", status: "ACTIVE" },
  ] });
  await prisma.$executeRaw`INSERT INTO fields (id,business_id,name,representative_point) VALUES
    (${field}::uuid,${business}::uuid,'Primary expense field',ST_SetSRID(ST_MakePoint(29,41),4326)),
    (${otherField}::uuid,${business}::uuid,'Other authorized expense field',ST_SetSRID(ST_MakePoint(29,41),4326)),
    (${otherBusinessField}::uuid,${otherBusiness}::uuid,'Other Business expense field',ST_SetSRID(ST_MakePoint(30,42),4326))`;
  await prisma.cropDefinitionVersion.create({ data: { id: crop, cropKey, version: "1", displayName: "SPEC-012 expense crop" } });
  await prisma.season.createMany({ data: [
    { id: season, businessId: business, fieldId: field, cropKey, cropDefinitionVersionId: crop, actualPlantingDate: new Date("2026-10-01T00:00:00.000Z"), status: "DRAFT" },
    { id: alternateSeason, businessId: business, fieldId: field, cropKey, cropDefinitionVersionId: crop, actualPlantingDate: new Date("2026-10-02T00:00:00.000Z"), status: "DRAFT" },
    { id: otherFieldSeason, businessId: business, fieldId: otherField, cropKey, cropDefinitionVersionId: crop, actualPlantingDate: new Date("2026-10-03T00:00:00.000Z"), status: "DRAFT" },
  ] });
});

after(async () => {
  try {
    await prisma.$executeRawUnsafe("ALTER TABLE expenses DISABLE TRIGGER USER");
    try { await prisma.expense.deleteMany({ where: { businessId: { in: [business, otherBusiness] } } }); }
    finally { await prisma.$executeRawUnsafe("ALTER TABLE expenses ENABLE TRIGGER USER"); }
    await prisma.season.deleteMany({ where: { id: { in: [season, alternateSeason, otherFieldSeason] } } });
    await prisma.cropDefinitionVersion.delete({ where: { id: crop } });
    await prisma.$executeRaw`DELETE FROM fields WHERE id IN (${field}::uuid,${otherField}::uuid,${otherBusinessField}::uuid)`;
    await prisma.membership.deleteMany({ where: { id: { in: [membership, otherMembership, secondOwnerMembership] } } });
    await prisma.applicationUser.deleteMany({ where: { id: { in: [user, otherUser, secondOwner] } } });
    await prisma.business.deleteMany({ where: { id: { in: [business, otherBusiness] } } });
  } finally { await prisma.$disconnect(); }
});

test("exact same-actor payload retry replays; changed payload, Field, Season, or actor conflicts", async () => {
  const id = randomUUID(), payload = request(id);
  const first = await repository().create(identity, field, payload);
  const replay = await repository().create(identity, field, { ...payload });
  assert.equal(first.kind, "accepted");
  assert.equal(replay.kind, "replayed");
  assert.deepEqual(replay.expense, first.expense);
  const changed = [
    () => repository().create(identity, field, { ...payload, amount: "250.123457" }),
    () => repository().create(identity, field, { ...payload, currency: "USD" }),
    () => repository().create(identity, field, { ...payload, category: "LABOR" }),
    () => repository().create(identity, field, { ...payload, expenseDate: "2026-10-14" }),
    () => repository().create(identity, otherField, payload),
    () => repository().create(secondOwnerIdentity, field, payload),
    () => repository().create(identity, field, { ...payload, seasonId: alternateSeason }),
    () => repository().create(identity, otherField, { ...payload, seasonId: otherFieldSeason }),
  ];
  for (const attempt of changed) await assert.rejects(attempt, (error: unknown) => error instanceof ApiError
    && error.getStatus() === 409 && error.presentation.code === "IDEMPOTENCY_KEY_REUSED");
});

test("concurrent identical submissions converge on one canonical Expense", async () => {
  const id = randomUUID(), payload = request(id);
  const [left, right] = await Promise.all([
    repository().create(identity, field, payload),
    repository().create(identity, field, payload),
  ]);
  assert.deepEqual([left.kind, right.kind].sort(), ["accepted", "replayed"]);
  assert.deepEqual(left.expense, right.expense);
  assert.equal(await prisma.expense.count({ where: { businessId: business, id } }), 1);
});

test("the same UUID is independent across Businesses and revoked membership blocks replay", async () => {
  const id = randomUUID(), payload = request(id);
  const [local, foreign] = await Promise.all([
    repository().create(identity, field, payload),
    repository().create(otherIdentity, otherBusinessField, { ...payload, seasonId: undefined }),
  ]);
  assert.deepEqual([local.kind, foreign.kind].sort(), ["accepted", "accepted"]);
  assert.equal(await prisma.expense.count({ where: { id } }), 2);

  await prisma.membership.update({ where: { id: membership }, data: { status: "REVOKED" } });
  try {
    await assert.rejects(repository().create(identity, field, payload),
      (error: unknown) => error instanceof ApiError && error.getStatus() === 403 && error.presentation.code === "FORBIDDEN");
  } finally { await prisma.membership.update({ where: { id: membership }, data: { status: "ACTIVE" } }); }
});
