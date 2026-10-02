import assert from "node:assert/strict";
import test from "node:test";

import { normalizeWeatherSnapshot } from "../../src/weather/weather-normalizer.js";
import type { WeatherNormalizationInput } from "../../src/weather/weather.types.js";

const requestedLocalDates = ["2026-10-01", "2026-10-02", "2026-10-03"] as const;
const validatedAt = new Date("2026-10-01T07:00:00.000Z");
const metricFixture: WeatherNormalizationInput = {
  location: { longitude: 29, latitude: 41 },
  businessTimezone: "Europe/Istanbul",
  requestedLocalDates,
  fetchedAt: "2026-10-01T06:00:00.000Z",
  providerIssuedAt: "2026-10-01T05:45:00.000Z",
  current: { observedAt: "2026-10-01T05:30:00.000Z", condition: "sun", temperature: 18, temperatureUnit: "C" },
  dailyForecasts: requestedLocalDates.map((localDate, index) => ({
    localDate,
    condition: ["sun", "cloud", "rain"][index],
    temperatureHigh: 22 + index,
    temperatureLow: 12 + index,
    temperatureUnit: "C",
    precipitationChance: index * 25,
    windSpeed: 10 + index,
    windSpeedUnit: "km/h",
  })),
};
const normalize = (input: WeatherNormalizationInput) => normalizeWeatherSnapshot(input, validatedAt);

// Two deterministic test-only provider adapters expose equivalent conditions
// using distinct source units. Neither adapter represents a production vendor.
const metricFixtureAdapter = () => metricFixture;
const imperialFixtureAdapter = () => ({
  ...metricFixture,
  current: { ...metricFixture.current, temperature: 64.4, temperatureUnit: "F" },
  dailyForecasts: metricFixture.dailyForecasts.map((day) => ({
    ...day,
    temperatureHigh: (day.temperatureHigh * 9) / 5 + 32,
    temperatureLow: (day.temperatureLow * 9) / 5 + 32,
    temperatureUnit: "F",
    windSpeed: day.windSpeed / 1.609344,
    windSpeedUnit: "mph",
  })),
});

test("normalizes equivalent metric and imperial provider fixtures to the same snapshot", () => {
  assert.deepEqual(
    normalize(metricFixtureAdapter()),
    normalize(imperialFixtureAdapter()),
  );
});

test("normalizes supported units and unknown conditions to safe application values", () => {
  const snapshot = normalize({
    ...metricFixture,
    current: { ...metricFixture.current, condition: "volcanic ash" },
  });

  assert.equal(snapshot.current.conditionCode, "UNKNOWN");
  assert.equal(snapshot.current.temperatureC, 18);
  assert.equal(snapshot.dailyForecasts[0]?.windSpeedKph, 10);
});

test("rejects invalid coordinates, timestamps, incomplete dates, and malformed measurements", () => {
  for (const input of [
    { ...metricFixture, location: { longitude: 181, latitude: 41 } },
    { ...metricFixture, location: { longitude: 29, latitude: -91 } },
    { ...metricFixture, fetchedAt: "not-a-date" },
    { ...metricFixture, current: { ...metricFixture.current, observedAt: "2026-10-01T07:00:00.001Z" } },
    { ...metricFixture, providerIssuedAt: "2026-10-01T07:00:00.001Z" },
    { ...metricFixture, current: { ...metricFixture.current, temperature: Number.NaN } },
    { ...metricFixture, dailyForecasts: metricFixture.dailyForecasts.slice(1) },
    { ...metricFixture, dailyForecasts: metricFixture.dailyForecasts.map((day, index) => index === 0 ? { ...day, precipitationChance: 101 } : day) },
    { ...metricFixture, dailyForecasts: metricFixture.dailyForecasts.map((day, index) => index === 0 ? { ...day, windSpeed: -1 } : day) },
    { ...metricFixture, dailyForecasts: metricFixture.dailyForecasts.map((day, index) => index === 0 ? { ...day, windSpeedUnit: "knots" } : day) },
    { ...metricFixture, dailyForecasts: metricFixture.dailyForecasts.map((day, index) => index === 0 ? { ...day, temperatureHigh: undefined } : day) },
    { ...metricFixture, dailyForecasts: metricFixture.dailyForecasts.map((day, index) => index === 0 ? { ...day, temperatureHigh: 1, temperatureLow: 2 } : day) },
  ]) {
    assert.throws(() => normalize(input as WeatherNormalizationInput));
  }
});

test("rejects future timestamps, duplicate dates, and unsupported units", () => {
  assert.throws(() => normalize({
    ...metricFixture,
    fetchedAt: "2026-10-02T00:00:00.000Z",
  }));
  assert.throws(() => normalize({
    ...metricFixture,
    dailyForecasts: metricFixture.dailyForecasts.map((day, index) => index === 2 ? { ...day, localDate: "2026-10-02" } : day),
  }));
  assert.throws(() => normalize({
    ...metricFixture,
    current: { ...metricFixture.current, temperatureUnit: "K" },
  }));
});
