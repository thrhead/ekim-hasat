import { createApiClient, type ApiClient, type ExpenseComponents } from "../../../../../packages/api-client/src/index";
import { readField } from "../fields/fields-client";

export type ExpenseRequest = ExpenseComponents["schemas"]["CreateExpenseRequest"];
export type ExpenseRecord = ExpenseComponents["schemas"]["Expense"];

function errorMessage(status: number, code?: string): string {
  if (code === "INVALID_REQUEST") return "Gider bilgilerini kontrol edin.";
  if ([401, 403, 404].includes(status)) return "Bu tarlaya erişiminizi kontrol edin.";
  if (status === 409) return "Bu kayıt doğrulanamadı. Tarla günlüğünü kontrol edin.";
  return "Kayıt sonucu doğrulanamadı. Bağlantınızı kontrol edip aynı kaydı yeniden deneyin.";
}

export async function readExpenseBusinessTimezone(client: ApiClient, fieldId: string): Promise<string> {
  const result = await client.GET("/fields/{fieldId}/diary", { params: { path: { fieldId }, query: { limit: 1 } } });
  if (!result.response.ok || !result.data?.businessTimezone) {
    throw Object.assign(new Error(errorMessage(result.response.status, result.error?.error.code)), { status: result.response.status });
  }
  try { new Intl.DateTimeFormat("en", { timeZone: result.data.businessTimezone }).format(); }
  catch { throw new Error("Tarla saat dilimi kullanılamıyor."); }
  return result.data.businessTimezone;
}

export async function readExpenseSeasonOptions(client: ApiClient, fieldId: string): Promise<ReadonlyArray<Readonly<{ id: string; label: string }>>> {
  const field = await readField(client, fieldId);
  return field.activeSeason ? [{ id: field.activeSeason.id, label: field.activeSeason.cropLabel ?? "Sezon" }] : [];
}

export async function submitExpense(client: ApiClient, fieldId: string, request: ExpenseRequest): Promise<ExpenseRecord> {
  const result = await client.POST("/fields/{fieldId}/expenses", { params: { path: { fieldId } }, body: request });
  if (!result.response.ok || !result.data) {
    throw Object.assign(new Error(errorMessage(result.response.status, result.error?.error.code)), { status: result.response.status });
  }
  return result.data;
}

export function defaultExpenseClient(): ApiClient { return createApiClient(); }
