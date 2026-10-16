import { createApiClient, type ApiClient, type ExpenseComponents } from "../../../../../packages/api-client/src/index";

export type ExpenseRequest = ExpenseComponents["schemas"]["CreateExpenseRequest"];
export type ExpenseRecord = ExpenseComponents["schemas"]["Expense"];
export type ExpenseSeasonOption = Readonly<{ id: string; label: string }>;

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

export async function readExpenseSeasonOptions(client: ApiClient, fieldId: string): Promise<ReadonlyArray<ExpenseSeasonOption>> {
  const result = await client.GET("/fields/{fieldId}/expenses/seasons", { params: { path: { fieldId } } });
  if (!result.response.ok || !result.data) {
    throw Object.assign(new Error(errorMessage(result.response.status, result.error?.error.code)), { status: result.response.status });
  }
  return result.data.map(({ id, cropLabel, status }) => ({
    id,
    label: `${cropLabel} · ${status === "ACTIVE" ? "Aktif" : "Taslak"}`,
  }));
}

export async function submitExpense(client: ApiClient, fieldId: string, request: ExpenseRequest): Promise<ExpenseRecord> {
  const result = await client.POST("/fields/{fieldId}/expenses", { params: { path: { fieldId } }, body: request });
  if (!result.response.ok || !result.data) {
    // A 2xx without a representation may still have committed. Treat it as
    // uncertain so the form retains this exact identity and payload for replay.
    const status = result.response.ok ? undefined : result.response.status;
    throw Object.assign(new Error(errorMessage(result.response.status, result.error?.error.code)), { status });
  }
  return result.data;
}

export function defaultExpenseClient(): ApiClient { return createApiClient(); }
