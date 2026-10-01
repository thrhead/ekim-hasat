import assert from "node:assert/strict";
import test from "node:test";
import { createSeasonReadApp } from "../../src/seasons/seasons-read.controller.js";
import { BusinessScopeForbiddenError } from "../../src/authorization/membership-scope.service.js";
import { NotFoundException } from "@nestjs/common";

const fieldId = "00000000-0000-4000-8000-000000000001";
const seasonId = "00000000-0000-4000-8000-000000000002";
const identity = { provider: "supabase", subject: "farmer" };
const draft = {
  id: seasonId, fieldId, cropDisplayName: "Fixture crop", sowingPlantingDate: "2026-08-01",
  status: "DRAFT" as const, version: 1,
  plan: { source: { kind: "MANUAL" as const, validationLabel: "NOT_CENTRALLY_VALIDATED" as const, templateVersionId: null }, tasks: [] },
};

async function setup(overrides: Partial<Parameters<typeof createSeasonReadApp>[0]> = {}) {
  const app = await createSeasonReadApp({
    verify: async (token) => token === "valid-token" ? identity : null,
    readOptions: async () => ({ fieldId, customCropAllowed: true, crops: [] }),
    readSeason: async () => draft,
    ...overrides,
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

test("field options expose the additive contract without accepting business authority", async () => {
  const seen: unknown[] = [];
  const app = await setup({ readOptions: async (...args) => {
    seen.push(args);
    return { fieldId, customCropAllowed: true, crops: [{
      id: seasonId, displayName: "Fixture central crop", source: "CENTRAL",
      templateAvailability: "EMPTY_TASK_DEFINITIONS", manualPlanAllowed: true,
    }] };
  } });
  try {
    const response = await app.inject({ method: "GET", url: `/v1/fields/${fieldId}/season-setup-options?businessId=forged`, headers: { authorization: "Bearer valid-token" } });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().crops[0].templateAvailability, "EMPTY_TASK_DEFINITIONS");
    assert.deepEqual(seen, [[identity, fieldId]]);
  } finally { await app.close(); }
});

test("recovery reads both DRAFT and ACTIVE with source, copied tasks, local dates and ETag", async () => {
  for (const record of [draft, { ...draft, status: "ACTIVE" as const, activatedAt: "2026-08-03T08:00:00.000Z", version: 2 }]) {
    const app = await setup({ readSeason: async () => record });
    try {
      const response = await app.inject({ method: "GET", url: `/v1/seasons/${seasonId}`, headers: { authorization: "Bearer valid-token" } });
      assert.equal(response.statusCode, 200);
      assert.deepEqual(response.json(), record);
      assert.equal(response.headers.etag, `"${record.version}"`);
    } finally { await app.close(); }
  }
});

test("authentication is checked before reading and failures use the season error contract", async () => {
  let reads = 0;
  const app = await setup({ readSeason: async () => { reads++; return draft; } });
  try {
    for (const authorization of [undefined, "Basic foo", "Bearer rejected"]) {
      const response = await app.inject({ method: "GET", url: `/v1/seasons/${seasonId}`, headers: authorization ? { authorization } : {} });
      assert.equal(response.statusCode, 401);
      assert.equal(response.json().error.code, "UNAUTHORIZED");
      assert.equal(typeof response.json().error.requestId, "string");
      assert.deepEqual(Object.keys(response.json()), ["error"]);
    }
    assert.equal(reads, 0);
  } finally { await app.close(); }
});

test("unknown and out-of-scope records share a privacy-safe 404; invalid membership is 403", async () => {
  for (const failure of [new NotFoundException("private field exists"), new BusinessScopeForbiddenError()]) {
    const app = await setup({ readOptions: async () => { throw failure; }, readSeason: async () => { throw failure; } });
    try {
      for (const url of [`/v1/seasons/${seasonId}`, `/v1/fields/${fieldId}/season-setup-options`]) {
        const response = await app.inject({ method: "GET", url, headers: { authorization: "Bearer valid-token" } });
        assert.equal(response.statusCode, failure instanceof NotFoundException ? 404 : 403);
        assert.equal(response.json().error.code, failure instanceof NotFoundException ? "NOT_FOUND" : "FORBIDDEN");
        assert.doesNotMatch(response.body, /private|membership|business/i);
      }
    } finally { await app.close(); }
  }
});

test("invalid path IDs and unexpected read failures return safe contract errors", async () => {
  const app = await setup({ readSeason: async () => { throw new Error("SQL or token secret"); } });
  try {
    const invalid = await app.inject({ method: "GET", url: "/v1/seasons/not-a-uuid", headers: { authorization: "Bearer valid-token" } });
    assert.equal(invalid.statusCode, 404);
    const failure = await app.inject({ method: "GET", url: `/v1/seasons/${seasonId}`, headers: { authorization: "Bearer valid-token" } });
    assert.equal(failure.statusCode, 500);
    assert.equal(failure.json().error.code, "UNEXPECTED");
    assert.doesNotMatch(failure.body, /SQL|secret|token/);
  } finally { await app.close(); }
});
