import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../src/generated/prisma/client.js";
import { SeasonPlanTaskRepository } from "../../src/seasons/seasons-plan-task.repository.js";
import { SeasonCommandError } from "../../src/seasons/seasons-command.error.js";
import { BusinessScopeForbiddenError } from "../../src/authorization/membership-scope.service.js";
import { NotFoundException } from "@nestjs/common";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const run = randomUUID();
const businessId = randomUUID(), otherBusinessId = randomUUID(), fieldId = randomUUID(), otherFieldId = randomUUID();
const userId = randomUUID(), otherUserId = randomUUID();
const identity = { provider: "plan-task-test", subject: run };
const foreign = { provider: identity.provider, subject: `${run}-foreign` };
const cropId = randomUUID(), templateId = randomUUID(), seasonId = randomUUID(), activeSeasonId = randomUUID(), planId = randomUUID(), seededTaskId = randomUUID(), foreignSeasonId = randomUUID();
const repository = new SeasonPlanTaskRepository(prisma, () => new Date("2026-09-29T00:00:00Z"));
const add = (expectedVersion: number, key: string, body: unknown, who = identity, id = seasonId) => repository.addTask(who, id, expectedVersion, key, body);
const edit = (expectedVersion: number, body: unknown, taskId = seededTaskId, who = identity, id = seasonId) => repository.editTask(who, id, taskId, expectedVersion, body);
const remove = (expectedVersion: number, taskId = seededTaskId, who = identity, id = seasonId) => repository.removeTask(who, id, taskId, expectedVersion);

async function expectCommandError(action: () => Promise<unknown>, code: string, status: number) {
  await assert.rejects(action, (error: unknown) => {
    assert.ok(error instanceof SeasonCommandError);
    assert.equal(error.presentation.code, code);
    assert.equal(error.getStatus(), status);
    return true;
  });
}

before(async () => {
  await prisma.$connect();
  await prisma.business.createMany({ data: [{ id: businessId }, { id: otherBusinessId }] });
  await prisma.applicationUser.createMany({ data: [
    { id: userId, authProvider: identity.provider, authSubject: identity.subject, defaultBusinessId: businessId },
    { id: otherUserId, authProvider: foreign.provider, authSubject: foreign.subject, defaultBusinessId: otherBusinessId },
  ] });
  await prisma.membership.createMany({ data: [
    { userId, businessId, role: "OWNER", status: "ACTIVE" },
    { userId: otherUserId, businessId: otherBusinessId, role: "OWNER", status: "ACTIVE" },
  ] });
  await prisma.$executeRaw`INSERT INTO fields (id,business_id,name,representative_point) VALUES (${fieldId}::uuid,${businessId}::uuid,'Fixture field',ST_SetSRID(ST_MakePoint(29,41),4326)),(${otherFieldId}::uuid,${otherBusinessId}::uuid,'Foreign field',ST_SetSRID(ST_MakePoint(29,41),4326))`;
  await prisma.cropDefinitionVersion.create({ data: { id: cropId, cropKey: `task-fixture-${run}`, version: "1", displayName: "Fixture crop" } });
  await prisma.validatedTemplateVersion.create({ data: { id: templateId, templateKey: `task-template-${run}`, version: "1", cropDefinitionVersionId: cropId, taskDefinitions: [{ key: "seed", title: "Seed task", offsetDays: 3 }] } });
  await prisma.season.create({ data: { id: seasonId, businessId, fieldId, cropKey: `task-fixture-${run}`, cropDefinitionVersionId: cropId,
    actualPlantingDate: new Date("2026-09-28T00:00:00Z"), status: "DRAFT", version: 1,
    plan: { create: { id: planId, source: "VALIDATED_TEMPLATE", templateVersionId: templateId,
      sourceSnapshot: { source: "VALIDATED_TEMPLATE", templateProvenance: { templateVersionId: templateId } }, status: "DRAFT",
      tasks: { create: { id: seededTaskId, title: "Seed task", description: null, plannedLocalDate: new Date("2026-10-01T00:00:00Z"), sourceTemplateTaskKey: "template-key", version: 1 } } } },
  } });
  const foreignCropId = randomUUID();
  await prisma.customCrop.create({ data: { id: foreignCropId, businessId: otherBusinessId, displayName: "Foreign crop" } });
  await prisma.season.create({ data: { id: foreignSeasonId, businessId: otherBusinessId, fieldId: otherFieldId, customCropId: foreignCropId,
    actualPlantingDate: new Date("2026-09-28T00:00:00Z"), plan: { create: { source: "MANUAL", sourceSnapshot: { source: "MANUAL" }, status: "DRAFT" } },
  } });
  await prisma.season.create({ data: { id: activeSeasonId, businessId, fieldId, cropKey: `task-fixture-${run}`, cropDefinitionVersionId: cropId,
    actualPlantingDate: new Date("2026-09-27T00:00:00Z"), status: "ACTIVE", activatedAt: new Date("2026-09-29T00:00:00Z"), version: 1,
    plan: { create: { source: "MANUAL", sourceSnapshot: { source: "MANUAL" }, status: "APPROVED" } },
  } });
});

