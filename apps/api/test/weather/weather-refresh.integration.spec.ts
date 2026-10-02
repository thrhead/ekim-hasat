import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after, before } from "node:test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../src/generated/prisma/client.js";
import { WeatherRepository } from "../../src/weather/weather.repository.js";
import { WeatherRefreshService, type WeatherRefreshTarget } from "../../src/weather/weather-refresh.service.js";
import type { WeatherProvider } from "../../src/weather/weather-provider.port.js";
import { normalizeWeatherSnapshot } from "../../src/weather/weather-normalizer.js";
import type { WeatherProviderForecast } from "../../src/weather/weather.types.js";
import { assertDisposableDatabaseUrl } from "../support/disposable-database.js";

const databaseUrl = process.env.DATABASE_URL;
assertDisposableDatabaseUrl(databaseUrl);
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });
const businessId = randomUUID();
const fieldId = randomUUID();
const batchBusinessId = "00000000-0000-4000-8000-000000000099";
const batchFieldIds = [1, 2, 3, 4].map((index) => `00000000-0000-4000-8000-${index.toString().padStart(12, "0")}`);
const now = new Date("2026-10-01T06:00:00.000Z");
const dates = ["2026-10-01", "2026-10-02", "2026-10-03"] as const;
const target: WeatherRefreshTarget = { businessId, fieldId, businessTimezone: "Europe/Istanbul", representativePoint: { longitude: 29, latitude: 41 }, requestedLocalDates: dates };
const repository = new WeatherRepository(prisma, { now: () => now });

function forecast(issuedAt: string, temperature = 18): WeatherProviderForecast {
  return { providerIssuedAt: issuedAt, current: { observedAt: "2026-10-01T05:30:00.000Z", condition: "sun", temperature, temperatureUnit: "C" },
    dailyForecasts: dates.map((localDate) => ({ localDate, condition: "sun", temperatureHigh: 23, temperatureLow: 12, temperatureUnit: "C", precipitationChance: 10, windSpeed: 8, windSpeedUnit: "km/h" })) };
}
function service(provider: WeatherProvider, outcomes: unknown[] = [], clock: () => Date = () => now) {
  return new WeatherRefreshService({ provider, now: clock, repository: {
    listEligibleRefreshTargets: async () => [target],
    markRefreshAttempted: (refreshTarget, at) => repository.markRefreshAttempted(refreshTarget, at),
    getSnapshotOrdering: (refreshTarget) => repository.getSnapshotOrdering(refreshTarget),
    persistValidatedSnapshot: (refreshTarget, candidate) => repository.persistValidatedSnapshot(refreshTarget, candidate),
  }, reportOutcome: (outcome) => outcomes.push(outcome) });
}

before(async () => {
  await prisma.$executeRaw`INSERT INTO businesses (id, timezone) VALUES (${businessId}::uuid, 'Europe/Istanbul')`;
  await prisma.$executeRaw`INSERT INTO fields (id, business_id, name, representative_point) VALUES (${fieldId}::uuid, ${businessId}::uuid, 'Refresh field', ST_SetSRID(ST_MakePoint(29, 41), 4326))`;
});
after(async () => {
  await prisma.$executeRaw`DELETE FROM weather_snapshots WHERE field_id = ANY(${batchFieldIds}::uuid[])`;
  await prisma.$executeRaw`DELETE FROM fields WHERE id = ANY(${batchFieldIds}::uuid[])`;
  await prisma.$executeRaw`DELETE FROM businesses WHERE id = ${batchBusinessId}::uuid`;
  await prisma.$executeRaw`DELETE FROM weather_snapshots WHERE field_id = ${fieldId}::uuid`;
  await prisma.$executeRaw`DELETE FROM fields WHERE id = ${fieldId}::uuid`;
  await prisma.$executeRaw`DELETE FROM businesses WHERE id = ${businessId}::uuid`;
  await prisma.$disconnect();
});

