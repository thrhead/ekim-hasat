import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../src/generated/prisma/client.js";
import { BusinessScopeForbiddenError } from "../../src/authorization/membership-scope.service.js";
import { TaskCompletionRepository } from "../../src/tasks/task-completion.repository.js";
import { TaskCompletionError } from "../../src/tasks/task-completion.error.js";
import { SeasonActivationRepository } from "../../src/seasons/seasons-activation.repository.js";
import { assertDisposableDatabaseUrl } from "../support/disposable-database.js";

const databaseUrl = process.env.DATABASE_URL;
assertDisposableDatabaseUrl(databaseUrl);
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });
const businessId = randomUUID(), otherBusinessId = randomUUID(), userId = randomUUID(), otherUserId = randomUUID(), fieldId = randomUUID(), otherFieldId = randomUUID();
const cropId = randomUUID(), templateId = randomUUID();
const seasonA = randomUUID(), seasonB = randomUUID(), foreignSeason = randomUUID();
const taskA = randomUUID(), taskB = randomUUID(), taskC = randomUUID(), otherFieldTask = randomUUID();
const tieCompletionIds = [randomUUID(), randomUUID()].sort((left, right) => right.localeCompare(left));
const completionC = randomUUID();
const identity = { provider: "task-history-test", subject: randomUUID() };
const otherIdentity = { provider: "task-history-test", subject: randomUUID() };
const repository = new TaskCompletionRepository(prisma);
const activation = new SeasonActivationRepository(prisma);
const tieInstant = "2026-09-28T07:00:00.000Z";

before(async () => {
  await prisma.$connect();
  await prisma.business.createMany({ data: [{ id: businessId, timezone: "Asia/Tokyo" }, { id: otherBusinessId, timezone: "Europe/Istanbul" }] });
  await prisma.applicationUser.create({ data: { id: userId, authProvider: identity.provider, authSubject: identity.subject, defaultBusinessId: businessId } });
  await prisma.applicationUser.create({ data: { id: otherUserId, authProvider: otherIdentity.provider, authSubject: otherIdentity.subject, defaultBusinessId: otherBusinessId } });
  await prisma.membership.createMany({ data: [
    { userId, businessId, role: "OWNER", status: "ACTIVE" },
    { userId: otherUserId, businessId: otherBusinessId, role: "OWNER", status: "ACTIVE" },
  ] });
  await prisma.$executeRaw`INSERT INTO fields (id,business_id,name,representative_point) VALUES
    (${fieldId}::uuid,${businessId}::uuid,'History field',ST_SetSRID(ST_MakePoint(29,41),4326)),
    (${otherFieldId}::uuid,${otherBusinessId}::uuid,'Foreign field',ST_SetSRID(ST_MakePoint(29,41),4326))`;
  await prisma.cropDefinitionVersion.create({ data: { id: cropId, cropKey: `history-${businessId}`, version: "1", displayName: "Fixture crop" } });
  await prisma.validatedTemplateVersion.create({ data: { id: templateId, templateKey: `history-${businessId}`, version: "1", cropDefinitionVersionId: cropId, taskDefinitions: [] } });

  async function createSeason(seasonId: string, field: string, tenantId: string, seasonIdentity: typeof identity, tasks: Array<{ id: string; title: string; plannedLocalDate: string }>) {
    await prisma.season.create({ data: { id: seasonId, businessId: tenantId, fieldId: field, cropKey: `history-${businessId}`, cropDefinitionVersionId: cropId,
      actualPlantingDate: new Date(`${tasks[0]!.plannedLocalDate}T00:00:00Z`), status: "DRAFT", version: 1,
      plan: { create: { source: "VALIDATED_TEMPLATE", templateVersionId: templateId,
        sourceSnapshot: { source: "VALIDATED_TEMPLATE", templateProvenance: { templateVersionId: templateId } }, status: "DRAFT",
        tasks: { create: tasks.map((task) => ({ ...task, plannedLocalDate: new Date(`${task.plannedLocalDate}T00:00:00Z`), sourceTemplateTaskKey: task.id, version: 1 })) } } } } });
    await activation.activate(seasonIdentity, seasonId, 1, randomUUID());
  }

  await createSeason(seasonA, fieldId, businessId, identity, [
    { id: taskA, title: "Watering", plannedLocalDate: "2026-09-26" },
    { id: taskB, title: "Field check", plannedLocalDate: "2026-09-27" },
  ]);
  await createSeason(seasonB, fieldId, businessId, identity, [{ id: taskC, title: "Harvest check", plannedLocalDate: "2026-09-25" }]);
  await createSeason(foreignSeason, otherFieldId, otherBusinessId, otherIdentity, [{ id: otherFieldTask, title: "Other field task", plannedLocalDate: "2026-09-25" }]);
  await repository.complete(identity, taskA, 1, { completionId: tieCompletionIds[0]!, occurredAt: tieInstant });
  await repository.complete(identity, taskB, 1, { completionId: tieCompletionIds[1]!, occurredAt: tieInstant });
  await repository.complete(identity, taskC, 1, { completionId: completionC, occurredAt: "2026-09-29T07:00:00.000Z" });
});

