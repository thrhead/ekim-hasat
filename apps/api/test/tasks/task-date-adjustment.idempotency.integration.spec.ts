import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../src/generated/prisma/client.js";
import { SeasonActivationRepository } from "../../src/seasons/seasons-activation.repository.js";
import { TaskDateAdjustmentRepository } from "../../src/tasks/task-date-adjustment.repository.js";
import { TaskDateAdjustmentError } from "../../src/tasks/task-date-adjustment.error.js";
import { assertDisposableDatabaseUrl } from "../support/disposable-database.js";

const databaseUrl = process.env.DATABASE_URL;
assertDisposableDatabaseUrl(databaseUrl);
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const run = randomUUID(), businessId = randomUUID(), fieldId = randomUUID(), userId = randomUUID();
const cropId = randomUUID(), templateId = randomUUID(), seasonId = randomUUID();
const taskA = randomUUID(), taskB = randomUUID(), taskC = randomUUID(), taskD = randomUUID(), taskE = randomUUID();
const identity = { provider: "adjustment-idempotency-test", subject: run };
const repository = new TaskDateAdjustmentRepository(prisma, () => new Date("2026-10-08T12:00:00.000Z"));

before(async () => {
  await prisma.$connect();
  await prisma.business.create({ data: { id: businessId, timezone: "Europe/Istanbul" } });
  await prisma.applicationUser.create({ data: { id: userId, authProvider: identity.provider, authSubject: identity.subject, defaultBusinessId: businessId } });
  await prisma.membership.create({ data: { userId, businessId, role: "OWNER", status: "ACTIVE" } });
  await prisma.$executeRaw`INSERT INTO fields (id,business_id,name,representative_point) VALUES (${fieldId}::uuid,${businessId}::uuid,'Adjustment fixture',ST_SetSRID(ST_MakePoint(29,41),4326))`;
  await prisma.cropDefinitionVersion.create({ data: { id: cropId, cropKey: `adjustment-${run}`, version: "1", displayName: "Fixture crop" } });
  await prisma.validatedTemplateVersion.create({ data: { id: templateId, templateKey: `adjustment-template-${run}`, version: "1", cropDefinitionVersionId: cropId, taskDefinitions: [] } });
  await prisma.season.create({ data: { id: seasonId, businessId, fieldId, cropKey: `adjustment-${run}`, cropDefinitionVersionId: cropId,
    actualPlantingDate: new Date("2026-09-01T00:00:00Z"), status: "DRAFT", version: 1,
    plan: { create: { source: "VALIDATED_TEMPLATE", templateVersionId: templateId, sourceSnapshot: { source: "VALIDATED_TEMPLATE", templateProvenance: { templateVersionId: templateId } }, status: "DRAFT",
      tasks: { create: [taskA, taskB, taskC, taskD, taskE].map((id) => ({ id, title: "Inspect crop", description: "preserve", plannedLocalDate: new Date("2026-09-29T00:00:00Z"), version: 1 })) } } } } });
  await new SeasonActivationRepository(prisma).activate(identity, seasonId, 1, randomUUID());
});

after(async () => { await prisma.$disconnect(); });

test("exact accepted replay survives later version advancement without duplicate history", async () => {
  const adjustmentId = randomUUID();
  const first = await repository.adjust(identity, taskA, 1, { adjustmentId, newPlannedLocalDate: "2026-10-10" });
  assert.equal(first.kind, "accepted");
  await repository.adjust(identity, taskA, 2, { adjustmentId: randomUUID(), newPlannedLocalDate: "2026-10-11" });
  const replay = await repository.adjust(identity, taskA, 1, { adjustmentId, newPlannedLocalDate: "2026-10-10" });
  assert.equal(replay.kind, "replayed");
  assert.deepEqual(replay.adjustment, first.adjustment);
  assert.equal((await prisma.plannedTask.findUniqueOrThrow({ where: { id: taskA } })).version, 3);
  assert.equal(await prisma.taskDateAdjustment.count({ where: { plannedTaskId: taskA } }), 2);
});

test("same Business ID with changed input conflicts; a new ID with stale version does not mutate", async () => {
  const adjustmentId = randomUUID();
  await repository.adjust(identity, taskB, 1, { adjustmentId, newPlannedLocalDate: "2026-10-10" });
  await assert.rejects(repository.adjust(identity, taskB, 1, { adjustmentId, newPlannedLocalDate: "2026-10-12" }),
    (error: unknown) => error instanceof TaskDateAdjustmentError && error.presentation.code === "IDEMPOTENCY_KEY_REUSED");
  await assert.rejects(repository.adjust(identity, taskB, 1, { adjustmentId: randomUUID(), newPlannedLocalDate: "2026-10-12" }),
    (error: unknown) => error instanceof TaskDateAdjustmentError && error.presentation.code === "TASK_VERSION_CONFLICT");
  assert.equal((await prisma.plannedTask.findUniqueOrThrow({ where: { id: taskB } })).plannedLocalDate.toISOString().slice(0, 10), "2026-10-10");
  assert.equal(await prisma.taskDateAdjustment.count({ where: { plannedTaskId: taskB } }), 1);
});

test("matching-version same-date command creates no accepted receipt or history", async () => {
  const adjustmentId = randomUUID();
  await assert.rejects(repository.adjust(identity, taskA, 3, { adjustmentId, newPlannedLocalDate: "2026-10-11" }),
    (error: unknown) => error instanceof TaskDateAdjustmentError && error.presentation.code === "NO_DATE_CHANGE");
  assert.equal(await prisma.taskDateAdjustment.findFirst({ where: { businessId, adjustmentId } }), null);
  assert.equal((await prisma.plannedTask.findUniqueOrThrow({ where: { id: taskA } })).version, 3);
});

test("same-ID insert race replays the exact winner and scopes changed-input recovery to its Business", async () => {
  const exactId = randomUUID();
  const exactRace = await Promise.all([
    repository.adjust(identity, taskC, 1, { adjustmentId: exactId, newPlannedLocalDate: "2026-10-10" }),
    repository.adjust(identity, taskC, 1, { adjustmentId: exactId, newPlannedLocalDate: "2026-10-10" }),
  ]);
  assert.deepEqual(exactRace.map((result) => result.kind).sort(), ["accepted", "replayed"]);
  assert.deepEqual(exactRace[0]?.adjustment, exactRace[1]?.adjustment);
  assert.equal(await prisma.taskDateAdjustment.count({ where: { businessId, adjustmentId: exactId } }), 1);

  const reusedId = randomUUID();
  const changedRace = await Promise.allSettled([
    repository.adjust(identity, taskD, 1, { adjustmentId: reusedId, newPlannedLocalDate: "2026-10-10" }),
    repository.adjust(identity, taskE, 1, { adjustmentId: reusedId, newPlannedLocalDate: "2026-10-12" }),
  ]);
  assert.equal(changedRace.filter((result) => result.status === "fulfilled").length, 1);
  const conflict = changedRace.find((result) => result.status === "rejected") as PromiseRejectedResult;
  assert.ok(conflict.reason instanceof TaskDateAdjustmentError);
  assert.equal(conflict.reason.presentation.code, "IDEMPOTENCY_KEY_REUSED");
  assert.equal(await prisma.taskDateAdjustment.count({ where: { businessId, adjustmentId: reusedId } }), 1);
});
