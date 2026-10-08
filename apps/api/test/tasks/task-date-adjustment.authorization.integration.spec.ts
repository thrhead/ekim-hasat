import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../src/generated/prisma/client.js";
import { SeasonActivationRepository } from "../../src/seasons/seasons-activation.repository.js";
import { TaskDateAdjustmentRepository } from "../../src/tasks/task-date-adjustment.repository.js";
import { TaskDateAdjustmentError } from "../../src/tasks/task-date-adjustment.error.js";
import { assertDisposableDatabaseUrl } from "../support/disposable-database.js";

const databaseUrl = process.env.DATABASE_URL;
assertDisposableDatabaseUrl(databaseUrl);
const prismaUrl = new URL(databaseUrl!);
prismaUrl.searchParams.set("application_name", "spec008-adjustment-privacy-race");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: prismaUrl.toString() }) });
const run = randomUUID(), businessA = randomUUID(), businessB = randomUUID(), fieldA = randomUUID(), fieldA2 = randomUUID(), fieldA3 = randomUUID(), fieldB = randomUUID();
const userA = randomUUID(), userA2 = randomUUID(), userB = randomUUID(), cropId = randomUUID(), templateId = randomUUID();
const seasonA = randomUUID(), seasonA2 = randomUUID(), seasonA3 = randomUUID(), seasonB = randomUUID(), taskA = randomUUID(), taskA2 = randomUUID(), taskA3 = randomUUID(), taskB = randomUUID();
const identityA = { provider: "adjustment-authorization-test", subject: `${run}-a` };
const identityA2 = { provider: "adjustment-authorization-test", subject: `${run}-a2` };
const identityB = { provider: "adjustment-authorization-test", subject: `${run}-b` };
const repository = new TaskDateAdjustmentRepository(prisma);
const sharedAdjustmentId = randomUUID();

before(async () => {
  await prisma.$connect();
  await prisma.business.createMany({ data: [{ id: businessA }, { id: businessB }] });
  await prisma.applicationUser.createMany({ data: [
    { id: userA, authProvider: identityA.provider, authSubject: identityA.subject, defaultBusinessId: businessA },
    { id: userB, authProvider: identityB.provider, authSubject: identityB.subject, defaultBusinessId: businessB },
  ] });
  await prisma.membership.createMany({ data: [
    { userId: userA, businessId: businessA, role: "OWNER", status: "ACTIVE" },
    { userId: userB, businessId: businessB, role: "OWNER", status: "ACTIVE" },
  ] });
  await prisma.applicationUser.create({ data: { id: userA2, authProvider: identityA2.provider, authSubject: identityA2.subject, defaultBusinessId: businessA } });
  await prisma.membership.create({ data: { userId: userA2, businessId: businessA, role: "OWNER", status: "ACTIVE" } });
  await prisma.$executeRaw`INSERT INTO fields (id,business_id,name,representative_point) VALUES
    (${fieldA}::uuid,${businessA}::uuid,'Adjustment privacy A',ST_SetSRID(ST_MakePoint(29,41),4326)),
    (${fieldA2}::uuid,${businessA}::uuid,'Adjustment privacy A2',ST_SetSRID(ST_MakePoint(29,41),4326)),
    (${fieldA3}::uuid,${businessA}::uuid,'Adjustment privacy A3',ST_SetSRID(ST_MakePoint(29,41),4326)),
    (${fieldB}::uuid,${businessB}::uuid,'Adjustment privacy B',ST_SetSRID(ST_MakePoint(29,41),4326))`;
  await prisma.cropDefinitionVersion.create({ data: { id: cropId, cropKey: `adjustment-privacy-${run}`, version: "1", displayName: "Fixture crop" } });
  await prisma.validatedTemplateVersion.create({ data: { id: templateId, templateKey: `adjustment-privacy-template-${run}`, version: "1", cropDefinitionVersionId: cropId, taskDefinitions: [] } });
  for (const [businessId, fieldId, seasonId, taskId, suffix] of [[businessA, fieldA, seasonA, taskA, "a"], [businessA, fieldA2, seasonA2, taskA2, "a2"], [businessA, fieldA3, seasonA3, taskA3, "a3"], [businessB, fieldB, seasonB, taskB, "b"]] as const) {
    await prisma.season.create({ data: { id: seasonId, businessId, fieldId, cropKey: `adjustment-privacy-${run}`, cropDefinitionVersionId: cropId,
      actualPlantingDate: new Date("2026-09-01T00:00:00Z"), status: "DRAFT", version: 1,
      plan: { create: { source: "VALIDATED_TEMPLATE", templateVersionId: templateId, sourceSnapshot: { source: "VALIDATED_TEMPLATE", templateProvenance: { templateVersionId: templateId } }, status: "DRAFT",
        tasks: { create: { id: taskId, title: `Inspect ${suffix}`, plannedLocalDate: new Date("2026-09-29T00:00:00Z"), version: 1 } } } } } });
    await new SeasonActivationRepository(prisma).activate(suffix === "a2" ? identityA2 : suffix === "b" ? identityB : identityA, seasonId, 1, randomUUID());
  }
});

after(async () => { await prisma.$disconnect(); });

