import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { NotFoundException } from "@nestjs/common";
import { Prisma, PrismaClient } from "../../src/generated/prisma/client.js";
import { MembershipScopeService } from "../../src/authorization/membership-scope.service.js";
import { CalendarReadRepository } from "../../src/calendar/calendar-read.repository.js";
import { businessLocalDate } from "../../src/seasons/business-timezone.js";
import { assertDisposableDatabaseUrl } from "../support/disposable-database.js";

assertDisposableDatabaseUrl(process.env.DATABASE_URL);

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});
const scopeService = new MembershipScopeService(prisma);
const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const provider = "calendar-t013-test";
const userSubjects: string[] = [];
const businessIds: string[] = [];
const fieldIds: string[] = [];
const customCropIds: string[] = [];
const seasonIds: string[] = [];
const planIds: string[] = [];
const calendarReadIds: string[] = [];

before(async () => prisma.$connect());

after(async () => {
  try {
    if (calendarReadIds.length) {
      await prisma.calendarReadSnapshot.deleteMany({ where: { readId: { in: calendarReadIds } } });
    }
    if (seasonIds.length) {
      await prisma.season.updateMany({
        where: { id: { in: seasonIds }, status: "ACTIVE" },
        data: { status: "DRAFT", activatedAt: null },
      });
    }
    if (planIds.length) await prisma.plannedTask.deleteMany({ where: { seasonPlanId: { in: planIds } } });
    if (planIds.length) await prisma.seasonPlan.deleteMany({ where: { id: { in: planIds } } });
    if (seasonIds.length) await prisma.season.deleteMany({ where: { id: { in: seasonIds } } });
    if (customCropIds.length) await prisma.customCrop.deleteMany({ where: { id: { in: customCropIds } } });
    if (fieldIds.length) await prisma.field.deleteMany({ where: { id: { in: fieldIds } } });
    if (userSubjects.length) {
      await prisma.applicationUser.deleteMany({ where: { authProvider: provider, authSubject: { in: userSubjects } } });
    }
    if (businessIds.length) await prisma.business.deleteMany({ where: { id: { in: businessIds } } });
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
    data: { seasonPlanId: plan.id, title: "Overdue fixture task", plannedLocalDate: new Date("2026-10-05T00:00:00.000Z") },
  });
  await prisma.seasonPlan.update({ where: { id: plan.id }, data: { status: "APPROVED" } });
  await prisma.season.update({ where: { id: season.id }, data: { status: "ACTIVE", activatedAt: new Date("2026-09-01T00:00:00.000Z") } });

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
  await assert.rejects(failingRepository.createRead(identity, { selectedDate: "2026-10-06" }), /injected projection write failure/);
  assert.equal(await prisma.calendarReadSnapshot.count({ where: { businessId: business.id } }), 0);

  const repository = new CalendarReadRepository(prisma);
  const read = await repository.createRead(identity, { selectedDate: "2026-10-06" });
  calendarReadIds.push(read.readId);
  assert.equal(read.selectedDate, "2026-10-06");
  assert.ok(read.readId);
  assert.equal(read.overdueTasksPage.items[0]?.taskId, task.id);
  assert.equal(read.selectedDateTasksPage.items.length, 0);
  assert.equal(read.monthIndicators.find(({ date }) => date === "2026-10-05")?.hasWork, true);
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
