import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ApiError } from "../../src/observability/api-error.filter.js";
import { after, before, test } from "node:test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../src/generated/prisma/client.js";
import { ObservationDiaryRepository } from "../../src/observations/observation-diary.repository.js";
import { createObservationApp } from "../../src/observations/observation.controller.js";
import { ObservationCreateRepository } from "../../src/observations/observation.repository.js";
import { decodeDiaryCursor } from "../../src/observations/diary-query.js";
import { ExpenseDiaryReader } from "../../src/finance/expense-diary-reader.js";
import { TaskCompletionRepository } from "../../src/tasks/task-completion.repository.js";
import { TaskSkipRepository } from "../../src/tasks/task-skip.repository.js";
import { SeasonActivationRepository } from "../../src/seasons/seasons-activation.repository.js";
import { assertDisposableDatabaseUrl } from "../support/disposable-database.js";

const databaseUrl = process.env.DATABASE_URL;
assertDisposableDatabaseUrl(databaseUrl);
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }), log: [{ emit: "event", level: "query" }] });
const queryEvents: string[] = [];
prisma.$on("query", ({ query }) => queryEvents.push(query));
const run = randomUUID(), businessId = randomUUID(), foreignBusinessId = randomUUID(), userId = randomUUID(), foreignUserId = randomUUID(), fieldId = randomUUID(), foreignFieldId = randomUUID(), seasonId = randomUUID();
const otherSeasonId = randomUUID();
const cropId = randomUUID(), templateId = randomUUID(), taskId = randomUUID(), skipTaskId = randomUUID(), completionId = randomUUID(), skipId = randomUUID();
const irrigationRecordId = randomUUID(), matchingSeasonIrrigationId = randomUUID(), otherSeasonIrrigationId = randomUUID();
const fieldExpenseId = "f0000000-0000-4000-8000-000000000001", olderFieldExpenseId = randomUUID(), seasonExpenseId = "00000000-0000-4000-8000-000000000000", otherSeasonExpenseId = "f0000000-0000-4000-8000-000000000002";
const harvestId = "f1000000-0000-4000-8000-000000000001", secondHarvestId = "f1000000-0000-4000-8000-000000000002";
const otherSeasonHarvestId = "00000000-0000-4000-8000-000000000003", foreignHarvestId = randomUUID();
const foreignSeasonId = randomUUID(), workerId = randomUUID(), advisorId = randomUUID();
const identity = { provider: "spec006-diary", subject: run };
const foreignIdentity = { provider: "spec006-diary", subject: `${run}-foreign` };
const workerIdentity = { provider: "spec006-diary", subject: `${run}-worker` };
const advisorIdentity = { provider: "spec006-diary", subject: `${run}-advisor` };
const taskCompletions = new TaskCompletionRepository(prisma);
const observationCreates = new ObservationCreateRepository(prisma, () => new Date("2026-10-05T10:00:00.000Z"));
const tieAt = "2026-10-04T09:30:00.000Z";
const taskSkips = new TaskSkipRepository(prisma, () => new Date(tieAt));
const diary = new ObservationDiaryRepository(prisma, taskCompletions, taskSkips);
const expenseDiary = new ExpenseDiaryReader(prisma);
const observationIds: string[] = [];

