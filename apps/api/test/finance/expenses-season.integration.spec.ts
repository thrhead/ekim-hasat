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
const run = randomUUID(), provider = "spec012-season";
const business = randomUUID(), foreignBusiness = randomUUID();
const owner = randomUUID(), foreignOwner = randomUUID();
const ownerMembership = randomUUID(), foreignMembership = randomUUID();
const field = randomUUID(), otherField = randomUUID(), foreignField = randomUUID();
const season = randomUUID(), wrongFieldSeason = randomUUID(), foreignBusinessSeason = randomUUID();
const crop = randomUUID(), cropKey = `spec012-season-${run}`;
const identity = { provider, subject: `${run}-owner` };
const repository = () => new ExpensesRepository(prisma, () => new Date("2026-10-16T10:00:00.000Z"));
const request = (expenseId = randomUUID(), seasonId?: string) => ({
  expenseId, amount: "81.250001", currency: "TRY", category: "FERTILIZER", expenseDate: "2026-10-15",
  ...(seasonId ? { seasonId } : {}),
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
    { id: owner, authProvider: provider, authSubject: identity.subject, defaultBusinessId: business },
    { id: foreignOwner, authProvider: provider, authSubject: `${run}-foreign-owner`, defaultBusinessId: foreignBusiness },
  ] });
  await prisma.membership.createMany({ data: [
    { id: ownerMembership, businessId: business, userId: owner, role: "OWNER", status: "ACTIVE" },
    { id: foreignMembership, businessId: foreignBusiness, userId: foreignOwner, role: "OWNER", status: "ACTIVE" },
  ] });
  await prisma.$executeRaw`INSERT INTO fields (id,business_id,name,representative_point) VALUES
    (${field}::uuid,${business}::uuid,'Season expense field',ST_SetSRID(ST_MakePoint(29,41),4326)),
    (${otherField}::uuid,${business}::uuid,'Other season expense field',ST_SetSRID(ST_MakePoint(29,41),4326)),
    (${foreignField}::uuid,${foreignBusiness}::uuid,'Foreign season expense field',ST_SetSRID(ST_MakePoint(30,42),4326))`;
  await prisma.cropDefinitionVersion.create({ data: { id: crop, cropKey, version: "1", displayName: "SPEC-012 season crop" } });
  await prisma.season.createMany({ data: [
    { id: season, businessId: business, fieldId: field, cropKey, cropDefinitionVersionId: crop, actualPlantingDate: new Date("2026-10-01T00:00:00.000Z"), status: "DRAFT" },
    { id: wrongFieldSeason, businessId: business, fieldId: otherField, cropKey, cropDefinitionVersionId: crop, actualPlantingDate: new Date("2026-10-02T00:00:00.000Z"), status: "DRAFT" },
    { id: foreignBusinessSeason, businessId: foreignBusiness, fieldId: foreignField, cropKey, cropDefinitionVersionId: crop, actualPlantingDate: new Date("2026-10-03T00:00:00.000Z"), status: "DRAFT" },
  ] });
});

after(async () => {
  try {
    await prisma.$executeRawUnsafe("ALTER TABLE expenses DISABLE TRIGGER USER");
    try { await prisma.expense.deleteMany({ where: { businessId: { in: [business, foreignBusiness] } } }); }
    finally { await prisma.$executeRawUnsafe("ALTER TABLE expenses ENABLE TRIGGER USER"); }
    await prisma.season.deleteMany({ where: { id: { in: [season, wrongFieldSeason, foreignBusinessSeason] } } });
    await prisma.cropDefinitionVersion.delete({ where: { id: crop } });
    await prisma.$executeRaw`DELETE FROM fields WHERE id IN (${field}::uuid,${otherField}::uuid,${foreignField}::uuid)`;
    await prisma.membership.deleteMany({ where: { id: { in: [ownerMembership, foreignMembership] } } });
    await prisma.applicationUser.deleteMany({ where: { id: { in: [owner, foreignOwner] } } });
    await prisma.business.deleteMany({ where: { id: { in: [business, foreignBusiness] } } });
  } finally { await prisma.$disconnect(); }
});

test("persists an explicit same-Business, same-Field Season and preserves Field-only null", async () => {
  const linkedRequest = request(randomUUID(), season);
  const linked = await repository().create(identity, field, linkedRequest);
  const fieldOnlyRequest = request();
  const fieldOnly = await repository().create(identity, field, fieldOnlyRequest);
  assert.equal(linked.expense.seasonId, season);
  assert.equal(fieldOnly.expense.seasonId, null);
  assert.equal((await prisma.expense.findUniqueOrThrow({ where: { businessId_id: { businessId: business, id: linkedRequest.expenseId } } })).seasonId, season);
  assert.equal((await prisma.expense.findUniqueOrThrow({ where: { businessId_id: { businessId: business, id: fieldOnlyRequest.expenseId } } })).seasonId, null);
});

test("rejects wrong-Field and cross-Business Seasons privately without creating a row", async () => {
  for (const invalidSeason of [wrongFieldSeason, foreignBusinessSeason]) {
    const submission = request(randomUUID(), invalidSeason);
    await assert.rejects(repository().create(identity, field, submission), (error: unknown) => error instanceof ApiError
      && error.getStatus() === 404 && error.presentation.code === "NOT_FOUND");
    assert.equal(await prisma.expense.count({ where: { businessId: business, id: submission.expenseId } }), 0);
  }
});

test("changed-Season reuse of an accepted Expense ID conflicts without revealing the row", async () => {
  const submission = request(randomUUID(), season);
  await repository().create(identity, field, submission);
  await assert.rejects(repository().create(identity, field, { ...submission, seasonId: wrongFieldSeason }), (error: unknown) => error instanceof ApiError
    && error.getStatus() === 409 && error.presentation.code === "IDEMPOTENCY_KEY_REUSED");
  assert.equal(await prisma.expense.count({ where: { businessId: business, id: submission.expenseId } }), 1);
});
