import assert from "node:assert/strict";
import test from "node:test";
import { CalendarPagesService } from "../../src/calendar/calendar-pages.service.js";

const identity = { provider: "supabase", subject: "page-subject" };
const scope = {
  userId: "11111111-1111-4111-8111-111111111111",
  membershipId: "22222222-2222-4222-8222-222222222222",
  businessId: "33333333-3333-4333-8333-333333333333",
  role: "OWNER",
};
const readId = "44444444-4444-4444-8444-444444444444";

function harness(options: { authorized?: boolean; cursorExists?: boolean; taskRows?: unknown[]; expired?: boolean; wrongScope?: boolean } = {}) {
  const calls: string[] = [];
  const parent = {
    readId,
    userId: scope.userId,
    membershipId: scope.membershipId,
    businessId: options.wrongScope ? "99999999-9999-4999-8999-999999999999" : scope.businessId,
    fieldId: null,
    fieldScopeKind: "ALL_AUTHORIZED",
    selectedDate: new Date("2026-10-06T00:00:00.000Z"),
    businessTimezone: "Europe/Istanbul",
    businessLocalToday: new Date("2026-10-06T00:00:00.000Z"),
    monthStart: new Date("2026-10-01T00:00:00.000Z"),
    monthEnd: new Date("2026-10-31T00:00:00.000Z"),
    asOf: new Date("2026-10-06T07:00:00.000Z"),
    expiresAt: new Date(options.expired ? "2026-10-06T06:59:00.000Z" : "2026-10-06T07:15:00.000Z"),
    state: "READY",
  };
  const tx = {
    async $queryRaw() { calls.push("snapshot"); return [{ asOf: new Date("2026-10-06T07:00:00.000Z") }]; },
    calendarReadSnapshot: { async findUnique() { calls.push("parent"); return parent; } },
    field: { async findFirst() { calls.push("field"); return { id: "field" }; } },
    calendarReadCursor: {
      async findFirst() { calls.push("cursor"); return options.cursorExists === false ? null : {
        lastPlannedLocalDate: new Date("2026-10-05T00:00:00.000Z"),
        lastTaskId: "55555555-5555-4555-8555-555555555555",
      }; },
      async upsert(args: unknown) { calls.push(`issue:${JSON.stringify(args)}`); return { token: "next-recorded-cursor" }; },
    },
    calendarReadSnapshotTask: {
      async findMany() { calls.push("projections"); return options.taskRows ?? []; },
    },
  };
  const prisma = {
    async $transaction<T>(operation: (client: typeof tx) => Promise<T>) { return operation(tx); },
  };
  const membershipScope = {
    async resolveDefaultBusinessScope() {
      calls.push("authorize");
      if (options.authorized === false) throw new Error("access denied");
      return scope;
    },
  };
  const service = new CalendarPagesService(prisma as never, membershipScope as never, { now: () => new Date("2026-10-06T07:05:00.000Z") });
  return { service, calls };
}

test("unauthorized continuation is rejected before projection rows are read", async () => {
  const { service, calls } = harness({ authorized: false });
  await assert.rejects(service.read(identity, { readId, group: "overdueTasks", cursor: "issued" }));
  assert.equal(calls.includes("projections"), false);
});

test("unissued or mismatched cursor returns no projection rows", async () => {
  const { service, calls } = harness({ cursorExists: false });
  await assert.rejects(service.read(identity, { readId, group: "selectedDateTasks", cursor: "not-issued" }));
  assert.equal(calls.includes("projections"), false);
});

test("expired or cross-scope reads return no projection rows", async () => {
  const expired = harness({ expired: true });
  await assert.rejects(expired.service.read(identity, { readId, group: "overdueTasks", cursor: "issued" }));
  assert.equal(expired.calls.includes("projections"), false);

  const crossScope = harness({ wrongScope: true });
  await assert.rejects(crossScope.service.read(identity, { readId, group: "overdueTasks", cursor: "issued" }));
  assert.equal(crossScope.calls.includes("projections"), false);
});

test("continuation pages read immutable projection rows and issue a replay-stable next token", async () => {
  const rows = Array.from({ length: 51 }, (_, index) => ({
    id: `row-${index}`,
    taskId: `${String(index).padStart(8, "0")}-1111-4111-8111-111111111111`,
    title: `Task ${index}`,
    plannedLocalDate: new Date("2026-10-05T00:00:00.000Z"),
    taskVersion: 1,
    fieldId: "66666666-6666-4666-8666-666666666666",
    fieldName: "Field",
    seasonId: "77777777-7777-4777-8777-777777777777",
    seasonContext: {},
    planContext: {},
    overdue: true,
  }));
  const { service, calls } = harness({ taskRows: rows });
  const page = await service.read(identity, { readId, group: "overdueTasks", cursor: "issued" });
  assert.equal(page.items.length, 50);
  assert.equal(page.complete, false);
  assert.equal(page.requestedCursor, "issued");
  assert.equal(page.nextCursor, "next-recorded-cursor");
  assert.ok(calls.includes("projections"));
  assert.ok(calls.some((call) => call.startsWith("issue:")));
});
