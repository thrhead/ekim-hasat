import assert from "node:assert/strict";
import test from "node:test";
import {
  LocalDateValidationError,
  validateActualPlantingDate,
  validateLocalDate,
  validatePlannedTaskDate,
} from "../../src/seasons/local-date.ts";

test("preserves canonical calendar dates, including leap days and ancient dates", () => {
  for (const value of ["0001-01-01", "1900-02-28", "2000-02-29", "2024-02-29", "9999-12-31"]) {
    assert.equal(validateLocalDate(value), value);
  }
});

test("rejects malformed dates and impossible calendar days without normalization", () => {
  const invalid: unknown[] = [
    undefined, null, 20260928, new Date("2026-09-28T00:00:00Z"),
    "", "2026-9-28", "2026-09-2", " 2026-09-28", "2026-09-28 ",
    "2026-09-28\n", "2026-09-28T00:00:00Z", "0000-01-01", "10000-01-01",
    "2026-00-01", "2026-13-01", "2026-01-00", "2026-01-32", "2026-04-31",
    "1900-02-29", "2100-02-29", "2026-02-29", "2024-02-30",
  ];
  for (const value of invalid) {
    assert.throws(() => validateLocalDate(value), { name: "LocalDateValidationError", code: "INVALID_LOCAL_DATE" });
  }
});

test("accepts actual planting today and any past date without a lookback limit", () => {
  for (const date of ["2026-09-28", "2026-09-27", "1900-01-01", "0001-01-01"]) {
    assert.equal(validateActualPlantingDate(date, "2026-09-28"), date);
  }
});

test("rejects future actual planting dates across calendar boundaries", () => {
  for (const [actual, today] of [["2026-09-29", "2026-09-28"], ["2027-01-01", "2026-12-31"]]) {
    assert.throws(() => validateActualPlantingDate(actual, today), {
      name: "LocalDateValidationError", code: "FUTURE_ACTUAL_PLANTING_DATE",
    });
  }
});

test("uses the supplied local today regardless of process timezone or UTC clock", () => {
  // At 21:30 UTC on September 27, Istanbul's local day is September 28.
  assert.equal(validateActualPlantingDate("2026-09-28", "2026-09-28"), "2026-09-28");
  assert.throws(() => validateActualPlantingDate("2026-09-28", "2026-09-27"), {
    code: "FUTURE_ACTUAL_PLANTING_DATE",
  });
});

test("validates both actual planting and its local today before comparing them", () => {
  assert.throws(() => validateActualPlantingDate("2026-02-30", "2026-09-28"), LocalDateValidationError);
  assert.throws(() => validateActualPlantingDate("2026-09-28", "invalid"), LocalDateValidationError);
});

test("accepts a planned task on the planting day or any later date", () => {
  for (const planned of ["2026-09-28", "2026-09-29", "9999-12-31"]) {
    assert.equal(validatePlannedTaskDate(planned, "2026-09-28"), planned);
  }
});

test("rejects planned tasks before actual planting, including across year boundaries", () => {
  for (const [planned, actual] of [["2026-09-27", "2026-09-28"], ["2025-12-31", "2026-01-01"]]) {
    assert.throws(() => validatePlannedTaskDate(planned, actual), {
      name: "LocalDateValidationError", code: "PLANNED_DATE_BEFORE_PLANTING",
    });
  }
});

test("validates both planned and planting dates before comparing them", () => {
  assert.throws(() => validatePlannedTaskDate("2026-02-30", "2026-01-01"), LocalDateValidationError);
  assert.throws(() => validatePlannedTaskDate("2026-09-28", "invalid"), LocalDateValidationError);
});

test("validates each task independently without chronological order between tasks", () => {
  const dates = ["2026-12-01", "2026-09-28", "2026-10-01"];
  assert.deepEqual(dates.map((date) => validatePlannedTaskDate(date, "2026-09-28")), dates);
});
