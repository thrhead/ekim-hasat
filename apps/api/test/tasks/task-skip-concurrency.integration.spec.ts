import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../src/generated/prisma/client.js";
import { SeasonActivationRepository } from "../../src/seasons/seasons-activation.repository.js";
import { TaskSkipRepository } from "../../src/tasks/task-skip.repository.js";
import { TaskSkipError } from "../../src/tasks/task-skip.error.js";
import { TaskCompletionRepository } from "../../src/tasks/task-completion.repository.js";
import { TaskCompletionError } from "../../src/tasks/task-completion.error.js";
import { TaskDateAdjustmentRepository } from "../../src/tasks/task-date-adjustment.repository.js";
import { TaskDateAdjustmentError } from "../../src/tasks/task-date-adjustment.error.js";
import { assertDisposableDatabaseUrl } from "../support/disposable-database.js";

const databaseUrl = process.env.DATABASE_URL;
assertDisposableDatabaseUrl(databaseUrl);
const prismaUrl = new URL(databaseUrl!); prismaUrl.searchParams.set("application_name", "spec009-terminal-race");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: prismaUrl.toString() }) });
const run = randomUUID(), businessId = randomUUID(), fieldId = randomUUID(), userId = randomUUID();
const cropId = randomUUID(), templateId = randomUUID(), seasonId = randomUUID();
const skipCompleteTask = randomUUID(), completeSkipTask = randomUUID(), skipAdjustTask = randomUUID(), adjustSkipTask = randomUUID();
const identity = { provider: "skip-terminal-race", subject: run };
const skips = new TaskSkipRepository(prisma), completions = new TaskCompletionRepository(prisma), adjustments = new TaskDateAdjustmentRepository(prisma);

before(async () => {
  const probe = new Client({ connectionString: databaseUrl }); await probe.connect();
  try { const current = await probe.query<{ name: string }>("SELECT current_database() AS name"); assert.equal(current.rows[0]?.name, "ekim_hasat_test", "terminal race tests require ekim_hasat_test"); }
  finally { await probe.end(); }
  await prisma.$connect();
  await prisma.business.create({ data: { id: businessId, timezone: "Europe/Istanbul" } });
  await prisma.applicationUser.create({ data: { id: userId, authProvider: identity.provider, authSubject: identity.subject, defaultBusinessId: businessId } });
  await prisma.membership.create({ data: { userId, businessId, role: "OWNER", status: "ACTIVE" } });
  await prisma.$executeRaw`INSERT INTO fields (id,business_id,name,representative_point) VALUES (${fieldId}::uuid,${businessId}::uuid,'Terminal race',ST_SetSRID(ST_MakePoint(29,41),4326))`;
  await prisma.cropDefinitionVersion.create({ data: { id: cropId, cropKey: `terminal-${run}`, version: "1", displayName: "Fixture" } });
  const template = await prisma.validatedTemplateVersion.create({ data: { id: templateId, templateKey: `terminal-${run}`, version: "1", cropDefinitionVersionId: cropId, taskDefinitions: [] } });
  await prisma.season.create({ data: { id: seasonId, businessId, fieldId, cropKey: `terminal-${run}`, cropDefinitionVersionId: cropId,
    actualPlantingDate: new Date("2026-09-01Z"), status: "DRAFT", version: 1,
    plan: { create: { source: "VALIDATED_TEMPLATE", templateVersionId: template.id,
      sourceSnapshot: { source: "VALIDATED_TEMPLATE", templateProvenance: { templateVersionId: template.id } }, status: "DRAFT",
      tasks: { create: [skipCompleteTask, completeSkipTask, skipAdjustTask, adjustSkipTask].map((id) => ({ id, title: "Inspect", plannedLocalDate: new Date("2026-09-29Z"), version: 1 })) } } } } });
  await new SeasonActivationRepository(prisma).activate(identity, seasonId, 1, randomUUID());
});
after(async () => { await prisma.$disconnect(); });

async function waitForLockWait(observer: Client, expected: number): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const result = await observer.query<{ count: number }>(`SELECT count(*)::int AS count FROM pg_stat_activity
      WHERE datname = current_database() AND application_name = 'spec009-terminal-race' AND wait_event_type = 'Lock'`);
    if ((result.rows[0]?.count ?? 0) >= expected) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`expected ${expected} terminal mutation(s) waiting for task lock`);
}

