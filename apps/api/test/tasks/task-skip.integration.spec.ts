import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../src/generated/prisma/client.js";
import { SeasonActivationRepository } from "../../src/seasons/seasons-activation.repository.js";
import { TaskCompletionRepository } from "../../src/tasks/task-completion.repository.js";
import { TaskDateAdjustmentRepository } from "../../src/tasks/task-date-adjustment.repository.js";
import { TaskSkipRepository } from "../../src/tasks/task-skip.repository.js";
import { TaskSkipError } from "../../src/tasks/task-skip.error.js";
import { BusinessScopeForbiddenError } from "../../src/authorization/membership-scope.service.js";
import { NotFoundException } from "@nestjs/common";
import { assertDisposableDatabaseUrl } from "../support/disposable-database.js";

const databaseUrl = process.env.DATABASE_URL;
assertDisposableDatabaseUrl(databaseUrl);
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });
const run = randomUUID();
const businessA = randomUUID(), businessB = randomUUID();
const fieldA = randomUUID(), fieldB = randomUUID();
const userA = randomUUID(), userA2 = randomUUID(), userB = randomUUID();
const cropId = randomUUID(), templateId = randomUUID();
const seasonA = randomUUID(), seasonB = randomUUID();
const mainTask = randomUUID(), staleTask = randomUUID(), completedTask = randomUUID(), alreadySkippedTask = randomUUID();
const exactRaceTask = randomUUID(), distinctRaceTask = randomUUID(), crossBusinessTask = randomUUID();
const identityA = { provider: "task-skip-integration", subject: `${run}-a` };
const identityA2 = { provider: "task-skip-integration", subject: `${run}-a2` };
const identityB = { provider: "task-skip-integration", subject: `${run}-b` };
const activation = new SeasonActivationRepository(prisma);
const completion = new TaskCompletionRepository(prisma);
const adjustment = new TaskDateAdjustmentRepository(prisma);
const skip = new TaskSkipRepository(prisma, () => new Date("2026-10-09T09:30:00.000Z"));
const taskIdsA = [mainTask, staleTask, completedTask, alreadySkippedTask, exactRaceTask, distinctRaceTask];

before(async () => {
  // This must remain the first database connection in the suite and precede fixture writes.
  const probe = new Client({ connectionString: databaseUrl });
  await probe.connect();
  try {
    const current = await probe.query<{ name: string }>("SELECT current_database() AS name");
    assert.equal(current.rows[0]?.name, "ekim_hasat_test", "writable Skip integration tests require the guarded disposable database");
  } finally {
    await probe.end();
  }

  await prisma.$connect();
  await prisma.business.createMany({ data: [{ id: businessA }, { id: businessB }] });
  await prisma.applicationUser.createMany({ data: [
    { id: userA, authProvider: identityA.provider, authSubject: identityA.subject, defaultBusinessId: businessA },
    { id: userA2, authProvider: identityA2.provider, authSubject: identityA2.subject, defaultBusinessId: businessA },
    { id: userB, authProvider: identityB.provider, authSubject: identityB.subject, defaultBusinessId: businessB },
  ] });
  await prisma.membership.createMany({ data: [
    { userId: userA, businessId: businessA, role: "OWNER", status: "ACTIVE" },
    { userId: userA2, businessId: businessA, role: "OWNER", status: "ACTIVE" },
    { userId: userB, businessId: businessB, role: "OWNER", status: "ACTIVE" },
  ] });
  await prisma.$executeRaw`INSERT INTO fields (id,business_id,name,representative_point) VALUES
    (${fieldA}::uuid,${businessA}::uuid,'Skip integration A',ST_SetSRID(ST_MakePoint(29,41),4326)),
    (${fieldB}::uuid,${businessB}::uuid,'Skip integration B',ST_SetSRID(ST_MakePoint(29,41),4326))`;
  await prisma.cropDefinitionVersion.create({ data: { id: cropId, cropKey: `skip-integration-${run}`, version: "1", displayName: "Fixture crop" } });
  const template = await prisma.validatedTemplateVersion.create({ data: {
    id: templateId, templateKey: `skip-integration-template-${run}`, version: "1", cropDefinitionVersionId: cropId, taskDefinitions: [],
  } });
  const createSeason = (id: string, businessId: string, fieldId: string, taskIds: readonly string[], label: string) => prisma.season.create({
    data: { id, businessId, fieldId, cropKey: `skip-integration-${run}`, cropDefinitionVersionId: cropId,
      actualPlantingDate: new Date("2026-09-01T00:00:00.000Z"), status: "DRAFT", version: 1,
      plan: { create: { source: "VALIDATED_TEMPLATE", templateVersionId: template.id,
        sourceSnapshot: { source: "VALIDATED_TEMPLATE", templateProvenance: { templateVersionId: template.id } }, status: "DRAFT",
        tasks: { create: taskIds.map((id, index) => ({ id, title: `${label} task ${index + 1}`,
          plannedLocalDate: new Date("2026-09-29T00:00:00.000Z"), sourceTemplateTaskKey: `${label}-${index}`, version: 1 })) },
      } },
    },
  });
  await createSeason(seasonA, businessA, fieldA, taskIdsA, "a");
  await createSeason(seasonB, businessB, fieldB, [crossBusinessTask], "b");
  await activation.activate(identityA, seasonA, 1, randomUUID());
  await activation.activate(identityB, seasonB, 1, randomUUID());
});

