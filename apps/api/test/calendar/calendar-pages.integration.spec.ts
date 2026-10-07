import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { GoneException } from "@nestjs/common";
import { BusinessScopeForbiddenError } from "../../src/authorization/membership-scope.service.js";
import { PrismaClient } from "../../src/generated/prisma/client.js";
import { CalendarPagesService } from "../../src/calendar/calendar-pages.service.js";
import { CalendarReadRepository } from "../../src/calendar/calendar-read.repository.js";
import { assertDisposableDatabaseUrl } from "../support/disposable-database.js";

assertDisposableDatabaseUrl(process.env.DATABASE_URL);

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
const provider = "calendar-pages-t015-test";
const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const subjects: string[] = [];
const businessIds: string[] = [];
const fieldIds: string[] = [];
const cropIds: string[] = [];
const seasonIds: string[] = [];
const planIds: string[] = [];
const taskIds: string[] = [];
const readIds: string[] = [];

before(async () => prisma.$connect());

after(async () => {
  try {
    if (readIds.length) await prisma.calendarReadSnapshot.deleteMany({ where: { readId: { in: readIds } } });
    if (seasonIds.length) await prisma.season.updateMany({ where: { id: { in: seasonIds }, status: "ACTIVE" }, data: { status: "DRAFT", activatedAt: null } });
    if (taskIds.length) await prisma.plannedTask.deleteMany({ where: { id: { in: taskIds } } });
    if (planIds.length) await prisma.seasonPlan.deleteMany({ where: { id: { in: planIds } } });
    if (seasonIds.length) await prisma.season.deleteMany({ where: { id: { in: seasonIds } } });
    if (cropIds.length) await prisma.customCrop.deleteMany({ where: { id: { in: cropIds } } });
    if (fieldIds.length) await prisma.field.deleteMany({ where: { id: { in: fieldIds } } });
    if (subjects.length) await prisma.applicationUser.deleteMany({ where: { authProvider: provider, authSubject: { in: subjects } } });
    if (businessIds.length) await prisma.business.deleteMany({ where: { id: { in: businessIds } } });
  } finally {
    await prisma.$disconnect();
  }
});

test("Calendar continuation stays immutable and replay-stable after canonical eligibility and task rows change", async () => {
  const subject = `calendar-pages-${runId}`;
  subjects.push(subject);
  const identity = { provider, subject };
  const business = await prisma.business.create({ data: { timezone: "Europe/Istanbul" } });
  businessIds.push(business.id);
  const user = await prisma.applicationUser.create({ data: { authProvider: provider, authSubject: subject, defaultBusinessId: business.id } });
  const membership = await prisma.membership.create({ data: { businessId: business.id, userId: user.id, role: "OWNER", status: "ACTIVE" } });
  const fieldId = randomUUID();
  fieldIds.push(fieldId);
  await prisma.$executeRaw`INSERT INTO fields (id, business_id, name, representative_point)
    VALUES (${fieldId}::uuid, ${business.id}::uuid, 'Calendar paging fixture', ST_SetSRID(ST_MakePoint(29, 41), 4326))`;
  const crop = await prisma.customCrop.create({ data: { businessId: business.id, displayName: `Calendar pages ${runId}` } });
  cropIds.push(crop.id);
  const season = await prisma.season.create({
    data: { businessId: business.id, fieldId, customCropId: crop.id, actualPlantingDate: new Date("2026-09-01T00:00:00.000Z") },
  });
  seasonIds.push(season.id);
  const plan = await prisma.seasonPlan.create({ data: { seasonId: season.id, source: "MANUAL", sourceSnapshot: {}, status: "DRAFT" } });
  planIds.push(plan.id);
  const ids = Array.from({ length: 51 }, () => randomUUID());
  taskIds.push(...ids);
  await prisma.plannedTask.createMany({
    data: ids.map((id) => ({ id, seasonPlanId: plan.id, title: `Paging task ${id}`, plannedLocalDate: new Date("2026-10-01T00:00:00.000Z") })),
  });
  await prisma.seasonPlan.update({ where: { id: plan.id }, data: { status: "APPROVED" } });
  await prisma.season.update({ where: { id: season.id }, data: { status: "ACTIVE", activatedAt: new Date("2026-09-01T00:00:00.000Z") } });

  const read = await new CalendarReadRepository(prisma).createRead(identity, { selectedDate: "2026-10-06" });
  readIds.push(read.readId);
  assert.equal(read.overdueTasksPage.items.length, 50);
  assert.equal(read.overdueTasksPage.complete, false);
  assert.ok(read.overdueTasksPage.nextCursor);
  assert.equal(read.monthIndicators.find(({ date }) => date === "2026-10-01")?.hasWork, true);

  const pages = new CalendarPagesService(prisma);
  const request = { readId: read.readId, group: "overdueTasks" as const, cursor: read.overdueTasksPage.nextCursor! };
  await prisma.membership.update({ where: { id: membership.id }, data: { status: "REVOKED" } });
  await assert.rejects(pages.read(identity, request), BusinessScopeForbiddenError);
  await prisma.membership.update({ where: { id: membership.id }, data: { status: "ACTIVE" } });

  await prisma.season.update({ where: { id: season.id }, data: { status: "DRAFT", activatedAt: null } });
  await prisma.plannedTask.deleteMany({ where: { id: { in: ids } } });

  const [next, replay] = await Promise.all([pages.read(identity, request), pages.read(identity, request)]);
  assert.deepEqual(replay, next);
  assert.equal(next.items.length, 1);
  const allIds = [...read.overdueTasksPage.items.map(({ taskId }) => taskId), ...next.items.map(({ taskId }) => taskId)];
  assert.equal(new Set(allIds).size, 51);
  assert.deepEqual(allIds, [...allIds].sort((left, right) => {
    const leftTask = [...read.overdueTasksPage.items, ...next.items].find(({ taskId }) => taskId === left)!;
    const rightTask = [...read.overdueTasksPage.items, ...next.items].find(({ taskId }) => taskId === right)!;
    return leftTask.plannedLocalDate.localeCompare(rightTask.plannedLocalDate) || left.localeCompare(right);
  }));

  await prisma.calendarReadSnapshot.update({ where: { readId: read.readId }, data: { expiresAt: new Date("2000-01-01T00:00:00.000Z") } });
  await assert.rejects(pages.read(identity, request), GoneException);

  const freshRead = await new CalendarReadRepository(prisma).createRead(identity, { selectedDate: "2026-10-06" });
  readIds.push(freshRead.readId);
  assert.equal(freshRead.overdueTasksPage.items.length, 0);
  assert.equal(freshRead.monthIndicators.find(({ date }) => date === "2026-10-01")?.hasWork, false);
  assert.equal(await prisma.calendarReadSnapshot.findUnique({ where: { readId: read.readId } }), null);
  assert.equal(await prisma.calendarReadSnapshotTask.count({ where: { readId: read.readId } }), 0);
  assert.equal(await prisma.calendarReadCursor.count({ where: { readId: read.readId } }), 0);
});
