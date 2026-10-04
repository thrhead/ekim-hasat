import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../src/generated/prisma/client.js";
import { FieldUpdateRepository } from "../../src/fields/fields-update.repository.js";
import { FieldUpdateService } from "../../src/fields/fields-update.service.js";
import { FieldCommandError } from "../../src/fields/fields-command.error.js";
import type { RegionResolverPort } from "../../src/regions/region-resolver.port.js";
import { assertDisposableDatabaseUrl } from "../support/disposable-database.js";

const databaseUrl = process.env.DATABASE_URL;
assertDisposableDatabaseUrl(databaseUrl);
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const run = randomUUID();
const businessId = randomUUID(), otherBusinessId = randomUUID();
const userId = randomUUID(), otherUserId = randomUUID();
const fieldId = randomUUID(), legacyFieldId = randomUUID(), foreignFieldId = randomUUID(), seasonId = randomUUID(), cropId = randomUUID();
const identity = { provider: "fields-update-test", subject: run };
const service = new FieldUpdateService(new FieldUpdateRepository(prisma));
const update = (version: number, body: unknown, field = fieldId) => service.update(identity, field, version, body);
const polygonA = { type: "POLYGON", polygon: { type: "Polygon", coordinates: [[[29, 41], [29.01, 41], [29.01, 41.01], [29, 41.01], [29, 41]]] } };
const polygonB = { type: "POLYGON", polygon: { type: "Polygon", coordinates: [[[29.02, 41], [29.03, 41], [29.03, 41.01], [29.02, 41.01], [29.02, 41]]] } };

before(async () => {
  await prisma.$connect();
  const target = await prisma.$queryRaw<Array<{ database: string; postgis: boolean }>>`
    SELECT current_database() AS database, EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'postgis') AS postgis`;
  assert.equal(target[0]?.database, "ekim_hasat_test", "fixture writes require the disposable test database");
  assert.equal(target[0]?.postgis, true, "PostGIS must be enabled before Field geometry fixtures");
  await prisma.business.createMany({ data: [{ id: businessId }, { id: otherBusinessId }] });
  await prisma.applicationUser.createMany({ data: [
    { id: userId, authProvider: identity.provider, authSubject: identity.subject, defaultBusinessId: businessId },
    { id: otherUserId, authProvider: identity.provider, authSubject: `${run}-other`, defaultBusinessId: otherBusinessId },
  ] });
  await prisma.membership.createMany({ data: [
    { userId, businessId, role: "OWNER", status: "ACTIVE" },
    { userId: otherUserId, businessId: otherBusinessId, role: "OWNER", status: "ACTIVE" },
  ] });
  await prisma.$executeRaw`INSERT INTO fields (id,business_id,name,representative_point) VALUES
    (${fieldId}::uuid,${businessId}::uuid,'Update fixture',ST_SetSRID(ST_MakePoint(29,41),4326)),
    (${legacyFieldId}::uuid,${businessId}::uuid,'Legacy update fixture',ST_SetSRID(ST_MakePoint(28,40),4326)),
    (${foreignFieldId}::uuid,${otherBusinessId}::uuid,'Foreign fixture',ST_SetSRID(ST_MakePoint(30,42),4326))`;
  await prisma.cropDefinitionVersion.create({ data: { id: cropId, cropKey: `update-${run}`, version: "1", displayName: "Update fixture crop" } });
  await prisma.season.create({ data: {
    id: seasonId, businessId, fieldId, cropKey: `update-${run}`, cropDefinitionVersionId: cropId,
    actualPlantingDate: new Date("2026-09-01T00:00:00.000Z"),
    status: "ACTIVE", version: 2, activatedAt: new Date("2026-09-02T00:00:00.000Z"),
    plan: { create: { source: "MANUAL", sourceSnapshot: { source: "MANUAL" }, status: "APPROVED" } },
  } });
  await prisma.seasonContextSnapshot.create({ data: {
    seasonId, cropSnapshot: { immutable: "before" }, source: "MANUAL", activatedAt: new Date("2026-09-02T00:00:00.000Z"),
    businessTimezone: "Europe/Istanbul", activatedLocalDate: new Date("2026-09-02T00:00:00.000Z"),
  } });
});

after(async () => {
  // Activation snapshots are immutable and rejected by the database on DELETE;
  // retain this isolated UUID fixture and its parent rows together.
  await prisma.$disconnect();
});

