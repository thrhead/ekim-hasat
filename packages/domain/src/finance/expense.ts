import { validateLocalDate, type LocalDate } from "../seasons/local-date.js";
import { isCurrencyCode, type CurrencyCode } from "./currency-code.js";
import { validateExpenseAmount, type ExpenseAmount } from "./expense-amount.js";
import { isExpenseCategory, type ExpenseCategory } from "./expense-category.js";

export class ExpenseValidationError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "ExpenseValidationError";
  }
}

export interface Expense {
  id: string;
  businessId: string;
  fieldId: string;
  seasonId: string | null;
  actorUserId: string;
  actorMembershipId: string;
  amount: ExpenseAmount;
  currency: CurrencyCode;
  category: ExpenseCategory;
  expenseDate: LocalDate;
  note: string | null;
}

export interface CreateExpenseInput {
  id: unknown;
  businessId: unknown;
  fieldId: unknown;
  seasonId?: unknown;
  actorUserId: unknown;
  actorMembershipId: unknown;
  amount: unknown;
  currency: unknown;
  category: unknown;
  expenseDate: unknown;
  note?: unknown;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createExpense(input: CreateExpenseInput): Expense {
  const uuid = (value: unknown, name: string): string => {
    if (typeof value !== "string" || !UUID.test(value)) throw new ExpenseValidationError(`INVALID_EXPENSE_${name.toUpperCase()}`);
    return value;
  };

  let amount: ExpenseAmount;
  let expenseDate: LocalDate;
  try {
    amount = validateExpenseAmount(input.amount);
    expenseDate = validateLocalDate(input.expenseDate);
  } catch (error) {
    throw new ExpenseValidationError(error instanceof Error ? error.message : "INVALID_EXPENSE_VALUE");
  }
  if (!isCurrencyCode(input.currency)) throw new ExpenseValidationError("INVALID_EXPENSE_CURRENCY");
  if (!isExpenseCategory(input.category)) throw new ExpenseValidationError("INVALID_EXPENSE_CATEGORY");
  if (input.note !== undefined && input.note !== null && typeof input.note !== "string") {
    throw new ExpenseValidationError("INVALID_EXPENSE_NOTE");
  }
  const seasonId = input.seasonId === undefined || input.seasonId === null ? null : uuid(input.seasonId, "seasonId");
  return {
    id: uuid(input.id, "id"),
    businessId: uuid(input.businessId, "businessId"),
    fieldId: uuid(input.fieldId, "fieldId"),
    seasonId,
    actorUserId: uuid(input.actorUserId, "actorUserId"),
    actorMembershipId: uuid(input.actorMembershipId, "actorMembershipId"),
    amount,
    currency: input.currency,
    category: input.category,
    expenseDate,
    note: input.note ?? null,
  };
}

export { isCurrencyCode } from "./currency-code.js";
export { isExpenseCategory } from "./expense-category.js";
export { validateExpenseAmount } from "./expense-amount.js";
export { ISO_4217_CURRENCY_CODES, ISO_4217_VERSION } from "./iso-4217-codes.js";
