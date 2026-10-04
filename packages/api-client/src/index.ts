import createClient, { type ClientOptions } from "openapi-fetch";
import type { operations as OnboardingOperations, paths as OnboardingPaths } from "./generated/onboarding-api.js";
import type { operations as SeasonOperations, paths as SeasonPaths } from "./generated/seasons-api.js";
import type { operations as TaskCompletionOperations, paths as TaskCompletionPaths } from "./generated/task-completions-api.js";
import type { operations as WeatherOperations, paths as WeatherPaths } from "./generated/weather-api.js";
import type { operations as FieldOperations, paths as FieldPaths } from "./generated/fields-api.js";

export type { components } from "./generated/onboarding-api.js";
export type { components as SeasonComponents, operations as SeasonOperations, paths as SeasonPaths } from "./generated/seasons-api.js";
export type { components as TaskCompletionComponents, operations as TaskCompletionOperations, paths as TaskCompletionPaths } from "./generated/task-completions-api.js";
export type { components as WeatherComponents, operations as WeatherOperations, paths as WeatherPaths } from "./generated/weather-api.js";
export type { components as FieldComponents, operations as FieldOperations, paths as FieldPaths } from "./generated/fields-api.js";
export type paths = OnboardingPaths & SeasonPaths & TaskCompletionPaths & WeatherPaths & FieldPaths;
export type operations = OnboardingOperations & SeasonOperations & TaskCompletionOperations & WeatherOperations & FieldOperations;

/** Creates the typed client from the generated application API paths. */
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