async function enqueueInOrder<T, U>(taskId: string, first: () => Promise<T>, second: () => Promise<U>): Promise<[PromiseSettledResult<T>, PromiseSettledResult<U>]> {
  const blocker = new Client({ connectionString: databaseUrl });
  const observer = new Client({ connectionString: databaseUrl });
  await blocker.connect(); await observer.connect(); await blocker.query("BEGIN");
  await blocker.query("SELECT id FROM planned_tasks WHERE id = $1::uuid FOR UPDATE", [taskId]);
  const firstPromise = first(); await waitForLockWait(observer, 1);
  const secondPromise = second(); await waitForLockWait(observer, 2);
  await blocker.query("COMMIT");
  const result = await Promise.allSettled([firstPromise, secondPromise]);
  await blocker.end(); await observer.end();
  return result;
}
const rejectedCode = (type: "skip" | "completion" | "adjustment", code: string) => (result: PromiseSettledResult<unknown>) => {
  assert.equal(result.status, "rejected");
  const error = (result as PromiseRejectedResult).reason;
  const valid = type === "skip" ? error instanceof TaskSkipError && error.presentation.code === code
    : type === "completion" ? error instanceof TaskCompletionError && error.presentation.code === code
      : error instanceof TaskDateAdjustmentError && error.presentation.code === code;
  assert.equal(valid, true, `expected ${type} error ${code}, got ${String(error)}`);
};

test("Skip wins when enqueued first; queued completion is TASK_NOT_ACTIONABLE", async () => {
  const results = await enqueueInOrder(skipCompleteTask,
    () => skips.skip(identity, skipCompleteTask, 1, { skipId: randomUUID() }),
    () => completions.complete(identity, skipCompleteTask, 1, { completionId: randomUUID(), occurredAt: "2026-10-09T08:00:00Z" }));
  assert.equal(results[0].status, "fulfilled"); assert.equal((results[0] as PromiseFulfilledResult<{ kind: string }>).value.kind, "accepted");
  rejectedCode("completion", "TASK_NOT_ACTIONABLE")(results[1]);
  assert.equal(await prisma.taskSkip.count({ where: { plannedTaskId: skipCompleteTask } }), 1);
  assert.equal(await prisma.taskCompletion.count({ where: { plannedTaskId: skipCompleteTask } }), 0);
});

test("completion wins when enqueued first; queued Skip is TASK_ALREADY_COMPLETED", async () => {
  const results = await enqueueInOrder(completeSkipTask,
    () => completions.complete(identity, completeSkipTask, 1, { completionId: randomUUID(), occurredAt: "2026-10-09T08:00:00Z" }),
    () => skips.skip(identity, completeSkipTask, 1, { skipId: randomUUID() }));
  assert.equal(results[0].status, "fulfilled"); rejectedCode("skip", "TASK_ALREADY_COMPLETED")(results[1]);
  assert.equal(await prisma.taskCompletion.count({ where: { plannedTaskId: completeSkipTask } }), 1);
  assert.equal(await prisma.taskSkip.count({ where: { plannedTaskId: completeSkipTask } }), 0);
});

test("Skip wins over queued date adjustment; adjustment is TASK_NOT_ACTIONABLE", async () => {
  const results = await enqueueInOrder(skipAdjustTask,
    () => skips.skip(identity, skipAdjustTask, 1, { skipId: randomUUID() }),
    () => adjustments.adjust(identity, skipAdjustTask, 1, { adjustmentId: randomUUID(), newPlannedLocalDate: "2026-10-15" }));
  assert.equal(results[0].status, "fulfilled"); rejectedCode("adjustment", "TASK_NOT_ACTIONABLE")(results[1]);
  assert.equal(await prisma.taskSkip.count({ where: { plannedTaskId: skipAdjustTask } }), 1);
  assert.equal(await prisma.taskDateAdjustment.count({ where: { plannedTaskId: skipAdjustTask } }), 0);
});

test("date adjustment wins when enqueued first; a stale queued Skip conflicts by version", async () => {
  const adjustmentId = randomUUID();
  const results = await enqueueInOrder(adjustSkipTask,
    () => adjustments.adjust(identity, adjustSkipTask, 1, { adjustmentId, newPlannedLocalDate: "2026-10-15" }),
    () => skips.skip(identity, adjustSkipTask, 1, { skipId: randomUUID() }));
  assert.equal(results[0].status, "fulfilled"); rejectedCode("skip", "TASK_VERSION_CONFLICT")(results[1]);
  assert.equal(await prisma.taskDateAdjustment.count({ where: { plannedTaskId: adjustSkipTask } }), 1);
  assert.equal(await prisma.taskSkip.count({ where: { plannedTaskId: adjustSkipTask } }), 0);
});