test("refresh persists only normalized accepted data and atomically replaces all forecast rows", async () => {
  const events: unknown[] = [];
  assert.deepEqual(await service({ getForecast: async () => forecast("2026-10-01T05:45:00.000Z") }, events).refreshEligibleFields("refresh-first"), { refreshed: 1, failed: 0, rejected: 0 });
  const before = await prisma.weatherSnapshot.findUniqueOrThrow({ where: { fieldId_businessId: { fieldId, businessId } }, include: { dailyForecasts: true } });
  assert.equal(before.dailyForecasts.length, 3);

  const invalid = forecast("2026-10-01T05:50:00.000Z", Number.NaN);
  assert.deepEqual(await service({ getForecast: async () => invalid }, events).refreshEligibleFields("refresh-invalid"), { refreshed: 0, failed: 0, rejected: 1 });
  const afterInvalid = await prisma.weatherSnapshot.findUniqueOrThrow({ where: { fieldId_businessId: { fieldId, businessId } }, include: { dailyForecasts: true } });
  assert.equal(afterInvalid.id, before.id);
  assert.equal(afterInvalid.temperatureC, before.temperatureC);
  assert.equal(afterInvalid.dailyForecasts.length, 3);

  assert.deepEqual(await service({ getForecast: async () => forecast("2026-10-01T05:55:00.000Z", 20) }, events).refreshEligibleFields("refresh-recovery"), { refreshed: 1, failed: 0, rejected: 0 });
  const recovered = await prisma.weatherSnapshot.findUniqueOrThrow({ where: { fieldId_businessId: { fieldId, businessId } }, include: { dailyForecasts: true } });
  assert.equal(recovered.id, before.id);
  assert.equal(recovered.temperatureC, 20);
  assert.equal(recovered.dailyForecasts.length, 3);
});

test("provider outage, delayed older result, and changed point preserve the last valid snapshot", async () => {
  const before = await prisma.weatherSnapshot.findUniqueOrThrow({ where: { fieldId_businessId: { fieldId, businessId } } });
  assert.deepEqual(await service({ getForecast: async () => { throw new Error("private provider detail"); } }).refreshEligibleFields("refresh-outage"), { refreshed: 0, failed: 1, rejected: 0 });
  const outage = await prisma.weatherSnapshot.findUniqueOrThrow({ where: { fieldId_businessId: { fieldId, businessId } } });
  assert.equal(outage.updatedAt.getTime(), before.updatedAt.getTime());

  const older = forecast("2026-10-01T05:40:00.000Z", 2);
  assert.deepEqual(await service({ getForecast: async () => older }).refreshEligibleFields("refresh-delayed"), { refreshed: 0, failed: 0, rejected: 1 });
  const afterOlder = await prisma.weatherSnapshot.findUniqueOrThrow({ where: { fieldId_businessId: { fieldId, businessId } } });
  assert.equal(afterOlder.temperatureC, before.temperatureC);

  await prisma.$executeRaw`UPDATE fields SET representative_point = ST_SetSRID(ST_MakePoint(30, 42), 4326) WHERE id = ${fieldId}::uuid`;
  assert.deepEqual(await service({ getForecast: async () => forecast("2026-10-01T06:00:00.000Z", 24) }).refreshEligibleFields("refresh-point-changed"), { refreshed: 0, failed: 0, rejected: 1 });
  const afterPoint = await prisma.weatherSnapshot.findUniqueOrThrow({ where: { fieldId_businessId: { fieldId, businessId } } });
  assert.equal(afterPoint.temperatureC, before.temperatureC);
  await prisma.$executeRaw`UPDATE fields SET representative_point = ST_SetSRID(ST_MakePoint(29, 41), 4326) WHERE id = ${fieldId}::uuid`;
});

test("a persistence constraint failure rolls back the prior snapshot and all forecast rows", async () => {
  const before = await prisma.weatherSnapshot.findUniqueOrThrow({ where: { fieldId_businessId: { fieldId, businessId } }, include: { dailyForecasts: true } });
  const candidate = normalizeWeatherSnapshot({ ...forecast("2026-10-01T06:10:00.000Z", 26), location: target.representativePoint!, businessTimezone: target.businessTimezone, requestedLocalDates: dates,
    fetchedAt: "2026-10-01T06:10:00.000Z", refreshStartedAt: "2026-10-01T06:10:00.000Z" }, new Date("2026-10-01T06:10:00.000Z"));
  const duplicateForecast = { ...candidate, dailyForecasts: [candidate.dailyForecasts[0], candidate.dailyForecasts[0], candidate.dailyForecasts[2]] as unknown as typeof candidate.dailyForecasts };

  await assert.rejects(repository.persistValidatedSnapshot(target, duplicateForecast));

  const afterFailure = await prisma.weatherSnapshot.findUniqueOrThrow({ where: { fieldId_businessId: { fieldId, businessId } }, include: { dailyForecasts: true } });
  assert.equal(afterFailure.id, before.id);
  assert.equal(afterFailure.temperatureC, before.temperatureC);
  assert.equal(afterFailure.updatedAt.getTime(), before.updatedAt.getTime());
  assert.equal(afterFailure.dailyForecasts.length, 3);
});

