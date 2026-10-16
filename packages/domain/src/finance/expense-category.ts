export const EXPENSE_CATEGORIES = [
  "SEED_SEEDLING", "FERTILIZER", "PESTICIDE", "FUEL", "LABOR", "IRRIGATION", "OTHER",
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export function isExpenseCategory(value: unknown): value is ExpenseCategory {
  return typeof value === "string" && (EXPENSE_CATEGORIES as readonly string[]).includes(value);
}
