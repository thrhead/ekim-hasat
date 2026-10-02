export type paths = {
    "/fields/{fieldId}/weather": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read the current authorized weather context for a field
         * @description Authenticates the caller and resolves current Business membership and field scope on the server. The request does not accept a business identifier, coordinates, timezone, or local date. The server uses the Field's existing representative point and the authorized Business timezone. This read returns a persisted normalized snapshot only and never calls an external provider. A CURRENT snapshot is within the configured maximum age (default and deterministic test value six hours; exactly six hours remains CURRENT), covers today and the next two Business-local dates, matches the current representative point, and has valid timezone/date context. Older snapshots or snapshots with invalid/expired forecast coverage or changed timezone/date context are STALE with retained values. A missing/unusable point or point fingerprint mismatch is UNAVAILABLE with no weather values. Provider refresh failure alone does not change status. A cross-business, missing, revoked, or out-of-scope field receives a privacy-safe denial.
         */
        get: operations["getFieldWeather"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/weather/fields": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List authorized field weather summaries
         * @description This weather-owned projection includes fields in the caller's current authorized Business and field scope whether or not a Today task exists. It is not a general field-list API. Each row contains only fieldId, fieldName, and weather context. Fields without a usable representative point or accepted snapshot are included as UNAVAILABLE without weather values. A snapshot for a changed representative point is also UNAVAILABLE. A timezone mismatch or incomplete requested local-date coverage is STALE while retaining the last-valid values. The server resolves current Membership/scope; no client business ID, coordinates, timezone, or local date establishes authority or selection. Results sort by fieldName then fieldId.
         */
        get: operations["getWeatherFieldOverview"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
};
export type webhooks = Record<string, never>;
export type components = {
    schemas: {
        ApiError: {
            error: {
                /**
                 * @description Stable machine-readable error category/code; weather reads reuse repository error semantics.
                 * @enum {string}
                 */
                code: "INVALID_REQUEST" | "UNAUTHORIZED" | "FORBIDDEN" | "NOT_FOUND" | "UNEXPECTED";
                message: string;
                requestId: string;
            };
        };
        CurrentConditions: {
            conditionCode: components["schemas"]["WeatherCondition"];
            /** @description Safe application-owned farmer-facing label; never copied from raw provider text. */
            conditionLabel?: string | null;
            /** Format: date-time */
            observedAt: string;
            /** @description Temperature in degrees Celsius. */
            temperatureC: number;
        };
        DailyForecast: {
            conditionCode: components["schemas"]["WeatherCondition"];
            conditionLabel?: string | null;
            /**
             * Format: date
             * @description ISO date in businessTimezone.
             */
            localDate: string;
            /** @description Probability of precipitation as a percentage. */
            precipitationChancePercent: number;
            /** @description High temperature in degrees Celsius. */
            temperatureHighC: number;
            /** @description Low temperature in degrees Celsius; must be less than or equal to high. */
            temperatureLowC: number;
            /** @description Wind speed in kilometers per hour. */
            windSpeedKph: number;
        };
        FieldWeather: {
            /** @description Authorized Business timezone resolved by the server; falls back to Europe/Istanbul under the SPEC-002 policy. */
            businessTimezone: string;
            /** @description Period covered by retained snapshot, null when unavailable. */
            coverage: components["schemas"]["ForecastCoverage"] | null;
            /** @description Current conditions; null when unavailable. */
            current: components["schemas"]["CurrentConditions"] | null;
            /** @description Exactly today and the next two Business-local days when a snapshot is present; empty when unavailable. */
            dailyForecasts: components["schemas"]["DailyForecast"][];
            /**
             * Format: date-time
             * @description Server UTC time of the last valid accepted refresh; null when unavailable.
             */
            fetchedAt: string | null;
            /** Format: uuid */
            fieldId: string;
            fieldName: string;
            /**
             * @description Derived on read. CURRENT requires age at or below the configured maximum (default/test six hours, inclusive), valid requested local-date coverage, matching representative point, and valid timezone/date context. STALE means freshness/coverage policy has expired. UNAVAILABLE is distinct. Provider refresh failure alone is not a stale condition.
             * @enum {string}
             */
            status: "CURRENT" | "STALE" | "UNAVAILABLE";
        };
        ForecastCoverage: {
            /**
             * Format: date-time
             * @description Exclusive UTC instant at the end of represented forecast coverage.
             */
            endAt: string;
            /** Format: date */
            localEndDate: string;
            /** Format: date */
            localStartDate: string;
            /**
             * Format: date-time
             * @description Inclusive UTC instant at the start of represented forecast coverage.
             */
            startAt: string;
        };
        /** @enum {string} */
        WeatherCondition: "CLEAR" | "PARTLY_CLOUDY" | "CLOUDY" | "FOG" | "RAIN" | "SNOW" | "THUNDERSTORM" | "WINDY" | "UNKNOWN";
        WeatherFieldOverviewPage: {
            items: components["schemas"]["FieldWeather"][];
            nextCursor: string | null;
        };
    };
    responses: {
        /** @description No current authorized Business membership or field scope. Does not reveal target existence. */
        Forbidden: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["ApiError"];
            };
        };
        /** @description The field identifier is malformed. */
        InvalidRequest: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["ApiError"];
            };
        };
        /** @description Field is unavailable in the caller's authorized Business scope. */
        NotFound: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["ApiError"];
            };
        };
        /** @description Authentication is missing or invalid. */
        Unauthorized: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["ApiError"];
            };
        };
        /** @description Unexpected API failure with the existing correlation request ID and stable machine-readable error code; server diagnostics are correlated and privacy-safe. */
        Unexpected: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["ApiError"];
            };
        };
    };
    parameters: {
        FieldId: string;
    };
    requestBodies: never;
    headers: never;
    pathItems: never;
};
export type $defs = Record<string, never>;
export interface operations {
    getFieldWeather: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                fieldId: components["parameters"]["FieldId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Current, stale, or unavailable weather context. Unavailable responses contain no weather values. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FieldWeather"];
                };
            };
            400: components["responses"]["InvalidRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            500: components["responses"]["Unexpected"];
        };
    };
    getWeatherFieldOverview: {
        parameters: {
            query?: {
                /** @description Opaque continuation token from the preceding page. */
                cursor?: string;
                /** @description Maximum summaries in this page. */
                limit?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A bounded page of current authorized field weather summaries, including unavailable fields. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WeatherFieldOverviewPage"];
                };
            };
            400: components["responses"]["InvalidRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            500: components["responses"]["Unexpected"];
        };
    };
}
