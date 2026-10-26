import assert from "node:assert/strict";
import test from "node:test";
import { createHarvestRecord } from "../../src/harvest/harvest-record.ts";

const validInput = {
  id: "70000000-0000-4000-8000-000000000001",
  businessId: "70000000-0000-4000-8000-000000000002",
  fieldId: "70000000-0000-4000-8000-000000000003",
  seasonId: "70000000-0000-4000-8000-000000000004",
  actorUserId: "70000000-0000-4000-8000-000000000005",
  actorMembershipId: "70000000-0000-4000-8000-000000000006",
  harvestDate: "2026-10-04",
  quantity: "1250.375",
  unit: "KG" as const,
};

test("accepts valid LocalDate strings without attaching a time or timezone", () => {
  for (const harvestDate of ["0001-01-01", "2024-02-29", "2026-10-04", "9999-12-31"]) {
    assert.equal(createHarvestRecord({ ...validInput, harvestDate }).harvestDate, harvestDate);
  }
});

test("rejects malformed and impossible Harvest calendar dates", () => {
  const invalidDates: unknown[] = [
    undefined, null, 20261004, new Date("2026-10-04T00:00:00Z"),
    "", "2026-2-04", "2026-10-4", " 2026-10-04", "2026-10-04 ",
    "2026-10-04T00:00:00Z", "0000-01-01", "2026-02-29", "2026-04-31",
  ];

  for (const harvestDate of invalidDates) {
    assert.throws(() => createHarvestRecord({ ...validInput, harvestDate }), TypeError);
  }
});

test("preserves unexpected errors raised while reading harvestDate", () => {
  const failure = new Error("harvestDate accessor failed");
  const input = {
    ...validInput,
    get harvestDate() {
      throw failure;
    },
  };

  assert.throws(() => createHarvestRecord(input), (error: unknown) => error === failure);
});

test("preserves exact positive decimal quantity strings within the supported bounds", () => {
  for (const quantity of ["0.001", "1", "1.0", "99999999999", "99999999999.999"]) {
    assert.equal(createHarvestRecord({ ...validInput, quantity }).quantity, quantity);
  }
});

test("rejects invalid, nonpositive, over-scale, over-width, and out-of-range quantities without rounding", () => {
  const invalidQuantities: unknown[] = [
    undefined, null, 1, 0, NaN, "", "0", "0.000", "-1", "+1", "1e2",
    " 1", "1 ", "1.", ".1", "1.0000", "100000000000", "100000000000.001",
    "100000000000000", "000000000001",
  ];

  for (const quantity of invalidQuantities) {
    assert.throws(() => createHarvestRecord({ ...validInput, quantity }), TypeError);
  }
});

test("accepts only the stable KG and METRIC_TONNE unit codes", () => {
  for (const unit of ["KG", "METRIC_TONNE"] as const) {
    assert.equal(createHarvestRecord({ ...validInput, unit }).unit, unit);
  }
  for (const unit of [undefined, null, "kg", "TONNE", "LITRE", ""] as unknown[]) {
    assert.throws(() => createHarvestRecord({ ...validInput, unit }), TypeError);
  }
});

test("requires valid identity and audit identifiers", () => {
  for (const field of ["id", "businessId", "fieldId", "seasonId", "actorUserId", "actorMembershipId"] as const) {
    assert.throws(() => createHarvestRecord({ ...validInput, [field]: "not-a-uuid" }), TypeError, field);
  }
});
