import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const contractPath = fileURLToPath(new URL("../../../../specs/007-calendar/contracts/calendar.openapi.yaml", import.meta.url));

test("Calendar read contract permits server date resolution and requires a coherent dated response", async () => {
  const contract = (await readFile(contractPath, "utf8")).replace(/\r\n/g, "\n");
  const create = /  \/v1\/calendar\/reads:\n    post:[\s\S]*?(?=\n  \/|\ncomponents:)/.exec(contract)?.[0];
  const read = /    CalendarRead:\n[\s\S]*?(?=\n    CalendarTaskPageFirst:)/.exec(contract)?.[0];
  assert.ok(create);
  assert.ok(read);

  assert.match(create, /selectedDate:[\s\S]*?format: date/);
  assert.doesNotMatch(create, /required:\s*\n\s*- selectedDate/);
  assert.doesNotMatch(create, /^\s+businessId:/m, "the client cannot supply Business authority");
  assert.match(create, /fieldId:[\s\S]*?format: uuid/);
  assert.match(create, /'404': \{ description: Field is absent from the authorized Business scope/);

  const required = /      required:\n([\s\S]*?)      properties:/.exec(read)?.[1] ?? "";
  for (const name of ["readId", "selectedDate", "monthIndicators", "monthIndicatorsComplete", "selectedDateTasksPage", "overdueTasksPage"]) {
    assert.match(required, new RegExp(`- ${name}(?:\\n|$)`));
  }
  assert.match(read, /selectedDate:[\s\S]*?Resolved selected date/);
});
