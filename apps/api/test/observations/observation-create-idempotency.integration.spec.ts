import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../src/generated/prisma/client.js";
import type { CreateObservationRequest } from "../../src/observations/observation.controller.js";
import { createObservationApp } from "../../src/observations/observation.controller.js";
import { ObservationCreateRepository } from "../../src/observations/observation.repository.js";
import { ObservationDiaryRepository } from "../../src/observations/observation-diary.repository.js";
import { TaskCompletionRepository } from "../../src/tasks/task-completion.repository.js";
import { ApiError } from "../../src/observability/api-error.filter.js";
import { assertDisposableDatabaseUrl } from "../support/disposable-database.js";

const databaseUrl = process.env.DATABASE_URL;
assertDisposableDatabaseUrl(databaseUrl);
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });
const run = randomUUID(), provider = "spec006-idempotency";
const business = randomUUID(), otherBusiness = randomUUID(), user = randomUUID(), otherUser = randomUUID(), otherBusinessUser = randomUUID();
const field = randomUUID(), otherField = randomUUID(), otherBusinessField = randomUUID();
const identity = { provider, subject: `${run}-farmer` }, otherIdentity = { provider, subject: `${run}-teammate` };
const otherBusinessIdentity = { provider, subject: `${run}-other-business-farmer` };
const repository = () => new ObservationCreateRepository(prisma, () => new Date("2026-10-05T10:00:00.000Z"));
const base = (observationId: string): CreateObservationRequest => ({ observationId, description: "Inspected north row", occurredAtLocal: "2026-10-04T12:30", occurredAt: "2026-10-04T09:30:00Z" });

before(async () => {
  await prisma.$connect();
  const target = await prisma.$queryRaw<Array<{ database: string; postgis: boolean }>>`SELECT current_database() AS database, EXISTS(SELECT 1 FROM pg_extension WHERE extname='postgis') AS postgis`;
  assert.equal(target[0]?.database, "ekim_hasat_test");
  assert.equal(target[0]?.postgis, true);
  await prisma.business.create({ data: { id: business, timezone: "Europe/Istanbul" } });
  await prisma.business.create({ data: { id: otherBusiness, timezone: "Europe/Istanbul" } });
  await prisma.applicationUser.createMany({ data: [
    { id: user, authProvider: provider, authSubject: identity.subject, defaultBusinessId: business },
    { id: otherUser, authProvider: provider, authSubject: otherIdentity.subject, defaultBusinessId: business },
    { id: otherBusinessUser, authProvider: provider, authSubject: otherBusinessIdentity.subject, defaultBusinessId: otherBusiness },
  ] });
  await prisma.membership.createMany({ data: [
    { businessId: business, userId: user, role: "OWNER", status: "ACTIVE" },
    { businessId: business, userId: otherUser, role: "MEMBER", status: "ACTIVE" },
    { businessId: otherBusiness, userId: otherBusinessUser, role: "OWNER", status: "ACTIVE" },
  ] });
  await prisma.$executeRaw`INSERT INTO fields (id,business_id,name,representative_point) VALUES
    (${field}::uuid,${business}::uuid,'Primary',ST_SetSRID(ST_MakePoint(29,41),4326)),
    (${otherField}::uuid,${business}::uuid,'Second',ST_SetSRID(ST_MakePoint(29,41),4326)),
    (${otherBusinessField}::uuid,${otherBusiness}::uuid,'Other business',ST_SetSRID(ST_MakePoint(29,41),4326))`;
});

after(async () => {
  try {
    await prisma.$executeRawUnsafe("ALTER TABLE field_observations DISABLE TRIGGER USER");
    try { await prisma.$executeRaw`DELETE FROM field_observations WHERE business_id IN (${business}::uuid,${otherBusiness}::uuid)`; }
    finally { await prisma.$executeRawUnsafe("ALTER TABLE field_observations ENABLE TRIGGER USER"); }
    await prisma.$executeRaw`DELETE FROM fields WHERE id IN (${field}::uuid,${otherField}::uuid,${otherBusinessField}::uuid)`;
    await prisma.membership.deleteMany({ where: { businessId: { in: [business, otherBusiness] }, userId: { in: [user, otherUser, otherBusinessUser] } } });
    await prisma.applicationUser.deleteMany({ where: { id: { in: [user, otherUser, otherBusinessUser] } } });
    await prisma.business.deleteMany({ where: { id: { in: [business, otherBusiness] } } });
  } finally { await prisma.$disconnect(); }
});