test("updates use compare-and-swap, isolate Business scope, append location history, and preserve season snapshots", async () => {
  await assert.rejects(() => update(1, { name: "Should not disclose" }, foreignFieldId), (error: unknown) => error instanceof Error);
  await assert.rejects(() => update(2, { name: "Stale" }), (error: unknown) => {
    assert.ok(error instanceof FieldCommandError);
    assert.equal(error.presentation.code, "STALE_VERSION");
    return true;
  });

  const concurrent = await Promise.allSettled([
    update(1, { name: "First concurrent edit" }),
    update(1, { name: "Second concurrent edit" }),
  ]);
  assert.equal(concurrent.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(concurrent.filter((result) => result.status === "rejected" && result.reason instanceof FieldCommandError
    && result.reason.presentation.code === "STALE_VERSION").length, 1);

  const current = await prisma.field.findUniqueOrThrow({ where: { id: fieldId } });
  const polygon = await update(current.version, { location: polygonA });
  assert.equal(polygon.field.version, current.version + 1);
  let persisted = await prisma.field.findUniqueOrThrow({ where: { id: fieldId } });
  assert.ok(persisted.currentBoundaryVersionId);
  let boundaries = await prisma.fieldBoundaryVersion.findMany({ where: { fieldId }, orderBy: { version: "asc" } });
  assert.equal(boundaries.length, 1);
  assert.equal(boundaries[0]?.version, 1);

  const secondPolygon = await update(persisted.version, { location: polygonB });
  assert.ok(secondPolygon.field.hasCurrentBoundary);
  persisted = await prisma.field.findUniqueOrThrow({ where: { id: fieldId } });
  boundaries = await prisma.fieldBoundaryVersion.findMany({ where: { fieldId }, orderBy: { version: "asc" } });
  assert.equal(boundaries.length, 2);
  assert.deepEqual(boundaries.map((row) => row.version), [1, 2]);
  assert.equal(persisted.currentBoundaryVersionId, boundaries[1]?.id);

  const pointOnly = await update(persisted.version, { location: { type: "POINT", point: { type: "Point", coordinates: [31, 43] } } });
  assert.equal(pointOnly.field.hasCurrentBoundary, false);
  persisted = await prisma.field.findUniqueOrThrow({ where: { id: fieldId } });
  assert.equal(persisted.currentBoundaryVersionId, null);
  assert.equal(await prisma.fieldBoundaryVersion.count({ where: { fieldId } }), 2);

  const backToPolygon = await update(persisted.version, { location: polygonA, agriculturalRegionOverride: { code: "MANUAL", label: "Farmer choice" } });
  assert.equal(backToPolygon.field.regionContext.agriculturalRegionOverride?.code, "MANUAL");
  persisted = await prisma.field.findUniqueOrThrow({ where: { id: fieldId } });
  boundaries = await prisma.fieldBoundaryVersion.findMany({ where: { fieldId }, orderBy: { version: "asc" } });
  assert.deepEqual(boundaries.map((row) => row.version), [1, 2, 3]);
  assert.equal(persisted.currentBoundaryVersionId, boundaries[2]?.id);
  await update(persisted.version, { agriculturalRegionOverride: null });

  const snapshot = await prisma.seasonContextSnapshot.findUniqueOrThrow({ where: { seasonId } });
  assert.deepEqual(snapshot.cropSnapshot, { immutable: "before" });
  assert.equal(snapshot.fieldBoundaryVersionId, null);
  assert.equal(await prisma.seasonContextSnapshot.count({ where: { seasonId } }), 1);
});

test("name-only edits preserve a legacy Field's null region-context pointer", async () => {
  const result = await update(1, { name: "Legacy renamed" }, legacyFieldId);
  assert.equal(result.field.name, "Legacy renamed");
  const current = await prisma.field.findUniqueOrThrow({ where: { id: legacyFieldId } });
  assert.equal(current.currentRegionContextVersionId, null);
  assert.equal(await prisma.fieldRegionContextVersion.count({ where: { fieldId: legacyFieldId } }), 0);
});

test("a valid location update commits even when the optional region source fails", async () => {
  const failingResolver: RegionResolverPort = {
    resolveAdministrative: async () => { throw new Error("provider unavailable"); },
    resolveAgricultural: async () => { throw new Error("provider unavailable"); },
  };
  const current = await prisma.field.findUniqueOrThrow({ where: { id: legacyFieldId } });
  const service = new FieldUpdateService(new FieldUpdateRepository(prisma, failingResolver));
  const result = await service.update(identity, legacyFieldId, current.version, {
    location: { type: "POINT", point: { type: "Point", coordinates: [30, 42] } },
  });
  assert.equal(result.field.version, current.version + 1);
  assert.equal(result.field.regionContext.administrativeLocation.state, "UNRESOLVED");
  assert.equal(result.field.regionContext.agriculturalRegion.state, "UNRESOLVED");
});
