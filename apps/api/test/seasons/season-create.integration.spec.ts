import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../src/generated/prisma/client.js";
import { SeasonCreateRepository } from "../../src/seasons/seasons-create.repository.js";
import { SeasonCommandError } from "../../src/seasons/seasons-command.error.js";
import { BusinessScopeForbiddenError } from "../../src/authorization/membership-scope.service.js";
import { NotFoundException } from "@nestjs/common";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const run = randomUUID();
const businessId = randomUUID(), otherBusinessId = randomUUID(), fieldId = randomUUID(), otherFieldId = randomUUID();
const userId = randomUUID(), otherUserId = randomUUID(), teammateId = randomUUID();
const identity = { provider: "season-create-test", subject: run };
const teammate = { provider: identity.provider, subject: `${run}-teammate` };
const foreign = { provider: identity.provider, subject: `${run}-foreign` };
const cropId = randomUUID(), cropV2Id = randomUUID(), unsupportedId = randomUUID(), emptyId = randomUUID();
const templateId = randomUUID(), emptyTemplateId = randomUUID();
const cropKey = `fixture-${run}`;
const repository = () => new SeasonCreateRepository(prisma, () => new Date("2026-09-28T21:30:00Z"));
const command = (date: string, extras = {}) => ({ crop: { centralCropId: cropId }, sowingPlantingDate: date, ...extras });
const manual = (date: string, name = "Yerel  ürün") => ({ crop: { customCropName: name }, sowingPlantingDate: date, planSource: "MANUAL" });
const create = (body: unknown, key = randomUUID(), who = identity, field = fieldId) => repository().createDraft(who, field, body, key);
async function rejectsCode(action: () => Promise<unknown>, code: string, status: number) {
  await assert.rejects(action, (error: unknown) => { assert.ok(error instanceof SeasonCommandError); assert.equal(error.presentation.code, code); assert.equal(error.getStatus(), status); return true; });
}
before(async () => {
  await prisma.$connect();
  await prisma.business.createMany({ data: [{ id: businessId, timezone: "Europe/Istanbul" }, { id: otherBusinessId }] });
  await prisma.applicationUser.createMany({ data: [{ id: userId, authProvider: identity.provider, authSubject: identity.subject, defaultBusinessId: businessId }, { id: teammateId, authProvider: teammate.provider, authSubject: teammate.subject, defaultBusinessId: businessId }, { id: otherUserId, authProvider: foreign.provider, authSubject: foreign.subject, defaultBusinessId: otherBusinessId }] });
  await prisma.membership.createMany({ data: [{ userId, businessId, role: "OWNER", status: "ACTIVE" }, { userId: teammateId, businessId, role: "OWNER", status: "ACTIVE" }, { userId: otherUserId, businessId: otherBusinessId, role: "OWNER", status: "ACTIVE" }] });
  for (const [id, business] of [[fieldId, businessId], [otherFieldId, otherBusinessId]]) await prisma.$executeRaw`INSERT INTO fields (id,business_id,name,representative_point) VALUES (${id}::uuid,${business}::uuid,'Fixture field',ST_SetSRID(ST_MakePoint(29,41),4326))`;
  await prisma.cropDefinitionVersion.createMany({ data: [{ id: cropId, cropKey, version: "1", displayName: "Fixture central" }, { id: cropV2Id, cropKey, version: "2", displayName: "Fixture v2" }, { id: unsupportedId, cropKey: `${cropKey}-unsupported`, version: "1", displayName: "Unsupported" }, { id: emptyId, cropKey: `${cropKey}-empty`, version: "1", displayName: "Empty" }] });
  await prisma.validatedTemplateVersion.createMany({ data: [{ id: templateId, templateKey: cropKey, version: "1", cropDefinitionVersionId: cropId, taskDefinitions: [{ key: "check", title: "Inspect field", description: "Published instruction", offsetDays: 0 }, { key: "follow", title: "Follow up", offsetDays: 3 }] }, { id: emptyTemplateId, templateKey: `${cropKey}-empty`, version: "1", cropDefinitionVersionId: emptyId, taskDefinitions: [] }] });
});
after(async () => {
  try {
    await prisma.seasonCommandIdempotencyRecord.deleteMany({ where: { businessId: { in: [businessId, otherBusinessId] } } });
    await prisma.season.updateMany({ where: { businessId }, data: { status: "DRAFT", activatedAt: null } });
    await prisma.plannedTask.deleteMany({ where: { seasonPlan: { season: { businessId } } } });
    await prisma.seasonPlan.deleteMany({ where: { season: { businessId } } });
    await prisma.season.deleteMany({ where: { businessId } });
    await prisma.customCrop.deleteMany({ where: { businessId: { in: [businessId, otherBusinessId] } } });
    await prisma.validatedTemplateVersion.deleteMany({ where: { cropDefinitionVersionId: { in: [cropId, cropV2Id, unsupportedId, emptyId] } } });
    await prisma.cropDefinitionVersion.deleteMany({ where: { id: { in: [cropId, cropV2Id, unsupportedId, emptyId] } } });
    await prisma.field.deleteMany({ where: { id: { in: [fieldId, otherFieldId] } } });
    await prisma.applicationUser.deleteMany({ where: { id: { in: [userId, otherUserId, teammateId] } } });
    await prisma.business.deleteMany({ where: { id: { in: [businessId, otherBusinessId] } } });
  } finally { await prisma.$disconnect(); }
});

