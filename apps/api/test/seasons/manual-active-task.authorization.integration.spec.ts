import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createManualTaskFixture } from "../support/spec014-fixture.js";

test("only a live OWNER can create within an eligible authorized season", async () => {
  const path = "../../src/seasons/manual-active-task.repository.js";
  const module = await import(path).catch((error: NodeJS.ErrnoException) => { if (error.code === "ERR_MODULE_NOT_FOUND") return null; throw error; });
  assert.ok(module?.ManualActiveTaskRepository, "manual task repository is not implemented");
  const f = await createManualTaskFixture();
  try {
    const repository = new module.ManualActiveTaskRepository(f.prisma);
    const payload = () => ({ taskId: randomUUID(), mutationId: randomUUID(), title: "Kontrol", plannedLocalDate: "2024-01-01" });
    const controller = await import("../../src/seasons/manual-active-task.controller.js");
    const app = await controller.createManualActiveTaskApp({ verify: async () => f.users.OWNER.identity, create: (identity, season, input) => repository.create(identity, season, input) });
    await app.init(); await app.getHttpAdapter().getInstance().ready();
    try {
      const body = payload();
      const first = await app.inject({ method: "POST", url: `/v1/seasons/${f.seasonId}/manual-tasks`, headers: { authorization: "Bearer valid" }, payload: body });
      assert.equal(first.statusCode, 201);
      const replay = await app.inject({ method: "POST", url: `/v1/seasons/${f.seasonId}/manual-tasks`, headers: { authorization: "Bearer valid" }, payload: body });
      assert.equal(replay.statusCode, 200); assert.deepEqual(replay.json(), first.json());
    } finally { await app.close(); }
    const accepted = await repository.create(f.users.OWNER.identity, f.seasonId, payload());
    assert.equal(accepted.replay, false);
    for (const role of ["WORKER", "ADVISOR", "FOREIGN"]) {
      await assert.rejects(repository.create(f.users[role].identity, f.seasonId, payload()));
    }
    await assert.rejects(repository.create(f.users.OWNER.identity, randomUUID(), payload()));
    await assert.rejects(repository.create(f.users.OWNER.identity, f.seasonId, { ...payload(), plannedLocalDate: "2023-12-31" }));
    await assert.rejects(repository.create(f.users.OWNER.identity, f.seasonId, { ...payload(), title: " " }));
    const state = await f.pool.connect();
    try {
      await state.query("UPDATE seasons SET status='DRAFT',activated_at=NULL WHERE id=$1", [f.seasonId]);
      await assert.rejects(repository.create(f.users.OWNER.identity, f.seasonId, payload()), (e: unknown) => (e as { presentation?: { code?: string } })?.presentation?.code === "SEASON_INELIGIBLE");
      await state.query("UPDATE seasons SET status='ACTIVE',activated_at=now() WHERE id=$1", [f.seasonId]);
      await state.query("UPDATE season_plans SET status='DRAFT' WHERE id=$1", [f.planId]);
      await assert.rejects(repository.create(f.users.OWNER.identity, f.seasonId, payload()), (e: unknown) => (e as { presentation?: { code?: string } })?.presentation?.code === "SEASON_INELIGIBLE");
      await state.query("UPDATE season_plans SET status='APPROVED' WHERE id=$1", [f.planId]);
    } finally { state.release(); }
    const c = await f.pool.connect();
    try { await c.query("UPDATE memberships SET status='REVOKED' WHERE id=$1", [f.users.OWNER.member]); } finally { c.release(); }
    await assert.rejects(repository.create(f.users.OWNER.identity, f.seasonId, payload()));
  } finally { await f.close(); }
});
