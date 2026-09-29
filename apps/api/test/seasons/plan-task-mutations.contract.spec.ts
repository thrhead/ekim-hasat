import assert from "node:assert/strict";
import test from "node:test";
import { NotFoundException } from "@nestjs/common";
import { createSeasonPlanTaskApp } from "../../src/seasons/seasons-plan-task.controller.js";
import { SeasonCommandError } from "../../src/seasons/seasons-command.error.js";
import { BusinessScopeForbiddenError } from "../../src/authorization/membership-scope.service.js";

const seasonId = "00000000-0000-4000-8000-000000000001";
const taskId = "00000000-0000-4000-8000-000000000002";
const identity = { provider: "supabase", subject: "farmer" };
const draft = { id: seasonId, fieldId: "00000000-0000-4000-8000-000000000003", cropDisplayName: "Wheat", sowingPlantingDate: "2026-09-28", status: "DRAFT" as const, version: 2,
  plan: { source: { kind: "VALIDATED_TEMPLATE" as const, validationLabel: "CENTRALLY_VALIDATED" as const, templateVersionId: taskId }, tasks: [{ id: taskId, title: "Check", plannedLocalDate: "2026-10-01", version: 1 }] } };
const headers = { authorization: "Bearer valid", "if-match": '"1"', "idempotency-key": "add-key" };
const baseUrl = `/v1/seasons/${seasonId}/plan-tasks`;

async function setup(overrides: Partial<Parameters<typeof createSeasonPlanTaskApp>[0]> = {}) {
  const app = await createSeasonPlanTaskApp({
    verify: async (token) => token === "valid" ? identity : null,
    addTask: async () => ({ season: draft, kind: "updated" }),
    editTask: async () => ({ season: draft, kind: "updated" }),
    removeTask: async () => ({ season: draft, kind: "updated" }),
    ...overrides,
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

test("add sends verified identity, season version and idempotency key, then returns updated draft with ETag", async () => {
  const calls: unknown[] = [];
  const app = await setup({ addTask: async (...args) => { calls.push(args); return { season: draft, kind: "updated" }; } });
  try {
    const response = await app.inject({ method: "POST", url: `${baseUrl}?businessId=forged`, headers, payload: { title: "Inspect", plannedLocalDate: "2026-09-28" } });
    assert.equal(response.statusCode, 201);
    assert.deepEqual(response.json(), draft);
    assert.equal(response.headers.etag, '"2"');
    assert.deepEqual(calls, [[identity, seasonId, 1, "add-key", { title: "Inspect", plannedLocalDate: "2026-09-28" }]]);
  } finally { await app.close(); }
});

test("edit and remove use If-Match and return updated draft with ETag", async () => {
  for (const [method, path, operation] of [["PATCH", `/${taskId}`, "editTask"], ["DELETE", `/${taskId}`, "removeTask"]] as const) {
    const calls: unknown[] = [];
    const app = await setup({ [operation]: async (...args: unknown[]) => { calls.push(args); return { season: draft, kind: "updated" }; } });
    try {
      const response = await app.inject({ method, url: `${baseUrl}${path}`, headers: { authorization: headers.authorization, "if-match": headers["if-match"] }, ...(method === "PATCH" ? { payload: { plannedLocalDate: "2026-10-02" } } : {}) });
      assert.equal(response.statusCode, 200);
      assert.deepEqual(response.json(), draft);
      assert.equal(response.headers.etag, '"2"');
      assert.equal(calls.length, 1);
      assert.equal(calls[0][0], identity);
      assert.equal(calls[0][1], seasonId);
      assert.equal(calls[0][2], taskId);
      assert.equal(calls[0][3], 1);
    } finally { await app.close(); }
  }
});

test("missing or malformed version/key headers and unauthenticated requests never reach mutations", async () => {
  let calls = 0;
  const app = await setup({ addTask: async () => { calls++; return { season: draft, kind: "updated" }; } });
  try {
    for (const requestHeaders of [
      { authorization: "Bearer valid", "idempotency-key": "key" },
      { authorization: "Bearer valid", "if-match": "0", "idempotency-key": "key" },
      { authorization: "Bearer valid", "if-match": '"1"' },
      { ...headers, authorization: "Bearer rejected" },
    ]) {
      const response = await app.inject({ method: "POST", url: baseUrl, headers: requestHeaders, payload: { title: "Inspect", plannedLocalDate: "2026-09-28" } });
      assert.ok([400, 401].includes(response.statusCode));
    }
    assert.equal(calls, 0);
  } finally { await app.close(); }
});

test("tenant and state failures keep the stable privacy-safe contract", async () => {
  for (const failure of [new NotFoundException("private task belongs to another business"), new BusinessScopeForbiddenError(), new SeasonCommandError(409, "STALE_SEASON_VERSION"), new SeasonCommandError(409, "SEASON_NOT_DRAFT")]) {
    const app = await setup({ editTask: async () => { throw failure; } });
    try {
      const response = await app.inject({ method: "PATCH", url: `${baseUrl}/${taskId}`, headers: { authorization: "Bearer valid", "if-match": '"1"' }, payload: { title: "Changed" } });
      const status = failure instanceof NotFoundException ? 404 : failure instanceof BusinessScopeForbiddenError ? 403 : 409;
      assert.equal(response.statusCode, status);
      assert.ok(response.json().error.requestId);
      assert.doesNotMatch(response.body, /private|business|membership/i);
      if (failure instanceof SeasonCommandError) assert.equal(response.json().error.code, failure.presentation.code);
    } finally { await app.close(); }
  }
});
