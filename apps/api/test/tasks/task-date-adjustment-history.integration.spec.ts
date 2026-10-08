import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../src/generated/prisma/client.js";
import { SeasonActivationRepository } from "../../src/seasons/seasons-activation.repository.js";
import { TaskDateAdjustmentRepository } from "../../src/tasks/task-date-adjustment.repository.js";
import { assertDisposableDatabaseUrl } from "../support/disposable-database.js";

const databaseUrl = process.env.DATABASE_URL;
assertDisposableDatabaseUrl(databaseUrl);
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const run = randomUUID(), businessId = randomUUID(), fieldId = randomUUID(), userId = randomUUID();
const cropId = randomUUID(), templateId = randomUUID(), seasonId = randomUUID(), taskId = randomUUID();
const firstAdjustmentId = randomUUID(), secondAdjustmentId = randomUUID();
const firstInternalId = `ffffffff-ffff-4fff-8fff-${run.slice(-12)}`;
const secondInternalId = `00000000-0000-4000-8000-${run.slice(-12)}`;
const identity = { provider: "adjustment-history-test", subject: run };
const repository = new TaskDateAdjustmentRepository(prisma, () => new Date("2026-10-08T12:00:00.000Z"));

before(async () => {
  await prisma.$connect();
  await prisma.business.create({ data: { id: businessId, timezone: "Europe/Istanbul" } });
  await prisma.applicationUser.create({ data: { id: userId, authProvider: identity.provider, authSubject: identity.subject, defaultBusinessId: businessId } });
  await prisma.membership.create({ data: { userId, businessId, role: "OWNER", status: "ACTIVE" } });
  await prisma.$executeRaw`INSERT INTO fields (id,business_id,name,representative_point) VALUES (${fieldId}::uuid,${businessId}::uuid,'Adjustment history fixture',ST_SetSRID(ST_MakePoint(29,41),4326))`;
  await prisma.cropDefinitionVersion.create({ data: { id: cropId, cropKey: `adjustment-history-${run}`, version: "1", displayName: "Fixture crop" } });
  await prisma.validatedTemplateVersion.create({ data: { id: templateId, templateKey: `adjustment-history-template-${run}`, version: "1", cropDefinitionVersionId: cropId, taskDefinitions: [] } });
  await prisma.season.create({ data: { id: seasonId, businessId, fieldId, cropKey: `adjustment-history-${run}`, cropDefinitionVersionId: cropId,
    actualPlantingDate: new Date("2026-09-01T00:00:00Z"), status: "DRAFT", version: 1,
    plan: { create: { source: "VALIDATED_TEMPLATE", templateVersionId: templateId, sourceSnapshot: { source: "VALIDATED_TEMPLATE", templateProvenance: { templateVersionId: templateId } }, status: "DRAFT",
      tasks: { create: { id: taskId, title: "Inspect crop", plannedLocalDate: new Date("2026-09-29T00:00:00Z"), version: 1 } } } } } });
  await new SeasonActivationRepository(prisma).activate(identity, seasonId, 1, randomUUID());
  await repository.adjust(identity, taskId, 1, { adjustmentId: firstAdjustmentId, newPlannedLocalDate: "2026-10-10" });
  await repository.adjust(identity, taskId, 2, { adjustmentId: secondAdjustmentId, newPlannedLocalDate: "2026-10-11" });
  await prisma.taskDateAdjustment.update({ where: { businessId_adjustmentId: { businessId, adjustmentId: firstAdjustmentId } }, data: { id: firstInternalId } });
  await prisma.taskDateAdjustment.update({ where: { businessId_adjustmentId: { businessId, adjustmentId: secondAdjustmentId } }, data: { id: secondInternalId } });
  const acceptedVersions = await prisma.taskDateAdjustment.findMany({ where: { plannedTaskId: taskId }, orderBy: { acceptedTaskVersion: "asc" }, select: { acceptedTaskVersion: true } });
  assert.deepEqual(acceptedVersions.map(({ acceptedTaskVersion }) => acceptedTaskVersion), [2, 3]);
});

after(async () => { await prisma.$disconnect(); });

test("history returns current canonical state and bounded newest-first retained snapshots", async () => {
  const page = await repository.readHistory(identity, taskId, { limit: 1 });
  assert.equal(page.task.taskId, taskId);
  assert.equal(page.task.plannedLocalDate, "2026-10-11");
  assert.equal(page.task.taskVersion, 3);
  assert.equal(page.task.adjustable, true);
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0]?.previousPlannedLocalDate, "2026-10-10");
  assert.equal(page.items[0]?.newPlannedLocalDate, "2026-10-11");
  assert.equal(page.items[0]?.adjustedAt, "2026-10-08T12:00:00.000Z");
  assert.ok(page.nextCursor);
  const older = await repository.readHistory(identity, taskId, { limit: 1, cursor: page.nextCursor! });
  assert.equal(older.items[0]?.previousPlannedLocalDate, "2026-09-29");
  assert.equal(older.items[0]?.newPlannedLocalDate, "2026-10-10");
  assert.equal(older.nextCursor, null);
});