after(async () => {
  try {
    await prisma.seasonCommandIdempotencyRecord.deleteMany({ where: { businessId: { in: [businessId, otherBusinessId] } } });
    await prisma.plannedTask.deleteMany({ where: { seasonPlan: { season: { businessId: { in: [businessId, otherBusinessId] } } } } });
    await prisma.seasonPlan.deleteMany({ where: { season: { businessId: { in: [businessId, otherBusinessId] } } } });
    await prisma.season.deleteMany({ where: { businessId: { in: [businessId, otherBusinessId] } } });
    await prisma.validatedTemplateVersion.deleteMany({ where: { id: templateId } });
    await prisma.cropDefinitionVersion.deleteMany({ where: { id: cropId } });
    await prisma.customCrop.deleteMany({ where: { businessId: otherBusinessId } });
    await prisma.field.deleteMany({ where: { id: { in: [fieldId, otherFieldId] } } });
    await prisma.applicationUser.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
    await prisma.business.deleteMany({ where: { id: { in: [businessId, otherBusinessId] } } });
  } finally { await prisma.$disconnect(); }
});

test("transactional add/edit/remove preserve source and unrelated tasks, version state, and add replay", async () => {
  const key = randomUUID();
  const first = await add(1, key, { title: "  Scout field  ", description: "Farmer note", plannedLocalDate: "2026-09-28" });
  assert.equal(first.kind, "updated");
  assert.equal(first.season.version, 2);
  assert.equal(first.season.status, "DRAFT");
  assert.equal(first.season.plan.source.kind, "VALIDATED_TEMPLATE");
  assert.equal(first.season.plan.tasks.length, 2);
  const added = first.season.plan.tasks.find((task) => task.title === "Scout field");
  assert.ok(added);
  assert.equal(added.plannedLocalDate, "2026-09-28");
  assert.equal(added.version, 1);
  assert.deepEqual(await add(1, key, { title: "  Scout field  ", description: "Farmer note", plannedLocalDate: "2026-09-28" }), { ...first, kind: "replayed" });
  await expectCommandError(() => add(1, key, { title: "Changed payload", plannedLocalDate: "2026-09-28" }), "IDEMPOTENCY_KEY_REUSED", 409);

  const edited = await edit(2, { title: "Updated title", plannedLocalDate: "2026-10-02" });
  assert.equal(edited.season.version, 3);
  assert.equal(edited.season.plan.tasks.length, 2);
  assert.equal(edited.season.plan.tasks.find((task) => task.id === seededTaskId)?.title, "Updated title");
  const persisted = await prisma.plannedTask.findUniqueOrThrow({ where: { id: seededTaskId } });
  assert.equal(persisted.sourceTemplateTaskKey, "template-key");
  assert.equal(persisted.version, 2);

  await expectCommandError(() => edit(3, { plannedLocalDate: "2026-09-27" }), "INVALID_REQUEST", 400);
  assert.equal((await prisma.season.findUniqueOrThrow({ where: { id: seasonId } })).version, 3);

  const removed = await remove(3, added.id);
  assert.equal(removed.season.version, 4);
  assert.deepEqual(removed.season.plan.tasks.map((task) => task.id), [seededTaskId]);
  await expectCommandError(() => remove(3, seededTaskId), "STALE_SEASON_VERSION", 409);
});

test("failed add rolls back the season version, task, and idempotency outcome atomically", async () => {
  const beforeTasks = await prisma.plannedTask.count({ where: { seasonPlanId: planId } });
  const beforeVersion = (await prisma.season.findUniqueOrThrow({ where: { id: seasonId } })).version;
  const previous = process.env.SEASON_IDEMPOTENCY_RETENTION_HOURS;
  process.env.SEASON_IDEMPOTENCY_RETENTION_HOURS = "invalid";
  const key = randomUUID();
  try { await assert.rejects(() => add(beforeVersion, key, { title: "Will rollback", plannedLocalDate: "2026-10-05" }), /retention/); }
  finally { if (previous === undefined) delete process.env.SEASON_IDEMPOTENCY_RETENTION_HOURS; else process.env.SEASON_IDEMPOTENCY_RETENTION_HOURS = previous; }
  assert.equal(await prisma.plannedTask.count({ where: { seasonPlanId: planId } }), beforeTasks);
  assert.equal((await prisma.season.findUniqueOrThrow({ where: { id: seasonId } })).version, beforeVersion);
  assert.equal(await prisma.seasonCommandIdempotencyRecord.count({ where: { businessId, key, command: "ADD_PLAN_TASK" } }), 0);
});

test("ACTIVE seasons reject every task mutation; cross-business or missing task IDs do not expose records", async () => {
  await expectCommandError(() => add(1, randomUUID(), { title: "No", plannedLocalDate: "2026-10-05" }, identity, activeSeasonId), "SEASON_NOT_DRAFT", 409);
  await expectCommandError(() => edit(1, { title: "No" }, seededTaskId, identity, activeSeasonId), "SEASON_NOT_DRAFT", 409);
  await expectCommandError(() => remove(1, seededTaskId, identity, activeSeasonId), "SEASON_NOT_DRAFT", 409);
  await assert.rejects(() => add(1, randomUUID(), { title: "Foreign", plannedLocalDate: "2026-09-28" }, identity, foreignSeasonId), NotFoundException);
  await assert.rejects(() => edit(4, { title: "Foreign" }, randomUUID()), NotFoundException);
  await assert.rejects(() => remove(4, randomUUID()), NotFoundException);
  assert.equal(await prisma.plannedTask.count({ where: { seasonPlanId: planId } }), 1);
  await prisma.membership.update({ where: { businessId_userId: { businessId, userId } }, data: { status: "REVOKED" } });
  try { await assert.rejects(() => add(4, randomUUID(), { title: "Revoked", plannedLocalDate: "2026-09-28" }), BusinessScopeForbiddenError); }
  finally { await prisma.membership.update({ where: { businessId_userId: { businessId, userId } }, data: { status: "ACTIVE" } }); }
});
