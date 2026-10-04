import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../src/generated/prisma/client.js";
import { MembershipScopeService } from "../../src/authorization/membership-scope.service.js";
import { FieldsReadRepository } from "../../src/fields/fields-read.repository.js";
import { FieldsReadService } from "../../src/fields/fields-read.service.js";
import { createFieldsReadApp } from "../../src/fields/fields-read.controller.js";
import { assertDisposableDatabaseUrl } from "../support/disposable-database.js";

const databaseUrl = process.env.DATABASE_URL;
assertDisposableDatabaseUrl(databaseUrl);
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const run = randomUUID();
const businessId = randomUUID(), otherBusinessId = randomUUID();
const userId = randomUUID(), otherUserId = randomUUID();
const identity = { provider: "fields-read-test", subject: run };
const otherIdentity = { provider: identity.provider, subject: `${run}-other` };
const ids = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
const service = new FieldsReadService(new MembershipScopeService(prisma), new FieldsReadRepository(prisma));
const unresolved = { state: "UNRESOLVED", code: null, label: null, sourceId: null, confidence: null, dataVersion: null, resolvedAt: null };

async function app() {
  const server = await createFieldsReadApp({
    verify: async (token) => ["valid-token", "top-secret-token"].includes(token) ? identity : null,
    readPage: (_identity, query) => service.list(_identity, query),
    readField: (_identity, fieldId) => service.read(_identity, fieldId),
  });
  await server.init();
  await server.getHttpAdapter().getInstance().ready();
  return server;
}

before(async () => {
  await prisma.$connect();
  const target = await prisma.$queryRaw<Array<{ database: string; postgis: boolean }>>`
    SELECT current_database() AS database, EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'postgis') AS postgis`;
  assert.equal(target[0]?.database, "ekim_hasat_test", "fixture writes require the disposable test database");
  assert.equal(target[0]?.postgis, true, "PostGIS must be enabled before Field geometry fixtures");
  await prisma.business.createMany({ data: [{ id: businessId }, { id: otherBusinessId }] });
  await prisma.applicationUser.createMany({ data: [
    { id: userId, authProvider: identity.provider, authSubject: identity.subject, defaultBusinessId: businessId },
    { id: otherUserId, authProvider: otherIdentity.provider, authSubject: otherIdentity.subject, defaultBusinessId: otherBusinessId },
  ] });
  await prisma.membership.createMany({ data: [
    { userId, businessId, role: "OWNER", status: "ACTIVE" },
    { userId: otherUserId, businessId: otherBusinessId, role: "OWNER", status: "ACTIVE" },
  ] });
  await prisma.$executeRaw`INSERT INTO fields (id,business_id,name,representative_point) VALUES
    (${ids[0]}::uuid,${businessId}::uuid,'Alpha',ST_SetSRID(ST_MakePoint(29,41),4326)),
    (${ids[1]}::uuid,${businessId}::uuid,'Same',ST_SetSRID(ST_MakePoint(29.1,41),4326)),
    (${ids[2]}::uuid,${businessId}::uuid,'Same',ST_SetSRID(ST_MakePoint(29.2,41),4326)),
    (${ids[3]}::uuid,${otherBusinessId}::uuid,'Same',ST_SetSRID(ST_MakePoint(29.3,41),4326))`;
});

after(async () => {
  try {
    await prisma.field.deleteMany({ where: { id: { in: ids } } });
    await prisma.membership.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
    await prisma.applicationUser.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
    await prisma.business.deleteMany({ where: { id: { in: [businessId, otherBusinessId] } } });
  } finally { await prisma.$disconnect(); }
});

test("authorized keyset pages traverse duplicate names without duplicates or omissions", async () => {
  const server = await app();
  try {
    const first = await server.inject({ method: "GET", url: "/v1/fields?limit=2", headers: { authorization: "Bearer valid-token" } });
    assert.equal(first.statusCode, 200);
    assert.deepEqual(first.json().items.map((field: { name: string; id: string }) => field.name), ["Alpha", "Same"]);
    assert.ok(first.json().nextCursor);
    const second = await server.inject({ method: "GET", url: `/v1/fields?limit=2&cursor=${encodeURIComponent(first.json().nextCursor)}`, headers: { authorization: "Bearer valid-token" } });
    assert.equal(second.statusCode, 200);
    const seen = [...first.json().items, ...second.json().items].map((field: { id: string }) => field.id);
    assert.deepEqual(seen, [ids[0]!, ...ids.slice(1, 3).sort((a, b) => a.localeCompare(b))]);
    assert.equal(new Set(seen).size, 3);
    assert.equal(second.json().items.length, 1);
    assert.equal(second.json().nextCursor, null);
  } finally { await server.close(); }
});

test("detail is Business-scoped and a legacy null region pointer projects explicit unresolved state", async () => {
  const server = await app();
  try {
    const detail = await server.inject({ method: "GET", url: `/v1/fields/${ids[0]}`, headers: { authorization: "Bearer valid-token" } });
    assert.equal(detail.statusCode, 200);
    assert.deepEqual(detail.json().regionContext, {
      administrativeLocation: unresolved,
      agriculturalRegion: unresolved,
      agriculturalRegionOverride: null,
    });
    for (const id of [ids[3], randomUUID()]) {
      const denied = await server.inject({ method: "GET", url: `/v1/fields/${id}`, headers: { authorization: "Bearer valid-token" } });
      assert.equal(denied.statusCode, 404);
      assert.equal(denied.json().error.code, "NOT_FOUND");
      assert.ok(denied.json().error.requestId, "privacy-safe denial includes a correlation ID");
      assert.doesNotMatch(denied.body, new RegExp(`${otherBusinessId}|29\\.3|${identity.subject}`));
    }
  } finally { await server.close(); }
});

test("revoked membership is denied on every request without leaking credentials or location", async () => {
  const server = await app();
  try {
    await prisma.membership.update({ where: { businessId_userId: { businessId, userId } }, data: { status: "REVOKED" } });
    const denied = await server.inject({ method: "GET", url: "/v1/fields", headers: { authorization: "Bearer top-secret-token" } });
    assert.equal(denied.statusCode, 403);
    assert.equal(denied.json().error.code, "FORBIDDEN");
    assert.ok(denied.json().error.requestId);
    assert.doesNotMatch(denied.body, /top-secret-token|29\\.0|41\\.0|membership|business/i);
  } finally {
    await prisma.membership.update({ where: { businessId_userId: { businessId, userId } }, data: { status: "ACTIVE" } });
    await server.close();
  }
});
