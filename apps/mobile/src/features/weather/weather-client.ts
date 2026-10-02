import type { ApiClient, WeatherComponents } from "../../../../../packages/api-client/src/index";

export type { WeatherComponents };
export type WeatherField = WeatherComponents["schemas"]["FieldWeather"];
export type WeatherOverviewPage = WeatherComponents["schemas"]["WeatherFieldOverviewPage"];

/** Read the server-authorized weather overview, independent of Today task rows. */
export async function readWeatherOverview(client: ApiClient): Promise<WeatherOverviewPage> {
  const items: WeatherField[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  do {
    let result;
    try {
      result = cursor === undefined
        ? await client.GET("/weather/fields")
        : await client.GET("/weather/fields", { params: { query: { cursor } } });
    } catch {
      throw Object.assign(new Error("Hava durumu yüklenemedi. Bağlantınızı kontrol edip yeniden deneyin."), { status: undefined });
    }
    const { data, error, response } = result;
    if (!response.ok || error !== undefined || data === undefined) {
      throw Object.assign(new Error(response.status === 403 || response.status === 401
        ? "Hava durumu erişiminiz doğrulanamadı. Yeniden bağlanıp erişiminizi kontrol edin."
        : "Hava durumu yüklenemedi. Bağlantınızı kontrol edip yeniden deneyin."), { status: response.status });
    }
    items.push(...data.items);
    cursor = data.nextCursor ?? undefined;
    if (cursor && seenCursors.has(cursor)) {
      throw Object.assign(new Error("Hava durumu listesi tamamlanamadı. Yeniden deneyin."), { status: response.status });
    }
    if (cursor) seenCursors.add(cursor);
  } while (cursor !== undefined);
  return { items, nextCursor: null };
}

/** Read an authorized field's persisted weather snapshot. */
export async function readFieldWeather(client: ApiClient, fieldId: string): Promise<WeatherField> {
  let result: { data?: WeatherField; error?: unknown; response: Pick<Response, "ok" | "status"> };
  try {
    result = await client.GET("/fields/{fieldId}/weather", { params: { path: { fieldId } } });
  } catch {
    throw Object.assign(new Error("Hava durumu yüklenemedi. Bağlantınızı kontrol edip yeniden deneyin."), { status: undefined });
  }
  const { data, error, response } = result;
  if (!response.ok || error !== undefined || data === undefined) {
    throw Object.assign(new Error(response.status === 403 || response.status === 401
      ? "Hava durumu erişiminiz doğrulanamadı. Yeniden bağlanıp erişiminizi kontrol edin."
      : "Hava durumu yüklenemedi. Bağlantınızı kontrol edip yeniden deneyin."), { status: response.status });
  }
  return data;
}
