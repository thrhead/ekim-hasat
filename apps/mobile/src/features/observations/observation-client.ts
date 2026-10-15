import type { ApiClient, ObservationDiaryComponents } from "../../../../../packages/api-client/src/index";
import type { ObservationCommand } from "./observation-command-store";
export type ObservationRequest = ObservationDiaryComponents["schemas"]["CreateObservationRequest"];
export type Observation = ObservationDiaryComponents["schemas"]["Observation"];
const timeCorrection = "Başka bir geçerli tarih ve saat seçin. Saatin tek bir zamanı belirtmesi gerekir.";
export function canonicalObservationNote(note: string): string {
  return note.replace(/^[\p{White_Space}\ufeff]+|[\p{White_Space}\ufeff]+$/gu, "");
}

export function validateObservationNote(note: string): string | null {
  const length = Array.from(canonicalObservationNote(note)).length;
  return length === 0 ? "Gözlem notunu yazın." : length > 2000 ? "Gözlem notu en fazla 2000 karakter olabilir." : null;
}

/** Format only with the timezone supplied by the authorized API context. */
export function observationLocalTime(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}:${values.second}`;
}

/** UX validation; the server independently validates the unique local/instant mapping. */
export function localObservationInstant(local: string, timezone: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) throw new Error(timeCorrection);
  const wall = Date.parse(`${local}:00.000Z`);
  if (!Number.isFinite(wall) || new Date(wall).toISOString().slice(0, 16) !== local) throw new Error(timeCorrection);
  const offsets = new Set<number>();
  // Sample both sides of nearby timezone transitions, then verify every candidate.
  for (let hours = -36; hours <= 36; hours += 6) {
    const instant = wall + hours * 3600000;
    const rendered = observationLocalTime(new Date(instant), timezone);
    offsets.add(Date.parse(`${rendered}Z`) - instant);
  }
  const candidates = [...offsets].map((offset) => wall - offset).filter((instant) => observationLocalTime(new Date(instant), timezone).slice(0, 16) === local);
  if (candidates.length !== 1) throw new Error(timeCorrection);
  return new Date(candidates[0]!).toISOString();
}

/** Creates one immutable local intent; server validation and authorization remain authoritative. */
export function buildObservationCommand(input: Readonly<{
  accountId: string; observationId: string; fieldId: string; seasonId: string | null;
  description: string; occurredAtLocal: string; capturedBusinessTimezone: string; now: Date;
}>): ObservationCommand {
  if (!input.accountId?.trim() || !input.fieldId?.trim()
    || !/^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(input.observationId)) {
    throw new Error("Observation identity or context is invalid");
  }
  const invalidNote = validateObservationNote(input.description);
  if (invalidNote) throw new Error(invalidNote);
  const occurredAt = localObservationInstant(input.occurredAtLocal, input.capturedBusinessTimezone);
  if (Date.parse(occurredAt) > input.now.getTime()) throw new Error("Gözlem zamanı gelecekte olamaz.");
  return {
    accountId: input.accountId, observationId: input.observationId, fieldId: input.fieldId,
    seasonId: input.seasonId, description: canonicalObservationNote(input.description),
    occurredAtLocal: input.occurredAtLocal, occurredAt,
    capturedBusinessTimezone: input.capturedBusinessTimezone, state: "PENDING",
  };
}

function apiFailure(status: number, code?: string): Error {
  const message = code === "INVALID_REQUEST"
    ? "Notunuzu kontrol edin ve başka bir geçerli tarih ve saat seçin. Saatin tek bir zamanı belirtmesi gerekir."
    : [401, 403, 404].includes(status)
      ? "Bu tarlaya erişiminiz doğrulanamadı. Yeniden bağlanıp erişiminizi kontrol edin."
      : status === 409 ? "Bu kayıt doğrulanamadı. Tarla günlüğünü kontrol edin."
        : "Kayıt sonucu doğrulanamadı. Bağlantınızı kontrol edip aynı kaydı yeniden deneyin.";
  return Object.assign(new Error(message), { status, code });
}

export async function readObservationTimezone(client: ApiClient, fieldId: string, seasonId?: string): Promise<string> {
  const result = await client.GET("/fields/{fieldId}/diary", { params: { path: { fieldId }, query: { limit: 1, ...(seasonId ? { seasonId } : {}) } } });
  if (!result.response.ok || !result.data) throw apiFailure(result.response.status, result.error?.error.code);
  const timezone = result.data.businessTimezone;
  // Missing/invalid authorized context must block saving rather than use device settings.
  new Intl.DateTimeFormat("en", { timeZone: timezone }).format();
  if (!timezone) throw new Error("Tarla bilgileri yüklenemedi.");
  return timezone;
}

export async function submitObservation(client: ApiClient, fieldId: string, request: ObservationRequest): Promise<Observation> {
  const result = await client.POST("/fields/{fieldId}/observations", { params: { path: { fieldId } }, body: request });
  if (!result.response.ok || !result.data) throw apiFailure(result.response.status, result.error?.error.code);
  return result.data;
}
