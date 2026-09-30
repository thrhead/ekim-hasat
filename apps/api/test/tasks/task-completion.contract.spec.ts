import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createTaskCompletionApp } from "../../src/tasks/task-completion.controller.js";

const contractPath = fileURLToPath(new URL("../../../../specs/003-task-completion-history/contracts/task-completions.openapi.yaml", import.meta.url));

test("task completion contract limits command authority and protects accepted history", async () => {
  const contract = (await readFile(contractPath, "utf8")).replace(/\r\n/g, "\n");
  assert.match(contract, /^openapi: 3\.1\.0/m);
  const complete = /  \/tasks\/{taskId}\/completions:\n    post:[\s\S]*?(?=\n  \/|\ncomponents:)/.exec(contract)?.[0];
  assert.ok(complete, "completion operation exists");
  assert.match(complete, /operationId: completePlannedTask/);
  assert.match(complete, /ExpectedTaskVersion/);
  assert.match(contract, /ExpectedTaskVersion:[\s\S]*?name: If-Match[\s\S]*?required: true/);
  assert.match(complete, /'201':[\s\S]*?first time/);
  assert.match(complete, /'200':[\s\S]*?replay/);
  assert.match(complete, /'409':[\s\S]*?task already completed by another command/);
  assert.match(complete, /'403':/);
  assert.match(complete, /'404':/);

  const request = /CompleteTaskRequest:[\s\S]*?(?=\n    [A-Z][A-Za-z]+:|\n  responses:)/.exec(contract)?.[0];
  assert.ok(request);
  assert.match(request, /additionalProperties: false/);
  assert.match(request, /required: \[completionId, occurredAt\]/);
  assert.match(request, /completionId:/);
  assert.match(request, /occurredAt:/);
  assert.doesNotMatch(request, /businessId|actor(User|Membership)Id|recordedAt|taskId:/);

});

test("completion route accepts only authenticated completion intent and required task version", async () => {
  let calls = 0;
  const app = await createTaskCompletionApp({
    verify: async (token) => token === "valid" ? { provider: "test", subject: "farmer" } : null,
    complete: async (_identity, taskId, version, input) => { calls++; return { kind: "accepted", completion: { id: input.completionId, taskId, baseTaskVersion: version } } as never; },
    readHistory: async () => ({ items: [], businessTimezone: "Europe/Istanbul", nextCursor: null }),
  });
  await app.init(); await app.getHttpAdapter().getInstance().ready();
  try {
    const validId = "11111111-1111-4111-8111-111111111111";
    const taskId = "22222222-2222-4222-8222-222222222222";
    const body = { completionId: validId, occurredAt: "2026-09-29T07:45:00.000Z" };
    const unauthorized = await app.inject({ method: "POST", url: `/v1/tasks/${taskId}/completions`, payload: body });
    assert.equal(unauthorized.statusCode, 401);
    const missingVersion = await app.inject({ method: "POST", url: `/v1/tasks/${taskId}/completions`, headers: { authorization: "Bearer valid" }, payload: body });
    assert.equal(missingVersion.statusCode, 400);
    const extraAuthority = await app.inject({ method: "POST", url: `/v1/tasks/${taskId}/completions`, headers: { authorization: "Bearer valid", "if-match": '"1"' }, payload: { ...body, businessId: validId } });
    assert.equal(extraAuthority.statusCode, 400);
    const accepted = await app.inject({ method: "POST", url: `/v1/tasks/${taskId}/completions`, headers: { authorization: "Bearer valid", "if-match": '"1"' }, payload: body });
    assert.equal(accepted.statusCode, 201);
    assert.equal(accepted.json().id, validId);
    assert.equal(calls, 1);
  } finally { await app.close(); }
});
