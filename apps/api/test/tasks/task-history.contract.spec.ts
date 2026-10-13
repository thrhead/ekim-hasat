import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createTaskCompletionApp } from "../../src/tasks/task-completion.controller.js";

const contractPath = fileURLToPath(new URL("../../../../specs/003-task-completion-history/contracts/task-completions.openapi.yaml", import.meta.url));
const skipContractPath = fileURLToPath(new URL("../../../../specs/009-skip-active-task/contracts/task-skips.openapi.yaml", import.meta.url));

test("field History contract is bounded, accepted-only, provenance-aware, and farmer-safe", async () => {
  const contract = (await readFile(contractPath, "utf8")).replace(/\r\n/g, "\n");
  const operation = /  \/fields\/{fieldId}\/task-completions:\n    get:[\s\S]*?(?=\ncomponents:)/.exec(contract)?.[0];
  assert.ok(operation);
  assert.match(operation, /operationId: getFieldTaskCompletionHistory/);
  assert.match(operation, /seasonId/);
  assert.match(operation, /cursor/);
  assert.match(operation, /default: 50/);
  assert.match(operation, /maximum: 100/);
  assert.match(operation, /accepted task completions only/);
  assert.match(operation, /occurredAt DESC, completionId DESC/);
  const item = /TaskCompletion:\n[\s\S]*?properties:\n([\s\S]*?)(?=\n    TaskCompletionHistoryPage:)/.exec(contract)?.[1] ?? "";
  assert.match(item, /taskId/);
  assert.match(item, /seasonId/);
  assert.match(item, /fieldId/);
  assert.match(item, /plannedLocalDate/);
  assert.match(item, /occurredAt/);
  assert.match(item, /sourceKind/);
  assert.match(item, /templateVersionId/);
  assert.match(item, /businessTimezone/);
  assert.doesNotMatch(item, /recordedAt|actor(User|Membership)Id/);
});

test("mixed Task History contract preserves the completion-only route and orders distinct Skip outcomes", async () => {
  const legacy = (await readFile(contractPath, "utf8")).replace(/\r\n/g, "\n");
  const mixed = (await readFile(skipContractPath, "utf8")).replace(/\r\n/g, "\n");
  const operation = /  \/fields\/\{fieldId\}\/task-history:\n    get:[\s\S]*?(?=\ncomponents:)/.exec(mixed)?.[0] ?? "";
  assert.match(legacy, /  \/fields\/\{fieldId\}\/task-completions:/);
  assert.match(operation, /operationId: getFieldTaskHistory/);
  assert.match(operation, /optionally limited to a Season/);
  assert.match(operation, /stable event-time, kind and event-ID order/);
  assert.match(mixed, /kind: \{ type: string, const: TASK_SKIPPED \}/);
  assert.match(mixed, /skippedAt/);
  assert.match(mixed, /plannedLocalDate/);
  assert.match(mixed, /TASK_COMPLETION[\s\S]*?TASK_SKIPPED/);
});

test("History route authenticates, validates bounds, and forwards the field and optional season scope", async () => {
  let read: unknown;
  const app = await createTaskCompletionApp({
    verify: async (token) => token === "valid" ? { provider: "test", subject: "farmer" } : null,
    complete: async () => { throw new Error("unexpected completion call"); },
    readHistory: async (identity, fieldId, filters) => {
      read = { identity, fieldId, filters };
      return { items: [], businessTimezone: "Europe/Istanbul", nextCursor: null };
    },
  });
  await app.init(); await app.getHttpAdapter().getInstance().ready();
  try {
    const fieldId = "22222222-2222-4222-8222-222222222222";
    const unauthorized = await app.inject({ method: "GET", url: `/v1/fields/${fieldId}/task-completions` });
    assert.equal(unauthorized.statusCode, 401);
    const invalidLimit = await app.inject({ method: "GET", url: `/v1/fields/${fieldId}/task-completions?limit=101`, headers: { authorization: "Bearer valid" } });
    assert.equal(invalidLimit.statusCode, 400);
    const response = await app.inject({ method: "GET", url: `/v1/fields/${fieldId}/task-completions?seasonId=33333333-3333-4333-8333-333333333333&limit=17&cursor=opaque`, headers: { authorization: "Bearer valid" } });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(read, {
      identity: { provider: "test", subject: "farmer" }, fieldId,
      filters: { seasonId: "33333333-3333-4333-8333-333333333333", limit: 17, cursor: "opaque" },
    });
    assert.deepEqual(response.json(), { items: [], businessTimezone: "Europe/Istanbul", nextCursor: null });
  } finally { await app.close(); }
});

test("mixed task outcome History has a distinct Task Skipped route projection", async () => {
  const calls: unknown[] = [];
  const app = await createTaskCompletionApp({
    verify: async () => ({ provider: "test", subject: "farmer" }),
    complete: async () => { throw new Error("unexpected completion call"); },
    readHistory: async () => ({ items: [], businessTimezone: "Europe/Istanbul", nextCursor: null }),
    readOutcomeHistory: async (identity, fieldId, filters) => {
      calls.push({ identity, fieldId, filters });
      return { items: [{ kind: "TASK_SKIPPED", id: "44444444-4444-4444-8444-444444444444", skipId: "55555555-5555-4555-8555-555555555555",
        taskId: "66666666-6666-4666-8666-666666666666", seasonId: "33333333-3333-4333-8333-333333333333", fieldId,
        title: "Inspect field", plannedLocalDate: "2026-10-01", skippedAt: "2026-10-02T10:00:00.000Z", sourceKind: "MANUAL", templateVersionId: null }],
        businessTimezone: "Europe/Istanbul", nextCursor: null };
    },
  });
  await app.init(); await app.getHttpAdapter().getInstance().ready();
  try {
    const response = await app.inject({ method: "GET", url: "/v1/fields/22222222-2222-4222-8222-222222222222/task-history?limit=10", headers: { authorization: "Bearer valid" } });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().items[0].kind, "TASK_SKIPPED");
    assert.equal(response.json().items[0].skippedAt, "2026-10-02T10:00:00.000Z");
    assert.equal("occurredAt" in response.json().items[0], false);
    assert.equal(calls.length, 1);
  } finally { await app.close(); }
});
