import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { NotFoundException } from "@nestjs/common";
import { Prisma, PrismaClient } from "../../src/generated/prisma/client.js";
import { MembershipScopeService } from "../../src/authorization/membership-scope.service.js";
import { CalendarReadRepository } from "../../src/calendar/calendar-read.repository.js";
import { TaskSkipRepository } from "../../src/tasks/task-skip.repository.js";
import { businessLocalDate } from "../../src/seasons/business-timezone.js";
import { assertDisposableDatabaseUrl } from "../support/disposable-database.js";

assertDisposableDatabaseUrl(process.env.DATABASE_URL);

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});
const scopeService = new MembershipScopeService(prisma);
const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const provider = "calendar-t013-test";
function shiftLocalDate(localDate: string, offsetDays: number): string {
  const [year, month, day] = localDate.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, day! + offsetDays)).toISOString().slice(0, 10);
}

const userSubjects: string[] = [];
const businessIds: string[] = [];
const fieldIds: string[] = [];
const customCropIds: string[] = [];
const seasonIds: string[] = [];
const planIds: string[] = [];
const calendarReadIds: string[] = [];
const retainedBusinessIds = new Set<string>();
const retainedFieldIds = new Set<string>();
const retainedSeasonIds = new Set<string>();
const retainedPlanIds = new Set<string>();
const retainedCropIds = new Set<string>();
const retainedSubjects = new Set<string>();

before(async () => prisma.$connect());

after(async () => {
  try {
    if (calendarReadIds.length) {
      await prisma.calendarReadSnapshot.deleteMany({ where: { readId: { in: calendarReadIds } } });
    }
    const disposableSeasonIds = seasonIds.filter((id) => !retainedSeasonIds.has(id));
    const disposablePlanIds = planIds.filter((id) => !retainedPlanIds.has(id));
    if (disposableSeasonIds.length) {
      await prisma.season.updateMany({
        where: { id: { in: disposableSeasonIds }, status: "ACTIVE" },
        data: { status: "DRAFT", activatedAt: null },
      });
    }
    if (disposablePlanIds.length) await prisma.plannedTask.deleteMany({ where: { seasonPlanId: { in: disposablePlanIds } } });
    if (disposablePlanIds.length) await prisma.seasonPlan.deleteMany({ where: { id: { in: disposablePlanIds } } });
    if (disposableSeasonIds.length) await prisma.season.deleteMany({ where: { id: { in: disposableSeasonIds } } });
    const disposableCropIds = customCropIds.filter((id) => !retainedCropIds.has(id));
    if (disposableCropIds.length) await prisma.customCrop.deleteMany({ where: { id: { in: disposableCropIds } } });
    const disposableFieldIds = fieldIds.filter((id) => !retainedFieldIds.has(id));
    if (disposableFieldIds.length) await prisma.field.deleteMany({ where: { id: { in: disposableFieldIds } } });
    const disposableSubjects = userSubjects.filter((id) => !retainedSubjects.has(id));
    if (disposableSubjects.length) {
      await prisma.applicationUser.deleteMany({ where: { authProvider: provider, authSubject: { in: disposableSubjects } } });
    }
    const disposableBusinessIds = businessIds.filter((id) => !retainedBusinessIds.has(id));
    if (disposableBusinessIds.length) await prisma.business.deleteMany({ where: { id: { in: disposableBusinessIds } } });
  } finally {
    await prisma.$disconnect();
  }
});

