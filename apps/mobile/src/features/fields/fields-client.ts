import type { ApiClient, FieldComponents } from "../../../../../packages/api-client/src/index";

export type FieldPage = FieldComponents["schemas"]["FieldPage"];
export type FieldDetail = FieldComponents["schemas"]["FieldDetail"];
export type FieldListItem = FieldComponents["schemas"]["FieldListItem"];
export type FieldCreate = FieldComponents["schemas"]["FieldCreate"];
export type FieldUpdate = FieldComponents["schemas"]["FieldUpdate"];

export type FieldReadError = Error & Readonly<{ status?: number }>;
export type FieldApiError = Error & Readonly<{ status?: number; code?: string }>;

/** Read one authorized page of Fields; the server owns Business scope and ordering. */
export async function readFields(
  client: ApiClient,
  query: { limit?: number; cursor?: string } = {},
): Promise<FieldPage> {
  let result;
  try {
    result = await client.GET("/fields", { params: { query } });
  } catch {
    throw readError(undefined);
  }
  const { data, error, response } = result;
  if (!response.ok || error !== undefined || data === undefined) throw readError(response.status);
  return data as FieldPage;
}

/** Read the current authorized Field state and read-only ACTIVE season summary. */
export async function readField(client: ApiClient, fieldId: string): Promise<FieldDetail> {
  let result;
  try {
    result = await client.GET("/fields/{fieldId}", { params: { path: { fieldId } } });
  } catch {
    throw readError(undefined);
  }
  const { data, error, response } = result;
  if (!response.ok || error !== undefined || data === undefined) throw readError(response.status);
  return data as FieldDetail;
}

/** Create retries reuse the caller's stable idempotency key and generated body type. */
export async function createField(client: ApiClient, request: FieldCreate, idempotencyKey: string): Promise<FieldDetail> {
  let result;
  try {
    result = await client.POST("/fields", { params: { header: { "Idempotency-Key": idempotencyKey } }, body: request });
  } catch {
    throw apiError(undefined);
  }
  const { data, error, response } = result;
  if (!response.ok || error !== undefined || data === undefined) throw apiError(response.status, apiErrorCode(error));
  return data as FieldDetail;
}

/** Update carries the current ETag and never queues a mutation for offline replay. */
export async function updateField(
  client: ApiClient,
  fieldId: string,
  version: number,
  request: FieldUpdate,
): Promise<FieldDetail> {
  let result;
  try {
    result = await client.PATCH("/fields/{fieldId}", {
      params: { path: { fieldId }, header: { "If-Match": `"${version}"` } },
      body: request,
    });
  } catch {
    throw apiError(undefined);
  }
  const { data, error, response } = result;
  if (!response.ok || error !== undefined || data === undefined) throw apiError(response.status, apiErrorCode(error));
  return data as FieldDetail;
}

function apiErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("error" in error)) return undefined;
  const envelope = (error as { error?: unknown }).error;
  if (!envelope || typeof envelope !== "object" || !("code" in envelope)) return undefined;
  const code = (envelope as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function apiError(status: number | undefined, code?: string): FieldApiError {
  const message = code === "STALE_VERSION"
    ? "Değişiklik başka bir cihazda güncellendi. Son bilgileri inceleyin."
    : status === 401 || status === 403
      ? "Tarla bilgileri için oturumunuzu kontrol edin."
      : status === 400
        ? "Tarla bilgilerini kontrol edip yeniden deneyin."
        : "Tarla bilgileri kaydedilemedi. Bağlantınızı kontrol edin.";
  return Object.assign(new Error(message), { status, ...(code ? { code } : {}) });
}

function readError(status: number | undefined): FieldReadError {
  const message = status === 401 || status === 403
    ? "Tarlalara erişiminiz doğrulanamadı. Bağlantınızı kontrol edip yeniden deneyin."
    : status === 404
      ? "Bu tarla artık kullanılamıyor. Listeyi yenileyin."
      : "Tarlalar yüklenemedi. Bağlantınızı kontrol edip yeniden deneyin.";
  return Object.assign(new Error(message), { status });
}
