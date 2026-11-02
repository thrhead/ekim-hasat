import assert from "node:assert/strict";
import { test } from "node:test";

test("create command rejects malformed shape and local dates before repository dispatch", async () => {
  const path = "../../src/seasons/manual-active-task.service.js";
  const service = await import(path).catch((error: NodeJS.ErrnoException) => { if (error.code === "ERR_MODULE_NOT_FOUND") return null; throw error; });
  assert.equal(typeof service?.parseManualActiveTaskInput, "function", "manual task command parser is not implemented");
  const good = { taskId: "00000000-0000-4000-8000-000000000001", mutationId: "00000000-0000-4000-8000-000000000002", title: "x", plannedLocalDate: "2024-02-29" };
  assert.deepEqual(service.parseManualActiveTaskInput(good), good);
  for (const bad of [null, {}, { ...good, businessId: "forged" }, { ...good, taskId: "bad" }, { ...good, plannedLocalDate: "2024-02-30" }, { ...good, plannedLocalDate: "2024-02-29T00:00:00Z" }]) {
    assert.throws(() => service.parseManualActiveTaskInput(bad), (e: unknown) => (e as { presentation?: { code?: string } })?.presentation?.code === "INVALID_COMMAND");
  }
});
