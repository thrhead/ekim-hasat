import { createApiClient, type ApiClient, type IrrigationRecordsComponents } from "../../../../../packages/api-client/src/index";
import { localObservationInstant, observationLocalTime } from "../observations/observation-client";

export type IrrigationRecordRequest = IrrigationRecordsComponents["schemas"]["CreateIrrigationRecordRequest"];
export type IrrigationRecord = IrrigationRecordsComponents["schemas"]["IrrigationRecord"];

function requestError(status: number, code?: string): Error {
  const message = code === "INVALID_REQUEST"
    ? "Sulama bilgilerini ve tarih ile saati kontrol edin."
    : [401, 403, 404].includes(status)
      ? "Bu tarlaya erişiminizi kontrol edin."
      : status === 409
        ? "Bu kayıt doğrulanamadı. Tarla günlüğünü kontrol edin."
        : "Kayıt sonucu doğrulanamadı. Bağlantınızı kontrol edip aynı kaydı yeniden deneyin.";
  return Object.assign(new Error(message), { status, code });
}

export function irrigationLocalTime(date: Date, timezone: string): string {
  return observationLocalTime(date, timezone).slice(0, 16);
}

export function irrigationInstant(local: string, timezone: string): string {
  return localObservationInstant(local, timezone);
}

export async function readIrrigationBusinessTimezone(client: ApiClient, fieldId: string): Promise<string> {
  const result = await client.GET("/fields/{fieldId}/diary", { params: { path: { fieldId }, query: { limit: 1 } } });
  if (!result.response.ok || !result.data) throw requestError(result.response.status, result.error?.error.code);
  const timezone = result.data.businessTimezone;
  if (!timezone) throw new Error("Tarla bilgileri yüklenemedi.");
  try { new Intl.DateTimeFormat("en", { timeZone: timezone }).format(); }
  catch { throw new Error("Tarla saat dilimi kullanılamıyor."); }
  return timezone;
}

export async function submitIrrigationRecord(
  client: ApiClient,
  fieldId: string,
  request: IrrigationRecordRequest,
): Promise<IrrigationRecord> {
  const result = await client.POST("/fields/{fieldId}/irrigation-records", { params: { path: { fieldId } }, body: request });
  if (!result.response.ok || !result.data) throw requestError(result.response.status, result.error?.error.code);
  return result.data;
}

export function defaultIrrigationClient(): ApiClient {
  return createApiClient();
}
