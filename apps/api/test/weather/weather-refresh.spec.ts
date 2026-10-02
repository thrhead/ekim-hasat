import assert from "node:assert/strict";
import test from "node:test";

import { WeatherRefreshService } from "../../src/weather/weather-refresh.service.js";
import type { WeatherProvider } from "../../src/weather/weather-provider.port.js";
import type { WeatherProviderForecast } from "../../src/weather/weather.types.js";
import { WeatherRepository } from "../../src/weather/weather.repository.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";

const now = new Date("2026-10-01T06:00:00.000Z");
const point = { longitude: 29, latitude: 41 } as const;
const dates = ["2026-10-01", "2026-10-02", "2026-10-03"] as const;
const forecast: WeatherProviderForecast = {
  providerIssuedAt: "2026-10-01T05:45:00.000Z",
  current: { observedAt: "2026-10-01T05:30:00.000Z", condition: "sun", temperature: 18, temperatureUnit: "C" },
  dailyForecasts: dates.map((localDate, i) => ({
    localDate, condition: "sun", temperatureHigh: 22 + i, temperatureLow: 12 + i,
    temperatureUnit: "C", precipitationChance: 10 + i, windSpeed: 8 + i, windSpeedUnit: "km/h",
  })),
};

const target = {
  businessId: "business-1",
  fieldId: "field-1",
  businessTimezone: "Europe/Istanbul",
  representativePoint: point,
  requestedLocalDates: dates,
};

function harness(options: {
  provider?: WeatherProvider;
  existing?: { providerIssuedAt: Date | null; refreshStartedAt: Date } | null;
  persist?: (candidate: unknown) => Promise<boolean>;
} = {}) {
  const calls: unknown[] = [];
  const events: unknown[] = [];
  const repo = {
    async listEligibleRefreshTargets(limit: number) { calls.push(["targets", limit]); return [target]; },
    async markRefreshAttempted() { calls.push(["attempted"]); },
    async getSnapshotOrdering() { return options.existing ?? null; },
    async persistValidatedSnapshot(_target: unknown, candidate: unknown) {
      calls.push(["persist", candidate]);
      return options.persist ? options.persist(candidate) : true;
    },
  };
  const provider = options.provider ?? { async getForecast() { return forecast; } };
  const service = new WeatherRefreshService({
    provider, repository: repo, now: () => now, maxBatchSize: 25,
    reportOutcome: (event) => events.push(event),
  });
  return { service, calls, events };
}

test("refresh uses eligible server representative points, normalizes, persists and reports correlated success", async () => {
  let requested: unknown;
  const { service, calls, events } = harness({ provider: { async getForecast(request) { requested = request; return forecast; } } });

  const result = await service.refreshEligibleFields("request-123");

  assert.deepEqual(requested, { location: point, businessTimezone: "Europe/Istanbul", requestedLocalDates: dates });
  assert.deepEqual(calls.map((call) => Array.isArray(call) ? call[0] : call), ["targets", "attempted", "persist"]);
  assert.equal((calls[2] as [string, { qualityStatus: string }])[1].qualityStatus, "ACCEPTED");
  assert.deepEqual(result, { refreshed: 1, failed: 0, rejected: 0 });
  assert.deepEqual(events, [{ requestId: "request-123", fieldId: "field-1", outcome: "REFRESHED" }]);
});

test("provider timeout or rate-limit failure is isolated and preserves the prior snapshot", async () => {
  for (const error of [new Error("timeout"), Object.assign(new Error("rate limited"), { status: 429 })]) {
    let persisted = false;
    const { service, events } = harness({
      provider: { async getForecast() { throw error; } },
      persist: async () => { persisted = true; return true; },
    });
    const result = await service.refreshEligibleFields("request-124");
    assert.deepEqual(result, { refreshed: 0, failed: 1, rejected: 0 });
    assert.equal(persisted, false);
    assert.deepEqual(events, [{ requestId: "request-124", fieldId: "field-1", outcome: "FAILED", reason: "PROVIDER_ERROR" }]);
  }
});

test("malformed provider output is rejected before persistence and leaves last valid data intact", async () => {
  let persisted = false;
  const invalid = { ...forecast, current: { ...forecast.current, temperature: Number.NaN } };
  const { service, events } = harness({
    provider: { async getForecast() { return invalid; } },
    persist: async () => { persisted = true; return true; },
  });

  assert.deepEqual(await service.refreshEligibleFields("request-125"), { refreshed: 0, failed: 0, rejected: 1 });
  assert.equal(persisted, false);
  assert.deepEqual(events, [{ requestId: "request-125", fieldId: "field-1", outcome: "REJECTED", reason: "INVALID_PROVIDER_OUTPUT" }]);
});

