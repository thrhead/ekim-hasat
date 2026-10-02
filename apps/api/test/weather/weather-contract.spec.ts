import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const contractPath = fileURLToPath(new URL("../../../../specs/004-weather-context-display/contracts/weather.openapi.yaml", import.meta.url));
let contractText = "";

const operation = (path: string) => {
  const match = new RegExp(`  ${path.replaceAll("/", "\\/")}:\\n    get:[\\s\\S]*?(?=\\n  \\/|\\ncomponents:)`).exec(contractText);
  assert.ok(match, `GET ${path} operation exists`);
  return match[0];
};

test("weather OpenAPI contract defines authorized read operations and bounded overview paging", async () => {
  contractText = await readFile(contractPath, "utf8");
  assert.match(contractText, /^openapi: 3\.1\.0/m);
  const paths = [...contractText.matchAll(/^  (\/[^:]+):$/gm)].map((match) => match[1]);
  assert.deepEqual(paths, ["/weather/fields", "/fields/{fieldId}/weather"]);

  const overview = operation("/weather/fields");
  const field = operation("/fields/{fieldId}/weather");
  assert.match(overview, /maximum number of summaries in this page|Maximum summaries in this page/i);
  assert.match(overview, /maximum: 100/);
  assert.match(overview, /default: 50/);
  assert.match(contractText, /required: \[fieldId, fieldName, status, businessTimezone, fetchedAt, coverage, current, dailyForecasts\]/);
  assert.match(contractText, /enum: \[CURRENT, STALE, UNAVAILABLE\]/);
  assert.match(contractText, /dailyForecasts:[\s\S]*?empty when unavailable/);
  assert.match(contractText, /enum: \[INVALID_REQUEST, UNAUTHORIZED, FORBIDDEN, NOT_FOUND, UNEXPECTED\]/);
  assert.match(contractText, /requestId/);
  for (const request of [overview, field]) {
    assert.doesNotMatch(request, /name: (businessId|longitude|latitude|timezone|localDate)\n/);
  }
  assert.match(overview, /fieldId, fieldName, and weather context/);
});
