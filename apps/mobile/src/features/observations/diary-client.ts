import type { ApiClient, ObservationDiaryComponents } from "../../../../../packages/api-client/src/index";
export type DiaryPage = ObservationDiaryComponents["schemas"]["DiaryPage"];
export type DiaryEntry = DiaryPage["items"][number];
export type DiaryReadError = Error & { status?: number; code?: string };

export async function readFieldDiary(client: ApiClient, fieldId: string, filters: Readonly<{ seasonId?: string; cursor?: string }> = {}): Promise<DiaryPage> {
  const result = await client.GET("/fields/{fieldId}/diary", {
    params: { path: { fieldId }, query: { limit: 50, ...(filters.seasonId ? { seasonId: filters.seasonId } : {}), ...(filters.cursor ? { cursor: filters.cursor } : {}) } },
  });
  if (!result.response.ok || result.error || !result.data) {
    const status = result.response.status;
    throw Object.assign(new Error([401, 403, 404].includes(status)
      ? "Bu günlüğe erişiminiz doğrulanamadı. Yeniden bağlanıp erişiminizi kontrol edin."
      : "Günlük yüklenemedi. İnternet bağlantınızı kontrol edip yeniden deneyin."), { status, code: result.error?.error.code });
  }
  return result.data;
}