test("the same public adjustment ID is independently accepted in two authorized Businesses", async () => {
  const a = await repository.adjust(identityA, taskA, 1, { adjustmentId: sharedAdjustmentId, newPlannedLocalDate: "2026-10-10" });
  const b = await repository.adjust(identityB, taskB, 1, { adjustmentId: sharedAdjustmentId, newPlannedLocalDate: "2026-10-11" });
  assert.equal(a.kind, "accepted");
  assert.equal(b.kind, "accepted");
  assert.equal(await prisma.taskDateAdjustment.count({ where: { adjustmentId: sharedAdjustmentId } }), 2);
  assert.equal(await prisma.taskDateAdjustment.count({ where: { businessId: businessA, adjustmentId: sharedAdjustmentId } }), 1);
  assert.equal(await prisma.taskDateAdjustment.count({ where: { businessId: businessB, adjustmentId: sharedAdjustmentId } }), 1);
});

test("same-Business concurrent insertion collision recovers only the winner's scoped identity", async () => {
  const adjustmentId = randomUUID();
  const blocker = new Client({ connectionString: databaseUrl });
  const observer = new Client({ connectionString: databaseUrl });
  await blocker.connect(); await observer.connect();
  await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION wait_spec008_adjustment_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(19008, 1); RETURN NEW; END $$`);
  await prisma.$executeRawUnsafe("CREATE TRIGGER wait_spec008_adjustment_insert BEFORE INSERT ON task_date_adjustments FOR EACH ROW EXECUTE FUNCTION wait_spec008_adjustment_insert()");
  try {
    await blocker.query("SELECT pg_advisory_lock(19008, 1)");
    const commands = [
      repository.adjust(identityA, taskA3, 1, { adjustmentId, newPlannedLocalDate: "2026-10-10" }),
      repository.adjust(identityA2, taskA2, 1, { adjustmentId, newPlannedLocalDate: "2026-10-11" }),
    ];
    let waiting = 0;
    const deadline = Date.now() + 10_000;
    while (waiting < 2 && Date.now() < deadline) {
      const result = await observer.query(`SELECT count(*)::int AS count FROM pg_stat_activity
        WHERE datname = current_database() AND application_name = 'spec008-adjustment-privacy-race' AND wait_event_type = 'Lock'`);
      waiting = result.rows[0]?.count ?? 0;
      if (waiting < 2) await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.ok(waiting >= 2, "both authorized commands must reach the held insert barrier");
    await blocker.query("SELECT pg_advisory_unlock(19008, 1)");
    const results = await Promise.allSettled(commands);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    const loser = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
    assert.ok(loser.reason instanceof TaskDateAdjustmentError, `${String(loser.reason)} ${JSON.stringify(loser.reason)}`);
    assert.equal(loser.reason.presentation.code, "IDEMPOTENCY_KEY_REUSED");
  } finally {
    await prisma.$executeRawUnsafe("DROP TRIGGER IF EXISTS wait_spec008_adjustment_insert ON task_date_adjustments");
    await prisma.$executeRawUnsafe("DROP FUNCTION IF EXISTS wait_spec008_adjustment_insert()");
    await blocker.end(); await observer.end();
  }
  assert.equal(await prisma.taskDateAdjustment.count({ where: { businessId: businessA, adjustmentId } }), 1);
  assert.equal(await prisma.taskDateAdjustment.count({ where: { businessId: businessB, adjustmentId } }), 0);
});

test("foreign-only and unknown adjustment IDs are indistinguishable and do not reveal foreign state", async () => {
  const foreignOnlyId = randomUUID();
  const unknownId = randomUUID();
  await repository.adjust(identityA, taskA, 2, { adjustmentId: foreignOnlyId, newPlannedLocalDate: "2026-10-12" });
  const probe = async (adjustmentId: string) => {
    try {
      await repository.adjust(identityB, taskB, 1, { adjustmentId, newPlannedLocalDate: "2026-10-12" });
      return "accepted";
    } catch (error) {
      const featureError = error as TaskDateAdjustmentError;
      return featureError.presentation?.code ?? featureError.name;
    }
  };
  assert.equal(await probe(foreignOnlyId), "TASK_VERSION_CONFLICT");
  assert.equal(await probe(unknownId), "TASK_VERSION_CONFLICT");
  assert.equal(await prisma.taskDateAdjustment.count({ where: { businessId: businessB, adjustmentId: unknownId } }), 0);
  const taskProbe = async (id: string) => {
    try { await repository.readHistory(identityB, id); return 200; }
    catch (error) { return error instanceof NotFoundException ? error.getStatus() : (error as { getStatus?: () => number }).getStatus?.(); }
  };
  assert.equal(await taskProbe(taskA), 404);
  assert.equal(await taskProbe(randomUUID()), 404);
  await assert.rejects(repository.adjust(identityB, taskA, 1, { adjustmentId: randomUUID(), newPlannedLocalDate: "2026-10-12" }), NotFoundException);
});

test("current Membership revocation blocks exact replay while retaining referenced Membership history", async () => {
  const accepted = await repository.adjust(identityB, taskB, 1, { adjustmentId: sharedAdjustmentId, newPlannedLocalDate: "2026-10-11" });
  await prisma.membership.update({ where: { businessId_userId: { businessId: businessB, userId: userB } }, data: { status: "REVOKED" } });
  await assert.rejects(repository.adjust(identityB, taskB, 1, { adjustmentId: sharedAdjustmentId, newPlannedLocalDate: "2026-10-11" }),
    (error: unknown) => error instanceof ForbiddenException && error.getStatus() === 403);
  await assert.rejects(repository.readHistory(identityB, taskB), (error: unknown) => error instanceof ForbiddenException && error.getStatus() === 403);
  assert.equal(accepted.kind, "replayed");
  assert.equal(await prisma.membership.count({ where: { businessId: businessB, userId: userB } }), 1);
  assert.equal(await prisma.taskDateAdjustment.count({ where: { businessId: businessB, adjustmentId: sharedAdjustmentId } }), 1);
});
