import createClient, { type ClientOptions } from "openapi-fetch";
import type { operations as OnboardingOperations, paths as OnboardingPaths } from "./generated/onboarding-api.js";
import type { operations as SeasonOperations, paths as SeasonPaths } from "./generated/seasons-api.js";
import type { operations as TaskCompletionOperations, paths as TaskCompletionPaths } from "./generated/task-completions-api.js";
import type { operations as WeatherOperations, paths as WeatherPaths } from "./generated/weather-api.js";
import type { operations as FieldOperations, paths as FieldPaths } from "./generated/fields-api.js";
import type { operations as ObservationDiaryOperations, paths as ObservationDiaryPaths } from "./generated/observations-diary-api.js";
import type { operations as CalendarOperations, paths as CalendarPaths } from "./generated/calendar-api.js";

export type { components } from "./generated/onboarding-api.js";
export type { components as SeasonComponents, operations as SeasonOperations, paths as SeasonPaths } from "./generated/seasons-api.js";
export type { components as TaskCompletionComponents, operations as TaskCompletionOperations, paths as TaskCompletionPaths } from "./generated/task-completions-api.js";
export type { components as WeatherComponents, operations as WeatherOperations, paths as WeatherPaths } from "./generated/weather-api.js";
export type { components as FieldComponents, operations as FieldOperations, paths as FieldPaths } from "./generated/fields-api.js";
export type { components as ObservationDiaryComponents, operations as ObservationDiaryOperations, paths as ObservationDiaryPaths } from "./generated/observations-diary-api.js";
export type { components as CalendarComponents, operations as CalendarOperations, paths as CalendarPaths } from "./generated/calendar-api.js";
export type paths = OnboardingPaths & SeasonPaths & TaskCompletionPaths & WeatherPaths & FieldPaths & ObservationDiaryPaths & CalendarPaths;
export type operations = OnboardingOperations & SeasonOperations & TaskCompletionOperations & WeatherOperations & FieldOperations & ObservationDiaryOperations & CalendarOperations;

/** Creates the typed client from the generated application API paths. */
export function createApiClient(options: ClientOptions = {}) {
  const baseUrl = options.baseUrl ?? "/v1";
  const relativeBaseUrl = baseUrl.startsWith("/");
  const fetch = options.fetch
    ? relativeBaseUrl
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
      : (request: Request) => {
        const url = new URL(request.url);
        const basePathSegments = new URL(baseUrl).pathname.split("/").filter(Boolean);
        const version = basePathSegments.at(-1);
        if (version && /^v\d+$/.test(version)) {
          const requestSegments = url.pathname.split("/").filter(Boolean);
          const duplicateVersionIndex = basePathSegments.length;
          if (requestSegments.slice(0, basePathSegments.length).join("/") === basePathSegments.join("/")
            && requestSegments[duplicateVersionIndex] === version) {
            requestSegments.splice(duplicateVersionIndex, 1);
            url.pathname = `/${requestSegments.join("/")}`;
            return options.fetch!(new Request(url, request));
          }
        }
        return options.fetch!(request);
      }
    : undefined;

  return createClient<paths>({
    ...options,
    baseUrl: relativeBaseUrl && options.fetch ? `http://localhost${baseUrl}` : baseUrl,
    ...(fetch ? { fetch } : {}),
  });
}

export type ApiClient = ReturnType<typeof createApiClient>;
export type ApiClientOptions = ClientOptions;
