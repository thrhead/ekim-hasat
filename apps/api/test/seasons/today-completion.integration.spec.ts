import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../src/generated/prisma/client.js";
import { TodayRepository } from "../../src/seasons/today.repository.js";
import { TaskCompletionRepository } from "../../src/tasks/task-completion.repository.js";
import { TaskCompletionError } from "../../src/tasks/task-completion.error.js";

const databaseUrl = process.env.DATABASE_URL ?? "postgresql://ekim_hasat:ekim_hasat_local@localhost:5432/ekim_hasat";
if (new URL(databaseUrl).pathname.slice(1) !== "ekim_hasat_test") {
  throw new Error("Today completion integration test requires disposable database ekim_hasat_test");
}
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const businessId = randomUUID();
const userId = randomUUID();
const fieldId = randomUUID();
const draftFieldId = randomUUID();
const cropId = randomUUID();
const cropKey = randomUUID();
const templateId = randomUUID();
const seasonId = randomUUID();
const draftSeasonId = randomUUID();
const taskId = randomUUID();
const draftTaskId = randomUUID();
const identity = { provider: "today-completion-test", subject: randomUUID() };
const instant = new Date("2026-09-30T09:00:00.000Z");
const repository = new TodayRepository(prisma, () => instant);
const completionRepository = new TaskCompletionRepository(prisma, () => instant);

before(async () => {
  await prisma.business.create({ data: { id: businessId, timezone: "Europe/Istanbul" } });
  await prisma.applicationUser.create({ data: { id: userId, authProvider: identity.provider, authSubject: identity.subject, defaultBusinessId: businessId } });
  const membership = await prisma.membership.create({ data: { userId, businessId, role: "OWNER", status: "ACTIVE" } });
  await prisma.$executeRaw`INSERT INTO fields (id, business_id, name, representative_point) VALUES
    (${fieldId}::uuid, ${businessId}::uuid, 'Today completion fixture', ST_SetSRID(ST_MakePoint(29,41),4326)),
    (${draftFieldId}::uuid, ${businessId}::uuid, 'Today draft fixture', ST_SetSRID(ST_MakePoint(29,41),4326))`;
  await prisma.cropDefinitionVersion.create({ data: { id: cropId, cropKey, version: "1", displayName: "Arpa" } });
  await prisma.validatedTemplateVersion.create({ data: { id: templateId, templateKey: randomUUID(), version: "1", cropDefinitionVersionId: cropId, taskDefinitions: [{ key: "today", title: "İş", offsetDays: 0 }] } });
  for (const [id, state, currentTaskId] of [[seasonId, "ACTIVE", taskId], [draftSeasonId, "DRAFT", draftTaskId]] as const) {
    const seasonFieldId = state === "ACTIVE" ? fieldId : draftFieldId;
    await prisma.season.create({ data: { id, businessId, fieldId: seasonFieldId, cropKey, cropDefinitionVersionId: cropId,
      actualPlantingDate: new Date("2026-09-29T00:00:00.000Z"), status: "DRAFT", version: 1,
      plan: { create: { source: "VALIDATED_TEMPLATE", status: "DRAFT", templateVersionId: templateId, sourceSnapshot: {},
        tasks: { create: { id: currentTaskId, title: id === seasonId ? "Sulama kontrolü" : "Taslak işi", plannedLocalDate: new Date("2026-09-30T00:00:00.000Z"), version: 1 } } } } } });
    if (state === "ACTIVE") {
      const activatedAt = new Date("2026-09-29T10:00:00.000Z");
      await prisma.season.update({ where: { id }, data: { status: "ACTIVE", activatedAt } });
      await prisma.seasonPlan.update({ where: { seasonId: id }, data: { status: "APPROVED" } });
      await prisma.seasonContextSnapshot.create({ data: { seasonId: id, source: "VALIDATED_TEMPLATE", templateVersionId: templateId,
        cropSnapshot: {}, activatedAt, businessTimezone: "Europe/Istanbul", activatedLocalDate: new Date("2026-09-29T00:00:00.000Z") } });
    }
  }
  assert.ok(membership.id);
});

after(async () => { await prisma.$disconnect(); });

test("Today hides a task only after server acceptance; pending device intent is not server completion and DRAFT work stays unavailable", async () => {
  const beforeAcceptance = await repository.readToday(identity);
  assert.equal(beforeAcceptance.businessTimezone, "Europe/Istanbul");
  assert.deepEqual(beforeAcceptance.tasks.map((item) => item.id), [taskId]);
  assert.equal(await prisma.taskCompletion.count({ where: { plannedTaskId: taskId } }), 0);

  // Pending command state exists only on the mobile device, so it does not alter this canonical API projection.
  const stillActionableUntilAccepted = await repository.readToday(identity);
  assert.deepEqual(stillActionableUntilAccepted.tasks.map((item) => item.id), [taskId]);
  assert.equal(stillActionableUntilAccepted.tasks.some((item) => item.id === draftTaskId), false);
  await assert.rejects(completionRepository.complete(identity, draftTaskId, 1, {
    completionId: randomUUID(), occurredAt: instant.toISOString(),
  }), (error: unknown) => error instanceof TaskCompletionError && error.presentation.code === "TASK_NOT_ACTIONABLE");
  assert.equal(await prisma.taskCompletion.count({ where: { plannedTaskId: draftTaskId } }), 0);

  const task = await prisma.plannedTask.findUniqueOrThrow({ where: { id: taskId } });
  const active = await prisma.season.findUniqueOrThrow({ where: { id: seasonId } });
  const actorMembership = await prisma.membership.findUniqueOrThrow({ where: { businessId_userId: { businessId, userId } } });
  await prisma.taskCompletion.create({ data: {
    id: randomUUID(), plannedTaskId: task.id, seasonPlanId: task.seasonPlanId, seasonId, fieldId, businessId,
    actorUserId: userId, actorMembershipId: actorMembership.id, occurredAt: instant, recordedAt: new Date(),
    baseTaskVersion: task.version, payloadFingerprint: randomUUID(), taskTitleSnapshot: task.title,
    plannedLocalDateSnapshot: task.plannedLocalDate,
  } });
  assert.equal(active.status, "ACTIVE");

  const afterAcceptance = await repository.readToday(identity);
  assert.deepEqual(afterAcceptance.tasks, []);
  assert.equal(afterAcceptance.tasks.some((item) => item.id === draftTaskId), false);
});
