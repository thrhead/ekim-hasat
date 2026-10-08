import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createTaskDateAdjustmentApp } from "../../src/tasks/task-date-adjustment.controller.js";
import { TaskDateAdjustmentError } from "../../src/tasks/task-date-adjustment.error.js";

const contractPath = fileURLToPath(new URL("../../../../specs/008-manual-active-season-task-adjustment/contracts/task-date-adjustments.openapi.yaml", import.meta.url));
const taskId = "22222222-2222-4222-8222-222222222222";
const adjustmentId = "11111111-1111-4111-8111-111111111111";

test("adjustment contract covers guarded commands, replay, bounded history, and stable errors", async () => {
  const contract = (await readFile(contractPath, "utf8")).replace(/\r\n/g, "\n");
  const operation = /  \/tasks\/{taskId}\/date-adjustments:\n    post:[\s\S]*?(?=\n    get:)/.exec(contract)?.[0];
  assert.ok(operation);
  assert.match(operation, /operationId: adjustPlannedTaskDate/);
  assert.match(operation, /ExpectedTaskVersion/);
  assert.match(operation, /'201':/);
  assert.match(operation, /'200':/);
  assert.match(operation, /'400':/);
  assert.match(operation, /'409':/);
  assert.match(contract, /ExpectedTaskVersion:[\s\S]*?name: If-Match[\s\S]*?required: true/);
  assert.match(contract, /NO_DATE_CHANGE/);
  assert.match(contract, /IDEMPOTENCY_KEY_REUSED/);
  assert.match(contract, /TASK_VERSION_CONFLICT/);
  const history = /  \/tasks\/{taskId}\/date-adjustments:\n[\s\S]*?    get:[\s\S]*?(?=\ncomponents:)/.exec(contract)?.[0];
  assert.match(history ?? "", /operationId: getPlannedTaskAdjustmentHistory/);
  assert.match(history ?? "", /maximum: 100/);
});

test("adjustment routes authenticate, require If-Match, reject extra authority, and expose typed errors", async () => {
  let calls = 0;
  const app = await createTaskDateAdjustmentApp({
    verify: async (token) => token === "valid" ? { provider: "test", subject: "farmer" } : null,
    adjust: async (_identity, pathTaskId, version, input) => {
      calls++;
      if (input.newPlannedLocalDate === "2026-10-10") {
        throw new TaskDateAdjustmentError("NO_DATE_CHANGE");
      }
      return { kind: calls === 1 ? "accepted" : "replay", adjustment: {
        adjustmentId: input.adjustmentId, taskId: pathTaskId,
        previousPlannedLocalDate: "2026-10-10", newPlannedLocalDate: input.newPlannedLocalDate,
        baseTaskVersion: version, acceptedTaskVersion: version + 1, adjustedAt: "2026-10-08T00:00:00.000Z",
      } } as never;
    },
    readHistory: async () => ({ task: { taskId, plannedLocalDate: "2026-10-12", taskVersion: 5, adjustable: true }, items: [], nextCursor: null }),
  });
  await app.init(); await app.getHttpAdapter().getInstance().ready();
  try {
    const url = `/v1/tasks/${taskId}/date-adjustments`;
    const body = { adjustmentId, newPlannedLocalDate: "2026-10-12" };
    assert.equal((await app.inject({ method: "POST", url, payload: body })).statusCode, 401);
    const headers = { authorization: "Bearer valid", "if-match": '"4"' };
    assert.equal((await app.inject({ method: "POST", url, headers: { authorization: "Bearer valid" }, payload: body })).statusCode, 400);
    assert.equal((await app.inject({ method: "POST", url, headers, payload: { ...body, businessId: taskId } })).statusCode, 400);
    const accepted = await app.inject({ method: "POST", url, headers, payload: body });
    assert.equal(accepted.statusCode, 201);
    assert.equal(accepted.json().adjustmentId, adjustmentId);
    const replay = await app.inject({ method: "POST", url, headers, payload: body });
    assert.equal(replay.statusCode, 200);
    const noChange = await app.inject({ method: "POST", url, headers, payload: { ...body, newPlannedLocalDate: "2026-10-10" } });
    assert.equal(noChange.statusCode, 400);
    assert.equal(noChange.json().error.code, "NO_DATE_CHANGE");
    const history = await app.inject({ method: "GET", url, headers: { authorization: "Bearer valid" } });
    assert.equal(history.statusCode, 200);
    assert.equal(history.json().task.taskVersion, 5);
  } finally { await app.close(); }
});
