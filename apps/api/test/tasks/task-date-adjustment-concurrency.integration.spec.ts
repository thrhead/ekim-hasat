import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../src/generated/prisma/client.js";
import { SeasonActivationRepository } from "../../src/seasons/seasons-activation.repository.js";
import { TaskCompletionRepository } from "../../src/tasks/task-completion.repository.js";
import { TaskCompletionError } from "../../src/tasks/task-completion.error.js";
import { TaskDateAdjustmentRepository } from "../../src/tasks/task-date-adjustment.repository.js";
import { TaskDateAdjustmentError } from "../../src/tasks/task-date-adjustment.error.js";
import { assertDisposableDatabaseUrl } from "../support/disposable-database.js";

const databaseUrl = process.env.DATABASE_URL;
assertDisposableDatabaseUrl(databaseUrl);
const prismaUrl = new URL(databaseUrl!);
prismaUrl.searchParams.set("application_name", "spec008-adjustment-race");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: prismaUrl.toString() }) });
const run = randomUUID(), businessId = randomUUID(), fieldId = randomUUID(), userId = randomUUID();
const cropId = randomUUID(), templateId = randomUUID(), seasonId = randomUUID();
const raceTask = randomUUID(), completeFirstTask = randomUUID(), adjustFirstTask = randomUUID(), rollbackTask = randomUUID();
const identity = { provider: "adjustment-concurrency-test", subject: run };
const adjustments = new TaskDateAdjustmentRepository(prisma);
const completions = new TaskCompletionRepository(prisma);

before(async () => {
  await prisma.$connect();
  await prisma.business.create({ data: { id: businessId, timezone: "Europe/Istanbul" } });
  await prisma.applicationUser.create({ data: { id: userId, authProvider: identity.provider, authSubject: identity.subject, defaultBusinessId: businessId } });
  await prisma.membership.create({ data: { userId, businessId, role: "OWNER", status: "ACTIVE" } });
  await prisma.$executeRaw`INSERT INTO fields (id,business_id,name,representative_point) VALUES (${fieldId}::uuid,${businessId}::uuid,'Adjustment concurrency fixture',ST_SetSRID(ST_MakePoint(29,41),4326))`;
  await prisma.cropDefinitionVersion.create({ data: { id: cropId, cropKey: `adjustment-race-${run}`, version: "1", displayName: "Fixture crop" } });
  await prisma.validatedTemplateVersion.create({ data: { id: templateId, templateKey: `adjustment-race-template-${run}`, version: "1", cropDefinitionVersionId: cropId, taskDefinitions: [] } });
  const taskIds = [raceTask, completeFirstTask, adjustFirstTask, rollbackTask];
  await prisma.season.create({ data: { id: seasonId, businessId, fieldId, cropKey: `adjustment-race-${run}`, cropDefinitionVersionId: cropId,
    actualPlantingDate: new Date("2026-09-01T00:00:00Z"), status: "DRAFT", version: 1,
    plan: { create: { source: "VALIDATED_TEMPLATE", templateVersionId: templateId, sourceSnapshot: { source: "VALIDATED_TEMPLATE", templateProvenance: { templateVersionId: templateId } }, status: "DRAFT",
      tasks: { create: taskIds.map((id) => ({ id, title: "Inspect crop", plannedLocalDate: new Date("2026-09-29T00:00:00Z"), version: 1 })) } } } } });
  await new SeasonActivationRepository(prisma).activate(identity, seasonId, 1, randomUUID());
});

after(async () => { await prisma.$disconnect(); });

