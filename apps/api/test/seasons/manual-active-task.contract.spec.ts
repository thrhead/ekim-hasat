import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("approved manual task contract defines stable identities, acceptance and typed failures", async () => {
  const contract = await readFile(new URL("../../../../specs/014-active-season-manual-task-creation/contracts/manual-tasks.openapi.yaml", import.meta.url), "utf8");
  assert.match(contract, /operationId: createActiveSeasonManualTask/);
  assert.match(contract, /required: \[taskId, mutationId, title, plannedLocalDate\]/);
  for (const status of ["200", "201", "400", "401", "403", "404", "409", "422"]) assert.match(contract, new RegExp(`'${status}':`));
  for (const code of ["INVALID_COMMAND", "AUTHENTICATION_REQUIRED", "ACCESS_DENIED", "RESOURCE_UNAVAILABLE", "SEASON_INELIGIBLE", "IDENTITY_CONFLICT", "INVALID_TASK"]) assert.match(contract, new RegExp(code));
});

test("manual task endpoint exposes the approved operation", async () => {
  const modulePath = "../../src/seasons/manual-active-task.controller.js";
  const controller = await import(modulePath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ERR_MODULE_NOT_FOUND") return null;
    throw error;
  });
  assert.equal(typeof controller?.createManualActiveTaskApp, "function", "manual task endpoint is not yet wired");
});

test("create endpoint returns authoritative 201 and exact-replay 200 receipts", async () => {
  const modulePath = "../../src/seasons/manual-active-task.controller.js";
  const controller = await import(modulePath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ERR_MODULE_NOT_FOUND") return null;
    throw error;
  });
  assert.ok(controller?.createManualActiveTaskApp, "manual task endpoint is not yet wired");
  const seasonId = "00000000-0000-4000-8000-000000000001";
  const receipt = { taskId: "00000000-0000-4000-8000-000000000002", mutationId: "00000000-0000-4000-8000-000000000003", seasonId, fieldId: "00000000-0000-4000-8000-000000000004", title: "Kontrol", plannedLocalDate: "2026-10-31", sourceKind: "MANUAL", templateVersionId: null, acceptedAt: "2026-10-31T00:00:00.000Z" };
  let replay = false;
  const app = await controller.createManualActiveTaskApp({ verify: async () => ({ provider: "supabase", subject: "owner" }), create: async () => ({ replay, receipt }) });
  await app.init(); await app.getHttpAdapter().getInstance().ready();
  try {
    const payload = { taskId: receipt.taskId, mutationId: receipt.mutationId, title: receipt.title, plannedLocalDate: receipt.plannedLocalDate };
    const first = await app.inject({ method: "POST", url: `/v1/seasons/${seasonId}/manual-tasks`, headers: { authorization: "Bearer valid" }, payload });
    assert.equal(first.statusCode, 201); assert.deepEqual(first.json(), receipt);
    replay = true;
    const again = await app.inject({ method: "POST", url: `/v1/seasons/${seasonId}/manual-tasks`, headers: { authorization: "Bearer valid" }, payload });
    assert.equal(again.statusCode, 200); assert.deepEqual(again.json(), receipt);
  } finally { await app.close(); }
});

test("endpoint maps typed create failures without disclosing resource details", async () => {
  const modulePath = "../../src/seasons/manual-active-task.controller.js";
  const controller = await import(modulePath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ERR_MODULE_NOT_FOUND") return null;
    throw error;
  });
  assert.ok(controller?.createManualActiveTaskApp && controller?.ManualTaskCommandError, "typed manual task endpoint is not yet wired");
  const seasonId = "00000000-0000-4000-8000-000000000001";
  for (const [status, code] of [[400,"INVALID_COMMAND"],[403,"ACCESS_DENIED"],[404,"RESOURCE_UNAVAILABLE"],[409,"SEASON_INELIGIBLE"],[409,"IDENTITY_CONFLICT"],[422,"INVALID_TASK"]] as const) {
    const app = await controller.createManualActiveTaskApp({ verify: async () => ({ provider: "supabase", subject: "owner" }), create: async () => { throw new controller.ManualTaskCommandError(status, code); } });
    await app.init(); await app.getHttpAdapter().getInstance().ready();
    try {
      const response = await app.inject({ method: "POST", url: `/v1/seasons/${seasonId}/manual-tasks`, headers: { authorization: "Bearer valid" }, payload: { taskId: "00000000-0000-4000-8000-000000000002", mutationId: "00000000-0000-4000-8000-000000000003", title: "x", plannedLocalDate: "2026-10-31" } });
      assert.equal(response.statusCode, status); assert.equal(response.json().error.code, code);
    } finally { await app.close(); }
  }
});
