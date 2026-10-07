import assert from "node:assert/strict";
import test from "node:test";
import { CalendarCursorRepository } from "../../src/calendar/calendar-cursor.repository.js";

const readId = "11111111-1111-4111-8111-111111111111";
const lastKey = { plannedLocalDate: "2026-10-05", taskId: "22222222-2222-4222-8222-222222222222" };

test("cursor issuance records a random token bound to read, group, and stable last key; retry reuses it", async () => {
  let stored: { token: string; args: unknown } | undefined;
  let createCount = 0;
  const db = {
    calendarReadCursor: {
      async upsert(args: unknown) {
        if (!stored) {
          const token = (args as { create: { token: string } }).create.token;
          stored = { token, args };
          createCount += 1;
        }
        return { token: stored.token };
      },
    },
  };
  const repository = new CalendarCursorRepository(db as never);
  const first = await repository.issue(readId, "overdueTasks", lastKey);
  const retry = await repository.issue(readId, "overdueTasks", lastKey);
  assert.equal(first, retry);
  assert.equal(createCount, 1);
  assert.match(first, /^[A-Za-z0-9_-]{40,}$/);
  const serialized = JSON.stringify(stored?.args);
  assert.match(serialized, new RegExp(readId));
  assert.match(serialized, /overdueTasks/);
  assert.match(serialized, new RegExp(lastKey.taskId));
});

test("continuation resolves only an issued token for the requested read and group", async () => {
  const calls: unknown[] = [];
  const repository = new CalendarCursorRepository({
    calendarReadCursor: {
      async findFirst(args: unknown) {
        calls.push(args);
        return null;
      },
    },
  } as never);
  assert.equal(await repository.resolve(readId, "selectedDateTasks", "unissued-token"), null);
  assert.match(JSON.stringify(calls[0]), new RegExp(readId));
  assert.match(JSON.stringify(calls[0]), /selectedDateTasks/);
  assert.match(JSON.stringify(calls[0]), /unissued-token/);
});
