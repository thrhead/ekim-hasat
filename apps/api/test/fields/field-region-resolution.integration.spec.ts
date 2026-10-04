import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../src/generated/prisma/client.js";
import { MembershipScopeService } from "../../src/authorization/membership-scope.service.js";
import { PrismaExistingFieldRegionRepository, ResolveExistingFieldRegionService } from "../../src/fields/resolve-existing-field-region.service.js";
import type { RegionResolverPort } from "../../src/regions/region-resolver.port.js";
import { RegionResolutionService } from "../../src/regions/region-resolution.service.js";
import { assertDisposableDatabaseUrl } from "../support/disposable-database.js";

const databaseUrl = process.env.DATABASE_URL;
assertDisposableDatabaseUrl(databaseUrl);
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const run = randomUUID();
const businessId = randomUUID(), otherBusinessId = randomUUID();
const userId = randomUUID(), otherUserId = randomUUID();
const fieldId = randomUUID(), legacyFieldId = randomUUID(), staleFieldId = randomUUID(), foreignFieldId = randomUUID();
const identity = { provider: "field-region-test", subject: run };
const otherIdentity = { provider: identity.provider, subject: `${run}-other` };
const candidate = (code: string, label: string, sourceId: string, dataVersion: string) => ({
  state: "RESOLVED" as const,
  candidate: { code, label, sourceId, confidence: 0.91, dataVersion, resolvedAt: "2026-09-20T10:00:00.000Z" },
});
const resolver: RegionResolverPort = {
  resolveAdministrative: async () => candidate("ADM-1", "Administrative area", "admin-source", "admin-v1"),
  resolveAgricultural: async () => candidate("AG-1", "Agricultural area", "ag-source", "ag-v1"),
};
const service = (source: RegionResolverPort = resolver) => new ResolveExistingFieldRegionService(
  new PrismaExistingFieldRegionRepository(prisma, new MembershipScopeService(prisma)), source,
);

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
    (${fieldId}::uuid,${businessId}::uuid,'Resolved fixture',ST_SetSRID(ST_MakePoint(29.02,41.01),4326)),
    (${legacyFieldId}::uuid,${businessId}::uuid,'Legacy fixture',ST_SetSRID(ST_MakePoint(29.03,41.02),4326)),
    (${staleFieldId}::uuid,${businessId}::uuid,'Stale fixture',ST_SetSRID(ST_MakePoint(29.04,41.03),4326)),
    (${foreignFieldId}::uuid,${otherBusinessId}::uuid,'Foreign fixture',ST_SetSRID(ST_MakePoint(29.05,41.04),4326))`;
  await prisma.fieldRegionContextVersion.create({ data: {
    fieldId, version: 1, resolutionLocationKey: `fixture-${run}`, administrativeState: "UNRESOLVED",
    agriculturalState: "UNRESOLVED", overrideCode: "FARMER-REGION", overrideLabel: "Farmer region",
  } });
  const version = await prisma.fieldRegionContextVersion.findFirstOrThrow({ where: { fieldId } });
  await prisma.field.update({ where: { id: fieldId }, data: { currentRegionContextVersionId: version.id } });
});

after(async () => {
  // Region context history is immutable; retain isolated UUID fixtures.
  await prisma.$disconnect();
});

test("one authorized Field resolution uses its current PostGIS point, preserves override, and replays idempotently", async () => {
  const operation = service();
  assert.deepEqual(await operation.execute(identity, foreignFieldId), { kind: "NOT_FOUND" });
  assert.deepEqual(await operation.execute(identity, fieldId), { kind: "UPDATED" });
  const current = await prisma.field.findUniqueOrThrow({ where: { id: fieldId }, include: { currentRegionContextVersion: true } });
  assert.ok(current.currentRegionContextVersion);
  assert.equal(current.currentRegionContextVersion.version, 2);
  assert.equal(current.currentRegionContextVersion.administrativeCode, "ADM-1");
  assert.equal(current.currentRegionContextVersion.agriculturalCode, "AG-1");
  assert.equal(current.currentRegionContextVersion.overrideCode, "FARMER-REGION");
  assert.equal(current.currentRegionContextVersion.overrideLabel, "Farmer region");
  const versionCount = await prisma.fieldRegionContextVersion.count({ where: { fieldId } });
  assert.deepEqual(await operation.execute(identity, fieldId), { kind: "UNCHANGED" });
  assert.equal(await prisma.fieldRegionContextVersion.count({ where: { fieldId } }), versionCount);
  const point = await prisma.$queryRaw<Array<{ longitude: number; latitude: number }>>`
    SELECT ST_X(representative_point) AS longitude, ST_Y(representative_point) AS latitude FROM fields WHERE id=${fieldId}::uuid`;
  assert.deepEqual(point[0], { longitude: 29.02, latitude: 41.01 });
});

test("legacy null pointers remain unresolved when no qualified source is available", async () => {
  const noSource = service(new RegionResolutionService());
  assert.deepEqual(await noSource.execute(identity, legacyFieldId), { kind: "UNCHANGED" });
  const row = await prisma.field.findUniqueOrThrow({ where: { id: legacyFieldId } });
  assert.equal(row.currentRegionContextVersionId, null);
  assert.equal(await prisma.fieldRegionContextVersion.count({ where: { fieldId: legacyFieldId } }), 0);
});

test("a result is discarded when the representative point changes while the source is resolving", async () => {
  let start!: () => void;
  let release!: () => void;
  const started = new Promise<void>((resolve) => { start = resolve; });
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const slow: RegionResolverPort = {
    resolveAdministrative: async () => { start(); await blocked; return candidate("OLD", "Old point", "slow-source", "v1"); },
    resolveAgricultural: async () => candidate("AG-OLD", "Old region", "ag-source", "v1"),
  };
  const pending = service(slow).execute(identity, staleFieldId);
  await started;
  await prisma.$executeRaw`UPDATE fields SET representative_point=ST_SetSRID(ST_MakePoint(30,42),4326) WHERE id=${staleFieldId}::uuid`;
  release();
  assert.deepEqual(await pending, { kind: "STALE" });
  assert.equal(await prisma.fieldRegionContextVersion.count({ where: { fieldId: staleFieldId } }), 0);
});