test("overlapping refreshes cannot let a delayed older request replace a newer accepted result", async () => {
  const olderStart = new Date("2026-10-01T06:01:00.000Z");
  const newerStart = new Date("2026-10-01T06:05:00.000Z");
  let providerStarted!: () => void;
  const started = new Promise<void>((resolve) => { providerStarted = resolve; });
  let resolveOlder!: (value: WeatherProviderForecast) => void;
  const delayedOlder = new Promise<WeatherProviderForecast>((resolve) => { resolveOlder = resolve; });
  const withoutIssueTime = (temperature: number): WeatherProviderForecast => {
    const value = forecast("2026-10-01T05:59:00.000Z", temperature);
    return { current: value.current, dailyForecasts: value.dailyForecasts };
  };
  const older = service({ getForecast: async () => { providerStarted(); return delayedOlder; } }, [], () => olderStart).refreshEligibleFields("overlap-older");
  await started;
  const newerResult = await service({ getForecast: async () => withoutIssueTime(29) }, [], () => newerStart).refreshEligibleFields("overlap-newer");
  resolveOlder(withoutIssueTime(2));
  const olderResult = await older;

  assert.deepEqual(newerResult, { refreshed: 1, failed: 0, rejected: 0 });
  assert.deepEqual(olderResult, { refreshed: 0, failed: 0, rejected: 1 });
  const stored = await prisma.weatherSnapshot.findUniqueOrThrow({ where: { fieldId_businessId: { fieldId, businessId } } });
  assert.equal(stored.temperatureC, 29);
  assert.equal(stored.refreshStartedAt.getTime(), newerStart.getTime());
});

test("bounded refresh batches reach later due fields after successful and failed attempts", async () => {
  await prisma.$executeRaw`INSERT INTO businesses (id, timezone) VALUES (${batchBusinessId}::uuid, 'Europe/Istanbul')`;
  for (const [index, id] of batchFieldIds.entries()) {
    await prisma.$executeRaw`INSERT INTO fields (id, business_id, name, representative_point) VALUES (${id}::uuid, ${batchBusinessId}::uuid, ${`Batch ${index + 1}`}, ST_SetSRID(ST_MakePoint(${20 + index}, 40), 4326))`;
  }
  const batchRepository = new WeatherRepository(prisma, { now: () => now });
  const failedTarget: WeatherRefreshTarget = { businessId: batchBusinessId, fieldId: batchFieldIds[0]!, businessTimezone: "Europe/Istanbul", representativePoint: { longitude: 20, latitude: 40 }, requestedLocalDates: dates };
  const previous = normalizeWeatherSnapshot({ ...forecast("2026-10-01T00:00:00.000Z", 9), location: failedTarget.representativePoint!, businessTimezone: failedTarget.businessTimezone, requestedLocalDates: dates,
    fetchedAt: "2026-09-30T23:59:00.000Z", refreshStartedAt: "2026-09-30T23:59:00.000Z" }, now);
  await batchRepository.persistValidatedSnapshot(failedTarget, previous);

  const seen = new Set<string>();
  const outcomes: Array<{ fieldId: string; outcome: string }> = [];
  const provider: WeatherProvider = { async getForecast(request) {
    const longitude = request.location.longitude;
    const index = longitude - 20;
    const fieldId = batchFieldIds[index];
    if (fieldId) seen.add(fieldId);
    if (index === 0) throw new Error("test provider outage");
    return forecast("2026-10-01T05:59:00.000Z", 15 + index);
  } };
  const batchService = new WeatherRefreshService({ provider, repository: batchRepository, now: () => now, maxBatchSize: 2, reportOutcome: (value) => outcomes.push(value) });

  await batchService.refreshEligibleFields("batch-first");
  const firstBatch = new Set(seen);
  assert.equal(firstBatch.size, 2, "first invocation processes only one bounded batch");
  await batchService.refreshEligibleFields("batch-second");

  for (const id of batchFieldIds) assert.ok(seen.has(id), `eventually refreshes ${id}`);
  assert.equal(outcomes.filter((outcome) => outcome.outcome === "REFRESHED").length, 3);
  const stillValid = await prisma.weatherSnapshot.findUniqueOrThrow({ where: { fieldId_businessId: { fieldId: batchFieldIds[0]!, businessId: batchBusinessId } } });
  assert.equal(stillValid.temperatureC, 9, "provider failure preserves the previous valid snapshot");
});
