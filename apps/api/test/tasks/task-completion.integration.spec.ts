import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../src/generated/prisma/client.js";
import { TaskCompletionRepository } from "../../src/tasks/task-completion.repository.js";
import { TaskCompletionError } from "../../src/tasks/task-completion.error.js";
import { SeasonActivationRepository } from "../../src/seasons/seasons-activation.repository.js";
import { assertDisposableDatabaseUrl } from "../support/disposable-database.js";

const databaseUrl = process.env.DATABASE_URL;
assertDisposableDatabaseUrl(databaseUrl);
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const run = randomUUID(), businessId = randomUUID(), fieldId = randomUUID(), userId = randomUUID();
const cropId = randomUUID(), templateId = randomUUID(), seasonId = randomUUID(), taskId = randomUUID();
const identity = { provider: "completion-test", subject: run };
const repository = new TaskCompletionRepository(prisma, () => new Date("2026-09-29T12:00:00.000Z"));
const activation = new SeasonActivationRepository(prisma, () => new Date("2026-09-29T00:00:00.000Z"));
const occurredAt = "2026-09-29T07:45:00.000Z";

before(async () => {
  await prisma.$connect();
  await prisma.business.create({ data: { id: businessId, timezone: "Europe/Istanbul" } });
  await prisma.applicationUser.create({ data: { id: userId, authProvider: identity.provider, authSubject: identity.subject, defaultBusinessId: businessId } });
  await prisma.membership.create({ data: { userId, businessId, role: "OWNER", status: "ACTIVE" } });
  await prisma.$executeRaw`INSERT INTO fields (id,business_id,name,representative_point) VALUES (${fieldId}::uuid,${businessId}::uuid,'Completion fixture',ST_SetSRID(ST_MakePoint(29,41),4326))`;
  await prisma.cropDefinitionVersion.create({ data: { id: cropId, cropKey: `completion-${run}`, version: "1", displayName: "Fixture crop" } });
  await prisma.validatedTemplateVersion.create({ data: { id: templateId, templateKey: `completion-template-${run}`, version: "1", cropDefinitionVersionId: cropId, taskDefinitions: [{ key: "check", title: "Check", offsetDays: 1 }] } });
  await prisma.season.create({ data: { id: seasonId, businessId, fieldId, cropKey: `completion-${run}`, cropDefinitionVersionId: cropId,
    actualPlantingDate: new Date("2026-09-01T00:00:00Z"), status: "DRAFT", version: 1,
    plan: { create: { source: "VALIDATED_TEMPLATE", templateVersionId: templateId, sourceSnapshot: { source: "VALIDATED_TEMPLATE", templateProvenance: { templateVersionId: templateId } }, status: "DRAFT",
      tasks: { create: { id: taskId, title: "Check crop", description: "preserve", plannedLocalDate: new Date("2026-09-29T00:00:00Z"), sourceTemplateTaskKey: "check", version: 1 } } } } } });
  await activation.activate(identity, seasonId, 1, randomUUID());
});

after(async () => {
  await prisma.$disconnect();
});

test("first completion commits server time and snapshot without changing planned task or provenance", async () => {
  const completionId = randomUUID();
  const beforeTask = await prisma.plannedTask.findUniqueOrThrow({ where: { id: taskId } });
  const beforePlan = await prisma.seasonPlan.findUniqueOrThrow({ where: { seasonId } });
  const result = await repository.complete(identity, taskId, 1, { completionId, occurredAt });
  assert.equal(result.kind, "accepted");
  assert.equal(result.completion.id, completionId);
  const row = await prisma.taskCompletion.findUniqueOrThrow({ where: { id: completionId } });
  assert.equal(row.actorUserId, userId);
  assert.equal(row.actorMembershipId, (await prisma.membership.findUniqueOrThrow({ where: { businessId_userId: { businessId, userId } } })).id);
  assert.equal(row.occurredAt.toISOString(), occurredAt);
  assert.equal(row.recordedAt.toISOString(), "2026-09-29T12:00:00.000Z");
  assert.notEqual(row.recordedAt.toISOString(), occurredAt);
  assert.equal(row.baseTaskVersion, 1);
  assert.equal((await prisma.plannedTask.findUniqueOrThrow({ where: { id: taskId } })).title, beforeTask.title);
  assert.equal((await prisma.plannedTask.findUniqueOrThrow({ where: { id: taskId } })).version, beforeTask.version);
  assert.deepEqual((await prisma.seasonPlan.findUniqueOrThrow({ where: { seasonId } })).sourceSnapshot, beforePlan.sourceSnapshot);
  assert.equal((await prisma.seasonContextSnapshot.findUniqueOrThrow({ where: { seasonId } })).templateVersionId, templateId);
});

test("DRAFT season or unapproved plan cannot accept completion", async () => {
  const draftTaskId = randomUUID(), draftSeasonId = randomUUID();
  const draft = await prisma.season.create({ data: { id: draftSeasonId, businessId, fieldId, cropKey: `completion-${run}`, cropDefinitionVersionId: cropId,
    actualPlantingDate: new Date("2026-09-02T00:00:00Z"), status: "DRAFT", version: 1,
    plan: { create: { source: "MANUAL", sourceSnapshot: { source: "MANUAL" }, status: "DRAFT", tasks: { create: { id: draftTaskId, title: "Draft task", plannedLocalDate: new Date("2026-09-29T00:00:00Z"), version: 1 } } } } } });
  assert.equal(draft.status, "DRAFT");
  await assert.rejects(repository.complete(identity, draftTaskId, 1, { completionId: randomUUID(), occurredAt }), (error: unknown) => error instanceof TaskCompletionError && error.presentation.code === "TASK_NOT_ACTIONABLE");
});

test("stale task base version returns a stable conflict without writing a completion", async () => {
  const beforeCount = await prisma.taskCompletion.count({ where: { plannedTaskId: taskId } });
  await assert.rejects(repository.complete(identity, taskId, 2, { completionId: randomUUID(), occurredAt }),
    (error: unknown) => error instanceof TaskCompletionError && error.presentation.code === "TASK_VERSION_CONFLICT");
  assert.equal(await prisma.taskCompletion.count({ where: { plannedTaskId: taskId } }), beforeCount);
});
