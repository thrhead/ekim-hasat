import type { ApiClient, HarvestComponents } from "../../../../../packages/api-client/src/index";

export type HarvestRecord = HarvestComponents["schemas"]["Harvest"];
export type HarvestCreateRequest = HarvestComponents["schemas"]["CreateHarvestRequest"];
export type HarvestCreateError = Error & { status?: number; code?: string };

/** Submit one online Harvest using the generated API contract. No local queue is involved. */
export async function submitHarvest(client: ApiClient, fieldId: string, request: HarvestCreateRequest): Promise<HarvestRecord> {
  const result = await client.POST("/fields/{fieldId}/harvests", {
    params: { path: { fieldId } },
    body: request,
  });
  if (result.response.ok && !result.data) {
    // A success status without the committed record leaves acceptance uncertain.
    throw new Error("Kayıt sonucu doğrulanamadı. Aynı kaydı yeniden deneyin.");
  }
  if (!result.response.ok || result.error || !result.data) {
    const status = result.response.status;
    const message = status === 400 ? "Hasat tarihi, miktarı veya birimi kontrol edin."
      : status === 401 || status === 403 || status === 404 ? "Bu tarlaya ve sezona erişiminizi kontrol edin."
        : status === 409 ? "Bu kayıt kimliği farklı bilgilerle daha önce kullanılmış. Bilgileri kontrol edin."
          : status >= 500 ? "Sunucu yanıtı doğrulanamadı. Aynı kaydı yeniden deneyin."
            : "İnternet bağlantınızı kontrol edip aynı kaydı yeniden deneyin.";
    const failure = new Error(message) as HarvestCreateError;
    failure.status = status;
    failure.code = result.error?.error.code;
    throw failure;
  }
  return result.data;
}
