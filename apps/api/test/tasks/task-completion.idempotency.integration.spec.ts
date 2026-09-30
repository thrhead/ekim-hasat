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
const run = randomUUID(), businessId = randomUUID(), foreignBusinessId = randomUUID(), fieldId = randomUUID(), foreignFieldId = randomUUID();
const userId = randomUUID(), otherUserId = randomUUID(), cropId = randomUUID(), seasonId = randomUUID(), taskA = randomUUID(), taskB = randomUUID(), taskC = randomUUID(), taskD = randomUUID(), taskE = randomUUID();
const identity = { provider: "completion-race", subject: run }, otherIdentity = { provider: "completion-race", subject: `${run}-other` };
const repository = new TaskCompletionRepository(prisma);
const activation = new SeasonActivationRepository(prisma);
const occurredAt = "2026-09-29T08:00:00.000Z";

before(async () => {
  await prisma.$connect();
  await prisma.business.createMany({ data: [{ id: businessId }, { id: foreignBusinessId }] });
  await prisma.applicationUser.createMany({ data: [
    { id: userId, authProvider: identity.provider, authSubject: identity.subject, defaultBusinessId: businessId },
    { id: otherUserId, authProvider: otherIdentity.provider, authSubject: otherIdentity.subject, defaultBusinessId: businessId },
  ] });
  await prisma.membership.createMany({ data: [
    { userId, businessId, role: "OWNER", status: "ACTIVE" }, { userId: otherUserId, businessId, role: "OWNER", status: "ACTIVE" },
  ] });
  await prisma.$executeRaw`INSERT INTO fields (id,business_id,name,representative_point) VALUES
    (${fieldId}::uuid,${businessId}::uuid,'Race fixture',ST_SetSRID(ST_MakePoint(29,41),4326)),
    (${foreignFieldId}::uuid,${foreignBusinessId}::uuid,'Foreign fixture',ST_SetSRID(ST_MakePoint(29,41),4326))`;
  await prisma.cropDefinitionVersion.create({ data: { id: cropId, cropKey: `race-${run}`, version: "1", displayName: "Fixture" } });
  const template = await prisma.validatedTemplateVersion.create({ data: { templateKey: `race-template-${run}`, version: "1", cropDefinitionVersionId: cropId, taskDefinitions: [] } });
  await prisma.season.create({ data: { id: seasonId, businessId, fieldId, cropKey: `race-${run}`, cropDefinitionVersionId: cropId, actualPlantingDate: new Date("2026-09-01Z"), status: "DRAFT", version: 1,
    plan: { create: { source: "VALIDATED_TEMPLATE", templateVersionId: template.id, sourceSnapshot: { source: "VALIDATED_TEMPLATE", templateProvenance: { templateVersionId: template.id } }, status: "DRAFT", tasks: { create: [taskA, taskB, taskC, taskD, taskE].map((id) => ({ id, title: id, plannedLocalDate: new Date("2026-09-29Z"), sourceTemplateTaskKey: id, version: 1 })) } } } } });
  await activation.activate(identity, seasonId, 1, randomUUID());
});

after(async () => { await prisma.$disconnect(); });

test("exact same ID and actor replays; changed payload or actor cannot replay another result", async () => {
  const completionId = randomUUID();
  const first = await repository.complete(identity, taskA, 1, { completionId, occurredAt });
  const retry = await repository.complete(identity, taskA, 1, { completionId, occurredAt });
  assert.equal(first.kind, "accepted"); assert.equal(retry.kind, "replayed"); assert.deepEqual(retry.completion, first.completion);
  await assert.rejects(repository.complete(identity, taskA, 1, { completionId, occurredAt: "2026-09-29T09:00:00.000Z" }), (error: unknown) => error instanceof TaskCompletionError && error.presentation.code === "IDEMPOTENCY_KEY_REUSED");
  const actorBoundId = randomUUID();
  await repository.complete(identity, taskC, 1, { completionId: actorBoundId, occurredAt });
  await assert.rejects(repository.complete(otherIdentity, taskC, 1, { completionId: actorBoundId, occurredAt }), (error: unknown) => error instanceof TaskCompletionError && error.presentation.code === "IDEMPOTENCY_KEY_REUSED");
});

test("different IDs racing one task commit one row; same ID racing different task locks resolves to stable conflict", async () => {
  const taskRace = await Promise.allSettled([
    repository.complete(identity, taskB, 1, { completionId: randomUUID(), occurredAt }),
    repository.complete(otherIdentity, taskB, 1, { completionId: randomUUID(), occurredAt }),
  ]);
  assert.equal(taskRace.filter((result) => result.status === "fulfilled").length, 1);
  const rejected = taskRace.find((result) => result.status === "rejected") as PromiseRejectedResult;
  assert.ok(rejected.reason instanceof TaskCompletionError); assert.equal(rejected.reason.presentation.code, "TASK_ALREADY_COMPLETED");

  const sharedId = randomUUID();
  const raced = await Promise.allSettled([
    repository.complete(identity, taskD, 1, { completionId: sharedId, occurredAt: "2026-09-29T10:00:00.000Z" }),
    repository.complete(identity, taskE, 1, { completionId: sharedId, occurredAt }),
  ]);
  assert.equal(raced.filter((result) => result.status === "fulfilled").length, 1, JSON.stringify(raced.map((result) => result.status === "rejected" ? String(result.reason) : result.value)));
  const loser = raced.find((result) => result.status === "rejected") as PromiseRejectedResult;
  assert.ok(loser.reason instanceof TaskCompletionError);
  assert.equal(loser.reason.presentation.code, "IDEMPOTENCY_KEY_REUSED");
  assert.equal(await prisma.taskCompletion.count({ where: { id: sharedId } }), 1);
});
