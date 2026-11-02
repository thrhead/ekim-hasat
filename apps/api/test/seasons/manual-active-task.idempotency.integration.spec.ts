import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createManualTaskFixture } from "../support/spec014-fixture.js";

test("concurrent exact retries converge and replay original receipt after task changes", async () => {
  const path = "../../src/seasons/manual-active-task.repository.js";
  const module = await import(path).catch((error: NodeJS.ErrnoException) => { if (error.code === "ERR_MODULE_NOT_FOUND") return null; throw error; });
  assert.ok(module?.ManualActiveTaskRepository, "manual task repository is not implemented");
  const f = await createManualTaskFixture();
  try {
    const repository = new module.ManualActiveTaskRepository(f.prisma);
    const command = { taskId: randomUUID(), mutationId: randomUUID(), title: "Kontrol", plannedLocalDate: "2024-01-01" };
    const beforePlan = await f.prisma.seasonPlan.findUnique({ where: { id: f.planId } });
    const beforeSnapshot = await f.prisma.seasonContextSnapshot.findUnique({ where: { seasonId: f.seasonId } });
    const [a,b] = await Promise.all([repository.create(f.users.OWNER.identity, f.seasonId, command), repository.create(f.users.OWNER.identity, f.seasonId, command)]);
    assert.deepEqual(a.receipt, b.receipt);
    assert.deepEqual(await f.prisma.seasonPlan.findUnique({ where: { id: f.planId } }), beforePlan);
    assert.deepEqual(await f.prisma.seasonContextSnapshot.findUnique({ where: { seasonId: f.seasonId } }), beforeSnapshot);
    assert.deepEqual([a.replay,b.replay].sort(), [false,true]);
    assert.equal(await f.prisma.plannedTask.count({ where: { id: command.taskId } }), 1);
    await assert.rejects(repository.create(f.users.OWNER.identity, f.seasonId, { ...command, title: "changed" }));
    await assert.rejects(repository.create(f.users.OWNER.identity, f.seasonId, { ...command, taskId: randomUUID() }));
    await assert.rejects(repository.create(f.users.OWNER.identity, f.seasonId, { ...command, mutationId: randomUUID() }));
    const c = await f.pool.connect();
    try { await c.query("UPDATE planned_tasks SET planned_local_date='2024-01-02',version=version+1 WHERE id=$1", [command.taskId]); } finally { c.release(); }
    const replay = await repository.create(f.users.OWNER.identity, f.seasonId, command);
    assert.equal(replay.replay, true); assert.deepEqual(replay.receipt, a.receipt);
    const later = await f.pool.connect();
    const secondUser = randomUUID(), secondMembership = randomUUID();
    try {
      await later.query("INSERT INTO application_users(id,auth_provider,auth_subject,default_business_id) VALUES ($1,$2,'other-owner',$3)", [secondUser,f.users.OWNER.identity.provider,f.businessId]);
      await later.query("INSERT INTO memberships(id,business_id,user_id,role,status) VALUES ($1,$2,$3,'OWNER','ACTIVE')", [secondMembership,f.businessId,secondUser]);
      await later.query("UPDATE seasons SET status='DRAFT',activated_at=NULL WHERE id=$1", [f.seasonId]);
    } finally { later.release(); }
    await assert.rejects(repository.create({ ...f.users.OWNER.identity, subject: "other-owner" }, f.seasonId, command), (e: unknown) => (e as { presentation?: { code?: string } })?.presentation?.code === "IDENTITY_CONFLICT");
    const laterReplay = await repository.create(f.users.OWNER.identity, f.seasonId, command);
    assert.equal(laterReplay.replay, true); assert.deepEqual(laterReplay.receipt, a.receipt);
    const d = await f.pool.connect();
    try { await d.query("UPDATE memberships SET status='REVOKED' WHERE id=$1", [f.users.OWNER.member]); } finally { d.release(); }
    await assert.rejects(repository.create(f.users.OWNER.identity, f.seasonId, command));
  } finally { await f.close(); }
});

test("UUID casing does not break an exact accepted replay", async () => {
  const f = await createManualTaskFixture();
  try {
    const repository = new (await import("../../src/seasons/manual-active-task.repository.js")).ManualActiveTaskRepository(f.prisma);
    const command = { taskId: randomUUID().toUpperCase(), mutationId: randomUUID().toUpperCase(), title: "Task", plannedLocalDate: "2024-01-01" };
    const first = await repository.create(f.users.OWNER.identity, f.seasonId, command);
    const replay = await repository.create(f.users.OWNER.identity, f.seasonId, command);
    assert.equal(replay.replay, true); assert.deepEqual(replay.receipt, first.receipt);
  } finally { await f.close(); }
});