test("Calendar authorization resolves through the caller's REPEATABLE READ transaction snapshot", async () => {
  const subject = `calendar-${runId}`;
  userSubjects.push(subject);
  const identity = { provider, subject };
  const business = await prisma.business.create({ data: { timezone: "Europe/Istanbul" } });
  businessIds.push(business.id);
  const user = await prisma.applicationUser.create({
    data: { authProvider: provider, authSubject: subject, defaultBusinessId: business.id },
  });
  const membership = await prisma.membership.create({
    data: { businessId: business.id, userId: user.id, role: "OWNER", status: "ACTIVE" },
  });

  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM memberships WHERE id = ${membership.id}::uuid`;
    await prisma.membership.update({ where: { id: membership.id }, data: { status: "REVOKED" } });

    const scope = await scopeService.resolveDefaultBusinessScope(identity, tx);
    assert.deepEqual(scope, {
      userId: user.id,
      businessId: business.id,
      membershipId: membership.id,
      role: "OWNER",
    });
    const sameSnapshot = await tx.membership.findUnique({ where: { id: membership.id }, select: { status: true } });
    assert.equal(sameSnapshot?.status, "ACTIVE");
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });

  assert.equal((await prisma.membership.findUnique({ where: { id: membership.id }, select: { status: true } }))?.status, "REVOKED");
});

test("Calendar read capture returns one authorized read identity with overdue projection and original-date indicators", async () => {
  const businessToday = businessLocalDate(new Date(), "Europe/Istanbul");
  const firstOverdueDate = shiftLocalDate(businessToday, -5);
  // A one-day offset remains selected work if the test crosses Business-local midnight before capture.
  const selectedDate = shiftLocalDate(businessToday, 1);
  const remainingOverdueDate = shiftLocalDate(businessToday, -3);
  const subject = `calendar-read-${runId}`;
  userSubjects.push(subject);
  const identity = { provider, subject };
  const business = await prisma.business.create({ data: { timezone: "Europe/Istanbul" } });
  businessIds.push(business.id);
  const user = await prisma.applicationUser.create({
    data: { authProvider: provider, authSubject: subject, defaultBusinessId: business.id },
  });
  await prisma.membership.create({ data: { businessId: business.id, userId: user.id, role: "OWNER", status: "ACTIVE" } });

  const fieldId = randomUUID();
  fieldIds.push(fieldId);
  await prisma.$executeRaw`INSERT INTO fields (id, business_id, name, representative_point, created_at, version)
    VALUES (${fieldId}::uuid, ${business.id}::uuid, 'Calendar fixture', ST_SetSRID(ST_MakePoint(29, 41), 4326), CURRENT_TIMESTAMP, 1)`;
  const customCrop = await prisma.customCrop.create({ data: { businessId: business.id, displayName: "Calendar fixture crop" } });
  customCropIds.push(customCrop.id);
  const season = await prisma.season.create({
    data: { businessId: business.id, fieldId, customCropId: customCrop.id, actualPlantingDate: new Date("2026-09-01T00:00:00.000Z") },
  });
  seasonIds.push(season.id);
  const plan = await prisma.seasonPlan.create({ data: { seasonId: season.id, source: "MANUAL", sourceSnapshot: {}, status: "DRAFT" } });
  planIds.push(plan.id);
  const task = await prisma.plannedTask.create({
    data: { seasonPlanId: plan.id, title: "Overdue fixture task", plannedLocalDate: new Date(`${firstOverdueDate}T00:00:00.000Z`) },
  });
  const selectedTask = await prisma.plannedTask.create({
    data: { seasonPlanId: plan.id, title: "Selected date fixture task", plannedLocalDate: new Date(`${selectedDate}T00:00:00.000Z`) },
  });
  const remainingTask = await prisma.plannedTask.create({
    data: { seasonPlanId: plan.id, title: "Remaining overdue fixture task", plannedLocalDate: new Date(`${remainingOverdueDate}T00:00:00.000Z`) },
  });
  await prisma.seasonPlan.update({ where: { id: plan.id }, data: { status: "APPROVED" } });
  const activatedAt = new Date("2026-09-01T00:00:00.000Z");
  await prisma.season.update({ where: { id: season.id }, data: { status: "ACTIVE", activatedAt } });
  await prisma.seasonContextSnapshot.create({ data: { seasonId: season.id, source: "MANUAL", templateVersionId: null,
    cropSnapshot: {}, activatedAt, businessTimezone: "Europe/Istanbul", activatedLocalDate: new Date("2026-09-01T00:00:00.000Z") } });
  retainedBusinessIds.add(business.id);
  retainedFieldIds.add(fieldId);
  retainedSeasonIds.add(season.id);
  retainedPlanIds.add(plan.id);
  retainedCropIds.add(customCrop.id);
  retainedSubjects.add(subject);

  const failingPrisma = new Proxy(prisma, {
    get(target, property) {
      if (property === "$transaction") {
        return (callback: (tx: unknown) => Promise<unknown>, options: unknown) => target.$transaction((tx) => callback(new Proxy(tx, {
          get(transaction, key) {
            if (key === "calendarReadSnapshotTask") {
              const delegate = Reflect.get(transaction, key, transaction);
              return new Proxy(delegate, {
                get(model, method) {
                  if (method === "createMany") return async () => { throw new Error("injected projection write failure"); };
                  const value = Reflect.get(model, method, model);
                  return typeof value === "function" ? value.bind(model) : value;
                },
              });
            }
            const value = Reflect.get(transaction, key, transaction);
            return typeof value === "function" ? value.bind(transaction) : value;
          },
        })), options as never);
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const failingRepository = new CalendarReadRepository(failingPrisma as unknown as PrismaClient);
  await assert.rejects(failingRepository.createRead(identity, { selectedDate }), /injected projection write failure/);
  assert.equal(await prisma.calendarReadSnapshot.count({ where: { businessId: business.id } }), 0);

  const repository = new CalendarReadRepository(prisma);
  const read = await repository.createRead(identity, { selectedDate });
  calendarReadIds.push(read.readId);
  assert.equal(read.selectedDate, selectedDate);
  assert.ok(read.readId);
  assert.equal(read.businessTimezone, "Europe/Istanbul");
  assert.ok(firstOverdueDate < read.businessLocalToday);
  assert.ok(remainingOverdueDate < read.businessLocalToday);
  assert.ok(read.businessLocalToday <= selectedDate);
  assert.deepEqual(read.overdueTasksPage.items.map(({ taskId }) => taskId), [task.id, remainingTask.id]);
  assert.deepEqual(read.selectedDateTasksPage.items.map(({ taskId }) => taskId), [selectedTask.id]);
  const initialIndicators = new Map(read.monthIndicators.map(({ date, hasWork }) => [date, hasWork]));
  const isInSelectedMonth = (date: string) => date.startsWith(selectedDate.slice(0, 7));
  assert.equal(initialIndicators.get(selectedDate), true);
  assert.equal(initialIndicators.get(firstOverdueDate), isInSelectedMonth(firstOverdueDate) ? true : undefined);
  assert.equal(initialIndicators.get(remainingOverdueDate), isInSelectedMonth(remainingOverdueDate) ? true : undefined);

  const skipRepository = new TaskSkipRepository(prisma);
  await skipRepository.skip(identity, task.id, 1, { skipId: randomUUID() });
  await skipRepository.skip(identity, selectedTask.id, 1, { skipId: randomUUID() });
  const freshRead = await repository.createRead(identity, { selectedDate });
  calendarReadIds.push(freshRead.readId);
  assert.notEqual(freshRead.readId, read.readId);
  assert.deepEqual(freshRead.overdueTasksPage.items.map(({ taskId }) => taskId), [remainingTask.id]);
  assert.deepEqual(freshRead.selectedDateTasksPage.items, []);
  const freshIndicators = new Map(freshRead.monthIndicators.map(({ date, hasWork }) => [date, hasWork]));
  assert.equal(freshIndicators.get(firstOverdueDate), isInSelectedMonth(firstOverdueDate) ? false : undefined);
  assert.equal(freshIndicators.get(selectedDate), false);
  assert.equal(freshIndicators.get(remainingOverdueDate), isInSelectedMonth(remainingOverdueDate) ? true : undefined);
  const oldSnapshotTasks = await prisma.calendarReadSnapshotTask.findMany({ where: { readId: read.readId }, select: { taskId: true } });
  assert.deepEqual(oldSnapshotTasks.map(({ taskId }) => taskId).sort(), [task.id, remainingTask.id, selectedTask.id].sort());
});

test("omitted selectedDate is resolved from captured asOf in the authorized Business timezone and bound to readId", async () => {
  const subject = `calendar-default-date-${runId}`;
  userSubjects.push(subject);
  const identity = { provider, subject };
  const timezone = "Pacific/Auckland";
  const business = await prisma.business.create({ data: { timezone } });
  businessIds.push(business.id);
  const user = await prisma.applicationUser.create({
    data: { authProvider: provider, authSubject: subject, defaultBusinessId: business.id },
  });
  await prisma.membership.create({ data: { businessId: business.id, userId: user.id, role: "OWNER", status: "ACTIVE" } });

  const repository = new CalendarReadRepository(prisma);
  const read = await repository.createRead(identity, {});
  calendarReadIds.push(read.readId);
  const capturedLocalDate = businessLocalDate(new Date(read.asOf), timezone);
  assert.equal(read.selectedDate, capturedLocalDate);
  assert.equal(read.businessLocalToday, capturedLocalDate);
  assert.equal(read.businessTimezone, timezone);
  assert.equal(read.selectedDateTasksPage.readId, read.readId);
  assert.equal(read.overdueTasksPage.readId, read.readId);

  const persisted = await prisma.calendarReadSnapshot.findUniqueOrThrow({ where: { readId: read.readId } });
  assert.equal(persisted.selectedDate.toISOString().slice(0, 10), capturedLocalDate);
  assert.equal(persisted.asOf.toISOString(), read.asOf);
});

test("a Field from another Business is privacy-safe and cannot publish a Calendar read", async () => {
  const subject = `calendar-field-scope-${runId}`;
  userSubjects.push(subject);
  const identity = { provider, subject };
  const business = await prisma.business.create({ data: { timezone: "Europe/Istanbul" } });
  const foreignBusiness = await prisma.business.create({ data: { timezone: "Europe/Istanbul" } });
  businessIds.push(business.id, foreignBusiness.id);
  const user = await prisma.applicationUser.create({
    data: { authProvider: provider, authSubject: subject, defaultBusinessId: business.id },
  });
  await prisma.membership.create({ data: { businessId: business.id, userId: user.id, role: "OWNER", status: "ACTIVE" } });
  const foreignFieldId = randomUUID();
  fieldIds.push(foreignFieldId);
  await prisma.$executeRaw`INSERT INTO fields (id, business_id, name, representative_point)
    VALUES (${foreignFieldId}::uuid, ${foreignBusiness.id}::uuid, 'Foreign Calendar fixture', ST_SetSRID(ST_MakePoint(29, 41), 4326))`;

  const repository = new CalendarReadRepository(prisma);
  await assert.rejects(repository.createRead(identity, { fieldId: foreignFieldId }), NotFoundException);
  assert.equal(await prisma.calendarReadSnapshot.count({ where: { userId: user.id } }), 0);
});

test("authorization and canonical projection queries see the same repeatable-read snapshot", async () => {
  const subject = `calendar-snapshot-${runId}`;
  userSubjects.push(subject);
  const identity = { provider, subject };
  const business = await prisma.business.create({ data: { timezone: "Europe/Istanbul" } });
  businessIds.push(business.id);
  const user = await prisma.applicationUser.create({
    data: { authProvider: provider, authSubject: subject, defaultBusinessId: business.id },
  });
  const membership = await prisma.membership.create({
    data: { businessId: business.id, userId: user.id, role: "OWNER", status: "ACTIVE" },
  });
  const fieldId = randomUUID();
  fieldIds.push(fieldId);
  await prisma.$executeRaw`INSERT INTO fields (id, business_id, name, representative_point)
    VALUES (${fieldId}::uuid, ${business.id}::uuid, 'Calendar snapshot fixture', ST_SetSRID(ST_MakePoint(29, 41), 4326))`;
  const customCrop = await prisma.customCrop.create({ data: { businessId: business.id, displayName: "Calendar snapshot crop" } });
  customCropIds.push(customCrop.id);
  const season = await prisma.season.create({
    data: { businessId: business.id, fieldId, customCropId: customCrop.id, actualPlantingDate: new Date("2026-09-01T00:00:00.000Z") },
  });
  seasonIds.push(season.id);
  const plan = await prisma.seasonPlan.create({ data: { seasonId: season.id, source: "MANUAL", sourceSnapshot: {}, status: "DRAFT" } });
  planIds.push(plan.id);
  const task = await prisma.plannedTask.create({
    data: { seasonPlanId: plan.id, title: "Snapshot fixture task", plannedLocalDate: new Date("2026-10-05T00:00:00.000Z") },
  });
  await prisma.seasonPlan.update({ where: { id: plan.id }, data: { status: "APPROVED" } });
  await prisma.season.update({ where: { id: season.id }, data: { status: "ACTIVE", activatedAt: new Date("2026-09-01T00:00:00.000Z") } });

  const repository = new CalendarReadRepository(prisma);
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT statement_timestamp() AS "asOf"`;
    await prisma.membership.update({ where: { id: membership.id }, data: { status: "REVOKED" } });
    await prisma.season.update({ where: { id: season.id }, data: { status: "DRAFT", activatedAt: null } });

    const capture = await repository.readEligibleTasks(identity, { transactionClient: tx });
    assert.equal(capture.scope.membershipId, membership.id);
    assert.equal(capture.tasks.length, 1);
    assert.equal(capture.tasks[0]?.id, task.id);
    assert.equal(capture.tasks[0]?.plannedLocalDate.toISOString().slice(0, 10), "2026-10-05");
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });

  assert.equal((await prisma.membership.findUnique({ where: { id: membership.id }, select: { status: true } }))?.status, "REVOKED");
  assert.equal((await prisma.season.findUnique({ where: { id: season.id }, select: { status: true } }))?.status, "DRAFT");
});
