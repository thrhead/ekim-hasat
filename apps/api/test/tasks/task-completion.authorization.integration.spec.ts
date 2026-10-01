import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../src/generated/prisma/client.js";
import { TaskCompletionRepository } from "../../src/tasks/task-completion.repository.js";
import { BusinessScopeForbiddenError } from "../../src/authorization/membership-scope.service.js";
import { NotFoundException } from "@nestjs/common";
import { SeasonActivationRepository } from "../../src/seasons/seasons-activation.repository.js";
import { assertDisposableDatabaseUrl } from "../support/disposable-database.js";

const databaseUrl = process.env.DATABASE_URL;
assertDisposableDatabaseUrl(databaseUrl);
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const run = randomUUID(), businessId = randomUUID(), foreignBusinessId = randomUUID(), fieldId = randomUUID(), foreignFieldId = randomUUID(), userId = randomUUID();
const foreignUserId = randomUUID(), cropId = randomUUID(), templateId = randomUUID(), seasonId = randomUUID(), taskId = randomUUID(), foreignSeasonId = randomUUID(), foreignTaskId = randomUUID();
const identity = { provider: "completion-auth", subject: run };
const repository = new TaskCompletionRepository(prisma);
const activation = new SeasonActivationRepository(prisma);
const command = () => ({ completionId: randomUUID(), occurredAt: "2026-09-29T08:00:00.000Z" });

before(async () => {
  await prisma.$connect();
  await prisma.business.createMany({ data: [{ id: businessId }, { id: foreignBusinessId }] });
  await prisma.applicationUser.createMany({ data: [{ id: userId, authProvider: identity.provider, authSubject: identity.subject, defaultBusinessId: businessId }, { id: foreignUserId, authProvider: "completion-auth", authSubject: `${run}-foreign`, defaultBusinessId: foreignBusinessId }] });
  await prisma.membership.createMany({ data: [{ userId, businessId, role: "OWNER", status: "ACTIVE" }, { userId: foreignUserId, businessId: foreignBusinessId, role: "OWNER", status: "ACTIVE" }] });
  await prisma.$executeRaw`INSERT INTO fields (id,business_id,name,representative_point) VALUES (${fieldId}::uuid,${businessId}::uuid,'Auth fixture',ST_SetSRID(ST_MakePoint(29,41),4326)),(${foreignFieldId}::uuid,${foreignBusinessId}::uuid,'Foreign',ST_SetSRID(ST_MakePoint(29,41),4326))`;
  await prisma.cropDefinitionVersion.create({ data: { id: cropId, cropKey: `auth-${run}`, version: "1", displayName: "Fixture" } });
  const template = await prisma.validatedTemplateVersion.create({ data: { id: templateId, templateKey: `auth-template-${run}`, version: "1", cropDefinitionVersionId: cropId, taskDefinitions: [] } });
  const createSeason = (id: string, bId: string, fId: string, task: string, suffix: string) => prisma.season.create({ data: { id, businessId: bId, fieldId: fId, cropKey: `auth-${run}`, cropDefinitionVersionId: cropId, actualPlantingDate: new Date("2026-09-01Z"), status: "DRAFT", version: 1,
    plan: { create: { source: "VALIDATED_TEMPLATE", templateVersionId: template.id, sourceSnapshot: { source: "VALIDATED_TEMPLATE", templateProvenance: { templateVersionId: template.id } }, status: "DRAFT", tasks: { create: { id: task, title: "Check", plannedLocalDate: new Date("2026-09-29Z"), sourceTemplateTaskKey: suffix, version: 1 } } } } } });
  await createSeason(seasonId, businessId, fieldId, taskId, "local");
  await createSeason(foreignSeasonId, foreignBusinessId, foreignFieldId, foreignTaskId, "foreign");
  await activation.activate(identity, seasonId, 1, randomUUID());
  await activation.activate({ provider: "completion-auth", subject: `${run}-foreign` }, foreignSeasonId, 1, randomUUID());
});

after(async () => { await prisma.$disconnect(); });

test("membership is revalidated at synchronization and client context never selects another business", async () => {
  const originalDefault = await prisma.applicationUser.findUniqueOrThrow({ where: { id: userId } });
  await prisma.membership.update({ where: { businessId_userId: { businessId, userId } }, data: { status: "REVOKED" } });
  try { await assert.rejects(repository.complete(identity, taskId, 1, command()), BusinessScopeForbiddenError); }
  finally { await prisma.membership.update({ where: { businessId_userId: { businessId, userId } }, data: { status: "ACTIVE" } }); }
  assert.equal(originalDefault.defaultBusinessId, businessId);
  await assert.rejects(repository.complete(identity, foreignTaskId, 1, command()), NotFoundException);
  assert.equal(await prisma.taskCompletion.count({ where: { plannedTaskId: { in: [taskId, foreignTaskId] } } }), 0);
});

test("replay does not disclose result after membership revocation", async () => {
  const payload = command();
  await repository.complete(identity, taskId, 1, payload);
  await prisma.membership.update({ where: { businessId_userId: { businessId, userId } }, data: { status: "REVOKED" } });
  try { await assert.rejects(repository.complete(identity, taskId, 1, payload), BusinessScopeForbiddenError); }
  finally { await prisma.membership.update({ where: { businessId_userId: { businessId, userId } }, data: { status: "ACTIVE" } }); }
});
