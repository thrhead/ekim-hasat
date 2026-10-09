import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createTaskSkipApp } from "../../src/tasks/task-skip.controller.js";

const contractPath = fileURLToPath(new URL("../../../../specs/009-skip-active-task/contracts/task-skips.openapi.yaml", import.meta.url));
const taskId = "22222222-2222-4222-8222-222222222222";
const skipId = "11111111-1111-4111-8111-111111111111";

test("Skip OpenAPI contract defines accepted, replay, version, response, and error shapes", async () => {
  const contract = (await readFile(contractPath, "utf8")).replace(/\r\n/g, "\n");
  const operation = /  \/tasks\/{taskId}\/skips:\n    post:[\s\S]*?(?=\n  \/|\ncomponents:)/.exec(contract)?.[0];
  assert.ok(operation, "Skip POST operation exists");
  assert.match(operation, /operationId: skipPlannedTask/);
  assert.match(operation, /ExpectedTaskVersion/);
  assert.match(operation, /'201':[\s\S]*?first time/);
  assert.match(operation, /'200':[\s\S]*?Exact retry/);
  assert.match(operation, /'400':/);
  assert.match(operation, /'401':/);
  assert.match(operation, /'403':/);
  assert.match(operation, /'404':/);
  assert.match(operation, /'409':[\s\S]*?ApiError/);
  assert.match(contract, /ExpectedTaskVersion:[\s\S]*?name: If-Match[\s\S]*?required: true/);
  const request = /SkipPlannedTaskRequest:[\s\S]*?(?=\n    TaskSkip:)/.exec(contract)?.[0] ?? "";
  assert.match(request, /additionalProperties: false/);
  assert.match(request, /required: \[skipId\]/);
  assert.match(request, /skipId:/);
  assert.doesNotMatch(request, /businessId|actor(User|Membership)Id|taskId:/);
  const response = /TaskSkip:\n[\s\S]*?(?=\n    TaskHistoryPage:)/.exec(contract)?.[0] ?? "";
  for (const field of ["skipId", "taskId", "taskTitle", "seasonId", "fieldId", "plannedLocalDate", "baseTaskVersion", "acceptedTaskVersion", "skippedAt"]) {
    assert.match(response, new RegExp(`\\b${field}\\b`));
  }
  assert.match(contract, /IDEMPOTENCY_KEY_REUSED/);
  assert.match(contract, /TASK_ALREADY_COMPLETED/);
  assert.match(contract, /TASK_ALREADY_SKIPPED/);
  assert.match(contract, /TASK_NOT_ACTIONABLE/);
  assert.match(contract, /TASK_VERSION_CONFLICT/);
});

test("Skip route returns 201 then exact replay 200 with the original stable result", async () => {
  let calls = 0;
  const result = {
    skipId, taskId, taskTitle: "Prune the rows", seasonId: "33333333-3333-4333-8333-333333333333",
    fieldId: "44444444-4444-4444-8444-444444444444", plannedLocalDate: "2026-10-10",
    baseTaskVersion: 4, acceptedTaskVersion: 5, skippedAt: "2026-10-09T09:30:00.000Z",
  };
  const app = await createTaskSkipApp({
    verify: async (token: string) => token === "valid" ? { provider: "test", subject: "farmer" } : null,
    skip: async () => { calls++; return { kind: calls === 1 ? "accepted" : "replay", skip: result }; },
  });
  await app.init(); await app.getHttpAdapter().getInstance().ready();
  try {
    const url = `/v1/tasks/${taskId}/skips`;
    const headers = { authorization: "Bearer valid", "if-match": '"4"' };
    const body = { skipId };
    const accepted = await app.inject({ method: "POST", url, headers, payload: body });
    assert.equal(accepted.statusCode, 201);
    assert.deepEqual(accepted.json(), result);
    const replay = await app.inject({ method: "POST", url, headers, payload: body });
    assert.equal(replay.statusCode, 200);
    assert.deepEqual(replay.json(), result);
    assert.equal(calls, 2);
  } finally { await app.close(); }
});

test("Skip route requires If-Match and returns the established error envelope", async () => {
  let calls = 0;
  const app = await createTaskSkipApp({
    verify: async (token: string) => token === "valid" ? { provider: "test", subject: "farmer" } : null,
    skip: async () => { calls++; throw new Error("unexpected Skip call"); },
  });
  await app.init(); await app.getHttpAdapter().getInstance().ready();
  try {
    const url = `/v1/tasks/${taskId}/skips`;
    const body = { skipId };
    const missingVersion = await app.inject({ method: "POST", url, headers: { authorization: "Bearer valid" }, payload: body });
    assert.equal(missingVersion.statusCode, 400);
    assert.equal(typeof missingVersion.json().error, "object");
    assert.equal(typeof (missingVersion.json().error as Record<string, unknown>).code, "string");
    assert.equal(typeof (missingVersion.json().error as Record<string, unknown>).message, "string");
    assert.equal(typeof (missingVersion.json().error as Record<string, unknown>).requestId, "string");
    assert.equal(calls, 0);
  } finally { await app.close(); }
});
