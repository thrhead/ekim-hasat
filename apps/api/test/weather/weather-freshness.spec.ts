import assert from "node:assert/strict";
import test from "node:test";

import { classifyWeatherFreshness } from "../../src/weather/weather-freshness.js";

const now = new Date("2026-10-01T12:00:00.000Z");
const requestedLocalDates = ["2026-10-01", "2026-10-02", "2026-10-03"];
const snapshot = {
  fetchedAt: new Date("2026-10-01T06:00:00.000Z"),
  businessTimezone: "Europe/Istanbul",
  forecastLocalDates: requestedLocalDates,
  locationFingerprint: "point:29.000000,41.000000",
};
const classify = (overrides: Record<string, unknown> = {}) => classifyWeatherFreshness({
  snapshot,
  now,
  maxAgeHours: 6,
  requestedLocalDates,
  businessTimezone: "Europe/Istanbul",
  currentLocationFingerprint: "point:29.000000,41.000000",
  hasUsableRepresentativePoint: true,
  ...overrides,
});

test("six-hour equality remains current and age beyond the configured maximum is stale", () => {
  assert.equal(classify(), "CURRENT");
  assert.equal(classify({ maxAgeHours: 5.99 }), "STALE");
  assert.equal(classify({ snapshot: { ...snapshot, fetchedAt: new Date("2026-10-01T05:59:59.999Z") } }), "STALE");
});

test("coverage and timezone validity affect freshness independently of refresh outcomes", () => {
  assert.equal(classify({ requestedLocalDates: ["2026-10-02", "2026-10-03", "2026-10-04"] }), "STALE");
  assert.equal(classify({ businessTimezone: "Europe/Ankara" }), "STALE");
  assert.equal(classify({ snapshot: { ...snapshot, forecastLocalDates: ["2026-10-01", "2026-10-02"] } }), "STALE");
});

test("missing snapshots or unusable and mismatched locations are unavailable", () => {
  assert.equal(classify({ snapshot: null }), "UNAVAILABLE");
  assert.equal(classify({ hasUsableRepresentativePoint: false }), "UNAVAILABLE");
  assert.equal(classify({ currentLocationFingerprint: "point:30.000000,41.000000" }), "UNAVAILABLE");
});
