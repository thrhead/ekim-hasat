import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createManualTaskFixture } from "../support/spec014-fixture.js";
import { ManualActiveTaskRepository } from "../../src/seasons/manual-active-task.repository.js";
import { SeasonReadRepository } from "../../src/seasons/seasons-read.repository.js";

test("active manual additions do not become approved-plan members or mutate the snapshot", async () => {
  const f = await createManualTaskFixture();
  try {
    const reads = new SeasonReadRepository(f.prisma);
    const before = await reads.readSeason(f.users.OWNER.identity, f.seasonId);
    const snapshot = await f.prisma.seasonContextSnapshot.findUnique({ where: { seasonId: f.seasonId } });
    const taskId = randomUUID();
    await new ManualActiveTaskRepository(f.prisma).create(f.users.OWNER.identity, f.seasonId, { taskId, mutationId: randomUUID(), title: "New work", plannedLocalDate: "2024-01-01" });
    const after = await reads.readSeason(f.users.OWNER.identity, f.seasonId);
    assert.deepEqual(after.plan, before.plan);
    assert.equal(after.plan.tasks.some(task => task.id === taskId), false);
    assert.deepEqual(await f.prisma.seasonContextSnapshot.findUnique({ where: { seasonId: f.seasonId } }), snapshot);
    assert.equal(await f.prisma.plannedTask.count({ where: { id: taskId } }), 1);
  } finally { await f.close(); }
});

test("season read supplies current role and independently checked plan status for capture", async () => {
  const f = await createManualTaskFixture();
  try {
    const reads = new SeasonReadRepository(f.prisma);
    const owner = await reads.readSeason(f.users.OWNER.identity, f.seasonId);
    assert.equal(owner.viewerRole, "OWNER"); assert.equal(owner.plan.status, "APPROVED");
    const worker = await reads.readSeason(f.users.WORKER.identity, f.seasonId);
    assert.equal(worker.viewerRole, "WORKER"); assert.equal(worker.plan.status, "APPROVED");
  } finally { await f.close(); }
});
