import { ISO_4217_CURRENCY_CODES } from "./iso-4217-codes.js";

export type CurrencyCode = string & { readonly __currencyCode: unique symbol };

export function isCurrencyCode(value: unknown): value is CurrencyCode {
  return typeof value === "string" && ISO_4217_CURRENCY_CODES.has(value);
}

export function validateCurrencyCode(value: unknown): CurrencyCode {
  if (!isCurrencyCode(value)) throw new Error("INVALID_EXPENSE_CURRENCY");
  return value;
}
