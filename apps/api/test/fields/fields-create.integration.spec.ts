import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../src/generated/prisma/client.js";
import { FieldCreateRepository } from "../../src/fields/fields-create.repository.js";
import { FieldCreateService } from "../../src/fields/fields-create.service.js";
import { FieldCommandError } from "../../src/fields/fields-command.error.js";
import { BusinessScopeForbiddenError } from "../../src/authorization/membership-scope.service.js";
import type { RegionResolverPort } from "../../src/regions/region-resolver.port.js";
import { fieldResolutionLocationKey } from "@ekim-hasat/domain/fields/field-region-context";
import type { PointLocation, PolygonLocation } from "@ekim-hasat/domain/fields/field-location";
import { assertDisposableDatabaseUrl } from "../support/disposable-database.js";

const databaseUrl = process.env.DATABASE_URL;
assertDisposableDatabaseUrl(databaseUrl);
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const run = randomUUID();
const businessId = randomUUID(), otherBusinessId = randomUUID();
const userId = randomUUID(), otherUserId = randomUUID();
const identity = { provider: "fields-create-test", subject: run };
const unscopedIdentity = { provider: identity.provider, subject: `${run}-unscoped` };
const point = { type: "POINT" as const, point: { type: "Point" as const, coordinates: [29.02, 41.01] as [number, number] } };
const polygon = { type: "POLYGON" as const, polygon: { type: "Polygon" as const, coordinates: [[[29, 41], [29.01, 41], [29.01, 41.01], [29, 41.01], [29, 41]]] as [number, number][][][] } };
const repository = new FieldCreateRepository(prisma);
const service = new FieldCreateService(repository);
const create = (body: unknown, key = randomUUID(), who = identity) => service.create(who, body, key);

before(async () => {
  await prisma.$connect();
  const target = await prisma.$queryRaw<Array<{ database: string; postgis: boolean }>>`
    SELECT current_database() AS database, EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'postgis') AS postgis`;
  assert.equal(target[0]?.database, "ekim_hasat_test", "fixture writes require the disposable test database");
  assert.equal(target[0]?.postgis, true, "PostGIS must be enabled before Field geometry fixtures");
  await prisma.business.createMany({ data: [{ id: businessId }, { id: otherBusinessId }] });
  await prisma.applicationUser.createMany({ data: [
    { id: userId, authProvider: identity.provider, authSubject: identity.subject, defaultBusinessId: businessId },
    { id: otherUserId, authProvider: "fields-create-test", authSubject: `${run}-other`, defaultBusinessId: otherBusinessId },
  ] });
  await prisma.membership.createMany({ data: [
    { userId, businessId, role: "OWNER", status: "ACTIVE" },
    { userId, businessId: otherBusinessId, role: "OWNER", status: "ACTIVE" },
    { userId: otherUserId, businessId: otherBusinessId, role: "OWNER", status: "ACTIVE" },
  ] });
});

after(async () => {
  // Field boundary and region history are immutable; retain isolated UUID fixtures.
  await prisma.$disconnect();
});

test("create authorizes the current Business and persists a point-only Field without boundary history", async () => {
  const result = await create({ location: point });
  assert.equal(result.kind, "created");
  assert.equal(result.field.name, "Tarla 1");
  assert.equal(result.field.hasCurrentBoundary, false);
  assert.equal(result.field.boundary, null);
  const row = await prisma.field.findUniqueOrThrow({ where: { id: result.field.id } });
  assert.equal(row.businessId, businessId);
  assert.equal(row.currentBoundaryVersionId, null);
  const geometry = await prisma.$queryRaw<Array<{ point: string }>>`SELECT ST_AsText(representative_point) AS point FROM fields WHERE id=${result.field.id}::uuid`;
  assert.equal(geometry[0]?.point, "POINT(29.02 41.01)");
  await assert.rejects(() => create({ businessId: otherBusinessId, location: point }), (error: unknown) => {
    assert.ok(error instanceof FieldCommandError);
    assert.equal(error.presentation.code, "INVALID_REQUEST");
    return true;
  });
  await assert.rejects(() => create({ location: point }, randomUUID(), unscopedIdentity), (error: unknown) => error instanceof BusinessScopeForbiddenError);
});

