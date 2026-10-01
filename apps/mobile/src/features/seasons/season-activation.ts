import type { ApiClient, SeasonComponents, SeasonOperations } from "../../api/onboarding-client";

type Season = SeasonComponents["schemas"]["SeasonDraft"] | SeasonComponents["schemas"]["ActiveSeason"];
type Draft = SeasonComponents["schemas"]["SeasonDraft"];
type Today = SeasonOperations["getTodayPlannedTasks"]["responses"][200]["content"]["application/json"];

export type ActivationOutcome = Readonly<{ season: Season; kind: "activated" | "already-active" }>;

export async function activateSeason(client: ApiClient, draft: Draft, idempotencyKey: string): Promise<ActivationOutcome> {
  if (draft.plan.tasks.length === 0) throw new Error("Sezona başlamadan önce plana en az bir görev ekleyin.");
  const result = await client.POST("/seasons/{seasonId}/activate", {
    params: { path: { seasonId: draft.id }, header: { "If-Match": `"${draft.version}"`, "Idempotency-Key": idempotencyKey } },
  });
  if (!result.response.ok || result.error !== undefined || result.data === undefined) {
    throw Object.assign(new Error(result.response.status === 409
      ? "Taslak başka bir yerde değişti. Güncel sezon yeniden yüklendi; tekrar gözden geçirin."
      : "Sezon etkinleştirilemedi. Güncel durumu kontrol edip yeniden deneyin."), { status: result.response.status });
  }
  return { season: result.data as Season, kind: "activated" };
}

export async function readTodayPlannedWork(client: ApiClient): Promise<Today> {
  const result = await client.GET("/today");
  if (!result.response.ok || result.error !== undefined || result.data === undefined) {
    throw Object.assign(new Error("Bugünün işleri yüklenemedi. Bağlantınızı kontrol edip yeniden deneyin."), { status: result.response.status });
  }
  return result.data;
}

/** Re-read after all activation outcomes to treat the API state as authoritative. */
export async function refreshSeasonAfterConflict(client: ApiClient, seasonId: string): Promise<Season> {
  const result = await client.GET("/seasons/{seasonId}", { params: { path: { seasonId } } });
  if (!result.response.ok || result.error !== undefined || result.data === undefined) throw new Error("Güncel sezon yüklenemedi. Yeniden deneyin.");
  return result.data as Season;
}
