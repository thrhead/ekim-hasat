import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "../../src/generated/prisma/client.js";
import { CalendarReadRepository, partitionCalendarProjectionRows } from "../../src/calendar/calendar-read.repository.js";

const identity = { provider: "supabase", subject: "verified-subject" };
const authorizedScope = {
  userId: "11111111-1111-4111-8111-111111111111",
  membershipId: "22222222-2222-4222-8222-222222222222",
  businessId: "33333333-3333-4333-8333-333333333333",
  role: "OWNER",
};

function harness(options: { fieldExists?: boolean } = {}) {
  const calls: Array<{ method: string; args: unknown }> = [];
  const scopeService = {
    async resolveDefaultBusinessScope(value: unknown) {
      calls.push({ method: "resolveScope", args: value });
      return authorizedScope;
    },
  };
  const prisma = {
    field: {
      async findFirst(args: unknown) {
        calls.push({ method: "findField", args });
        return options.fieldExists === false ? null : { id: "44444444-4444-4444-8444-444444444444" };
      },
    },
    plannedTask: {
      async findMany(args: unknown) {
        calls.push({ method: "findTasks", args });
        return [];
      },
    },
  } as unknown as PrismaClient;
  const repository = new CalendarReadRepository(prisma, scopeService as never);
  return { repository, calls };
}

test("Calendar task reads derive Business scope from the verified identity", async () => {
  const { repository, calls } = harness();
  await repository.readEligibleTasks(identity);
  assert.deepEqual(calls[0], { method: "resolveScope", args: identity });
  const taskQuery = calls.find((call) => call.method === "findTasks")?.args as { where: unknown };
  assert.match(JSON.stringify(taskQuery.where), new RegExp(authorizedScope.businessId));
  assert.doesNotMatch(JSON.stringify(taskQuery.where), /clientBusinessId/);
});

test("optional Field narrowing is checked inside the authorized Business and applied to tasks", async () => {
  const fieldId = "44444444-4444-4444-8444-444444444444";
  const { repository, calls } = harness();
  await repository.readEligibleTasks(identity, { fieldId });
  const fieldQuery = calls.find((call) => call.method === "findField")?.args;
  assert.match(JSON.stringify(fieldQuery), new RegExp(authorizedScope.businessId));
  const taskQuery = calls.find((call) => call.method === "findTasks")?.args;
  assert.match(JSON.stringify(taskQuery), new RegExp(fieldId));
});

test("Calendar eligibility requires ACTIVE Season, APPROVED plan, and no accepted completion", async () => {
  const { repository, calls } = harness();
  await repository.readEligibleTasks(identity);
  const taskQuery = calls.find((call) => call.method === "findTasks")?.args;
  const serialized = JSON.stringify(taskQuery);
  assert.match(serialized, /ACTIVE/);
  assert.match(serialized, /APPROVED/);
  assert.match(serialized, /completion/);
  assert.match(serialized, /null/);
});

test("overdue and selected-date groups are disjoint and stable by original date then task ID", () => {
  const rows = [
    { taskId: "b", plannedLocalDate: "2026-10-06" },
    { taskId: "c", plannedLocalDate: "2026-10-05" },
    { taskId: "a", plannedLocalDate: "2026-10-06" },
    { taskId: "d", plannedLocalDate: "2026-10-04" },
  ];
  const result = partitionCalendarProjectionRows(rows, {
    selectedDate: "2026-10-06", businessLocalToday: "2026-10-06",
    monthStart: "2026-10-01", monthEnd: "2026-10-31",
  });
  assert.deepEqual(result.overdueTasks.map(({ taskId }) => taskId), ["d", "c"]);
  assert.deepEqual(result.selectedDateTasks.map(({ taskId }) => taskId), ["a", "b"]);
  assert.equal(new Set([...result.overdueTasks, ...result.selectedDateTasks]).size, rows.length);
});

test("a past selected date remains in overdue and is not duplicated into the selected-date group", () => {
  const rows = [{ taskId: "past", plannedLocalDate: "2026-10-05" }];
  const result = partitionCalendarProjectionRows(rows, {
    selectedDate: "2026-10-05", businessLocalToday: "2026-10-06",
    monthStart: "2026-10-01", monthEnd: "2026-10-31",
  });
  assert.deepEqual(result.overdueTasks, rows);
  assert.deepEqual(result.selectedDateTasks, []);
});

test("month presence follows original planned dates and fills every date in the selected month", () => {
  const rows = [
    { taskId: "overdue", plannedLocalDate: "2026-10-02" },
    { taskId: "outside", plannedLocalDate: "2026-11-01" },
  ];
  const result = partitionCalendarProjectionRows(rows, {
    selectedDate: "2026-10-06", businessLocalToday: "2026-10-06",
    monthStart: "2026-10-01", monthEnd: "2026-10-31",
  });
  assert.equal(result.monthIndicators.length, 31);
  assert.equal(result.monthIndicators.find(({ date }) => date === "2026-10-02")?.hasWork, true);
  assert.equal(result.monthIndicators.find(({ date }) => date === "2026-10-06")?.hasWork, false);
  assert.equal(result.monthIndicators.find(({ date }) => date === "2026-11-01"), undefined);
});
