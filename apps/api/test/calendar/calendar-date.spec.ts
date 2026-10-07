import assert from "node:assert/strict";
import test from "node:test";
import { resolveCalendarDates } from "../../src/calendar/calendar-date.js";

test("omitted selectedDate resolves from captured asOf in the Business timezone, never the device timezone", () => {
  const result = resolveCalendarDates({
    timezone: "Europe/Istanbul",
    asOf: new Date("2026-10-05T21:30:00.000Z"),
  });
  assert.equal(result.businessLocalToday, "2026-10-06");
  assert.equal(result.selectedDate, "2026-10-06");
  assert.equal(result.timezone, "Europe/Istanbul");
});

test("an explicit selectedDate is validated and used independently of asOf timezone rollover", () => {
  const result = resolveCalendarDates({
    selectedDate: "2026-03-01",
    timezone: "Europe/Istanbul",
    asOf: new Date("2026-02-28T22:30:00.000Z"),
  });
  assert.equal(result.businessLocalToday, "2026-03-01");
  assert.equal(result.selectedDate, "2026-03-01");
});

test("invalid explicit dates are rejected without JavaScript date normalization", () => {
  assert.throws(() => resolveCalendarDates({
    selectedDate: "2026-02-30",
    timezone: "Europe/Istanbul",
    asOf: new Date("2026-02-01T00:00:00.000Z"),
  }));
});

test("an unavailable Business timezone uses the established Istanbul fallback", () => {
  const result = resolveCalendarDates({
    timezone: null,
    asOf: new Date("2026-10-05T21:30:00.000Z"),
  });
  assert.equal(result.timezone, "Europe/Istanbul");
  assert.equal(result.businessLocalToday, "2026-10-06");
});

test("month boundaries use the resolved selectedDate and overdue boundary is exclusive", () => {
  const result = resolveCalendarDates({
    selectedDate: "2026-02-28",
    timezone: "Europe/Istanbul",
    asOf: new Date("2026-03-01T12:00:00.000Z"),
  });
  assert.deepEqual([result.monthStart, result.monthEnd], ["2026-02-01", "2026-02-28"]);
  assert.equal(result.businessLocalToday, "2026-03-01");
  assert.equal(result.isOverdue("2026-02-28"), true);
  assert.equal(result.isOverdue("2026-03-01"), false);
});