after(async () => { await prisma.$disconnect(); });

const command = (skipId = randomUUID()) => ({ skipId });
const codeIs = (expected: string) => (error: unknown) =>
  error instanceof TaskSkipError && error.presentation.code === expected;

test("accepted Skip snapshots the adjusted task once and an exact stale-version retry returns the original result", async () => {
  const beforeTask = await prisma.plannedTask.findUniqueOrThrow({ where: { id: mainTask } });
  await assert.rejects(prisma.plannedTask.updateMany({ where: { id: mainTask }, data: { version: { increment: 1 } } }),
    /ACTIVE season tasks are read-only/);
  await assert.rejects(prisma.plannedTask.updateMany({ where: { id: mainTask }, data: { title: "unapproved active-task edit" } }),
    /ACTIVE season tasks are read-only/);
  assert.equal((await prisma.plannedTask.findUniqueOrThrow({ where: { id: mainTask } })).version, beforeTask.version);
  assert.equal(await prisma.taskSkip.count({ where: { plannedTaskId: mainTask } }), 0);
  const moved = await adjustment.adjust(identityA, mainTask, 1, {
    adjustmentId: randomUUID(), newPlannedLocalDate: "2026-10-12",
  });
  assert.equal(moved.kind, "accepted");
  const beforeSkip = await prisma.plannedTask.findUniqueOrThrow({ where: { id: mainTask } });
  const adjustmentCount = await prisma.taskDateAdjustment.count({ where: { plannedTaskId: mainTask } });
  const adjustmentHistory = await prisma.taskDateAdjustment.findMany({ where: { plannedTaskId: mainTask }, orderBy: { id: "asc" } });
  const completionCount = await prisma.taskCompletion.count({ where: { plannedTaskId: mainTask } });
  const payload = command();

  const first = await skip.skip(identityA, mainTask, beforeSkip.version, payload);
  assert.equal(first.kind, "accepted");
  const event = await prisma.taskSkip.findUniqueOrThrow({ where: { businessId_skipId: { businessId: businessA, skipId: payload.skipId } } });
  const membership = await prisma.membership.findUniqueOrThrow({ where: { businessId_userId: { businessId: businessA, userId: userA } } });
  assert.equal(event.plannedTaskId, mainTask);
  assert.equal(event.seasonId, seasonA);
  assert.equal(event.fieldId, fieldA);
  assert.equal(event.businessId, businessA);
  assert.equal(event.actorUserId, userA);
  assert.equal(event.actorMembershipId, membership.id);
  assert.equal(event.skippedAt.toISOString(), "2026-10-09T09:30:00.000Z");
  assert.equal(event.baseTaskVersion, beforeSkip.version);
  assert.equal(event.acceptedTaskVersion, beforeSkip.version + 1);
  assert.equal(event.taskTitleSnapshot, beforeSkip.title);
  assert.equal(event.plannedLocalDateSnapshot.toISOString().slice(0, 10), "2026-10-12");
  assert.equal(first.skip.acceptedTaskVersion, beforeSkip.version + 1);
  const afterTask = await prisma.plannedTask.findUniqueOrThrow({ where: { id: mainTask } });
  assert.equal(afterTask.version, beforeSkip.version + 1);
  assert.equal(afterTask.plannedLocalDate.toISOString().slice(0, 10), "2026-10-12");
  assert.equal(afterTask.plannedLocalDate.toISOString().slice(0, 10), beforeSkip.plannedLocalDate.toISOString().slice(0, 10));
  assert.equal(await prisma.taskSkip.count({ where: { plannedTaskId: mainTask } }), 1);
  assert.equal(await prisma.taskDateAdjustment.count({ where: { plannedTaskId: mainTask } }), adjustmentCount);
  assert.deepEqual(await prisma.taskDateAdjustment.findMany({ where: { plannedTaskId: mainTask }, orderBy: { id: "asc" } }), adjustmentHistory);
  assert.equal(await prisma.taskCompletion.count({ where: { plannedTaskId: mainTask } }), completionCount);
  assert.equal(completionCount, 0);

  const replay = await skip.skip(identityA, mainTask, beforeSkip.version, payload);
  assert.equal(replay.kind, "replayed");
  assert.deepEqual(replay.skip, first.skip);
  assert.equal(await prisma.taskSkip.count({ where: { plannedTaskId: mainTask } }), 1);
  assert.equal((await prisma.plannedTask.findUniqueOrThrow({ where: { id: mainTask } })).version, beforeSkip.version + 1);

  assert.notEqual(beforeTask.plannedLocalDate.toISOString().slice(0, 10), "2026-10-12");
});