test("transaction creates DRAFT season, immutable provenance and independent task copies using DATE", async () => {
  const result = await create(command("2026-08-01"));
  assert.equal(result.kind, "created"); assert.equal(result.season.status, "DRAFT");
  assert.equal(result.season.plan.source.templateVersionId, templateId);
  assert.deepEqual(result.season.plan.tasks.map((task) => task.plannedLocalDate).sort(), ["2026-08-01", "2026-08-04"]);
  const plan = await prisma.seasonPlan.findUniqueOrThrow({ where: { seasonId: result.season.id }, include: { tasks: true } });
  assert.deepEqual(plan.tasks.map((task) => task.sourceTemplateTaskKey).sort(), ["check", "follow"]);
  assert.equal((plan.sourceSnapshot as { templateProvenance: { templateVersionId: string } }).templateProvenance.templateVersionId, templateId);
  const types = await prisma.$queryRaw<Array<{ actual: string; actualtype: string; plannedtype: string }>>`SELECT s.actual_planting_date::text AS actual,pg_typeof(s.actual_planting_date)::text AS actualtype,pg_typeof(t.planned_local_date)::text AS plannedtype FROM seasons s JOIN season_plans p ON p.season_id=s.id JOIN planned_tasks t ON t.season_plan_id=p.id WHERE s.id=${result.season.id}::uuid LIMIT 1`;
  assert.deepEqual(types[0], { actual: "2026-08-01", actualtype: "date", plannedtype: "date" });
  await prisma.plannedTask.update({ where: { id: plan.tasks[0].id }, data: { title: "Farmer copy" } });
  const template = await prisma.validatedTemplateVersion.findUniqueOrThrow({ where: { id: templateId } });
  assert.equal((template.taskDefinitions as Array<{ title: string }>)[0].title, "Inspect field");
});
test("same key replay returns original committed snapshot after lost response, editing and availability change", async () => {
  const key = randomUUID(); const body = command("2026-08-02"); const initial = await create(body, key);
  await prisma.plannedTask.update({ where: { id: initial.season.plan.tasks[0].id }, data: { title: "Changed after create" } });
  await prisma.validatedTemplateVersion.update({ where: { id: templateId }, data: { available: false } });
  try { const replay = await new SeasonCreateRepository(prisma).createDraft(identity, fieldId, body, key);
    assert.equal(replay.kind, "replayed"); assert.deepEqual(replay.season, initial.season);
  } finally { await prisma.validatedTemplateVersion.update({ where: { id: templateId }, data: { available: true } }); }
  await rejectsCode(() => create(command("2026-08-03"), key), "IDEMPOTENCY_KEY_REUSED", 409);
  await rejectsCode(() => create({ ...body, planSource: "MANUAL" }, key), "IDEMPOTENCY_KEY_REUSED", 409);
});
test("different keys dedupe stable central crop identity across definition versions and ACTIVE state unchanged", async () => {
  const first = await create(command("2026-08-04"));
  await prisma.season.update({ where: { id: first.season.id }, data: { status: "ACTIVE", activatedAt: new Date("2026-09-01T00:00:00Z"), version: 2 } });
  const second = await create(command("2026-08-04", { crop: { centralCropId: cropV2Id }, planSource: "MANUAL" }));
  assert.equal(second.kind, "existing"); assert.equal(second.season.id, first.season.id); assert.equal(second.season.status, "ACTIVE"); assert.equal(second.season.version, 2);
  assert.equal(second.season.plan.source.templateVersionId, templateId);
  assert.equal(await prisma.season.count({ where: { businessId, fieldId, cropKey, actualPlantingDate: new Date("2026-08-04") } }), 1);
  await prisma.cropDefinitionVersion.update({ where: { id: cropId }, data: { selectable: false } });
  try { assert.equal((await create(command("2026-08-04"))).season.id, first.season.id); }
  finally { await prisma.cropDefinitionVersion.update({ where: { id: cropId }, data: { selectable: true } }); }
});
test("concurrent different keys and different authorized users create one logical season", async () => {
  const results = await Promise.all(Array.from({ length: 6 }, (_, i) => create(command("2026-08-05"), randomUUID(), i % 2 ? identity : teammate)));
  assert.equal(new Set(results.map((r) => r.season.id)).size, 1); assert.equal(results.filter((r) => r.kind === "created").length, 1);
  assert.equal(await prisma.seasonCommandIdempotencyRecord.count({ where: { seasonId: results[0].season.id } }), 6);
});
test("concurrent identical keys replay one commit; changed same-key command conflicts", async () => {
  const key = randomUUID(); const results = await Promise.all([create(command("2026-08-06"), key), create(command("2026-08-06"), key)]);
  assert.deepEqual(new Set(results.map((r) => r.kind)), new Set(["created", "replayed"])); assert.deepEqual(results[0].season, results[1].season);
  const changedKey = randomUUID(); const outcomes = await Promise.allSettled([create(command("2026-08-07"), changedKey), create(command("2026-08-08"), changedKey)]);
  assert.equal(outcomes.filter((r) => r.status === "fulfilled").length, 1);
  const loser = outcomes.find((r) => r.status === "rejected"); assert.ok(loser?.status === "rejected" && loser.reason instanceof SeasonCommandError); assert.equal(loser.reason.presentation.code, "IDEMPOTENCY_KEY_REUSED");
});
test("custom names trim surrounding whitespace without central aliasing or name reuse", async () => {
  const first = await create(manual("2026-08-09", "  Fixture central  "));
  const second = await create(manual("2026-08-09", "Fixture central"));
  assert.notEqual(first.season.id, second.season.id); assert.equal(first.season.cropDisplayName, "Fixture central");
  assert.equal(first.season.plan.source.kind, "MANUAL"); assert.equal(first.season.plan.source.templateVersionId, null); assert.deepEqual(first.season.plan.tasks, []);
  const crops = await prisma.customCrop.findMany({ where: { businessId, displayName: "Fixture central" } }); assert.equal(crops.length, 2); assert.notEqual(crops[0].id, crops[1].id);
  const key = randomUUID(); const third = await create(manual("2026-08-09", "  Yerel  ürün  "), key); assert.equal(third.season.cropDisplayName, "Yerel  ürün");
  await rejectsCode(() => create(manual("2026-08-09", "Yerel  ürün"), key), "IDEMPOTENCY_KEY_REUSED", 409);
});
test("unsupported and empty-template crops require explicit MANUAL; no zero-task validated plan or fallback", async () => {
  for (const id of [unsupportedId, emptyId]) {
    const body = command("2026-08-10", { crop: { centralCropId: id } });
    await rejectsCode(() => create(body), "MANUAL_PLAN_CHOICE_REQUIRED", 409);
    assert.equal(await prisma.season.count({ where: { cropDefinitionVersionId: id } }), 0);
    const created = await create({ ...body, planSource: "MANUAL" }); assert.equal(created.season.plan.source.kind, "MANUAL"); assert.deepEqual(created.season.plan.tasks, []);
  }
  await rejectsCode(() => create({ crop: { customCropName: "No explicit choice" }, sowingPlantingDate: "2026-08-11" }), "MANUAL_PLAN_CHOICE_REQUIRED", 409);
  await rejectsCode(() => create(command("2026-08-11", { planSource: "MANUAL" })), "INVALID_REQUEST", 400);
});
test("actual local date uses business timezone with past unlimited, today allowed and future rejected", async () => {
  for (const date of ["0001-01-01", "1900-01-01", "2026-09-29"]) assert.equal((await create(manual(date, `Crop ${date}`))).kind, "created");
  await rejectsCode(() => create(manual("2026-09-30")), "SEASON_DATE_IN_FUTURE", 400);
  await prisma.business.update({ where: { id: businessId }, data: { timezone: "Pacific/Honolulu" } });
  try { await rejectsCode(() => create(manual("2026-09-29")), "SEASON_DATE_IN_FUTURE", 400); }
  finally { await prisma.business.update({ where: { id: businessId }, data: { timezone: "Europe/Istanbul" } }); }
});
test("cross-business fields and nonexistent fields share 404; revoked membership blocks create and replay", async () => {
  for (const field of [otherFieldId, randomUUID()]) await assert.rejects(() => create(command("2026-08-12"), randomUUID(), identity, field), NotFoundException);
  await assert.rejects(() => create(command("2026-08-12"), randomUUID(), foreign, fieldId), NotFoundException);
  const key = randomUUID(); await create(command("2026-08-12"), key);
  await prisma.membership.update({ where: { businessId_userId: { businessId, userId } }, data: { status: "REVOKED" } });
  try { await assert.rejects(() => create(command("2026-08-12"), key), BusinessScopeForbiddenError); }
  finally { await prisma.membership.update({ where: { businessId_userId: { businessId, userId } }, data: { status: "ACTIVE" } }); }
  assert.equal(await prisma.season.count({ where: { businessId: otherBusinessId } }), 0);
});
test("failure after season and plan creation atomically rolls back custom crop and idempotency outcome", async () => {
  const counts = await Promise.all([prisma.customCrop.count({ where: { businessId } }), prisma.season.count({ where: { businessId } }), prisma.seasonPlan.count({ where: { season: { businessId } } }), prisma.seasonCommandIdempotencyRecord.count({ where: { businessId } })]);
  const prior = process.env.SEASON_IDEMPOTENCY_RETENTION_HOURS; process.env.SEASON_IDEMPOTENCY_RETENTION_HOURS = "invalid";
  try { await assert.rejects(() => create(manual("2026-08-13", "Rollback crop")), /retention/); await assert.rejects(() => create(command("2026-08-13")), /retention/); }
  finally { if (prior === undefined) delete process.env.SEASON_IDEMPOTENCY_RETENTION_HOURS; else process.env.SEASON_IDEMPOTENCY_RETENTION_HOURS = prior; }
  const afterCounts = await Promise.all([prisma.customCrop.count({ where: { businessId } }), prisma.season.count({ where: { businessId } }), prisma.seasonPlan.count({ where: { season: { businessId } } }), prisma.seasonCommandIdempotencyRecord.count({ where: { businessId } })]);
  assert.deepEqual(afterCounts, counts); assert.equal(await prisma.plannedTask.count({ where: { seasonPlan: { season: { businessId, actualPlantingDate: new Date("2026-08-13") } } } }), 0);
  assert.equal((await create(manual("2026-08-13", "Rollback crop"))).kind, "created");
});
test("idempotency timestamps use one injected clock for historical deterministic creates", async () => {
  const key = randomUUID();
  const createdAt = new Date("2000-01-01T00:00:00.000Z");
  const retentionHours = Number(process.env.SEASON_IDEMPOTENCY_RETENTION_HOURS ?? "24");
  const repo = new SeasonCreateRepository(prisma, () => new Date(createdAt));
  const result = await repo.createDraft(identity, fieldId, manual("1900-01-01", "Historical clock crop"), key);
  assert.equal(result.kind, "created");
  const outcome = await prisma.seasonCommandIdempotencyRecord.findFirstOrThrow({
    where: { seasonId: result.season.id, command: "CREATE", key },
    select: { createdAt: true, expiresAt: true },
  });
  assert.equal(outcome.createdAt.toISOString(), createdAt.toISOString());
  assert.equal(outcome.expiresAt.getTime() - outcome.createdAt.getTime(), retentionHours * 60 * 60 * 1000);
  assert.ok(outcome.expiresAt > outcome.createdAt);
});