before(async () => {
  await prisma.$connect();
  const target = await prisma.$queryRaw<Array<{ database: string; postgis: boolean }>>`SELECT current_database() AS database, EXISTS(SELECT 1 FROM pg_extension WHERE extname='postgis') AS postgis`;
  assert.equal(target[0]?.database, "ekim_hasat_test");
  assert.equal(target[0]?.postgis, true);
  await prisma.business.createMany({ data: [{ id: businessId, timezone: "Asia/Tokyo" }, { id: foreignBusinessId, timezone: "Europe/Istanbul" }] });
  await prisma.applicationUser.create({ data: { id: userId, authProvider: identity.provider, authSubject: identity.subject, defaultBusinessId: businessId } });
  await prisma.applicationUser.create({ data: { id: foreignUserId, authProvider: foreignIdentity.provider, authSubject: foreignIdentity.subject, defaultBusinessId: foreignBusinessId } });
  await prisma.applicationUser.create({ data: { id: workerId, authProvider: workerIdentity.provider, authSubject: workerIdentity.subject, defaultBusinessId: businessId } });
  await prisma.applicationUser.create({ data: { id: advisorId, authProvider: advisorIdentity.provider, authSubject: advisorIdentity.subject, defaultBusinessId: businessId } });
  await prisma.membership.create({ data: { businessId, userId, role: "OWNER", status: "ACTIVE" } });
  await prisma.membership.create({ data: { businessId: foreignBusinessId, userId: foreignUserId, role: "OWNER", status: "ACTIVE" } });
  await prisma.membership.create({ data: { businessId, userId: workerId, role: "WORKER", status: "ACTIVE" } });
  await prisma.membership.create({ data: { businessId, userId: advisorId, role: "ADVISOR", status: "ACTIVE" } });
  await prisma.$executeRaw`INSERT INTO fields (id,business_id,name,representative_point) VALUES
    (${fieldId}::uuid,${businessId}::uuid,'Diary field',ST_SetSRID(ST_MakePoint(29,41),4326)),
    (${foreignFieldId}::uuid,${foreignBusinessId}::uuid,'Foreign diary',ST_SetSRID(ST_MakePoint(29,41),4326))`;
  await prisma.cropDefinitionVersion.create({ data: { id: cropId, cropKey: `diary-${run}`, version: "1", displayName: "Diary fixture" } });
  await prisma.validatedTemplateVersion.create({ data: { id: templateId, templateKey: `diary-${run}`, version: "1", cropDefinitionVersionId: cropId, taskDefinitions: [] } });
  await prisma.season.create({ data: { id: seasonId, businessId, fieldId, cropKey: `diary-${run}`, cropDefinitionVersionId: cropId,
    actualPlantingDate: new Date("2026-10-01T00:00:00.000Z"), status: "DRAFT", version: 1,
    plan: { create: { source: "VALIDATED_TEMPLATE", templateVersionId: templateId,
      sourceSnapshot: { source: "VALIDATED_TEMPLATE", templateProvenance: { templateVersionId: templateId } }, status: "DRAFT",
      tasks: { create: [
        { id: taskId, title: "Check row", plannedLocalDate: new Date("2026-10-04T00:00:00.000Z"), sourceTemplateTaskKey: "check-row", version: 1 },
        { id: skipTaskId, title: "Skip irrigation check", plannedLocalDate: new Date("2026-10-03T00:00:00.000Z"), sourceTemplateTaskKey: "skip-check", version: 1 },
      ] } } } } });
  await new SeasonActivationRepository(prisma).activate(identity, seasonId, 1, randomUUID());
  await prisma.season.create({ data: { id: otherSeasonId, businessId, fieldId, cropKey: `diary-${run}`, cropDefinitionVersionId: cropId,
    actualPlantingDate: new Date("2026-09-01T00:00:00.000Z"), status: "DRAFT", version: 1 } });
  await prisma.season.create({ data: { id: foreignSeasonId, businessId: foreignBusinessId, fieldId: foreignFieldId, cropKey: `diary-${run}`, cropDefinitionVersionId: cropId,
    actualPlantingDate: new Date("2026-09-01T00:00:00.000Z"), status: "DRAFT", version: 1 } });
  await taskCompletions.complete(identity, taskId, 1, { completionId, occurredAt: tieAt });
  await taskSkips.skip(identity, skipTaskId, 1, { skipId });

  for (let index = 0; index < 105; index++) observationIds.push(randomUUID());
  const observations = observationIds.map((id, index) => ({ id, businessId, fieldId,
    seasonId: index === 0 ? seasonId : null, actorUserId: userId,
    actorMembershipId: "", description: `Inspection ${index}`,
    occurredAt: new Date(Date.parse("2026-10-05T08:00:00.000Z") - index * 60_000),
    acceptedAt: new Date("2026-10-05T10:00:00.000Z"), payloadFingerprint: randomUUID().replaceAll("-", "") }));
  const membership = await prisma.membership.findUniqueOrThrow({ where: { businessId_userId: { businessId, userId } }, select: { id: true } });
  await prisma.expense.createMany({ data: [
    { id: fieldExpenseId, businessId, fieldId, seasonId: null, actorUserId: userId, actorMembershipId: membership.id,
      amount: "12.30", currency: "TRY", category: "FERTILIZER", expenseDate: new Date("2026-10-05T00:00:00.000Z"), note: "Seedlings" },
    { id: olderFieldExpenseId, businessId, fieldId, seasonId: null, actorUserId: userId, actorMembershipId: membership.id,
      amount: "2.00", currency: "TRY", category: "FUEL", expenseDate: new Date("2026-10-04T00:00:00.000Z"), note: null },
    { id: seasonExpenseId, businessId, fieldId, seasonId, actorUserId: userId, actorMembershipId: membership.id,
      amount: "5.00", currency: "TRY", category: "LABOR", expenseDate: new Date("2026-10-05T00:00:00.000Z"), note: null },
    { id: otherSeasonExpenseId, businessId, fieldId, seasonId: otherSeasonId, actorUserId: userId, actorMembershipId: membership.id,
      amount: "7.00", currency: "TRY", category: "SEED_SEEDLING", expenseDate: new Date("2026-10-05T00:00:00.000Z"), note: null },
  ] });
  await prisma.harvest.createMany({ data: [
    { id: harvestId, businessId, fieldId, seasonId, actorUserId: userId, actorMembershipId: membership.id,
      harvestDate: new Date("2026-10-05T00:00:00.000Z"), quantity: "12.375", unit: "METRIC_TONNE", recordedAt: new Date("2026-10-05T10:00:00.000Z") },
    { id: secondHarvestId, businessId, fieldId, seasonId, actorUserId: userId, actorMembershipId: membership.id,
      harvestDate: new Date("2026-10-05T00:00:00.000Z"), quantity: "8.250", unit: "KG", recordedAt: new Date("2026-10-05T10:01:00.000Z") },
    { id: otherSeasonHarvestId, businessId, fieldId, seasonId: otherSeasonId, actorUserId: userId, actorMembershipId: membership.id,
      harvestDate: new Date("2026-10-05T00:00:00.000Z"), quantity: "5", unit: "KG", recordedAt: new Date("2026-10-05T10:02:00.000Z") },
    { id: foreignHarvestId, businessId: foreignBusinessId, fieldId: foreignFieldId, seasonId: foreignSeasonId,
      actorUserId: foreignUserId, actorMembershipId: (await prisma.membership.findUniqueOrThrow({
        where: { businessId_userId: { businessId: foreignBusinessId, userId: foreignUserId } }, select: { id: true },
      })).id, harvestDate: new Date("2026-10-05T00:00:00.000Z"), quantity: "9.5", unit: "KG",
      recordedAt: new Date("2026-10-05T10:03:00.000Z") },
  ] });
  await prisma.fieldObservation.createMany({ data: observations.map((row) => ({ ...row, actorMembershipId: membership.id })) });
  // An observation and accepted completion share an occurrence instant to protect observation-first ties.
  const tieId = randomUUID(); observationIds.push(tieId);
  await prisma.fieldObservation.create({ data: { id: tieId, businessId, fieldId, seasonId,
    actorUserId: userId, actorMembershipId: membership.id, description: "At completion time", occurredAt: new Date(tieAt),
    acceptedAt: new Date("2026-10-05T10:00:00.000Z"), payloadFingerprint: randomUUID().replaceAll("-", "") } });
  await prisma.irrigationRecord.create({ data: { id: irrigationRecordId, businessId, fieldId, seasonId: null,
    actorUserId: userId, actorMembershipId: membership.id, occurredAt: new Date(tieAt),
    recordedAt: new Date("2026-10-05T10:00:00.000Z"), method: "Drip", durationMinutes: 30 } });
  await prisma.irrigationRecord.createMany({ data: [
    { id: matchingSeasonIrrigationId, businessId, fieldId, seasonId, actorUserId: userId, actorMembershipId: membership.id,
      occurredAt: new Date("2026-10-04T09:31:00.000Z"), recordedAt: new Date("2026-10-05T10:00:00.000Z"), method: "Drip" },
    { id: otherSeasonIrrigationId, businessId, fieldId, seasonId: otherSeasonId, actorUserId: userId, actorMembershipId: membership.id,
      occurredAt: new Date("2026-10-04T09:32:00.000Z"), recordedAt: new Date("2026-10-05T10:00:00.000Z"), method: "Drip" },
  ] });
});