test("stale versions, completed tasks, already skipped tasks, and changed command payloads are rejected without extra events", async () => {
  await assert.rejects(skip.skip(identityA, staleTask, 2, command()), codeIs("TASK_VERSION_CONFLICT"));
  assert.equal(await prisma.taskSkip.count({ where: { plannedTaskId: staleTask } }), 0);
  assert.equal((await prisma.plannedTask.findUniqueOrThrow({ where: { id: staleTask } })).version, 1);

  await completion.complete(identityA, completedTask, 1, { completionId: randomUUID(), occurredAt: "2026-10-09T09:00:00.000Z" });
  await assert.rejects(skip.skip(identityA, completedTask, 1, command()), codeIs("TASK_ALREADY_COMPLETED"));
  assert.equal(await prisma.taskSkip.count({ where: { plannedTaskId: completedTask } }), 0);
  assert.equal(await prisma.taskCompletion.count({ where: { plannedTaskId: completedTask } }), 1);

  const alreadySkipped = command();
  await skip.skip(identityA, alreadySkippedTask, 1, alreadySkipped);
  await assert.rejects(skip.skip(identityA, alreadySkippedTask, 2, command()), codeIs("TASK_ALREADY_SKIPPED"));
  assert.equal(await prisma.taskSkip.count({ where: { plannedTaskId: alreadySkippedTask } }), 1);
  assert.equal((await prisma.plannedTask.findUniqueOrThrow({ where: { id: alreadySkippedTask } })).version, 2);

  await assert.rejects(skip.skip(identityA, mainTask, 3, command((await prisma.taskSkip.findFirstOrThrow({ where: { plannedTaskId: mainTask } })).skipId)),
    codeIs("IDEMPOTENCY_KEY_REUSED"));
  assert.equal(await prisma.taskSkip.count({ where: { plannedTaskId: mainTask } }), 1);
});

test("current authorization hides foreign tasks and revoked membership denies even an exact replay", async () => {
  const sharedSkipId = randomUUID();
  await assert.rejects(skip.skip(identityA, crossBusinessTask, 1, command(sharedSkipId)), NotFoundException);
  assert.equal(await prisma.taskSkip.count({ where: { skipId: sharedSkipId } }), 0);

  const own = await skip.skip(identityA, staleTask, 1, command(sharedSkipId));
  assert.equal(own.kind, "accepted");
  // A public command ID is independently scoped by Business; it does not disclose or collide with A's row.
  const otherBusiness = await skip.skip(identityB, crossBusinessTask, 1, command(sharedSkipId));
  assert.equal(otherBusiness.kind, "accepted");
  assert.equal(await prisma.taskSkip.count({ where: { skipId: sharedSkipId } }), 2);

  await prisma.membership.update({ where: { businessId_userId: { businessId: businessA, userId: userA } }, data: { status: "REVOKED" } });
  try {
    await assert.rejects(skip.skip(identityA, staleTask, 1, command(sharedSkipId)), BusinessScopeForbiddenError);
  } finally {
    await prisma.membership.update({ where: { businessId_userId: { businessId: businessA, userId: userA } }, data: { status: "ACTIVE" } });
  }
  assert.equal(await prisma.taskSkip.count({ where: { businessId: businessA, skipId: sharedSkipId } }), 1);
});

test("concurrent exact requests replay one accepted Skip; distinct commands produce one terminal winner", async () => {
  const exactCommand = command();
  const exact = await Promise.all([
    skip.skip(identityA, exactRaceTask, 1, exactCommand),
    skip.skip(identityA, exactRaceTask, 1, exactCommand),
  ]);
  assert.deepEqual(exact.map((result) => result.kind).sort(), ["accepted", "replayed"]);
  assert.equal(await prisma.taskSkip.count({ where: { plannedTaskId: exactRaceTask } }), 1);
  assert.equal((await prisma.plannedTask.findUniqueOrThrow({ where: { id: exactRaceTask } })).version, 2);

  const distinct = await Promise.allSettled([
    skip.skip(identityA, distinctRaceTask, 1, command()),
    skip.skip(identityA2, distinctRaceTask, 1, command()),
  ]);
  assert.equal(distinct.filter((result) => result.status === "fulfilled").length, 1);
  const loser = distinct.find((result): result is PromiseRejectedResult => result.status === "rejected");
  assert.ok(loser);
  assert.ok(loser.reason instanceof TaskSkipError);
  assert.equal(loser.reason.presentation.code, "TASK_ALREADY_SKIPPED");
  assert.equal(await prisma.taskSkip.count({ where: { plannedTaskId: distinctRaceTask } }), 1);
  assert.equal((await prisma.plannedTask.findUniqueOrThrow({ where: { id: distinctRaceTask } })).version, 2);
});
