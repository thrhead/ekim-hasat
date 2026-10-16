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
const run = randomUUID(), provider = "spec012-auth";
const business = randomUUID(), foreignBusiness = randomUUID();
const owner = randomUUID(), worker = randomUUID(), advisor = randomUUID(), foreignOwner = randomUUID(), noScope = randomUUID();
const ownerMembership = randomUUID(), workerMembership = randomUUID(), advisorMembership = randomUUID(), foreignMembership = randomUUID();
const field = randomUUID(), foreignField = randomUUID();
const ownerIdentity = { provider, subject: `${run}-owner` };
const workerIdentity = { provider, subject: `${run}-worker` };
const advisorIdentity = { provider, subject: `${run}-advisor` };
const foreignIdentity = { provider, subject: `${run}-foreign` };
const noScopeIdentity = { provider, subject: `${run}-no-scope` };
const now = () => new Date("2026-10-16T21:30:00.000Z");
const repository = () => new ExpensesRepository(prisma, now);
const payload = (expenseId = randomUUID(), expenseDate = "2026-10-17") => ({
  expenseId, amount: "12.30", currency: "TRY", category: "FERTILIZER", expenseDate,
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
    { id: owner, authProvider: provider, authSubject: ownerIdentity.subject, defaultBusinessId: business },
    { id: worker, authProvider: provider, authSubject: workerIdentity.subject, defaultBusinessId: business },
    { id: advisor, authProvider: provider, authSubject: advisorIdentity.subject, defaultBusinessId: business },
    { id: foreignOwner, authProvider: provider, authSubject: foreignIdentity.subject, defaultBusinessId: foreignBusiness },
    { id: noScope, authProvider: provider, authSubject: noScopeIdentity.subject },
  ] });
  await prisma.membership.createMany({ data: [
    { id: ownerMembership, businessId: business, userId: owner, role: "OWNER", status: "ACTIVE" },
    { id: workerMembership, businessId: business, userId: worker, role: "WORKER", status: "ACTIVE" },
    { id: advisorMembership, businessId: business, userId: advisor, role: "ADVISOR", status: "ACTIVE" },
    { id: foreignMembership, businessId: foreignBusiness, userId: foreignOwner, role: "OWNER", status: "ACTIVE" },
  ] });
  await prisma.$executeRaw`INSERT INTO fields (id,business_id,name,representative_point) VALUES
    (${field}::uuid,${business}::uuid,'Authorized expense field',ST_SetSRID(ST_MakePoint(29,41),4326)),
    (${foreignField}::uuid,${foreignBusiness}::uuid,'Private foreign expense field',ST_SetSRID(ST_MakePoint(29,41),4326))`;
});

after(async () => {
  try {
    await prisma.$executeRawUnsafe("ALTER TABLE expenses DISABLE TRIGGER USER");
    try { await prisma.expense.deleteMany({ where: { businessId: { in: [business, foreignBusiness] } } }); }
    finally { await prisma.$executeRawUnsafe("ALTER TABLE expenses ENABLE TRIGGER USER"); }
    await prisma.$executeRaw`DELETE FROM fields WHERE id IN (${field}::uuid,${foreignField}::uuid)`;
    await prisma.membership.deleteMany({ where: { id: { in: [ownerMembership, workerMembership, advisorMembership, foreignMembership] } } });
    await prisma.applicationUser.deleteMany({ where: { id: { in: [owner, worker, advisor, foreignOwner, noScope] } } });
    await prisma.business.deleteMany({ where: { id: { in: [business, foreignBusiness] } } });
  } finally { await prisma.$disconnect(); }
});

test("only a current OWNER can create expenses under the server-resolved Business", async () => {
  const accepted = await repository().create(ownerIdentity, field, payload());
  assert.equal(accepted.kind, "accepted");
  assert.deepEqual(
    [accepted.expense.businessId, accepted.expense.fieldId, accepted.expense.actorUserId, accepted.expense.actorMembershipId],
    [business, field, owner, ownerMembership],
  );
  for (const identity of [workerIdentity, advisorIdentity, noScopeIdentity]) {
    await assert.rejects(repository().create(identity, field, payload()),
      (error: unknown) => error instanceof ApiError && error.getStatus() === 403 && error.presentation.code === "FORBIDDEN");
  }
  await assert.rejects(repository().create(ownerIdentity, foreignField, payload()),
    (error: unknown) => error instanceof ApiError && error.getStatus() === 404 && error.presentation.code === "NOT_FOUND");
  assert.equal(await prisma.expense.count({ where: { businessId: foreignBusiness } }), 0);
});

test("rejects future dates against Business-local today and accepts its current date across UTC midnight", async () => {
  const currentBusinessDate = await repository().create(ownerIdentity, field, payload(randomUUID(), "2026-10-17"));
  assert.equal(currentBusinessDate.expense.expenseDate, "2026-10-17");
  await assert.rejects(repository().create(ownerIdentity, field, payload(randomUUID(), "2026-10-18")),
    (error: unknown) => error instanceof ApiError && error.getStatus() === 400);
});

test("membership revocation prevents a later acceptance or replay", async () => {
  const request = payload();
  await prisma.membership.update({ where: { id: ownerMembership }, data: { status: "REVOKED" } });
  try {
    await assert.rejects(repository().create(ownerIdentity, field, request),
      (error: unknown) => error instanceof ApiError && error.getStatus() === 403);
    assert.equal(await prisma.expense.count({ where: { businessId: business, id: request.expenseId } }), 0);
  } finally { await prisma.membership.update({ where: { id: ownerMembership }, data: { status: "ACTIVE" } }); }
});
