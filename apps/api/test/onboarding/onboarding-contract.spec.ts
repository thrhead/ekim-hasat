import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const contractPath = fileURLToPath(
  new URL("../../../../specs/001-farmer-onboarding-first-field/contracts/onboarding.openapi.yaml", import.meta.url),
);

const requiredResponses = (path: string, method: string, expected: string[]) => {
  const operation = new RegExp(`  ${path}:\\n    ${method}:[\\s\\S]*?(?=\\n  /|\\ncomponents:)`).exec(contractText);
  assert.ok(operation, `${method.toUpperCase()} ${path} operation exists`);
  for (const status of expected) {
    assert.match(operation[0], new RegExp(`        '${status.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}':`), `${method.toUpperCase()} ${path} includes ${status}`);
  }
  return operation[0];
};

let contractText: string;
test("SPEC-001 onboarding OpenAPI contract", async (t) => {
  contractText = (await readFile(contractPath, "utf8")).replace(/\r\n/g, "\n");
  assert.match(contractText, /^openapi: 3\.1\.0/m);
  const paths = [...contractText.matchAll(/^  (\/[^:]+):$/gm)].map((match) => match[1]);
  assert.deepEqual(paths, ["/onboarding/status", "/onboarding/complete"]);

  await t.test("status remains minimal and authenticates with 401; unusable default context is 403", () => {
    const status = requiredResponses("/onboarding/status", "get", ["200", "401", "403"]);
    assert.match(status, /first-field onboarding is needed/);
    assert.match(status, /privacy-safe 403/);
    assert.match(status, /does not reveal whether another business exists/);
    assert.match(contractText, /OnboardingStatus:[\s\S]*?required: \[firstFieldOnboardingNeeded\]/);
  });

  await t.test("completion requires idempotency and defines approved result/error semantics", () => {
    const completion = requiredResponses("/onboarding/complete", "post", ["200", "201", "400", "401", "409", "422", "5XX"]);
    assert.doesNotMatch(completion, /'403':/);
    assert.match(completion, /'201':[\s\S]*?command committed the first onboarding result/);
    assert.match(completion, /'200':[\s\S]*?idempotent retry or already-completed onboarding/);
    assert.match(completion, /'409':[\s\S]*?IdempotencyConflict/);
    assert.match(completion, /'422':[\s\S]*?InvalidLocation/);
    assert.match(completion, /'400':[\s\S]*?InvalidInput/);
    assert.match(completion, /'401':[\s\S]*?Unauthorized/);
    assert.match(completion, /'5XX':[\s\S]*?ServerFailure/);
    assert.match(completion, /parameters:[\s\S]*?IdempotencyKey/);
    assert.match(completion, /unusable[\s\S]*?HTTP 400[\s\S]*?privacy-safe Error schema/i);
    assert.match(contractText, /InvalidInput:[\s\S]*?Request fields are invalid/);
    assert.match(contractText, /does not reveal whether another business exists/);
    assert.match(contractText, /active Membership/);
    assert.match(completion, /client-selected business or membership/);
    assert.match(contractText, /reusing a retained key with a[\s\S]*?different payload returns 409/i);
    assert.match(contractText, /after the key record expires[\s\S]*?with 200 and perform no mutation/i);
  });

  await t.test("completion preserves only Point or Polygon and the first-field summary", () => {
    const completion = requiredResponses("/onboarding/complete", "post", ["200", "201"]);
    assert.match(completion, /CompleteOnboardingRequest/);
    assert.match(completion, /FirstFieldSummary/);
    assert.match(contractText, /FirstFieldSummary:[\s\S]*?createdAt/);
    assert.match(contractText, /PointGeometry/);
    assert.match(contractText, /PolygonGeometry/);
    assert.match(contractText, /MultiPolygon is outside SPEC-001/);
    assert.match(contractText, /field listing remains SPEC-002/);
    assert.match(contractText, /FirstFieldSummary:[\s\S]*?required: \[id, name, representativePoint, createdAt\]/);
    assert.match(contractText, /location:[\s\S]*?oneOf:[\s\S]*?PointGeometry[\s\S]*?PolygonGeometry/);
    assert.match(contractText, /additionalProperties: false/);
  });
});
