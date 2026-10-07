import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { VerifiedSubject } from "@ekim-hasat/domain/identity/auth-provider";
import { createCalendarTestApp } from "./calendar-test-app.js";

const identity: VerifiedSubject = { provider: "supabase", subject: "calendar-http-subject" };
const createCalls: unknown[] = [];
const pageCalls: unknown[] = [];
let server: Awaited<ReturnType<typeof createCalendarTestApp>>;

function readResponse(selectedDate: string) {
  const readId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const businessId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const readScope = {
    businessId, asOf: "2026-10-06T07:00:00.000Z", businessTimezone: "Europe/Istanbul",
    businessLocalToday: "2026-10-06", selectedDate, monthStart: "2026-10-01", monthEnd: "2026-10-31",
    fieldScope: { mode: "allAuthorized", includedFieldIds: [] },
  };
  const firstPage = (group: "selectedDateTasks" | "overdueTasks") => ({ readId, readScope, group, items: [], complete: true });
  return {
    readId, asOf: readScope.asOf, expiresAt: "2026-10-06T07:15:00.000Z", businessId,
    businessTimezone: readScope.businessTimezone, businessLocalToday: readScope.businessLocalToday,
    selectedDate, monthStart: readScope.monthStart, monthEnd: readScope.monthEnd, fieldScope: readScope.fieldScope,
    activeSeasonExists: false, hasAnyUnfinishedWork: false, monthIndicators: [], monthIndicatorsComplete: true,
    selectedDateTasksPage: firstPage("selectedDateTasks"), overdueTasksPage: firstPage("overdueTasks"),
  };
}

before(async () => {
  server = await createCalendarTestApp({
    verify: async (token) => token === "valid-token" ? identity : null,
    membershipScope: {} as never,
    createRead: async (_identity, request) => {
      createCalls.push(request);
      return readResponse(request.selectedDate ?? "2026-10-06");
    },
    readPage: async (_identity, request) => {
      pageCalls.push(request);
      return { readId: request.readId, group: request.group, requestedCursor: request.cursor, items: [], complete: true };
    },
  });
});

after(async () => server?.close());

test("Calendar routes authenticate before request validation or data callbacks", async () => {
  const read = await fetch(`${server.baseUrl}/v1/calendar/reads`, {
    method: "POST", headers: { "content-type": "application/json" }, body: "{}",
  });
  assert.equal(read.status, 401);
  const page = await fetch(`${server.baseUrl}/v1/calendar/reads/11111111-1111-4111-8111-111111111111/pages?group=overdueTasks&cursor=x`);
  assert.equal(page.status, 401);
  assert.equal(createCalls.length, 0);
  assert.equal(pageCalls.length, 0);
});

test("Calendar read accepts omitted or explicit selectedDate and rejects client Business authority", async () => {
  const omitted = await fetch(`${server.baseUrl}/v1/calendar/reads`, {
    method: "POST", headers: { authorization: "Bearer valid-token", "content-type": "application/json" }, body: "{}",
  });
  assert.equal(omitted.status, 201);
  assert.equal((await omitted.json() as { selectedDate: string }).selectedDate, "2026-10-06");

  const explicit = await fetch(`${server.baseUrl}/v1/calendar/reads`, {
    method: "POST", headers: { authorization: "Bearer valid-token", "content-type": "application/json" },
    body: JSON.stringify({ selectedDate: "2026-10-05" }),
  });
  assert.equal(explicit.status, 201);
  assert.deepEqual(createCalls.slice(0, 2), [{}, { selectedDate: "2026-10-05" }]);

  const forged = await fetch(`${server.baseUrl}/v1/calendar/reads`, {
    method: "POST", headers: { authorization: "Bearer valid-token", "content-type": "application/json" },
    body: JSON.stringify({ businessId: "11111111-1111-4111-8111-111111111111" }),
  });
  assert.equal(forged.status, 400);
  assert.equal(createCalls.length, 2);
});

test("Calendar page route validates group and delegates the opaque read-bound cursor", async () => {
  const valid = await fetch(`${server.baseUrl}/v1/calendar/reads/11111111-1111-4111-8111-111111111111/pages?group=overdueTasks&cursor=issued-token`, {
    headers: { authorization: "Bearer valid-token" },
  });
  assert.equal(valid.status, 200);
  assert.deepEqual(pageCalls, [{ readId: "11111111-1111-4111-8111-111111111111", group: "overdueTasks", cursor: "issued-token" }]);

  const invalid = await fetch(`${server.baseUrl}/v1/calendar/reads/11111111-1111-4111-8111-111111111111/pages?group=other&cursor=issued-token`, {
    headers: { authorization: "Bearer valid-token" },
  });
  assert.equal(invalid.status, 400);
  assert.equal(pageCalls.length, 1);
});