after(async () => { await prisma.$disconnect(); });

test("Field and Season diary pages merge canonical completions and observations in a bounded stable traversal", async () => {
  const defaultPage = await diary.read(identity, fieldId);
  assert.equal(defaultPage.items.length, 50);
  const first = await diary.read(identity, fieldId, { limit: 100 });
  assert.equal(first.items.length, 100);
  assert.equal(first.businessTimezone, "Asia/Tokyo");
  assert.ok(first.nextCursor);
  const second = await diary.read(identity, fieldId, { limit: 100, cursor: first.nextCursor! });
  assert.equal(second.items.length, 8);
  assert.equal(second.nextCursor, null);
  const ids = [...first.items, ...second.items].map(({ id }) => id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(ids.length, 108);
  assert.equal(ids.includes(completionId), true);
  const tieEntries = [...first.items, ...second.items].filter((entry) => (entry.kind === "TASK_SKIPPED" ? entry.skippedAt : entry.occurredAt) === tieAt);
  assert.deepEqual(tieEntries.map(({ kind }) => kind), ["OBSERVATION", "TASK_COMPLETION", "TASK_SKIPPED"]);
  const skipProjection = [...first.items, ...second.items].find((entry) => entry.kind === "TASK_SKIPPED" && entry.skipId === skipId);
  assert.ok(skipProjection && skipProjection.kind === "TASK_SKIPPED");
  assert.equal(skipProjection.taskId, skipTaskId);
  assert.equal(skipProjection.seasonId, seasonId);
  assert.equal(skipProjection.plannedLocalDate, "2026-10-03");
  assert.equal(skipProjection.skippedAt, tieAt);
  assert.equal([...first.items, ...second.items].filter((entry) => entry.kind === "TASK_SKIPPED" && entry.skipId === skipId).length, 1);
  const season = await diary.read(identity, fieldId, { seasonId, limit: 100 });
  assert.ok(season.items.every((item) => item.kind === "TASK_COMPLETION" || item.seasonId === seasonId));
  assert.equal(season.items.some((item) => item.kind === "TASK_COMPLETION" && item.id === completionId), true);
});

test("strict continuation omits later insertions before the cursor and may include insertions after it", async () => {
  const initial = await diary.read(identity, fieldId, { limit: 3 });
  const cursor = initial.nextCursor!;
  const key = decodeDiaryCursor(cursor, fieldId, null)!;
  const userMembership = await prisma.membership.findUniqueOrThrow({ where: { businessId_userId: { businessId, userId } }, select: { id: true } });
  const olderId = randomUUID(), newerId = randomUUID();
  await prisma.fieldObservation.createMany({ data: [
    { id: newerId, businessId, fieldId, seasonId: null, actorUserId: userId, actorMembershipId: userMembership.id, description: "Before", occurredAt: new Date(Date.parse(key.occurredAt) + 1_000), acceptedAt: new Date(), payloadFingerprint: randomUUID().replaceAll("-", "") },
    { id: olderId, businessId, fieldId, seasonId: null, actorUserId: userId, actorMembershipId: userMembership.id, description: "After", occurredAt: new Date(Date.parse(key.occurredAt) - 1_000), acceptedAt: new Date(), payloadFingerprint: randomUUID().replaceAll("-", "") },
  ] });
  const continuation = await diary.read(identity, fieldId, { limit: 100, cursor });
  assert.equal(continuation.items.some(({ id }) => id === newerId), false);
  assert.equal(continuation.items.some(({ id }) => id === olderId), true);
  const refreshed = await diary.read(identity, fieldId, { limit: 100 });
  assert.equal(refreshed.items.some(({ id }) => id === newerId), true);
});

test("diary reads remain within the verified Business and Field scope", async () => {
  await assert.rejects(diary.read(identity, foreignFieldId), (error: unknown) => (error as { getStatus?: () => number }).getStatus?.() === 404);
  await assert.rejects(diary.read(foreignIdentity, fieldId), (error: unknown) => (error as { getStatus?: () => number }).getStatus?.() === 404);
});

test("irrigation history is opt-in and returned as its distinct canonical record event", async () => {
  assert.equal(await prisma.irrigationRecord.count({ where: { businessId, id: irrigationRecordId } }), 1);
  const defaultPage = await diary.read(identity, fieldId);
  assert.equal(defaultPage.items.some(({ id }) => id === irrigationRecordId), false);
  const filters = { includeIrrigation: true, limit: 100 };
  const firstPage = await diary.read(identity, fieldId, filters);
  assert.ok(firstPage.nextCursor);
  const includedPage = await diary.read(identity, fieldId, { ...filters, cursor: firstPage.nextCursor! });
  const item = includedPage.items.find(({ id }) => id === irrigationRecordId);
  assert.ok(item);
  assert.equal(item.kind, "IRRIGATION");
  if (item.kind !== "IRRIGATION") return;
  assert.equal(item.fieldId, fieldId);
  assert.equal(item.seasonId, null);
  assert.equal(item.occurredAt, tieAt);
  assert.equal(item.businessTimezone, "Asia/Tokyo");
  assert.equal("description" in item, false);
});

test("Season-filtered irrigation diary projection includes only irrigation records from that Season", async () => {
  const fieldIrrigationIds: string[] = [];
  let fieldPage = await diary.read(identity, fieldId, { includeIrrigation: true, limit: 100 });
  while (true) {
    fieldIrrigationIds.push(...fieldPage.items.filter((item) => item.kind === "IRRIGATION").map(({ id }) => id));
    if (!fieldPage.nextCursor) break;
    fieldPage = await diary.read(identity, fieldId, { includeIrrigation: true, limit: 100, cursor: fieldPage.nextCursor });
  }
  assert.deepEqual(new Set(fieldIrrigationIds), new Set([irrigationRecordId, matchingSeasonIrrigationId, otherSeasonIrrigationId]));

  const seasonIrrigationIds: string[] = [];
  let seasonPage = await diary.read(identity, fieldId, { includeIrrigation: true, seasonId, limit: 100 });
  while (true) {
    seasonIrrigationIds.push(...seasonPage.items.filter((item) => item.kind === "IRRIGATION").map(({ id }) => id));
    if (!seasonPage.nextCursor) break;
    seasonPage = await diary.read(identity, fieldId, { includeIrrigation: true, seasonId, limit: 100, cursor: seasonPage.nextCursor });
  }
  assert.deepEqual(seasonIrrigationIds, [matchingSeasonIrrigationId]);
});

test("Field Diary HTTP query forwards the includeIrrigation opt-in", async () => {
  const app = await createObservationApp({
    verify: async (token) => token === "diary-token" ? identity : null,
    create: (who, requestedFieldId, request) => observationCreates.create(who, requestedFieldId, request),
    readDiary: (who, requestedFieldId, filters) => diary.read(who, requestedFieldId, filters),
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  try {
    const response = await app.inject({ method: "GET", url: `/v1/fields/${fieldId}/diary?includeIrrigation=true&limit=100`,
      headers: { authorization: "Bearer diary-token" } });
    assert.equal(response.statusCode, 200);
    const first = response.json() as { items: Array<{ id: string }>; nextCursor: string | null };
    assert.ok(first.nextCursor);
    const next = await app.inject({ method: "GET", url: `/v1/fields/${fieldId}/diary?includeIrrigation=true&limit=100&cursor=${encodeURIComponent(first.nextCursor)}`,
      headers: { authorization: "Bearer diary-token" } });
    assert.equal(next.statusCode, 200);
    assert.ok((next.json() as { items: Array<{ id: string }> }).items.some(({ id }) => id === irrigationRecordId));
  } finally { await app.close(); }
});

test("default Field Diary keeps V1 cursors and excludes accepted expenses", async () => {
  const first = await diary.read(identity, fieldId, { limit: 1 });
  assert.ok(first.nextCursor);
  assert.equal(JSON.parse(Buffer.from(first.nextCursor, "base64url").toString("utf8")).version, 1);
  const seen: string[] = [];
  let page = first;
  while (true) {
    seen.push(...page.items.map(({ id }) => id));
    if (!page.nextCursor) break;
    page = await diary.read(identity, fieldId, { limit: 100, cursor: page.nextCursor });
  }
  assert.equal(seen.includes(fieldExpenseId), false);
  assert.equal(seen.includes(seasonExpenseId), false);
});

test("OWNER expense-enabled Field Diary projects accepted date-only expenses once across pages", async () => {
  const seen: Array<Record<string, unknown>> = [];
  let page = await diary.read(identity, fieldId, { includeExpenses: true, limit: 1 });
  assert.equal(page.businessTimezone, "Asia/Tokyo");
  while (true) {
    seen.push(...page.items);
    if (!page.nextCursor) break;
    assert.equal(JSON.parse(Buffer.from(page.nextCursor, "base64url").toString("utf8")).version, 2);
    page = await diary.read(identity, fieldId, { includeExpenses: true, limit: 100, cursor: page.nextCursor });
  }
  assert.equal(new Set(seen.map(({ id }) => id)).size, seen.length);
  const expenses = seen.filter(({ kind }) => kind === "EXPENSE");
  assert.deepEqual(new Set(expenses.map(({ id }) => id)), new Set([fieldExpenseId, olderFieldExpenseId, seasonExpenseId, otherSeasonExpenseId]));
  const fieldOnly = expenses.find(({ id }) => id === fieldExpenseId);
  assert.deepEqual(fieldOnly, { kind: "EXPENSE", id: fieldExpenseId, fieldId, seasonId: null,
    expenseDate: "2026-10-05", amount: "12.30", currency: "TRY", category: "FERTILIZER", note: "Seedlings" });
  assert.equal("occurredAt" in fieldOnly!, false);
  assert.equal("recordedAt" in fieldOnly!, false);
});

test("expense-enabled Season Diary includes only explicitly linked expenses", async () => {
  const seen: Array<{ id: string; kind: string }> = [];
  let page = await diary.read(identity, fieldId, { seasonId, includeExpenses: true, limit: 1 });
  while (true) {
    seen.push(...page.items);
    if (!page.nextCursor) break;
    page = await diary.read(identity, fieldId, { seasonId, includeExpenses: true, limit: 1, cursor: page.nextCursor });
  }
  const expenses = seen.filter(({ kind }) => kind === "EXPENSE");
  assert.equal(new Set(seen.map(({ id }) => id)).size, seen.length);
  assert.deepEqual(expenses.map(({ id }) => id), [seasonExpenseId]);
  assert.equal(expenses.some(({ id }) => id === fieldExpenseId || id === olderFieldExpenseId || id === otherSeasonExpenseId), false);
});

test("active WORKER can read ordinary Diary but receives generic forbidden for expense opt-in", async () => {
  const ordinary = await diary.read(workerIdentity, fieldId);
  assert.ok(ordinary.items.length > 0);
  assert.equal(ordinary.items.some(({ kind }) => kind === "EXPENSE"), false);
  await assert.rejects(diary.read(workerIdentity, fieldId, { includeExpenses: true }),
    (error: unknown) => error instanceof ApiError && error.getStatus() === 403 && error.presentation.code === "FORBIDDEN");
});

test("Field Diary HTTP expense opt-in returns date-only entries to OWNER and generic 403 to WORKER", async () => {
  const app = await createObservationApp({
    verify: async (token) => token === "owner-diary-token" ? identity : token === "worker-diary-token" ? workerIdentity : null,
    create: (who, requestedFieldId, request) => observationCreates.create(who, requestedFieldId, request),
    readDiary: (who, requestedFieldId, filters) => diary.read(who, requestedFieldId, filters),
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  try {
    const url = `/v1/fields/${fieldId}/diary?includeExpenses=true&seasonId=${seasonId}`;
    const owner = await app.inject({ method: "GET", url,
      headers: { authorization: "Bearer owner-diary-token" } });
    assert.equal(owner.statusCode, 200);
    assert.deepEqual((owner.json() as { items: Array<{ id: string }> }).items.filter(({ id }) => id === seasonExpenseId).length, 1);
    const worker = await app.inject({ method: "GET", url,
      headers: { authorization: "Bearer worker-diary-token" } });
    assert.equal(worker.statusCode, 403);
    assert.equal((worker.json() as { error: { code: string } }).error.code, "FORBIDDEN");
    assert.equal(worker.body.includes(seasonExpenseId), false);
  } finally { await app.close(); }
});

test("expense-enabled cursor cannot continue in default Diary mode", async () => {
  const first = await diary.read(identity, fieldId, { includeExpenses: true, limit: 1 });
  assert.ok(first.nextCursor);
  await assert.rejects(diary.read(identity, fieldId, { cursor: first.nextCursor }),
    (error: unknown) => error instanceof ApiError && error.getStatus() === 400 && error.presentation.code === "INVALID_REQUEST");
});

test("Harvest is opt-in, tenant and Season scoped, and visible to every ordinary Diary role", async () => {
  type HarvestEntry = { kind: string; id: string; fieldId?: string; seasonId?: string | null;
    harvestDate?: string; quantity?: string; unit?: string; [key: string]: unknown };
  type HarvestPage = { items: HarvestEntry[]; nextCursor: string | null; viewerRole?: string };
  const readWithHarvests = async (who: typeof identity, filters: Record<string, unknown> = {}) =>
    await diary.read(who, fieldId, { ...filters, includeHarvests: true } as never) as unknown as HarvestPage;
  const readAllWithHarvests = async (who: typeof identity, filters: Record<string, unknown> = {}) => {
    let page = await readWithHarvests(who, { ...filters, limit: 100 });
    const items = [...page.items];
    while (page.nextCursor) {
      page = await readWithHarvests(who, { ...filters, limit: 100, cursor: page.nextCursor });
      items.push(...page.items);
    }
    return { ...page, items };
  };

  const expected = new Map([[harvestId, "OWNER"], [secondHarvestId, "OWNER"], [otherSeasonHarvestId, "OWNER"]]);
  const defaultOwner = await diary.read(identity, fieldId) as unknown as HarvestPage;
  assert.equal(JSON.parse(Buffer.from(defaultOwner.nextCursor!, "base64url").toString("utf8")).version, 1);
  assert.equal(defaultOwner.items.some(({ id }) => expected.has(id)), false, "the default projection remains Harvest-free");
  assert.equal(defaultOwner.viewerRole, "OWNER");
  assert.equal(defaultOwner.items.some((item) => "viewerRole" in item), false, "viewerRole is response metadata, not an item field");

  for (const [who, role] of [[identity, "OWNER"], [workerIdentity, "WORKER"], [advisorIdentity, "ADVISOR"]] as const) {
    const ordinary = await diary.read(who, fieldId) as unknown as HarvestPage;
    assert.equal(ordinary.viewerRole, role);
    assert.equal(ordinary.items.some(({ id }) => expected.has(id)), false);
    assert.equal(ordinary.items.some(({ kind }) => kind === "EXPENSE"), false);

    const included = await readAllWithHarvests(who);
    assert.equal(included.viewerRole, role);
    assert.equal(included.items.filter(({ id }) => expected.has(id)).length, 3,
      `${role} sees each same-Field Harvest once`);
    assert.equal(included.items.some(({ id }) => id === foreignHarvestId), false, "another Business Harvest is isolated");
    assert.equal(included.items.some(({ kind }) => kind === "EXPENSE"), false, "Harvest opt-in does not enable Expense history");
  }

  const fieldPage = await readAllWithHarvests(identity);
  const first = fieldPage.items.find(({ id }) => id === harvestId)!;
  assert.deepEqual({ kind: first.kind, id: first.id, fieldId: first.fieldId, seasonId: first.seasonId,
    harvestDate: first.harvestDate, quantity: first.quantity, unit: first.unit },
  { kind: "HARVEST", id: harvestId, fieldId, seasonId, harvestDate: "2026-10-05", quantity: "12.375", unit: "METRIC_TONNE" });
  assert.equal("recordedAt" in first, false);
  assert.equal("occurredAt" in first, false);

  const seasonPage = await readAllWithHarvests(identity, { seasonId });
  assert.deepEqual(new Set(seasonPage.items.filter(({ kind }) => kind === "HARVEST").map(({ id }) => id)), new Set([harvestId, secondHarvestId]));
  assert.equal(seasonPage.items.some(({ id }) => id === otherSeasonHarvestId), false);
  await assert.rejects(readWithHarvests(foreignIdentity),
    (error: unknown) => (error as { getStatus?: () => number }).getStatus?.() === 404);

  const paged = await readWithHarvests(identity, { includeExpenses: true, limit: 1 });
  assert.ok(paged.nextCursor);
  const cursor = JSON.parse(Buffer.from(paged.nextCursor!, "base64url").toString("utf8"));
  assert.equal(cursor.version, 2);
  assert.equal(cursor.includeExpenses, true);
  assert.equal(cursor.includeHarvests, true);
  assert.equal(cursor.viewerRole, undefined);

  const mixedDateOnly = await readAllWithHarvests(identity, { includeExpenses: true });
  const dateOnly = mixedDateOnly.items.filter((item) => item.kind === "EXPENSE" || item.kind === "HARVEST");
  const sameDay = dateOnly.filter((item) => item.kind === "EXPENSE"
    ? item.expenseDate === "2026-10-05" : item.harvestDate === "2026-10-05");
  const firstHarvestPosition = sameDay.findIndex(({ kind }) => kind === "HARVEST");
  assert.ok(firstHarvestPosition > 0);
  assert.ok(sameDay.slice(0, firstHarvestPosition).every(({ kind }) => kind === "EXPENSE"),
    "same-day date-only entries order by kind before source UUID");
});

test("Harvest source candidate queries are database-bounded", async () => {
  queryEvents.length = 0;
  await diary.read(identity, fieldId, { includeHarvests: true, limit: 3 } as never);
  const harvestQuery = queryEvents.find((query) => /FROM[\s\S]*\bharvests\b/i.test(query));
  assert.ok(harvestQuery, "the Diary reader queries the canonical Harvest table");
  assert.match(harvestQuery!, /\bLIMIT\b/i, "the Harvest candidate query applies a database-side bound");
});

test("mixed Expense and Harvest pages continue after the full DATE_ONLY kind and UUID tuple", async () => {
  const seen: Array<{ id: string; kind: string; date: string }> = [];
  let page = await diary.read(identity, fieldId, { includeExpenses: true, includeHarvests: true, limit: 1 });
  while (true) {
    seen.push(...page.items.flatMap((item) => item.kind === "EXPENSE"
      ? [{ id: item.id, kind: item.kind, date: item.expenseDate }]
      : item.kind === "HARVEST" ? [{ id: item.id, kind: item.kind, date: item.harvestDate }] : []));
    if (!page.nextCursor) break;
    page = await diary.read(identity, fieldId, { includeExpenses: true, includeHarvests: true, limit: 1, cursor: page.nextCursor });
  }
  assert.equal(new Set(seen.map(({ id }) => id)).size, seen.length, "continuation never repeats a date-only identity");
  const sameDay = seen.filter(({ date }) => date === "2026-10-05");
  assert.deepEqual(sameDay.map(({ kind }) => kind), ["EXPENSE", "EXPENSE", "EXPENSE", "HARVEST", "HARVEST", "HARVEST"]);
  assert.equal(seen.filter(({ id }) => id === olderFieldExpenseId).length, 1,
    "consumed same-day Expenses do not starve older date-only source rows after Harvests");
  assert.equal(seen.filter(({ id }) => id === seasonExpenseId).length, 1,
    "an Expense with a UUID below Harvest IDs is not returned again after a Harvest cursor");
  const afterHarvest = { version: 2, fieldId, seasonId: null, includeIrrigation: false, includeExpenses: true,
    includeHarvests: true, businessTimezone: "Asia/Tokyo", localDate: "2026-10-05", precision: "DATE_ONLY",
    kind: "HARVEST", id: secondHarvestId } as const;
  const expenseCandidates = await expenseDiary.readDiaryCandidates(identity, fieldId, undefined, afterHarvest, 2);
  assert.deepEqual(expenseCandidates.map(({ id }) => id), [olderFieldExpenseId],
    "source keyset query removes consumed same-date Expenses before applying its candidate bound");
});

test("Harvest keyset continuation remains strict when date-only records are inserted during traversal", async () => {
  const first = await diary.read(identity, fieldId, { limit: 1, includeHarvests: true } as never);
  assert.ok(first.nextCursor);
  const cursor = JSON.parse(Buffer.from(first.nextCursor!, "base64url").toString("utf8"));
  assert.equal(cursor.version, 2);
  const membership = await prisma.membership.findUniqueOrThrow({ where: { businessId_userId: { businessId, userId } }, select: { id: true } });
  const earlierId = randomUUID(), laterId = randomUUID();
  await prisma.harvest.createMany({ data: [
    { id: earlierId, businessId, fieldId, seasonId, actorUserId: userId, actorMembershipId: membership.id,
      harvestDate: new Date("2026-10-06T00:00:00.000Z"), quantity: "1", unit: "KG", recordedAt: new Date() },
    { id: laterId, businessId, fieldId, seasonId, actorUserId: userId, actorMembershipId: membership.id,
      harvestDate: new Date("2026-10-02T00:00:00.000Z"), quantity: "2", unit: "KG", recordedAt: new Date() },
  ] });
  let continuation = await diary.read(identity, fieldId, { limit: 100, cursor: first.nextCursor!, includeHarvests: true } as never) as unknown as {
    items: Array<{ id: string; kind: string }>; nextCursor: string | null;
  };
  const continuationIds = continuation.items.map(({ id }) => id);
  assert.equal(continuation.items.length <= 100, true, "each returned page stays within its requested bound");
  while (continuation.nextCursor) {
    continuation = await diary.read(identity, fieldId, { limit: 100, cursor: continuation.nextCursor, includeHarvests: true } as never) as unknown as {
      items: Array<{ id: string; kind: string }>; nextCursor: string | null;
    };
    assert.equal(continuation.items.length <= 100, true, "each returned page stays within its requested bound");
    continuationIds.push(...continuation.items.map(({ id }) => id));
  }
  assert.equal(continuationIds.includes(earlierId), false, "an insertion before the consumed tuple waits for refresh");
  assert.equal(continuationIds.includes(laterId), true, "an insertion after the consumed tuple may appear later");
});

test("Field Diary HTTP response derives viewerRole from current authorized Membership and keeps it outside items", async () => {
  const app = await createObservationApp({
    verify: async (token) => token === "owner-harvest-diary" ? identity
      : token === "worker-harvest-diary" ? workerIdentity : token === "advisor-harvest-diary" ? advisorIdentity : null,
    create: (who, requestedFieldId, request) => observationCreates.create(who, requestedFieldId, request),
    readDiary: (who, requestedFieldId, filters) => diary.read(who, requestedFieldId, filters),
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  try {
    for (const [token, role] of [["owner-harvest-diary", "OWNER"], ["worker-harvest-diary", "WORKER"], ["advisor-harvest-diary", "ADVISOR"]] as const) {
      let response = await app.inject({ method: "GET", url: `/v1/fields/${fieldId}/diary?includeHarvests=true&limit=100`,
        headers: { authorization: `Bearer ${token}` } });
      assert.equal(response.statusCode, 200);
      let body = response.json() as { items: Array<Record<string, unknown>>; viewerRole?: string; nextCursor: string | null };
      const items = [...body.items];
      while (body.nextCursor) {
        response = await app.inject({ method: "GET", url: `/v1/fields/${fieldId}/diary?includeHarvests=true&limit=100&cursor=${encodeURIComponent(body.nextCursor)}`,
          headers: { authorization: `Bearer ${token}` } });
        assert.equal(response.statusCode, 200);
        body = response.json() as typeof body;
        assert.equal(body.viewerRole, role);
        items.push(...body.items);
      }
      assert.equal(body.viewerRole, role);
      assert.equal(items.some((item) => "viewerRole" in item), false);
      const harvestIds = items.filter(({ kind }) => kind === "HARVEST").map(({ id }) => id);
      for (const expectedId of [harvestId, secondHarvestId, otherSeasonHarvestId]) {
        assert.equal(harvestIds.filter((id) => id === expectedId).length, 1, `${role} sees canonical Harvest ${expectedId} exactly once`);
      }
      assert.equal(harvestIds.includes(foreignHarvestId), false, "the current Business Diary excludes foreign Harvests");
    }
  } finally { await app.close(); }
});

test("quickstart journey creates, reads back, exactly replays, and paginates with an accepted completion", async () => {
  const request = { observationId: randomUUID(), description: "  North row needs water  ", seasonId,
    occurredAtLocal: "2026-10-04T18:30", occurredAt: tieAt };
  const created = await observationCreates.create(identity, fieldId, request);
  assert.equal(created.kind, "accepted");
  const seen: string[] = [];
  let page = await diary.read(identity, fieldId, { seasonId, limit: 1 });
  while (true) {
    seen.push(...page.items.map(({ id }) => id));
    if (!page.nextCursor) break;
    page = await diary.read(identity, fieldId, { seasonId, limit: 1, cursor: page.nextCursor });
  }
  assert.ok(seen.includes(created.observation.id));
  assert.ok(seen.includes(completionId));
  assert.equal(new Set(seen).size, seen.length);
  const observationPosition = seen.indexOf(created.observation.id);
  const completionPosition = seen.indexOf(completionId);
  assert.ok(observationPosition < completionPosition, "observation ties precede existing accepted completion ties");
  const replay = await observationCreates.create(identity, fieldId, { ...request, description: "North row needs water" });
  assert.equal(replay.kind, "replayed");
  assert.deepEqual(replay.observation, created.observation);
});