test("exact replay is 200-equivalent and changed canonical payload, actor, or authorized Field conflicts", async () => {
  const id = randomUUID(), payload = base(id);
  const first = await repository().create(identity, field, payload);
  const replay = await repository().create(identity, field, { ...payload, description: "  Inspected north row  " });
  assert.equal(first.kind, "accepted");
  assert.equal(replay.kind, "replayed");
  assert.deepEqual(replay.observation, first.observation);
  const conflicts: Array<() => Promise<unknown>> = [
    () => repository().create(identity, field, { ...payload, description: "Inspected south row" }),
    () => repository().create(otherIdentity, field, payload),
    () => repository().create(identity, otherField, payload),
  ];
  for (const attempt of conflicts) await assert.rejects(attempt, (error: unknown) => error instanceof ApiError
    && error.getStatus() === 409 && error.presentation.code === "IDEMPOTENCY_KEY_REUSED");
});

test("concurrent identical creates produce one inserted winner and one canonical replay", async () => {
  const id = randomUUID(), payload = base(id);
  const [left, right] = await Promise.all([
    repository().create(identity, field, payload),
    repository().create(identity, field, payload),
  ]);
  assert.deepEqual([left.kind, right.kind].sort(), ["accepted", "replayed"]);
  assert.deepEqual(left.observation, right.observation);
  assert.equal(await prisma.fieldObservation.count({ where: { id } }), 1);
});

test("the API returns 201 for creation, 200 for exact replay, and one 201/200 pair for a race", async () => {
  const diary = new ObservationDiaryRepository(prisma, new TaskCompletionRepository(prisma));
  const app = await createObservationApp({
    verify: async (token) => token === "business-a" ? identity : null,
    create: (who, fieldId, payload) => repository().create(who, fieldId, payload),
    readDiary: (who, fieldId, filters) => diary.read(who, fieldId, filters),
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  const post = (payload: CreateObservationRequest) => app.inject({ method: "POST", url: `/v1/fields/${field}/observations`,
    headers: { authorization: "Bearer business-a" }, payload });
  try {
    const id = randomUUID(), payload = base(id);
    const first = await post(payload);
    const replay = await post(payload);
    assert.equal(first.statusCode, 201);
    assert.equal(replay.statusCode, 200);
    const racingPayload = base(randomUUID());
    const raced = await Promise.all([post(racingPayload), post(racingPayload)]);
    assert.deepEqual(raced.map(({ statusCode }) => statusCode).sort(), [200, 201]);
    assert.equal(await prisma.fieldObservation.count({ where: { businessId: business, id: racingPayload.observationId } }), 1);
  } finally { await app.close(); }
});

test("the same observation UUID is independent across authorized Businesses", async () => {
  const id = randomUUID();
  const inBusinessB = await repository().create(otherBusinessIdentity, otherBusinessField, { ...base(id), description: "Business B private note" });
  const inBusinessA = await repository().create(identity, field, { ...base(id), description: "Business A note" });
  assert.equal(inBusinessB.kind, "accepted");
  assert.equal(inBusinessA.kind, "accepted");
  assert.equal(await prisma.fieldObservation.count({ where: { businessId: business, id } }), 1);
  assert.equal(await prisma.fieldObservation.count({ where: { businessId: otherBusiness, id } }), 1);
  assert.equal(await prisma.fieldObservation.count({ where: { id } }), 2);
  const diary = await new ObservationDiaryRepository(prisma, new TaskCompletionRepository(prisma)).read(identity, field);
  assert.deepEqual(diary.items.filter((item) => item.id === id).map((item) => item.description), ["Business A note"]);
  assert.equal(JSON.stringify(diary).includes("Business B private note"), false);
});
