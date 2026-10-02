import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { NotFoundException } from "@nestjs/common";
import { BusinessScopeForbiddenError } from "../../src/authorization/membership-scope.service.js";
import { createWeatherReadApp } from "../../src/weather/weather.controller.js";

const fieldId = "00000000-0000-4000-8000-000000000001";
const identity = { provider: "supabase", subject: "farmer" };
const fieldWeather = {
  fieldId, fieldName: "North field", status: "UNAVAILABLE", businessTimezone: "Europe/Istanbul",
  fetchedAt: null, coverage: null, current: null, dailyForecasts: [],
};

async function setup(overrides: Partial<Parameters<typeof createWeatherReadApp>[0]> = {}) {
  const app = await createWeatherReadApp({
    verify: async (token) => token === "valid-token" ? identity : null,
    readFieldWeather: async () => fieldWeather,
    readWeatherOverview: async () => ({ items: [fieldWeather], nextCursor: null }),
    ...overrides,
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

test("field weather read authenticates before calling the persisted read and ignores business authority inputs", async () => {
  const seen: unknown[] = [];
  const app = await setup({ readFieldWeather: async (...args) => { seen.push(args); return fieldWeather; } });
  try {
    const response = await app.inject({ method: "GET", url: `/v1/fields/${fieldId}/weather?businessId=forged&latitude=0&longitude=0&timezone=UTC&date=2000-01-01`, headers: { authorization: "Bearer valid-token" } });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), fieldWeather);
    assert.deepEqual(seen, [[identity, fieldId]]);
  } finally { await app.close(); }
});

test("weather overview is bounded and returns only the approved overview page", async () => {
  const seen: unknown[] = [];
  const app = await setup({ readWeatherOverview: async (...args) => { seen.push(args); return { items: [fieldWeather], nextCursor: "next-page" }; } });
  try {
    const response = await app.inject({ method: "GET", url: "/v1/weather/fields?limit=100&cursor=opaque&businessId=forged", headers: { authorization: "Bearer valid-token" } });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { items: [fieldWeather], nextCursor: "next-page" });
    assert.deepEqual(seen, [[identity, { limit: 100, cursor: "opaque" }]]);
  } finally { await app.close(); }
});

test("weather overview defaults to 50 and rejects limits above 100 without reading", async () => {
  const seen: unknown[] = [];
  const app = await setup({ readWeatherOverview: async (...args) => { seen.push(args); return { items: [], nextCursor: null }; } });
  try {
    const defaultPage = await app.inject({ method: "GET", url: "/v1/weather/fields", headers: { authorization: "Bearer valid-token" } });
    assert.equal(defaultPage.statusCode, 200);
    assert.deepEqual(seen, [[identity, { limit: 50 }]]);

    const oversized = await app.inject({ method: "GET", url: "/v1/weather/fields?limit=101", headers: { authorization: "Bearer valid-token" } });
    assert.equal(oversized.statusCode, 400);
    assert.equal(oversized.json().error.code, "INVALID_REQUEST");
    assert.equal(seen.length, 1);
  } finally { await app.close(); }
});

test("authentication failure does not call weather reads and uses correlated stable error shape", async () => {
  let reads = 0;
  const app = await setup({ readFieldWeather: async () => { reads++; return fieldWeather; } });
  try {
    for (const authorization of [undefined, "Basic foo", "Bearer rejected"]) {
      const response = await app.inject({ method: "GET", url: `/v1/fields/${fieldId}/weather`, headers: authorization ? { authorization } : {} });
      assert.equal(response.statusCode, 401);
      assert.equal(response.json().error.code, "UNAUTHORIZED");
      assert.equal(typeof response.json().error.requestId, "string");
    }
    assert.equal(reads, 0);
  } finally { await app.close(); }
});

test("out-of-scope and missing weather fields have privacy-safe errors", async () => {
  for (const failure of [new NotFoundException("private field exists"), new BusinessScopeForbiddenError()]) {
    const app = await setup({ readFieldWeather: async () => { throw failure; } });
    try {
      const response = await app.inject({ method: "GET", url: `/v1/fields/${fieldId}/weather`, headers: { authorization: "Bearer valid-token" } });
      assert.equal(response.statusCode, failure instanceof NotFoundException ? 404 : 403);
      assert.equal(response.json().error.code, failure instanceof NotFoundException ? "NOT_FOUND" : "FORBIDDEN");
      assert.doesNotMatch(response.body, /private|membership|business/i);
    } finally { await app.close(); }
  }
});

test("unexpected weather read failures hide provider data while retaining the request ID", async () => {
  const logged: unknown[] = [];
  const consoleSpy = mock.method(console, "error", (line: unknown) => { logged.push(line); });
  const app = await setup({ readFieldWeather: async () => { throw new Error("provider payload secret access-token"); } });
  try {
    const response = await app.inject({ method: "GET", url: `/v1/fields/${fieldId}/weather`, headers: { authorization: "Bearer valid-token", "x-correlation-id": "weather-read-42" } });
    assert.equal(response.statusCode, 500);
    assert.equal(response.json().error.code, "UNEXPECTED");
    assert.equal(response.json().error.requestId, "weather-read-42");
    assert.doesNotMatch(response.body, /provider payload|secret|access-token/);
    assert.equal(logged.length, 1);
    const record = JSON.parse(String(logged[0])) as Record<string, unknown>;
    assert.equal(record.correlationId, "weather-read-42");
    assert.equal(record.errorCategory, "INTERNAL_ERROR");
    assert.deepEqual(Object.keys(record).sort(), ["correlationId", "errorCategory", "event", "method", "statusCode"].sort());
    assert.doesNotMatch(JSON.stringify(record), /provider payload|secret|access-token/);
  } finally { await app.close(); consoleSpy.mock.restore(); }
});
