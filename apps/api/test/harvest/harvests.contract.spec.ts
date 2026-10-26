import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const contractPath = fileURLToPath(new URL("../../../../specs/013-harvest-record-capture/contracts/harvests.openapi.yaml", import.meta.url));

test("Harvest create contract defines exact request and response schemas", async () => {
  const contract = (await readFile(contractPath, "utf8")).replace(/\r\n/g, "\n");
  const operation = /  \/fields\/\{fieldId\}\/harvests:\n    post:[\s\S]*?(?=\ncomponents:)/.exec(contract)?.[0] ?? "";
  const request = /    CreateHarvestRequest:\n[\s\S]*?(?=\n    Harvest:)/.exec(contract)?.[0] ?? "";
  const response = /    Harvest:\n[\s\S]*?(?=\n    ApiError:)/.exec(contract)?.[0] ?? "";

  assert.ok(operation, "POST /fields/{fieldId}/harvests exists");
  assert.match(operation, /operationId: createFieldHarvest/);
  assert.match(contract, /^security:\n\s+- BearerAuth: \[\]/m, "create operation requires bearer authentication");
  assert.match(operation, /schema:\n\s+\$ref: '#\/components\/schemas\/CreateHarvestRequest'/);
  assert.match(request, /type: object/);
  assert.match(request, /additionalProperties: false/);
  assert.match(request, /required: \[harvestId, seasonId, harvestDate, quantity, unit\]/);
  assert.match(request, /harvestId:\n\s+type: string\n\s+format: uuid/);
  assert.match(request, /Stable client-generated identity for this logical create and exact retry/);
  assert.match(request, /harvestDate:\n\s+type: string\n\s+format: date\n\s+pattern: '\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$'/);
  assert.match(request, /quantity:\n\s+type: string\n\s+minLength: 1\n\s+maxLength: 15\n\s+pattern: '\^\(\?=\.\*\[1-9\]\)/);
  assert.match(request, /at most 11 integer digits and 3 fractional\s+digits/);
  assert.match(request, /unit:\n\s+type: string\n\s+enum: \[KG, METRIC_TONNE\]/);
  assert.doesNotMatch(request, /^\s+note:/m, "unsupported note is not part of the create request");

  assert.match(response, /required: \[id, fieldId, seasonId, harvestDate, quantity, unit, recordedAt\]/);
  assert.match(response, /harvestDate:\n\s+type: string\n\s+format: date/);
  assert.match(response, /quantity:\n\s+type: string/);
  assert.match(response, /unit:\n\s+type: string\n\s+enum: \[KG, METRIC_TONNE\]/);
  assert.match(response, /recordedAt:\n\s+type: string\n\s+format: date-time/);
});

test("Harvest create contract defines acceptance, exact replay, and safe error statuses", async () => {
  const contract = (await readFile(contractPath, "utf8")).replace(/\r\n/g, "\n");
  const operation = /  \/fields\/\{fieldId\}\/harvests:\n    post:[\s\S]*?(?=\ncomponents:)/.exec(contract)?.[0] ?? "";

  assert.ok(operation, "Harvest create POST exists");
  assert.match(operation, /'201':\n\s+description: Harvest accepted and committed[\s\S]*?\$ref: '#\/components\/schemas\/Harvest'/);
  assert.match(operation, /'200':\n\s+description: Exact retry replayed the previously accepted Harvest[\s\S]*?\$ref: '#\/components\/schemas\/Harvest'/);
  for (const status of ["400", "401", "403", "404", "409", "500"]) {
    assert.match(operation, new RegExp(`'${status}':[\\s\\S]*?\\$ref: '#/components/schemas/ApiError'`), `${status} uses ApiError`);
  }

  const errors = /    ApiError:\n[\s\S]*$/.exec(contract)?.[0] ?? "";
  assert.match(errors, /required: \[code, message, requestId\]/);
  assert.match(errors, /enum: \[INVALID_REQUEST, IDEMPOTENCY_KEY_REUSED, UNAUTHORIZED, FORBIDDEN, NOT_FOUND, UNEXPECTED\]/);
});
