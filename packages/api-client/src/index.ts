import createClient, { type ClientOptions } from "openapi-fetch";
import type { paths } from "./generated/onboarding-api.js";

export type { components, operations, paths } from "./generated/onboarding-api.js";

/** Creates the typed SPEC-001 client. Paths and payloads come from OpenAPI. */
export function createApiClient(options: ClientOptions = {}) {
  const baseUrl = options.baseUrl ?? "/v1";
  const relativeBaseUrl = baseUrl.startsWith("/");
  const fetch = options.fetch && relativeBaseUrl
    ? (request: Request) => {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return options.fetch!(request);
      }
      const url = new URL(request.url);
      const path = `${url.pathname}${url.search}`;
      const init: RequestInit = {
        method: request.method,
        headers: request.headers,
        signal: request.signal,
      };
      return (options.fetch as unknown as (
        input: string,
        init?: RequestInit,
      ) => Promise<Response>)(path, init);
    }
    : options.fetch;

  return createClient<paths>({
    ...options,
    baseUrl: relativeBaseUrl && options.fetch ? `http://localhost${baseUrl}` : baseUrl,
    ...(fetch ? { fetch } : {}),
  });
}

export type ApiClient = ReturnType<typeof createApiClient>;
export type ApiClientOptions = ClientOptions;