test("same-base concurrent new commands commit at most one canonical transition", async () => {
  const blocker = new Client({ connectionString: databaseUrl });
  const observer = new Client({ connectionString: databaseUrl });
  await blocker.connect(); await observer.connect();
  await blocker.query("BEGIN");
  await blocker.query("SELECT id FROM planned_tasks WHERE id = $1::uuid FOR UPDATE", [raceTask]);
  const commands = [
    adjustments.adjust(identity, raceTask, 1, { adjustmentId: randomUUID(), newPlannedLocalDate: "2026-10-10" }),
    adjustments.adjust(identity, raceTask, 1, { adjustmentId: randomUUID(), newPlannedLocalDate: "2026-10-11" }),
  ];
  try {
    let waiting = 0;
    const deadline = Date.now() + 10_000;
    while (waiting < 2 && Date.now() < deadline) {
      const result = await observer.query(`SELECT count(*)::int AS count FROM pg_stat_activity
        WHERE datname = current_database() AND application_name = 'spec008-adjustment-race' AND wait_event_type = 'Lock'`);
      waiting = result.rows[0]?.count ?? 0;
      if (waiting < 2) await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.ok(waiting >= 2, "both API transactions must reach the held task lock before release");
  } catch (error) {
    await blocker.query("ROLLBACK");
    await Promise.allSettled(commands);
    await blocker.end(); await observer.end();
    throw error;
  }
  await blocker.query("COMMIT");
  const results = await Promise.allSettled(commands);
  await blocker.end(); await observer.end();
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const winner = results.find((result) => result.status === "fulfilled") as PromiseFulfilledResult<Awaited<ReturnType<typeof adjustments.adjust>>>;
  const loser = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
  assert.equal(winner.value.kind, "accepted");
  assert.ok(loser.reason instanceof TaskDateAdjustmentError);
  assert.equal(loser.reason.presentation.code, "TASK_VERSION_CONFLICT");
  const task = await prisma.plannedTask.findUniqueOrThrow({ where: { id: raceTask } });
  assert.equal(task.version, 2);
  assert.equal(task.plannedLocalDate.toISOString().slice(0, 10), winner.value.adjustment.newPlannedLocalDate);
  assert.equal(await prisma.taskDateAdjustment.count({ where: { plannedTaskId: raceTask } }), 1);
});

test("completion-first rejects adjustment; adjustment-first completion conflicts then snapshots canonical date", async () => {
  await completions.complete(identity, completeFirstTask, 1, { completionId: randomUUID(), occurredAt: "2026-10-08T10:00:00.000Z" });
  await assert.rejects(adjustments.adjust(identity, completeFirstTask, 1, { adjustmentId: randomUUID(), newPlannedLocalDate: "2026-10-12" }),
    (error: unknown) => error instanceof TaskDateAdjustmentError && error.presentation.code === "TASK_ALREADY_COMPLETED");
  assert.equal(await prisma.taskDateAdjustment.count({ where: { plannedTaskId: completeFirstTask } }), 0);

  await adjustments.adjust(identity, adjustFirstTask, 1, { adjustmentId: randomUUID(), newPlannedLocalDate: "2026-10-13" });
  await assert.rejects(completions.complete(identity, adjustFirstTask, 1, { completionId: randomUUID(), occurredAt: "2026-10-08T10:00:00.000Z" }),
    (error: unknown) => error instanceof TaskCompletionError && error.presentation.code === "TASK_VERSION_CONFLICT");
  const accepted = await completions.complete(identity, adjustFirstTask, 2, { completionId: randomUUID(), occurredAt: "2026-10-08T10:01:00.000Z" });
  assert.equal(accepted.completion.plannedLocalDate, "2026-10-13");
  assert.equal(await prisma.taskDateAdjustment.count({ where: { plannedTaskId: adjustFirstTask } }), 1);
});

test("history insert failure rolls back canonical task date and version", async () => {
  await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION reject_spec008_adjustment_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced adjustment history failure'; END $$`);
  await prisma.$executeRawUnsafe(`CREATE TRIGGER reject_spec008_adjustment_insert BEFORE INSERT ON task_date_adjustments FOR EACH ROW EXECUTE FUNCTION reject_spec008_adjustment_insert()`);
  try {
    await assert.rejects(adjustments.adjust(identity, rollbackTask, 1, { adjustmentId: randomUUID(), newPlannedLocalDate: "2026-10-14" }), /forced adjustment history failure/);
  } finally {
    await prisma.$executeRawUnsafe("DROP TRIGGER IF EXISTS reject_spec008_adjustment_insert ON task_date_adjustments");
    await prisma.$executeRawUnsafe("DROP FUNCTION IF EXISTS reject_spec008_adjustment_insert()");
  }
  const task = await prisma.plannedTask.findUniqueOrThrow({ where: { id: rollbackTask } });
  assert.equal(task.plannedLocalDate.toISOString().slice(0, 10), "2026-09-29");
  assert.equal(task.version, 1);
  assert.equal(await prisma.taskDateAdjustment.count({ where: { plannedTaskId: rollbackTask } }), 0);
});

test("the ACTIVE-task guard still rejects non-date edits", async () => {
  const before = await prisma.plannedTask.findUniqueOrThrow({ where: { id: raceTask } });
  await assert.rejects(prisma.plannedTask.updateMany({ where: { id: raceTask }, data: { title: "Unauthorized title change" } }));
  const after = await prisma.plannedTask.findUniqueOrThrow({ where: { id: raceTask } });
  assert.equal(after.title, before.title);
  assert.equal(after.plannedLocalDate.toISOString(), before.plannedLocalDate.toISOString());
  assert.equal(after.version, before.version);
});

test("the ACTIVE-task guard rejects date changes for completed tasks", async () => {
  const completed = await prisma.plannedTask.findUniqueOrThrow({ where: { id: completeFirstTask } });
  await assert.rejects(prisma.plannedTask.updateMany({ where: { id: completeFirstTask }, data: {
    plannedLocalDate: new Date("2026-10-15T00:00:00Z"), version: { increment: 1 },
  } }));
  const after = await prisma.plannedTask.findUniqueOrThrow({ where: { id: completeFirstTask } });
  assert.equal(after.plannedLocalDate.toISOString(), completed.plannedLocalDate.toISOString());
  assert.equal(after.version, completed.version);
});

test("the ACTIVE-task guard rejects date changes while the plan is not approved", async () => {
  const plan = await prisma.seasonPlan.findUniqueOrThrow({ where: { seasonId } });
  await prisma.seasonPlan.update({ where: { id: plan.id }, data: { status: "DRAFT" } });
  try {
    await assert.rejects(prisma.plannedTask.updateMany({ where: { id: raceTask }, data: {
      plannedLocalDate: new Date("2026-10-16T00:00:00Z"), version: { increment: 1 },
    } }));
  } finally {
    await prisma.seasonPlan.update({ where: { id: plan.id }, data: { status: "APPROVED" } });
  }
});
