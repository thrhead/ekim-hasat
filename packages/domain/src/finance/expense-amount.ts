export type ExpenseAmount = string & { readonly __expenseAmount: unique symbol };

const POSITIVE_DECIMAL = /^(?=.*[1-9])(?:0|[1-9][0-9]{0,17})(?:\.[0-9]{1,6})?$/;

export function validateExpenseAmount(value: unknown): ExpenseAmount {
  if (typeof value !== "string" || !POSITIVE_DECIMAL.test(value)) {
    throw new Error("INVALID_EXPENSE_AMOUNT");
  }
  return value as ExpenseAmount;
}
