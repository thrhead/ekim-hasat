import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../src/generated/prisma/client.js";
import { SeasonActivationRepository } from "../../src/seasons/seasons-activation.repository.js";
import { SeasonPlanTaskRepository } from "../../src/seasons/seasons-plan-task.repository.js";
import { SeasonCommandError } from "../../src/seasons/seasons-command.error.js";
import { BusinessScopeForbiddenError } from "../../src/authorization/membership-scope.service.js";
import { NotFoundException } from "@nestjs/common";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const run = randomUUID();
const businessId = randomUUID(), otherBusinessId = randomUUID(), fieldId = randomUUID(), otherFieldId = randomUUID();
const userId = randomUUID(), otherUserId = randomUUID(), cropId = randomUUID(), templateId = randomUUID();
const seasonId = randomUUID(), emptySeasonId = randomUUID(), concurrentSeasonId = randomUUID(), rollbackSeasonId = randomUUID(), foreignSeasonId = randomUUID();
const identity = { provider: "activation-test", subject: run };
const foreign = { provider: identity.provider, subject: `${run}-foreign` };
const repository = new SeasonActivationRepository(prisma, () => new Date("2026-09-29T00:30:00.000Z"));
const planTaskRepository = new SeasonPlanTaskRepository(prisma, () => new Date("2026-09-29T00:30:00.000Z"));
const activate = (id = seasonId, version = 1, key = randomUUID(), who = identity) => repository.activate(who, id, version, key);

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
  await prisma.business.createMany({ data: [{ id: businessId, timezone: "Europe/Istanbul" }, { id: otherBusinessId }] });
  await prisma.applicationUser.createMany({ data: [
    { id: userId, authProvider: identity.provider, authSubject: identity.subject, defaultBusinessId: businessId },
    { id: otherUserId, authProvider: foreign.provider, authSubject: foreign.subject, defaultBusinessId: otherBusinessId },
  ] });
  await prisma.membership.createMany({ data: [
    { userId, businessId, role: "OWNER", status: "ACTIVE" },
    { userId: otherUserId, businessId: otherBusinessId, role: "OWNER", status: "ACTIVE" },
  ] });
  await prisma.$executeRaw`INSERT INTO fields (id,business_id,name,representative_point) VALUES
    (${fieldId}::uuid,${businessId}::uuid,'Activation fixture',ST_SetSRID(ST_MakePoint(29,41),4326)),
    (${otherFieldId}::uuid,${otherBusinessId}::uuid,'Foreign fixture',ST_SetSRID(ST_MakePoint(29,41),4326))`;
  await prisma.cropDefinitionVersion.create({ data: { id: cropId, cropKey: `activation-${run}`, version: "1", displayName: "Fixture crop" } });
  await prisma.validatedTemplateVersion.create({ data: { id: templateId, templateKey: `activation-template-${run}`, version: "1",
    cropDefinitionVersionId: cropId, taskDefinitions: [{ key: "check", title: "Check crop", offsetDays: 1 }] } });
  let dateOffset = 0;
  const createSeason = (id: string, taskCount: number, source: "MANUAL" | "VALIDATED_TEMPLATE" = "VALIDATED_TEMPLATE") => {
    const day = String(1 + dateOffset++).padStart(2, "0");
    return prisma.season.create({ data: {
    id, businessId, fieldId, cropKey: `activation-${run}`, cropDefinitionVersionId: cropId,
    actualPlantingDate: new Date(`2026-10-${day}T00:00:00Z`), status: "DRAFT", version: 1,
    plan: { create: { source, templateVersionId: source === "MANUAL" ? null : templateId,
      sourceSnapshot: { source, approvedContext: "fixture" }, status: "DRAFT",
      tasks: { create: Array.from({ length: taskCount }, (_, index) => ({ id: randomUUID(), title: `Task ${index + 1}`,
        description: null, plannedLocalDate: new Date(`2026-10-${day}T00:00:00Z`), sourceTemplateTaskKey: source === "MANUAL" ? null : `task-${index + 1}`, version: 1 })) } },
    } } });
  };
  await createSeason(seasonId, 1);
  await createSeason(emptySeasonId, 0, "MANUAL");
  await createSeason(concurrentSeasonId, 1, "MANUAL");
  await createSeason(rollbackSeasonId, 1, "MANUAL");
  const foreignCropId = randomUUID();
  await prisma.customCrop.create({ data: { id: foreignCropId, businessId: otherBusinessId, displayName: "Foreign crop" } });
  await prisma.season.create({ data: { id: foreignSeasonId, businessId: otherBusinessId, fieldId: otherFieldId, customCropId: foreignCropId,
    actualPlantingDate: new Date("2026-09-28T00:00:00Z"), plan: { create: { source: "MANUAL", sourceSnapshot: { source: "MANUAL" }, status: "DRAFT" } } } });
});

after(async () => {
  // Snapshot rows are intentionally immutable and database-protected from deletion.
  await prisma.$disconnect();
});

