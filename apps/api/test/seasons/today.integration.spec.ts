import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../src/generated/prisma/client.js";
import { TodayRepository, businessLocalDate, FALLBACK_BUSINESS_TIMEZONE } from "../../src/seasons/today.repository.js";
import { BusinessScopeForbiddenError } from "../../src/authorization/membership-scope.service.js";

const databaseUrl = process.env.DATABASE_URL ?? "postgresql://ekim_hasat:ekim_hasat_local@localhost:5432/ekim_hasat";
const databaseName = new URL(databaseUrl).pathname.slice(1);
if (databaseName !== "ekim_hasat_test") {
  throw new Error(`Today PostgreSQL integration test requires disposable database ekim_hasat_test; got ${databaseName || "no database"}`);
}
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const businessId = randomUUID(); const otherBusinessId = randomUUID(); const userId = randomUUID();
const fieldId = randomUUID(); const otherFieldId = randomUUID(); const cropId = randomUUID(); const cropKey = randomUUID(); const templateId = randomUUID();
const seasonId = randomUUID(); const otherSeasonId = randomUUID(); const identity = { provider: "today-test", subject: randomUUID() };
const actionableTaskId = randomUUID(); const completionTaskId = randomUUID();
let instant = new Date("2026-08-01T20:30:00.000Z");
const repository = new TodayRepository(prisma, () => instant);

before(async () => {
  await prisma.business.createMany({ data: [{ id: businessId, timezone: "Asia/Tokyo" }, { id: otherBusinessId, timezone: "Pacific/Honolulu" }] });
  await prisma.applicationUser.create({ data: { id: userId, authProvider: identity.provider, authSubject: identity.subject, defaultBusinessId: businessId } });
  await prisma.membership.create({ data: { userId, businessId, role: "MEMBER", status: "ACTIVE" } });
  await prisma.$executeRaw`INSERT INTO fields (id, business_id, name, representative_point) VALUES (${fieldId}::uuid, ${businessId}::uuid, 'Today fixture', ST_SetSRID(ST_MakePoint(29,41),4326)), (${otherFieldId}::uuid, ${otherBusinessId}::uuid, 'Foreign fixture', ST_SetSRID(ST_MakePoint(29,41),4326))`;
  await prisma.cropDefinitionVersion.create({ data: { id: cropId, cropKey, version: "1", displayName: "Arpa" } });
  await prisma.validatedTemplateVersion.create({ data: { id: templateId, templateKey: randomUUID(), version: "1", cropDefinitionVersionId: cropId, taskDefinitions: [{ key: "t", title: "T", offsetDays: 0 }] } });
  for (const [id, business, field] of [[seasonId, businessId, fieldId], [otherSeasonId, otherBusinessId, otherFieldId]] as const) {
    const tasks = id === seasonId
      ? [
          { id: actionableTaskId, title: "Inspect field", plannedLocalDate: new Date("2026-08-02T00:00:00.000Z") },
          { id: completionTaskId, title: "Record completed work", plannedLocalDate: new Date("2026-08-03T00:00:00.000Z") },
        ]
      : [{ id: randomUUID(), title: "Inspect field", plannedLocalDate: new Date("2026-08-02T00:00:00.000Z") }];
    await prisma.season.create({ data: { id, businessId: business, fieldId: field, cropKey, cropDefinitionVersionId: cropId, actualPlantingDate: new Date("2026-08-01T00:00:00.000Z"), plan: { create: { source: "VALIDATED_TEMPLATE", status: "DRAFT", templateVersionId: templateId, sourceSnapshot: {}, tasks: { create: tasks } } } } });
  }
  // The database makes active task rows immutable, so seed tasks before moving the fixture to ACTIVE.
  await prisma.season.updateMany({ where: { id: { in: [seasonId, otherSeasonId] } }, data: { status: "ACTIVE", activatedAt: new Date("2026-08-01T01:00:00.000Z") } });
  await prisma.seasonPlan.updateMany({ where: { seasonId: { in: [seasonId, otherSeasonId] } }, data: { status: "APPROVED" } });
});

