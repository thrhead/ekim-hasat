import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after, before } from "node:test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../src/generated/prisma/client.js";
import { FieldUpdateRepository } from "../../src/fields/fields-update.repository.js";
import { FieldUpdateService } from "../../src/fields/fields-update.service.js";
import { WeatherRepository } from "../../src/weather/weather.repository.js";
import { assertDisposableDatabaseUrl } from "../support/disposable-database.js";

const databaseUrl = process.env.DATABASE_URL;
assertDisposableDatabaseUrl(databaseUrl);
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });
const run = randomUUID();
const businessId = randomUUID(), userId = randomUUID(), fieldId = randomUUID(), snapshotId = randomUUID();
const identity = { provider: "fields-weather-location-test", subject: run };
const update = new FieldUpdateService(new FieldUpdateRepository(prisma));
const weather = new WeatherRepository(prisma, { now: () => new Date("2026-10-01T06:00:00.000Z") });

before(async () => {
  await prisma.$connect();
  const target = await prisma.$queryRaw<Array<{ database: string; postgis: boolean }>>`
    SELECT current_database() AS database, EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'postgis') AS postgis`;
  assert.equal(target[0]?.database, "ekim_hasat_test", "fixture writes require the disposable test database");
  assert.equal(target[0]?.postgis, true, "PostGIS must be enabled for representative-point behavior");
  await prisma.business.create({ data: { id: businessId, timezone: "Europe/Istanbul" } });
  await prisma.applicationUser.create({ data: { id: userId, authProvider: identity.provider, authSubject: identity.subject, defaultBusinessId: businessId } });
  await prisma.membership.create({ data: { userId, businessId, role: "OWNER", status: "ACTIVE" } });
  await prisma.$executeRaw`INSERT INTO fields (id,business_id,name,representative_point) VALUES (${fieldId}::uuid,${businessId}::uuid,'Weather location fixture',ST_SetSRID(ST_MakePoint(29,41),4326))`;
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`INSERT INTO weather_snapshots (
    id,business_id,field_id,representative_point,location_fingerprint,business_timezone,
    coverage_start,coverage_end,forecast_local_dates,fetched_at,refresh_started_at,
    quality_status,observed_at,condition_code,temperature_c
  ) VALUES (
    ${snapshotId}::uuid,${businessId}::uuid,${fieldId}::uuid,ST_SetSRID(ST_MakePoint(29,41),4326),'29.000000,41.000000','Europe/Istanbul',
    '2026-10-01T00:00:00Z','2026-10-04T00:00:00Z',ARRAY['2026-10-01','2026-10-02','2026-10-03'],'2026-10-01T06:00:00Z','2026-10-01T05:55:00Z',
    'ACCEPTED','2026-10-01T05:30:00Z','CLEAR',18
    )`;
    for (const day of ["2026-10-01", "2026-10-02", "2026-10-03"]) {
      await tx.$executeRaw`INSERT INTO weather_daily_forecasts (id,snapshot_id,local_date,condition_code,temperature_high_c,temperature_low_c,precipitation_chance_percent,wind_speed_kph)
        VALUES (${randomUUID()}::uuid,${snapshotId}::uuid,${day}::date,'CLEAR',22,12,10,8)`;
    }
  });
});

after(async () => {
  // This fixture appends Field history; keep its isolated UUID rows together.
  await prisma.$disconnect();
});

test("a changed representative point invalidates old weather, while a Polygon edit with the same point preserves it", async () => {
  const initial = await prisma.field.findUniqueOrThrow({ where: { id: fieldId } });
  assert.equal((await weather.readFieldWeather(identity, fieldId)).status, "CURRENT");

  const polygon = { type: "Polygon", coordinates: [[[28, 40], [30, 40], [30, 42], [28, 42], [28, 40]]] };
  await update.update(identity, fieldId, initial.version, { location: { type: "POLYGON", polygon } });
  const afterPolygon = await weather.readFieldWeather(identity, fieldId);
  assert.equal(afterPolygon.status, "CURRENT");
  assert.equal(afterPolygon.current?.temperatureC, 18);

  const beforeMove = await prisma.field.findUniqueOrThrow({ where: { id: fieldId } });
  await update.update(identity, fieldId, beforeMove.version, {
    location: { type: "POINT", point: { type: "Point", coordinates: [30, 42] } },
  });
  const moved = await weather.readFieldWeather(identity, fieldId);
  assert.equal(moved.status, "UNAVAILABLE");
  assert.equal(moved.current, null);
});
