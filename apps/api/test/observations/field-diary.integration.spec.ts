import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../src/generated/prisma/client.js";
import { ObservationDiaryRepository } from "../../src/observations/observation-diary.repository.js";
import { ObservationCreateRepository } from "../../src/observations/observation.repository.js";
import { decodeDiaryCursor } from "../../src/observations/diary-query.js";
import { TaskCompletionRepository } from "../../src/tasks/task-completion.repository.js";
import { SeasonActivationRepository } from "../../src/seasons/seasons-activation.repository.js";
import { assertDisposableDatabaseUrl } from "../support/disposable-database.js";

const databaseUrl = process.env.DATABASE_URL;
assertDisposableDatabaseUrl(databaseUrl);
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });
const run = randomUUID(), businessId = randomUUID(), foreignBusinessId = randomUUID(), userId = randomUUID(), foreignUserId = randomUUID(), fieldId = randomUUID(), foreignFieldId = randomUUID(), seasonId = randomUUID();
const cropId = randomUUID(), templateId = randomUUID(), taskId = randomUUID(), completionId = randomUUID();
const identity = { provider: "spec006-diary", subject: run };
const foreignIdentity = { provider: "spec006-diary", subject: `${run}-foreign` };
const taskCompletions = new TaskCompletionRepository(prisma);
const observationCreates = new ObservationCreateRepository(prisma, () => new Date("2026-10-05T10:00:00.000Z"));
const diary = new ObservationDiaryRepository(prisma, taskCompletions);
const tieAt = "2026-10-04T09:30:00.000Z";
const observationIds: string[] = [];

before(async () => {
  await prisma.$connect();
  const target = await prisma.$queryRaw<Array<{ database: string; postgis: boolean }>>`SELECT current_database() AS database, EXISTS(SELECT 1 FROM pg_extension WHERE extname='postgis') AS postgis`;
  assert.equal(target[0]?.database, "ekim_hasat_test");
  assert.equal(target[0]?.postgis, true);
  await prisma.business.createMany({ data: [{ id: businessId, timezone: "Asia/Tokyo" }, { id: foreignBusinessId, timezone: "Europe/Istanbul" }] });
  await prisma.applicationUser.create({ data: { id: userId, authProvider: identity.provider, authSubject: identity.subject, defaultBusinessId: businessId } });
  await prisma.applicationUser.create({ data: { id: foreignUserId, authProvider: foreignIdentity.provider, authSubject: foreignIdentity.subject, defaultBusinessId: foreignBusinessId } });
  await prisma.membership.create({ data: { businessId, userId, role: "OWNER", status: "ACTIVE" } });
  await prisma.membership.create({ data: { businessId: foreignBusinessId, userId: foreignUserId, role: "OWNER", status: "ACTIVE" } });
  await prisma.$executeRaw`INSERT INTO fields (id,business_id,name,representative_point) VALUES
    (${fieldId}::uuid,${businessId}::uuid,'Diary field',ST_SetSRID(ST_MakePoint(29,41),4326)),
    (${foreignFieldId}::uuid,${foreignBusinessId}::uuid,'Foreign diary',ST_SetSRID(ST_MakePoint(29,41),4326))`;
  await prisma.cropDefinitionVersion.create({ data: { id: cropId, cropKey: `diary-${run}`, version: "1", displayName: "Diary fixture" } });
  await prisma.validatedTemplateVersion.create({ data: { id: templateId, templateKey: `diary-${run}`, version: "1", cropDefinitionVersionId: cropId, taskDefinitions: [] } });
  await prisma.season.create({ data: { id: seasonId, businessId, fieldId, cropKey: `diary-${run}`, cropDefinitionVersionId: cropId,
    actualPlantingDate: new Date("2026-10-01T00:00:00.000Z"), status: "DRAFT", version: 1,
    plan: { create: { source: "VALIDATED_TEMPLATE", templateVersionId: templateId,
      sourceSnapshot: { source: "VALIDATED_TEMPLATE", templateProvenance: { templateVersionId: templateId } }, status: "DRAFT",
      tasks: { create: [{ id: taskId, title: "Check row", plannedLocalDate: new Date("2026-10-04T00:00:00.000Z"), sourceTemplateTaskKey: "check-row", version: 1 }] } } } } });
  await new SeasonActivationRepository(prisma).activate(identity, seasonId, 1, randomUUID());
  await taskCompletions.complete(identity, taskId, 1, { completionId, occurredAt: tieAt });

  for (let index = 0; index < 105; index++) observationIds.push(randomUUID());
  const observations = observationIds.map((id, index) => ({ id, businessId, fieldId,
    seasonId: index === 0 ? seasonId : null, actorUserId: userId,
    actorMembershipId: "", description: `Inspection ${index}`,
    occurredAt: new Date(Date.parse("2026-10-05T08:00:00.000Z") - index * 60_000),
    acceptedAt: new Date("2026-10-05T10:00:00.000Z"), payloadFingerprint: randomUUID().replaceAll("-", "") }));
  const membership = await prisma.membership.findUniqueOrThrow({ where: { businessId_userId: { businessId, userId } }, select: { id: true } });
  await prisma.fieldObservation.createMany({ data: observations.map((row) => ({ ...row, actorMembershipId: membership.id })) });
  // An observation and accepted completion share an occurrence instant to protect observation-first ties.
  const tieId = randomUUID(); observationIds.push(tieId);
  await prisma.fieldObservation.create({ data: { id: tieId, businessId, fieldId, seasonId,
    actorUserId: userId, actorMembershipId: membership.id, description: "At completion time", occurredAt: new Date(tieAt),
    acceptedAt: new Date("2026-10-05T10:00:00.000Z"), payloadFingerprint: randomUUID().replaceAll("-", "") } });
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
  assert.equal(second.items.length, 7);
  assert.equal(second.nextCursor, null);
  const ids = [...first.items, ...second.items].map(({ id }) => id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(ids.length, 107);
  assert.equal(ids.includes(completionId), true);
  const tieEntries = [...first.items, ...second.items].filter((entry) => entry.occurredAt === tieAt);
  assert.deepEqual(tieEntries.map(({ kind }) => kind), ["OBSERVATION", "TASK_COMPLETION"]);
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