after(async () => { await prisma.$disconnect(); });

test("business-local midnight wins over UTC and device timezone across authorized fields", async () => {
  instant = new Date("2026-08-01T20:30:00.000Z"); // Tokyo is already Aug 2; UTC is still Aug 1.
  const response = await repository.readToday(identity);
  assert.equal(response.localDate, "2026-08-02"); assert.equal(response.tasks.length, 1); assert.equal(response.tasks[0]?.fieldId, fieldId);
  assert.equal(response.businessTimezone, "Asia/Tokyo");
  const task = response.tasks.find((candidate) => candidate.id === actionableTaskId);
  assert.equal(task?.taskVersion, 1);
  assert.equal(task?.plannedLocalDate, response.localDate);
});

test("Today excludes only accepted completion and preserves task version metadata", async () => {
  instant = new Date("2026-08-02T20:30:00.000Z"); // Tokyo is Aug 3, the completion fixture task's planned day.
  const task = await prisma.plannedTask.findUniqueOrThrow({ where: { id: completionTaskId } });
  const season = await prisma.season.findUniqueOrThrow({ where: { id: seasonId }, include: { plan: true } });
  const activatedAt = season.activatedAt ?? new Date("2026-08-01T01:00:00.000Z");
  await prisma.season.update({ where: { id: seasonId }, data: { activatedAt } });
  await prisma.seasonContextSnapshot.create({ data: { seasonId, source: season.plan!.source,
    templateVersionId: season.plan!.templateVersionId, cropSnapshot: {}, activatedAt, businessTimezone: "Asia/Tokyo",
    activatedLocalDate: new Date(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(activatedAt) + "T00:00:00.000Z") } });
  await prisma.taskCompletion.create({ data: {
    id: randomUUID(), plannedTaskId: task.id, seasonPlanId: task.seasonPlanId, seasonId, fieldId, businessId,
    actorUserId: userId, actorMembershipId: (await prisma.membership.findUniqueOrThrow({ where: { businessId_userId: { businessId, userId } } })).id,
    occurredAt: instant, recordedAt: new Date(), baseTaskVersion: task.version, payloadFingerprint: randomUUID(),
    taskTitleSnapshot: task.title, plannedLocalDateSnapshot: task.plannedLocalDate,
  } });
  const response = await repository.readToday(identity);
  assert.equal(response.tasks.some((candidate) => candidate.id === task.id), false);
});

test("Europe/Istanbul fallback and date calculation are deterministic independent of host timezone", () => {
  assert.equal(FALLBACK_BUSINESS_TIMEZONE, "Europe/Istanbul");
  assert.equal(businessLocalDate(new Date("2026-08-01T21:10:00.000Z"), FALLBACK_BUSINESS_TIMEZONE), "2026-08-02");
  assert.equal(businessLocalDate(new Date("2026-08-01T20:59:00.000Z"), FALLBACK_BUSINESS_TIMEZONE), "2026-08-01");
});

test("forged business identity cannot select a different business and revoked membership is forbidden", async () => {
  instant = new Date("2026-08-01T20:30:00.000Z"); // Keep this authorization assertion on the independent Aug 2 task.
  const forgedIdentity = { ...identity, businessId: otherBusinessId, role: "OWNER" };
  const forged = await repository.readToday(forgedIdentity);
  assert.equal(forged.tasks.length, 1); assert.equal(forged.tasks[0]?.id, actionableTaskId); assert.equal(forged.tasks[0]?.fieldId, fieldId);
  await prisma.membership.updateMany({ where: { userId, businessId }, data: { status: "REVOKED" } });
  try { await assert.rejects(repository.readToday(identity), BusinessScopeForbiddenError); }
  finally { await prisma.membership.updateMany({ where: { userId, businessId }, data: { status: "ACTIVE" } }); }
});