test("activation atomically saves active state, approved copied plan, snapshot, and exact idempotency result", async () => {
  const key = randomUUID();
  const first = await activate(seasonId, 1, key);
  assert.equal(first.kind, "activated");
  assert.equal(first.season.status, "ACTIVE");
  assert.equal(first.season.version, 2);
  assert.equal(first.season.plan.source.kind, "VALIDATED_TEMPLATE");
  assert.equal(first.season.plan.tasks.length, 1);
  const replay = await activate(seasonId, 1, key);
  assert.deepEqual(replay, { ...first, kind: "replayed" });
  await expectCommandError(() => activate(seasonId, 2, key), "IDEMPOTENCY_KEY_REUSED", 409);
  await expectCommandError(() => activate(seasonId, 1, randomUUID()), "SEASON_STATE_CONFLICT", 409);
  const persisted = await prisma.season.findUniqueOrThrow({ where: { id: seasonId }, include: { plan: { include: { tasks: true } }, snapshot: true } });
  assert.equal(persisted.status, "ACTIVE");
  assert.equal(persisted.version, 2);
  assert.equal(persisted.plan?.status, "APPROVED");
  assert.equal(persisted.snapshot?.source, "VALIDATED_TEMPLATE");
  assert.equal(persisted.snapshot?.businessTimezone, "Europe/Istanbul");
  const approvedTasks = (persisted.snapshot?.cropSnapshot as { approvedTasks: Array<{ title: string }> }).approvedTasks;
  assert.equal(approvedTasks.length, 1);
  assert.deepEqual(approvedTasks[0]?.title, "Task 1");
  assert.equal(await prisma.seasonContextSnapshot.count({ where: { seasonId } }), 1);
  assert.equal(await prisma.seasonCommandIdempotencyRecord.count({ where: { seasonId, command: "ACTIVATE" } }), 1);
  await assert.rejects(() => planTaskRepository.addTask(identity, seasonId, 2, "after-activation", {
    title: "Should remain unavailable", plannedLocalDate: "2026-10-01",
  }), (error: unknown) => error instanceof SeasonCommandError && error.presentation.code === "SEASON_NOT_DRAFT");
  await prisma.validatedTemplateVersion.create({ data: { templateKey: `activation-template-${run}`, version: "2",
    cropDefinitionVersionId: cropId, regionSelector: "activation-later-region",
    taskDefinitions: [{ key: "new", title: "New template task", offsetDays: 2 }] } });
  const unchanged = await prisma.season.findUniqueOrThrow({ where: { id: seasonId }, include: { plan: { include: { tasks: true } }, snapshot: true } });
  assert.equal(unchanged.plan?.tasks[0].title, "Task 1");
  assert.equal(unchanged.snapshot?.templateVersionId, templateId);
  const unchangedApprovedTasks = (unchanged.snapshot?.cropSnapshot as { approvedTasks: Array<{ title: string }> }).approvedTasks;
  assert.equal(unchangedApprovedTasks[0]?.title, "Task 1");
  await expectCommandError(() => activate(seasonId, 2, randomUUID()), "SEASON_STATE_CONFLICT", 409);
});

test("zero-task plan and stale version leave draft state untouched", async () => {
  await expectCommandError(() => activate(emptySeasonId, 1), "PLAN_HAS_NO_VALID_TASKS", 422);
  await expectCommandError(() => activate(emptySeasonId, 2), "STALE_VERSION", 409);
  const season = await prisma.season.findUniqueOrThrow({ where: { id: emptySeasonId }, include: { snapshot: true, plan: true } });
  assert.equal(season.status, "DRAFT");
  assert.equal(season.version, 1);
  assert.equal(season.plan?.status, "DRAFT");
  assert.equal(season.snapshot, null);
});

test("concurrent different keys produce one transition and one conflict, while same-key retries replay", async () => {
  const outcomes = await Promise.allSettled([activate(concurrentSeasonId, 1, "race-a"), activate(concurrentSeasonId, 1, "race-b")]);
  assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
  assert.equal(outcomes.filter((outcome) => outcome.status === "rejected").length, 1);
  const loser = outcomes.find((outcome) => outcome.status === "rejected") as PromiseRejectedResult;
  assert.ok(loser.reason instanceof SeasonCommandError);
  assert.equal(loser.reason.getStatus(), 409);
  assert.equal(loser.reason.presentation.code, "SEASON_STATE_CONFLICT");
  const state = await prisma.season.findUniqueOrThrow({ where: { id: concurrentSeasonId }, include: { snapshot: true } });
  assert.equal(state.status, "ACTIVE");
  assert.equal(state.version, 2);
  assert.ok(state.snapshot);
  assert.equal(await prisma.seasonContextSnapshot.count({ where: { seasonId: concurrentSeasonId } }), 1);
});

test("failed idempotency persistence rolls back activation and snapshot; scope failures do not disclose seasons", async () => {
  const previous = process.env.SEASON_IDEMPOTENCY_RETENTION_HOURS;
  process.env.SEASON_IDEMPOTENCY_RETENTION_HOURS = "invalid";
  try { await assert.rejects(() => activate(rollbackSeasonId, 1, "rollback-key"), /retention/); }
  finally { if (previous === undefined) delete process.env.SEASON_IDEMPOTENCY_RETENTION_HOURS; else process.env.SEASON_IDEMPOTENCY_RETENTION_HOURS = previous; }
  const concurrent = await prisma.season.findUniqueOrThrow({ where: { id: rollbackSeasonId }, include: { snapshot: true, plan: true } });
  assert.equal(concurrent.status, "DRAFT");
  assert.equal(concurrent.version, 1);
  assert.equal(concurrent.snapshot, null);
  assert.equal(concurrent.plan?.status, "DRAFT");
  assert.equal(await prisma.seasonCommandIdempotencyRecord.count({ where: { seasonId: rollbackSeasonId, key: "rollback-key" } }), 0);
  await assert.rejects(() => activate(foreignSeasonId), NotFoundException);
  await prisma.membership.update({ where: { businessId_userId: { businessId, userId } }, data: { status: "REVOKED" } });
  try { await assert.rejects(() => activate(seasonId), BusinessScopeForbiddenError); }
  finally { await prisma.membership.update({ where: { businessId_userId: { businessId, userId } }, data: { status: "ACTIVE" } }); }
});