test("older results are rejected by provider issue time, or refresh start time when issue times are absent", async () => {
  for (const existing of [
    { providerIssuedAt: new Date("2026-10-01T05:50:00.000Z"), refreshStartedAt: new Date("2026-10-01T05:20:00.000Z") },
    { providerIssuedAt: null, refreshStartedAt: new Date("2026-10-01T06:05:00.000Z") },
  ]) {
    let persisted = false;
    const { service, events } = harness({ existing, persist: async () => { persisted = true; return true; } });
    assert.deepEqual(await service.refreshEligibleFields("request-126"), { refreshed: 0, failed: 0, rejected: 1 });
    assert.equal(persisted, false);
    assert.equal((events[0] as { reason: string }).reason, "OLDER_RESULT");
  }
});

test("a later valid refresh recovers and atomically replaces the previous snapshot", async () => {
  const previous = { providerIssuedAt: new Date("2026-10-01T05:40:00.000Z"), refreshStartedAt: new Date("2026-10-01T05:30:00.000Z") };
  let persistedCandidate: unknown;
  const { service } = harness({ existing: previous, persist: async (candidate) => { persistedCandidate = candidate; return true; } });

  assert.deepEqual(await service.refreshEligibleFields("request-127"), { refreshed: 1, failed: 0, rejected: 0 });
  assert.ok(persistedCandidate);
});

test("refresh target selection moves past attempted or already-current fields", async () => {
  const fields = [1, 2, 3, 4, 5, 6].map((index) => ({
    id: `field-${index}`, businessId: "business-1", business: { timezone: "Europe/Istanbul" },
    representativePoint: { longitude: 29, latitude: 41 },
    weatherSnapshot: null as null | { fetchedAt: Date; businessTimezone: string; forecastLocalDates: string[]; locationFingerprint: string },
    weatherRefreshState: null as null | { lastAttemptedAt: Date; lastAttemptOrder: bigint },
  }));
  fields[0]!.weatherSnapshot = {
    fetchedAt: new Date("2026-09-30T23:59:00.000Z"), businessTimezone: "Europe/Istanbul", forecastLocalDates: [...dates], locationFingerprint: "29.000000,41.000000",
  };
  fields[1]!.weatherSnapshot = {
    fetchedAt: now, businessTimezone: "Europe/Istanbul", forecastLocalDates: [...dates], locationFingerprint: "29.000000,41.000000",
  };
  let attemptOrder = 0n;
  const prisma = {
    field: { async findMany(args: { take?: number }) { return fields.slice(0, args.take ?? fields.length); } },
    async $queryRaw(strings: TemplateStringsArray, ...values: unknown[]) {
      const query = strings.join(" ");
      if (query.includes("ANY")) return fields.map((field) => ({ id: field.id, longitude: 29, latitude: 41 }));
      const field = fields.find(({ id }) => id === values[0]);
      return field ? [{ id: field.id, longitude: 29, latitude: 41 }] : [];
    },
    async $executeRaw(_strings: TemplateStringsArray, ...values: unknown[]) {
      const field = fields.find(({ id }) => id === values[1])!;
      field.weatherRefreshState = { lastAttemptedAt: values[2] as Date, lastAttemptOrder: ++attemptOrder };
      return 1;
    },
  } as unknown as PrismaClient;
  const repository = new WeatherRepository(prisma, { now: () => now });

  const firstBatch = await repository.listEligibleRefreshTargets(2);
  assert.deepEqual(firstBatch.map(({ fieldId }) => fieldId), ["field-1", "field-3"]);
  const oldValidData = fields[0]!.weatherSnapshot;
  for (const target of firstBatch) await repository.markRefreshAttempted(target, now);
  const secondBatch = await repository.listEligibleRefreshTargets(2);
  assert.deepEqual(secondBatch.map(({ fieldId }) => fieldId), ["field-4", "field-5"]);
  for (const target of secondBatch) await repository.markRefreshAttempted(target, now);
  const thirdBatch = await repository.listEligibleRefreshTargets(2);
  assert.deepEqual(thirdBatch.map(({ fieldId }) => fieldId), ["field-6", "field-1"]);
  for (const target of thirdBatch) await repository.markRefreshAttempted(target, now);
  const fourthBatch = await repository.listEligibleRefreshTargets(2);
  assert.deepEqual(fourthBatch.map(({ fieldId }) => fieldId), ["field-3", "field-4"], "repeated provider failures rotate by persisted attempt order");
  assert.deepEqual(fields[0]!.weatherSnapshot, oldValidData, "attempting a failed refresh does not modify its last valid snapshot");
});
