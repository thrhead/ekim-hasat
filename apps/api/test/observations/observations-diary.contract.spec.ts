import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const contractPath = fileURLToPath(new URL("../../../../specs/006-field-observations-basic-diary/contracts/observations-diary.openapi.yaml", import.meta.url));

test("SPEC-006 contract defines create and bounded diary operations with shared errors", async () => {
  const contract = (await readFile(contractPath, "utf8")).replace(/\r\n/g, "\n");
  const create = /  \/fields\/\{fieldId\}\/observations:\n    post:[\s\S]*?(?=\n  \/fields\/\{fieldId\}\/diary:)/.exec(contract)?.[0];
  const diary = /  \/fields\/\{fieldId\}\/diary:\n    get:[\s\S]*?(?=\ncomponents:)/.exec(contract)?.[0];
  assert.ok(create, "observation POST exists");
  assert.ok(diary, "Field diary GET exists");
  assert.match(create, /operationId: createFieldObservation/);
  const requestSchema = /CreateObservationRequest:[\s\S]*?(?=\n    Observation:)/.exec(contract)?.[0] ?? "";
  assert.match(requestSchema, /occurredAtLocal/);
  assert.match(requestSchema, /occurredAt/);
  assert.match(create, /'201':/);
  assert.match(create, /'200':/);
  assert.match(create, /'409':[\s\S]*?ApiError/);
  assert.match(diary, /operationId: getFieldDiary/);
  assert.match(diary, /default: 50/);
  assert.match(diary, /maximum: 100/);
  assert.match(contract, /enum: \[INVALID_REQUEST, IDEMPOTENCY_KEY_REUSED, UNAUTHORIZED, FORBIDDEN, NOT_FOUND, UNEXPECTED\]/);
  assert.match(contract, /required: \[code, message, requestId\]/);
  assert.match(contract, /Unexpected server error[\s\S]*?safe generic UNEXPECTED presentation/);
  assert.match(contract, /absent and cross-Business resources have the same response/);
  assert.doesNotMatch(contract, /^\s+(put|patch|delete):/m);
});
