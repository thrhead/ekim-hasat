export type paths = {
    "/fields/{fieldId}/irrigation-records": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Record irrigation for an authorized Field
         * @description The API resolves the active Membership and Business from authentication and validates the required Field and optional same-Field, same-Business Season. Business identity is never accepted from the request. An exact retry replays only for the same actor under current authorization; reusing the identity with a different actor, payload, Field, or Season returns 409. The server resolves occurredAtLocal in the current Business timezone, or Europe/Istanbul when unset, and requires it to map uniquely to occurredAt. Future, ambiguous, nonexistent, or mismatched local times are rejected. Reusing irrigationRecordId with the exact same payload and currently authorized context replays the accepted record; changed payload or context returns 409. This endpoint does not queue offline work.
         */
        post: operations["createIrrigationRecord"];
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
                /** @enum {string} */
                code: "INVALID_REQUEST" | "UNAUTHORIZED" | "FORBIDDEN" | "NOT_FOUND" | "IDEMPOTENCY_KEY_REUSED" | "UNEXPECTED";
                message: string;
                requestId: string;
            };
        };
        CreateIrrigationRecordRequest: {
            /** @description Business timezone used to compose occurredAtLocal and occurredAt; it must match the current server-resolved timezone. */
            capturedBusinessTimezone: string;
            /** @description Optional positive duration in whole minutes. */
            durationMinutes?: number;
            /**
             * Format: uuid
             * @description Stable identity for this online create attempt and exact retry.
             */
            irrigationRecordId: string;
            /** @description Optional farmer-entered irrigation method; no catalog is used. */
            method?: string;
            /** @description Optional farmer note, trimmed and limited to the existing observation text length. */
            note?: string;
            /**
             * Format: date-time
             * @description Absolute instant corresponding to occurredAtLocal; validated by the server.
             */
            occurredAt: string;
            /** @description Farmer-entered local date/time without a timezone offset, defaulted to now in Business time. */
            occurredAtLocal: string;
            /**
             * Format: uuid
             * @description Optional Season; it must belong to the path Field and authorized Business.
             */
            seasonId?: string;
            /** @description Optional positive water volume in cubic metres, with at most one decimal place and at most 11 integer digits; transmitted as a decimal string. */
            waterVolumeCubicMetres?: string;
        };
        IrrigationRecord: {
            /** @description Authorized Business timezone used to display occurredAt. */
            businessTimezone: string;
            /** @description Optional positive duration in whole minutes. */
            durationMinutes: number | null;
            /** Format: uuid */
            fieldId: string;
            /** Format: uuid */
            id: string;
            method: string | null;
            note: string | null;
            /**
             * Format: date-time
             * @description Original absolute occurrence instant.
             */
            occurredAt: string;
            /**
             * Format: date-time
             * @description Server UTC time when the record was accepted.
             */
            recordedAt: string;
            /** Format: uuid */
            seasonId: string | null;
            /** @description Optional positive cubic-metre volume with at most one decimal place, transmitted as a decimal string. */
            waterVolumeCubicMetres: string | null;
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
};
export type $defs = Record<string, never>;
export interface operations {
    createIrrigationRecord: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                fieldId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateIrrigationRecordRequest"];
            };
        };
        responses: {
            /** @description Unexpected server failure */
            "5XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Exact retry replayed the previously accepted record */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["IrrigationRecord"];
                };
            };
            /** @description Irrigation record accepted and committed */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["IrrigationRecord"];
                };
            };
            /** @description Invalid payload, association, or occurrence time */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Authentication is missing or invalid */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The current membership does not authorize this operation */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The Field or optional Season is unavailable in this authorized context */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Record identity was reused with a changed payload or context */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
}
