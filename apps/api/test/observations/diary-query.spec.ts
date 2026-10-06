import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "../../src/observability/api-error.filter.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";
import { ObservationDiaryRepository } from "../../src/observations/observation-diary.repository.js";
import type { TaskCompletionRepository } from "../../src/tasks/task-completion.repository.js";

const fieldId = "11111111-1111-4111-8111-111111111111";
const seasonId = "22222222-2222-4222-8222-222222222222";
const obs = (id: string, occurredAt: string, description = id) => ({ kind: "OBSERVATION" as const, id, fieldId, seasonId: null, description, occurredAt });
const completion = (id: string, occurredAt: string) => ({ kind: "TASK_COMPLETION" as const, id, taskId: id, seasonId, fieldId, title: "Cultivate", plannedLocalDate: "2026-10-04", occurredAt, sourceKind: "MANUAL" as const, templateVersionId: null });
const queryModule = () => import("../../src/observations/diary-query.js");
const base64urlAlphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";

function noncanonicalTrailingBits(value: string): string {
  const finalIndex = base64urlAlphabet.indexOf(value.at(-1) ?? "");
  const unusedBits = value.length % 4 === 2 ? 4 : value.length % 4 === 3 ? 2 : 0;
  assert.ok(unusedBits > 0, "encoder output has a partial final base64url group");
  const unusedMask = (1 << unusedBits) - 1;
  const noncanonicalIndex = (finalIndex & ~unusedMask) | ((finalIndex & unusedMask) + 1);
  return `${value.slice(0, -1)}${base64urlAlphabet[noncanonicalIndex]}`;
}

function isInvalidCursor(error: unknown): boolean {
  return error instanceof ApiError && error.getStatus() === 400 && error.presentation.code === "INVALID_REQUEST";
}

async function canonicalCursor(): Promise<string> {
  const { encodeDiaryCursor } = await queryModule();
  return encodeDiaryCursor({ version: 1, fieldId, seasonId: null,
    occurredAt: "2026-10-05T09:00:00Z", kind: "OBSERVATION", id: "22222222-2222-4222-8222-222222222222" });
}