after(async () => { await prisma.$disconnect(); });

test("history returns accepted snapshots newest-first with ID tie-break pagination and Business timezone", async () => {
  const first = await repository.readHistory(identity, fieldId, { limit: 2 });
  assert.deepEqual(first.items.map((item) => item.id), [completionC, tieCompletionIds[0]]);
  assert.equal(first.businessTimezone, "Asia/Tokyo");
  assert.ok(first.nextCursor);
  assert.equal(first.items[1]?.title, "Watering");
  assert.equal(first.items[1]?.plannedLocalDate, "2026-09-26");
  assert.equal(first.items[1]?.occurredAt, tieInstant);
  assert.equal(first.items[1]?.sourceKind, "VALIDATED_TEMPLATE");
  assert.equal(first.items[1]?.templateVersionId, templateId);
  assert.equal("recordedAt" in (first.items[1] ?? {}), false);
  assert.equal("actorUserId" in (first.items[1] ?? {}), false);
  const second = await repository.readHistory(identity, fieldId, { limit: 2, cursor: first.nextCursor! });
  assert.deepEqual(second.items.map((item) => item.id), [tieCompletionIds[1]]);
  assert.equal(second.nextCursor, null);
});

test("optional season filter is scoped to the requested field and excludes incomplete tasks", async () => {
  const selected = await repository.readHistory(identity, fieldId, { seasonId: seasonA });
  assert.deepEqual(selected.items.map((item) => item.taskId).sort(), [taskA, taskB].sort());
  await assert.rejects(repository.readHistory(identity, fieldId, { seasonId: foreignSeason }));
  assert.equal(await prisma.taskCompletion.count({ where: { plannedTaskId: otherFieldTask } }), 0);
});

test("rejects invalid cursor/limit without reading or changing completion records", async () => {
  const before = await prisma.taskCompletion.count({ where: { businessId, fieldId } });
  await assert.rejects(repository.readHistory(identity, fieldId, { limit: 101 }), TaskCompletionError);
  await assert.rejects(repository.readHistory(identity, fieldId, { cursor: "not-an-opaque-server-cursor" }), TaskCompletionError);
  assert.equal(await prisma.taskCompletion.count({ where: { businessId, fieldId } }), before);
});

test("uses the shared Business timezone fallback and rejects invalid configured zones", async () => {
  await prisma.business.update({ where: { id: businessId }, data: { timezone: null } });
  try {
    assert.equal((await repository.readHistory(identity, fieldId, {})).businessTimezone, "Europe/Istanbul");
    await prisma.business.update({ where: { id: businessId }, data: { timezone: "Not/A_Timezone" } });
    await assert.rejects(repository.readHistory(identity, fieldId, {}), /Configured business timezone is invalid/);
  } finally { await prisma.business.update({ where: { id: businessId }, data: { timezone: "Asia/Tokyo" } }); }
});

test("history cannot read another field or business and requires current membership", async () => {
  await assert.rejects(repository.readHistory(identity, otherFieldId, {}));
  const forged = await repository.readHistory({ ...identity, businessId: otherBusinessId }, fieldId, {});
  assert.equal(forged.businessTimezone, "Asia/Tokyo");
  assert.ok(forged.items.every((item) => item.fieldId === fieldId));
  await prisma.membership.update({ where: { businessId_userId: { businessId, userId } }, data: { status: "REVOKED" } });
  try { await assert.rejects(repository.readHistory(identity, fieldId, {}), BusinessScopeForbiddenError); }
  finally { await prisma.membership.update({ where: { businessId_userId: { businessId, userId } }, data: { status: "ACTIVE" } }); }
});
