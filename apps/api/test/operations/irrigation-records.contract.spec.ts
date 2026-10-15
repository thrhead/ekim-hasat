import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const contractPath = fileURLToPath(new URL("../../../../specs/011-irrigation-record-capture/contracts/irrigation-records.openapi.yaml", import.meta.url));

test("irrigation create contract defines request validation, safe errors, and first-create versus exact-replay statuses", async () => {
  const contract = (await readFile(contractPath, "utf8")).replace(/\r\n/g, "\n");
  const operation = /  \/fields\/\{fieldId\}\/irrigation-records:\n    post:[\s\S]*?(?=\ncomponents:)/.exec(contract)?.[0] ?? "";
  const request = /CreateIrrigationRecordRequest:[\s\S]*?(?=\n    IrrigationRecord:)/.exec(contract)?.[0] ?? "";
  assert.ok(operation, "irrigation create POST exists");
  assert.match(operation, /operationId: createIrrigationRecord/);
  assert.match(request, /required:[\s\S]*?irrigationRecordId[\s\S]*?occurredAtLocal[\s\S]*?occurredAt[\s\S]*?capturedBusinessTimezone/);
  assert.match(request, /irrigationRecordId:[\s\S]*?format: uuid/);
  assert.match(request, /seasonId:[\s\S]*?Optional Season/);
  assert.match(request, /method:[\s\S]*?type: string[\s\S]*?maxLength: 120/);
  assert.match(request, /durationMinutes:[\s\S]*?type: integer[\s\S]*?minimum: 1/);
  assert.match(request, /waterVolumeCubicMetres:[\s\S]*?type: string[\s\S]*?positive water volume[\s\S]*?one decimal place/);
  assert.match(request, /note:[\s\S]*?type: string[\s\S]*?maxLength: 2000/);
  assert.match(operation, /'201':[\s\S]*?Irrigation record accepted and committed/);
  assert.match(operation, /'200':[\s\S]*?Exact retry replayed the previously accepted record/);
  for (const status of ["400", "401", "403", "404", "409", "5XX"]) {
    assert.match(operation, new RegExp(`'${status}':[\\s\\S]*?ApiError`), `${status} uses the shared ApiError response`);
  }
  assert.match(contract, /enum: \[INVALID_REQUEST, UNAUTHORIZED, FORBIDDEN, NOT_FOUND, IDEMPOTENCY_KEY_REUSED, UNEXPECTED\]/);
  assert.match(contract, /required: \[code, message, requestId\]/);
  assert.doesNotMatch(operation, /^\s+(put|patch|delete):/m);
});
