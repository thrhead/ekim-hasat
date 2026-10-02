import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after, before } from "node:test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../src/generated/prisma/client.js";
import { WeatherRepository } from "../../src/weather/weather.repository.js";
import { assertDisposableDatabaseUrl } from "../support/disposable-database.js";

const databaseUrl = process.env.DATABASE_URL;
assertDisposableDatabaseUrl(databaseUrl);
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }), log: [{ emit: "event", level: "query" }] });
const userId = randomUUID();
const businessId = randomUUID();
const otherBusinessId = randomUUID();
const fieldIds = [randomUUID(), randomUUID(), randomUUID()];
const otherFieldId = randomUUID();
const subject = { provider: "weather-test", subject: `weather-${userId}` };
const identity = { provider: subject.provider, subject: subject.subject };
const repository = new WeatherRepository(prisma, { now: () => new Date("2026-10-01T06:00:00.000Z") });
const weatherQueries: string[] = [];
prisma.$on("query", (event) => weatherQueries.push(event.query));

before(async () => {
  await prisma.$executeRaw`INSERT INTO businesses (id, timezone) VALUES (${businessId}::uuid, 'Europe/Istanbul'), (${otherBusinessId}::uuid, 'UTC')`;
  await prisma.$executeRaw`INSERT INTO application_users (id, auth_provider, auth_subject, default_business_id) VALUES (${userId}::uuid, ${subject.provider}, ${subject.subject}, ${businessId}::uuid)`;
  await prisma.$executeRaw`INSERT INTO memberships (id, business_id, user_id, role, status) VALUES (${randomUUID()}::uuid, ${businessId}::uuid, ${userId}::uuid, 'OWNER', 'ACTIVE')`;
  for (const [index, fieldId] of fieldIds.entries()) await prisma.$executeRaw`INSERT INTO fields (id, business_id, name, representative_point) VALUES (${fieldId}::uuid, ${businessId}::uuid, ${["Alpha", "Bravo", "Charlie"][index]!}, ST_SetSRID(ST_MakePoint(29 + ${index}, 41), 4326))`;
  await prisma.$executeRaw`INSERT INTO fields (id, business_id, name, representative_point) VALUES (${otherFieldId}::uuid, ${otherBusinessId}::uuid, 'Outside', ST_SetSRID(ST_MakePoint(35, 39), 4326))`;
});
after(async () => {
  await prisma.$executeRaw`DELETE FROM weather_snapshots WHERE field_id = ANY(${fieldIds}::uuid[])`;
  await prisma.$executeRaw`DELETE FROM fields WHERE id = ANY(${[...fieldIds, otherFieldId]}::uuid[])`;
  await prisma.$executeRaw`DELETE FROM memberships WHERE user_id = ${userId}::uuid`;
  await prisma.$executeRaw`DELETE FROM application_users WHERE id = ${userId}::uuid`;
  await prisma.$executeRaw`DELETE FROM businesses WHERE id = ANY(${[businessId, otherBusinessId]}::uuid[])`;
  await prisma.$disconnect();
});

test("authorized weather overview includes no-task fields with minimum identity and stable bounded cursor pages", async () => {
  const first = await repository.readWeatherOverview(identity, { limit: 2 });
  assert.deepEqual(first.items.map((item) => item.fieldName), ["Alpha", "Bravo"]);
  assert.ok(first.nextCursor);
  assert.deepEqual(Object.keys(first.items[0]!).sort(), ["businessTimezone", "coverage", "current", "dailyForecasts", "fetchedAt", "fieldId", "fieldName", "status"].sort());
  assert.equal(first.items[0]?.status, "UNAVAILABLE");
  assert.equal(first.items[0]?.current, null);
  const second = await repository.readWeatherOverview(identity, { limit: 2, cursor: first.nextCursor! });
  assert.deepEqual(second.items.map((item) => item.fieldName), ["Charlie"]);
  assert.equal(second.nextCursor, null);
  assert.ok(![...first.items, ...second.items].some((item) => item.fieldId === otherFieldId));
});

test("single-field reads recheck membership and never expose cross-business fields", async () => {
  const status = (error: unknown) => error instanceof Error && "getStatus" in error ? (error as { getStatus(): number }).getStatus() : undefined;
  await assert.rejects(repository.readFieldWeather(identity, otherFieldId), (error: unknown) => status(error) === 404);
  await assert.rejects(repository.readFieldWeather(identity, randomUUID()), (error: unknown) => status(error) === 404);
  await prisma.$executeRaw`UPDATE memberships SET status = 'REVOKED' WHERE user_id = ${userId}::uuid`;
  await assert.rejects(repository.readFieldWeather(identity, fieldIds[0]!), (error: unknown) => status(error) === 403);
  await assert.rejects(repository.readWeatherOverview(identity, { limit: 50 }), (error: unknown) => status(error) === 403);
  await prisma.$executeRaw`UPDATE memberships SET status = 'ACTIVE' WHERE user_id = ${userId}::uuid`;
});

test("unusable representative points remain unavailable without weather values", async () => {
  await prisma.$executeRaw`UPDATE fields SET representative_point = ST_SetSRID(ST_MakePoint(181, 91), 4326) WHERE id = ${fieldIds[1]}::uuid`;
  const unusable = await repository.readFieldWeather(identity, fieldIds[1]!);
  assert.equal(unusable.status, "UNAVAILABLE");
  assert.equal(unusable.current, null);
  assert.deepEqual(unusable.dailyForecasts, []);
});

test("weather overview query count stays bounded as page size grows", async () => {
  const countFor = async (limit: number) => {
    weatherQueries.length = 0;
    await repository.readWeatherOverview(identity, { limit });
    return weatherQueries.length;
  };
  const oneFieldQueries = await countFor(1);
  const threeFieldQueries = await countFor(3);

  assert.ok(oneFieldQueries <= 10, `one field uses a bounded query set, got ${oneFieldQueries}`);
  assert.equal(threeFieldQueries, oneFieldQueries, "query count is independent of fields returned in the page");
});