test("first-available names serialize per Business while farmer-entered duplicate names remain allowed", async () => {
  const generated = await Promise.all(Array.from({ length: 5 }, () => create({ location: point })));
  assert.deepEqual(generated.map((result) => result.field.name).sort(), ["Tarla 2", "Tarla 3", "Tarla 4", "Tarla 5", "Tarla 6"]);
  const [first, second] = await Promise.all([
    create({ name: "Zeytinlik", location: point }), create({ name: "Zeytinlik", location: point }),
  ]);
  assert.equal(first.field.name, "Zeytinlik");
  assert.equal(second.field.name, "Zeytinlik");
  assert.notEqual(first.field.id, second.field.id);
});

test("Polygon create stores an unverified boundary and server-derived representative point", async () => {
  const result = await create({ location: polygon });
  assert.equal(result.field.hasCurrentBoundary, true);
  const row = await prisma.field.findUniqueOrThrow({ where: { id: result.field.id } });
  assert.ok(row.currentBoundaryVersionId);
  const boundary = await prisma.fieldBoundaryVersion.findUniqueOrThrow({ where: { id: row.currentBoundaryVersionId } });
  assert.equal(boundary.verificationStatus, "UNVERIFIED");
  assert.equal(result.field.representativePoint.type, "Point");
  const context = await prisma.fieldRegionContextVersion.findUniqueOrThrow({ where: { id: row.currentRegionContextVersionId! } });
  assert.equal(context.resolutionLocationKey, fieldResolutionLocationKey({
    representativePoint: result.field.representativePoint as unknown as PointLocation,
    polygon: polygon.polygon as unknown as PolygonLocation,
  }));
  assert.equal(result.field.regionContext.administrativeLocation.state, "UNRESOLVED");
  assert.equal(result.field.regionContext.agriculturalRegion.state, "UNRESOLVED");
});

test("valid Field creation remains successful when both optional region lookups fail", async () => {
  const failingResolver: RegionResolverPort = {
    resolveAdministrative: async () => { throw new Error("provider unavailable"); },
    resolveAgricultural: async () => { throw new Error("provider unavailable"); },
  };
  const resilient = new FieldCreateService(new FieldCreateRepository(prisma, failingResolver));
  const result = await resilient.create(identity, { location: point }, `resolver-failure-${run}`);
  assert.equal(result.kind, "created");
  assert.equal(result.field.regionContext.administrativeLocation.state, "UNRESOLVED");
  assert.equal(result.field.regionContext.agriculturalRegion.state, "UNRESOLVED");
});

test("idempotent create replays one canonical result and rejects changed payload or context", async () => {
  const key = `same-${run}`;
  const initial = await create({ location: point }, key);
  const replay = await create({ location: point }, key);
  assert.equal(replay.kind, "replayed");
  assert.deepEqual(replay.field, initial.field);
  await assert.rejects(() => create({ name: "Changed", location: point }, key), (error: unknown) => {
    assert.ok(error instanceof FieldCommandError);
    assert.equal(error.presentation.code, "IDEMPOTENCY_KEY_REUSED");
    return true;
  });
  await prisma.applicationUser.update({ where: { id: userId }, data: { defaultBusinessId: otherBusinessId } });
  try {
    await assert.rejects(() => create({ location: point }, key), (error: unknown) => {
      assert.ok(error instanceof FieldCommandError);
      assert.equal(error.presentation.code, "IDEMPOTENCY_KEY_REUSED");
      return true;
    });
  } finally {
    await prisma.applicationUser.update({ where: { id: userId }, data: { defaultBusinessId: businessId } });
  }
  assert.equal(await prisma.businessCommandIdempotencyRecord.count({ where: { businessId, command: "CREATE_FIELD", key } }), 1);
});

test("concurrent same-context key submissions persist one Field and one canonical result", async () => {
  const key = `concurrent-${run}`;
  const outcomes = await Promise.all([create({ location: point }, key), create({ location: point }, key)]);
  assert.deepEqual(new Set(outcomes.map((outcome) => outcome.kind)), new Set(["created", "replayed"]));
  assert.equal(outcomes[0]?.field.id, outcomes[1]?.field.id);
  assert.equal(await prisma.field.count({ where: { id: outcomes[0]!.field.id, businessId } }), 1);
  assert.equal(await prisma.businessCommandIdempotencyRecord.count({ where: { businessId, command: "CREATE_FIELD", key } }), 1);
});

test("revoked membership prevents a new Field command", async () => {
  await prisma.membership.update({ where: { businessId_userId: { businessId, userId } }, data: { status: "REVOKED" } });
  try {
    await assert.rejects(() => create({ location: point }), (error: unknown) => error instanceof BusinessScopeForbiddenError);
  } finally {
    await prisma.membership.update({ where: { businessId_userId: { businessId, userId } }, data: { status: "ACTIVE" } });
  }
});