test("diary ordering is deterministic with observations first on tied occurrence instants", async () => {
  const { sortDiaryEntries } = await queryModule();
  const items = sortDiaryEntries([
    completion("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "2026-10-04T09:00:00.000Z"),
    obs("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "2026-10-04T09:00:00.000Z"),
    obs("cccccccc-cccc-4ccc-8ccc-cccccccccccc", "2026-10-05T09:00:00.000Z"),
    obs("dddddddd-dddd-4ddd-8ddd-dddddddddddd", "2026-10-04T09:00:00.000Z"),
  ]);
  assert.deepEqual(items.map(({ id }) => id), ["cccccccc-cccc-4ccc-8ccc-cccccccccccc", "dddddddd-dddd-4ddd-8ddd-dddddddddddd", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"]);
});

test("bounded page defaults to 50, caps at 100, and continues strictly after the global tuple", async () => {
  const { diaryLimit, pageDiaryCandidates, encodeDiaryCursor, decodeDiaryCursor } = await queryModule();
  assert.equal(diaryLimit(undefined), 50);
  assert.equal(diaryLimit(100), 100);
  assert.throws(() => diaryLimit(101), (error: unknown) => error instanceof ApiError && error.presentation.code === "INVALID_REQUEST");
  const items = [obs("ffffffff-ffff-4fff-8fff-ffffffffffff", "2026-10-05T09:00:00.000Z"),
    completion("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", "2026-10-05T09:00:00.000Z"),
    obs("dddddddd-dddd-4ddd-8ddd-dddddddddddd", "2026-10-04T09:00:00.000Z")];
  const page = pageDiaryCandidates(items, 2, fieldId, null);
  assert.deepEqual(page.items.map(({ id }) => id), [items[0]!.id, items[1]!.id]);
  assert.ok(page.nextCursor);
  const cursor = decodeDiaryCursor(page.nextCursor, fieldId, null);
  assert.ok(cursor);
  assert.equal((JSON.parse(Buffer.from(page.nextCursor!, "base64url").toString("utf8")) as { version?: number }).version, 1);
  assert.equal((cursor as unknown as { version?: number }).version, 1);
  assert.deepEqual(cursor, { version: 1, fieldId, seasonId: null, occurredAt: items[1]!.occurredAt, kind: items[1]!.kind, id: items[1]!.id });
  assert.deepEqual(pageDiaryCandidates(items, 2, fieldId, null, cursor).items.map(({ id }) => id), [items[2]!.id]);
  const encoded = encodeDiaryCursor({ version: 1, fieldId, seasonId, occurredAt: items[0]!.occurredAt, kind: items[0]!.kind, id: items[0]!.id });
  assert.throws(() => decodeDiaryCursor(encoded, fieldId, null), (error: unknown) => error instanceof ApiError && error.getStatus() === 400);
  assert.throws(() => decodeDiaryCursor("broken", fieldId, null), (error: unknown) => error instanceof ApiError && error.getStatus() === 400);
  const unsupported = Buffer.from(JSON.stringify({ version: 99, fieldId, seasonId: null, occurredAt: items[0]!.occurredAt, kind: "OBSERVATION", id: items[0]!.id }), "utf8").toString("base64url");
  assert.throws(() => decodeDiaryCursor(unsupported, fieldId, null), (error: unknown) => error instanceof ApiError && error.getStatus() === 400 && error.presentation.code === "INVALID_REQUEST");
  const missingVersion = Buffer.from(JSON.stringify({ fieldId, seasonId: null, occurredAt: items[0]!.occurredAt, kind: "OBSERVATION", id: items[0]!.id }), "utf8").toString("base64url");
  assert.throws(() => decodeDiaryCursor(missingVersion, fieldId, null), (error: unknown) => error instanceof ApiError && error.getStatus() === 400 && error.presentation.code === "INVALID_REQUEST");
  assert.throws(() => decodeDiaryCursor(encoded, "33333333-3333-4333-8333-333333333333", seasonId), (error: unknown) => error instanceof ApiError && error.getStatus() === 400);
});

test("cursor decoder round-trips the application's canonical unpadded base64url output", async () => {
  const { encodeDiaryCursor, decodeDiaryCursor } = await queryModule();
  const canonical = encodeDiaryCursor({ version: 1, fieldId, seasonId: null,
    occurredAt: "2026-10-05T09:00:00Z", kind: "OBSERVATION", id: "22222222-2222-4222-8222-222222222222" });
  assert.deepEqual(decodeDiaryCursor(canonical, fieldId, null), {
    version: 1, fieldId, seasonId: null, occurredAt: "2026-10-05T09:00:00Z",
    kind: "OBSERVATION", id: "22222222-2222-4222-8222-222222222222",
  });
});

test("cursor decoder continues to reject empty input", async () => {
  const { decodeDiaryCursor } = await queryModule();
  assert.throws(() => decodeDiaryCursor("", fieldId, null), isInvalidCursor);
});

const malformedCursorVariants: ReadonlyArray<readonly [string, (canonical: string) => string]> = [
  ["invalid trailing characters", (canonical) => `${canonical}!!!!`],
  ["padding", (canonical) => `${canonical}=`],
  ["leading whitespace", (canonical) => ` ${canonical}`],
  ["trailing whitespace", (canonical) => `${canonical}\n`],
  ["nonzero unused trailing bits", noncanonicalTrailingBits],
];

for (const [label, makeMalformed] of malformedCursorVariants) {
  test(`cursor decoder rejects ${label}`, async () => {
    const { decodeDiaryCursor } = await queryModule();
    const canonical = await canonicalCursor();
    const malformed = makeMalformed(canonical);
    assert.equal(Buffer.from(malformed, "base64url").toString("utf8"), Buffer.from(canonical, "base64url").toString("utf8"));
    assert.throws(() => decodeDiaryCursor(malformed, fieldId, null), isInvalidCursor);
  });
}

test("malformed cursor reaches the diary service as structured INVALID_REQUEST", async () => {
  const canonical = await canonicalCursor();
  const repository = new ObservationDiaryRepository({ $transaction: () => { throw new Error("malformed cursor reached authorization lookup"); } } as unknown as PrismaClient, {} as TaskCompletionRepository);
  await assert.rejects(repository.read({ provider: "test", subject: "test" }, fieldId, { cursor: `${canonical}!!!!` }), isInvalidCursor);
});

test("strict-after traversal excludes records before its consumed cursor and permits records after it", async () => {
  const { pageDiaryCandidates } = await queryModule();
  const beforeCursor = obs("ffffffff-ffff-4fff-8fff-ffffffffffff", "2026-10-06T09:00:00.000Z");
  const consumed = obs("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", "2026-10-05T09:00:00.000Z");
  const afterCursor = obs("dddddddd-dddd-4ddd-8ddd-dddddddddddd", "2026-10-04T09:00:00.000Z");
  const first = pageDiaryCandidates([beforeCursor, consumed], 1, fieldId, null);
  const cursor = (await queryModule()).decodeDiaryCursor(first.nextCursor!, fieldId, null)!;
  const next = pageDiaryCandidates([beforeCursor, afterCursor], 10, fieldId, null, cursor);
  assert.deepEqual(next.items.map(({ id }) => id), [afterCursor.id]);
});
