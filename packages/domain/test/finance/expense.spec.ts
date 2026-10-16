import assert from "node:assert/strict";
import test from "node:test";
import {
  ExpenseValidationError,
  createExpense,
  isCurrencyCode,
  isExpenseCategory,
} from "../../src/finance/expense.ts";
import { ISO_4217_VERSION } from "../../src/finance/iso-4217-codes.ts";

const validExpense = {
  id: "8f9210ad-d9df-49e2-91a8-4c9a3f11d5c3",
  businessId: "6b73e911-8d74-4f62-bd8b-803cb39b0f3e",
  fieldId: "dcd7256a-e916-43ef-8945-d9d30d2637f0",
  actorUserId: "6fc3ef0b-6f3d-4f54-9383-a969b1e2de50",
  actorMembershipId: "21c08471-f720-48b3-9441-b9e09a2ef105",
  amount: "120.50",
  currency: "TRY",
  category: "FERTILIZER",
  expenseDate: "2026-10-16",
  note: "  Kuyu gübresi  ",
};

test("validates required UUID identity, Field, Business, and actor provenance", () => {
  assert.deepEqual(createExpense(validExpense), { ...validExpense, seasonId: null });
  for (const key of ["id", "businessId", "fieldId", "actorUserId", "actorMembershipId"] as const) {
    assert.throws(() => createExpense({ ...validExpense, [key]: "" }), ExpenseValidationError);
  }
});

test("preserves positive exact decimal strings within 18 integer and 6 fractional digits", () => {
  for (const amount of ["0.000001", "999999999999999999.999999", "12", "120.5000"]) {
    assert.equal(createExpense({ ...validExpense, amount }).amount, amount);
  }
  for (const amount of ["0", "0.000000", "-1", "+1", "01", ".5", "1.", "1e2", "1.0000001", "1000000000000000000", "9999999999999999999"]) {
    assert.throws(() => createExpense({ ...validExpense, amount }), ExpenseValidationError, amount);
  }
});

test("validates versioned ISO 4217 currency codes and the seven fixed categories", () => {
  assert.equal(ISO_4217_VERSION, "2026-01");
  assert.equal(isCurrencyCode("TRY"), true);
  assert.equal(isCurrencyCode("USD"), true);
  assert.equal(isCurrencyCode("XAD"), true);
  assert.equal(isCurrencyCode("BGN"), false);
  assert.equal(isCurrencyCode("VED"), false);
  assert.equal(isCurrencyCode("ZZZ"), false);
  assert.equal(isCurrencyCode("try"), false);
  assert.deepEqual(
    ["SEED_SEEDLING", "FERTILIZER", "PESTICIDE", "FUEL", "LABOR", "IRRIGATION", "OTHER"].map(isExpenseCategory),
    [true, true, true, true, true, true, true],
  );
  assert.equal(isExpenseCategory("CUSTOM"), false);
  assert.throws(() => createExpense({ ...validExpense, currency: "ZZZ" }), ExpenseValidationError);
  assert.throws(() => createExpense({ ...validExpense, category: "CUSTOM" }), ExpenseValidationError);
});

test("preserves a valid date-only value and rejects impossible dates", () => {
  assert.equal(createExpense({ ...validExpense, expenseDate: "2024-02-29" }).expenseDate, "2024-02-29");
  assert.throws(() => createExpense({ ...validExpense, expenseDate: "2026-02-29" }), ExpenseValidationError);
});

test("preserves an optional note exactly without feature-specific trimming", () => {
  assert.equal(createExpense({ ...validExpense, note: "  note  " }).note, "  note  ");
  assert.equal(createExpense({ ...validExpense, note: undefined }).note, null);
  assert.equal(createExpense({ ...validExpense, note: "" }).note, "");
});
