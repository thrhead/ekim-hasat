import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { NotFoundException } from "@nestjs/common";
import { PrismaClient } from "../../src/generated/prisma/client.js";
import { SeasonActivationRepository } from "../../src/seasons/seasons-activation.repository.js";
import { TaskSkipRepository } from "../../src/tasks/task-skip.repository.js";
import { BusinessScopeForbiddenError } from "../../src/authorization/membership-scope.service.js";
import { assertDisposableDatabaseUrl } from "../support/disposable-database.js";

const databaseUrl = process.env.DATABASE_URL;
assertDisposableDatabaseUrl(databaseUrl);
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });
const run = randomUUID();
const businessA = randomUUID(), businessB = randomUUID();
const fieldA = randomUUID(), fieldB = randomUUID();
const userA = randomUUID(), userB = randomUUID(), noMemberUser = randomUUID();
const cropId = randomUUID(), templateId = randomUUID();
const seasonA = randomUUID(), seasonB = randomUUID();
const taskA = randomUUID(), taskA2 = randomUUID(), taskB = randomUUID();
const identityA = { provider: "skip-auth-test", subject: `${run}-a` };
const identityB = { provider: "skip-auth-test", subject: `${run}-b` };
const unauthorizedIdentity = { provider: "skip-auth-test", subject: `${run}-none` };
const skip = new TaskSkipRepository(prisma);
const activation = new SeasonActivationRepository(prisma);

before(async () => {
  const probe = new Client({ connectionString: databaseUrl });
  await probe.connect();
  try {
    const current = await probe.query<{ name: string }>("SELECT current_database() AS name");
    assert.equal(current.rows[0]?.name, "ekim_hasat_test", "writable Skip authorization tests require ekim_hasat_test");
  } finally { await probe.end(); }
  await prisma.$connect();
  await prisma.business.createMany({ data: [{ id: businessA }, { id: businessB }] });
  await prisma.applicationUser.createMany({ data: [
    { id: userA, authProvider: identityA.provider, authSubject: identityA.subject, defaultBusinessId: businessA },
    { id: userB, authProvider: identityB.provider, authSubject: identityB.subject, defaultBusinessId: businessB },
    { id: noMemberUser, authProvider: unauthorizedIdentity.provider, authSubject: unauthorizedIdentity.subject, defaultBusinessId: businessA },
  ] });
  await prisma.membership.createMany({ data: [
    { userId: userA, businessId: businessA, role: "OWNER", status: "ACTIVE" },
    { userId: userB, businessId: businessB, role: "OWNER", status: "ACTIVE" },
  ] });
  await prisma.$executeRaw`INSERT INTO fields (id,business_id,name,representative_point) VALUES
    (${fieldA}::uuid,${businessA}::uuid,'Skip auth A',ST_SetSRID(ST_MakePoint(29,41),4326)),
    (${fieldB}::uuid,${businessB}::uuid,'Skip auth B',ST_SetSRID(ST_MakePoint(29,41),4326))`;
  await prisma.cropDefinitionVersion.create({ data: { id: cropId, cropKey: `skip-auth-${run}`, version: "1", displayName: "Fixture" } });
  const template = await prisma.validatedTemplateVersion.create({ data: { id: templateId, templateKey: `skip-auth-template-${run}`, version: "1", cropDefinitionVersionId: cropId, taskDefinitions: [] } });
  const createSeason = (id: string, businessId: string, fieldId: string, taskIds: readonly string[]) => prisma.season.create({ data: {
    id, businessId, fieldId, cropKey: `skip-auth-${run}`, cropDefinitionVersionId: cropId,
    actualPlantingDate: new Date("2026-09-01T00:00:00Z"), status: "DRAFT", version: 1,
    plan: { create: { source: "VALIDATED_TEMPLATE", templateVersionId: template.id,
      sourceSnapshot: { source: "VALIDATED_TEMPLATE", templateProvenance: { templateVersionId: template.id } }, status: "DRAFT",
      tasks: { create: taskIds.map((id) => ({ id, title: "Check", plannedLocalDate: new Date("2026-09-29T00:00:00Z"), version: 1 })) } } },
  } });
  await createSeason(seasonA, businessA, fieldA, [taskA, taskA2]);
  await createSeason(seasonB, businessB, fieldB, [taskB]);
  await activation.activate(identityA, seasonA, 1, randomUUID());
  await activation.activate(identityB, seasonB, 1, randomUUID());
});
after(async () => { await prisma.$disconnect(); });

const command = (skipId = randomUUID()) => ({ skipId });

test("foreign task stays private and a user without active membership is denied", async () => {
  const foreignIdentity = command();
  await assert.rejects(skip.skip(identityA, taskB, 1, foreignIdentity), NotFoundException);
  await assert.rejects(skip.skip(unauthorizedIdentity, taskA, 1, command()), BusinessScopeForbiddenError);
  assert.equal(await prisma.taskSkip.count({ where: { skipId: foreignIdentity.skipId } }), 0);
});

test("exact retry is denied after membership revocation", async () => {
  const input = command();
  const accepted = await skip.skip(identityA, taskA, 1, input);
  assert.equal(accepted.kind, "accepted");
  await prisma.membership.update({ where: { businessId_userId: { businessId: businessA, userId: userA } }, data: { status: "REVOKED" } });
  try { await assert.rejects(skip.skip(identityA, taskA, 1, input), BusinessScopeForbiddenError); }
  finally { await prisma.membership.update({ where: { businessId_userId: { businessId: businessA, userId: userA } }, data: { status: "ACTIVE" } }); }
  assert.equal(await prisma.taskSkip.count({ where: { businessId: businessA, skipId: input.skipId } }), 1);
});

test("same public identity is isolated by Business", async () => {
  const shared = command();
  await skip.skip(identityB, taskB, 1, shared);
  const independent = await skip.skip(identityA, taskA2, 1, shared);
  assert.equal(independent.kind, "accepted");
  assert.equal(await prisma.taskSkip.count({ where: { skipId: shared.skipId } }), 2);
});
