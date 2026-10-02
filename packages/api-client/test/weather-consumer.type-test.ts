import { createApiClient } from "@ekim-hasat/api-client";
import type { operations, paths, WeatherComponents } from "@ekim-hasat/api-client";

const client = createApiClient();
void client.GET("/weather/fields", { params: { query: { limit: 50, cursor: "next" } } });
void client.GET("/fields/{fieldId}/weather", { params: { path: { fieldId: "field-id" } } });

type Assert<T extends true> = T;
type WeatherPaths = Assert<"/weather/fields" | "/fields/{fieldId}/weather" extends keyof paths ? true : false>;
type WeatherOperations = Assert<"getWeatherFieldOverview" | "getFieldWeather" extends keyof operations ? true : false>;
type OverviewResponse = operations["getWeatherFieldOverview"]["responses"][200]["content"]["application/json"];
type SingleFieldResponse = operations["getFieldWeather"]["responses"][200]["content"]["application/json"];
type OverviewItems = Assert<OverviewResponse["items"][number] extends WeatherComponents["schemas"]["FieldWeather"] ? true : false>;
type SingleField = Assert<SingleFieldResponse extends WeatherComponents["schemas"]["FieldWeather"] ? true : false>;
type OverviewQuery = NonNullable<operations["getWeatherFieldOverview"]["parameters"]["query"]>;
type OverviewQueryKeys = Assert<keyof OverviewQuery extends "cursor" | "limit" ? true : false>;
type NoSingleFieldQuery = Assert<operations["getFieldWeather"]["parameters"]["query"] extends undefined ? true : false>;
type NoSingleFieldBody = Assert<operations["getFieldWeather"]["requestBody"] extends undefined ? true : false>;
void (0 as unknown as WeatherPaths);
void (0 as unknown as WeatherOperations);
void (0 as unknown as OverviewItems);
void (0 as unknown as SingleField);
void (0 as unknown as OverviewQueryKeys);
void (0 as unknown as NoSingleFieldQuery);
void (0 as unknown as NoSingleFieldBody);

const overviewItem: OverviewResponse["items"][number] = {
  fieldId: "field-id",
  fieldName: "Üst tarla",
  status: "UNAVAILABLE",
  businessTimezone: "Europe/Istanbul",
  fetchedAt: null,
  coverage: null,
  current: null,
  dailyForecasts: [],
};
void overviewItem;

void client.GET("/weather/fields", {
  params: { query: {
  // @ts-expect-error The weather overview accepts no client-selected business authority.
    businessId: "business-id",
  } },
});
void client.GET("/fields/{fieldId}/weather", {
  params: {
    path: { fieldId: "field-id" },
    // @ts-expect-error Coordinates and timezone are server-owned inputs.
    query: { longitude: 29, latitude: 41, timezone: "Europe/Istanbul" },
  },
});
