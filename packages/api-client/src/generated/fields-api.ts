export type paths = {
    "/fields": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List Fields in the authorized Business */
        get: operations["listFields"];
        put?: never;
        /** Create an additional Field */
        post: operations["createField"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/fields/{fieldId}": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                fieldId: string;
            };
            cookie?: never;
        };
        /** Get authorized Field detail */
        get: operations["getField"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Update supported current Field values */
        patch: operations["updateField"];
        trace?: never;
    };
};
export type webhooks = Record<string, never>;
export type components = {
    schemas: {
        ActiveSeasonSummary: {
            cropLabel?: string | null;
            id: string;
            /** Format: date */
            plantingDate?: string | null;
            /** @constant */
            status: "ACTIVE";
        };
        ApiError: {
            error: {
                /** @enum {string} */
                code: "INVALID_REQUEST" | "IDEMPOTENCY_KEY_REUSED" | "STALE_VERSION" | "UNAUTHORIZED" | "FORBIDDEN" | "NOT_FOUND" | "UNEXPECTED";
                message: string;
                requestId: string;
            };
        };
        FieldCreate: {
            location: components["schemas"]["FieldLocation"];
            /** @description Optional; omitted or blank/whitespace-only receives the first available Tarla N server label. A nonblank value is trimmed. A same-key exact retry returns the original result and never allocates another label. */
            name?: string | null;
        };
        FieldDetail: components["schemas"]["FieldListItem"] & {
            activeSeason: components["schemas"]["ActiveSeasonSummary"] | null;
            boundary: components["schemas"]["Polygon"] | null;
            regionContext: components["schemas"]["RegionContext"];
        };
        FieldListItem: {
            hasCurrentBoundary: boolean;
            id: string;
            name: string;
            representativePoint: components["schemas"]["Point"];
            version: number;
        };
        /** @description Existing Point/Polygon model; Polygon representative point is server-derived. */
        FieldLocation: {
            point: components["schemas"]["Point"];
            /** @constant */
            type: "POINT";
        } | {
            polygon: components["schemas"]["Polygon"];
            /** @constant */
            type: "POLYGON";
        };
        FieldPage: {
            items: components["schemas"]["FieldListItem"][];
            nextCursor: string | null;
        };
        FieldUpdate: {
            /** @description Set an explicit choice or clear it with null. Omission leaves it unchanged. */
            agriculturalRegionOverride?: components["schemas"]["RegionOverride"] | null;
            location?: components["schemas"]["FieldLocation"];
            /** @description Omission leaves the existing name unchanged. If supplied, the value must contain a non-whitespace character and is trimmed. Blank/whitespace-only values are invalid; updates never allocate or reset to a generated Tarla N name. */
            name?: string;
        };
        Point: {
            /** @description Longitude, latitude in EPSG:4326 order. */
            coordinates: [
                number,
                number
            ];
            /** @constant */
            type: "Point";
        };
        Polygon: {
            /** @description GeoJSON Polygon coordinates; server performs existing geometry validation. */
            coordinates: unknown[];
            /** @constant */
            type: "Polygon";
        };
        /** @description For legacy Fields with no persisted region-context pointer, the read model returns both suggestions as UNRESOLVED and agriculturalRegionOverride as null. This does not imply region absence in the real world. */
        RegionContext: {
            administrativeLocation: components["schemas"]["RegionSuggestion"];
            agriculturalRegion: components["schemas"]["RegionSuggestion"];
            agriculturalRegionOverride: components["schemas"]["RegionOverride"] | null;
        };
        RegionOverride: {
            code: string;
            label: string;
        };
        /** @description For RESOLVED, code, label, sourceId, confidence, dataVersion, and resolvedAt describe the accepted suggestion. For UNRESOLVED, suggestion values and resolvedAt are null. Confidence is the normalized quality/confidence value; dataVersion identifies the immutable source-data version. */
        RegionSuggestion: {
            code?: string | null;
            confidence?: number | null;
            dataVersion?: string | null;
            label?: string | null;
            /**
             * Format: date-time
             * @description Server UTC time when the resolver result was obtained and accepted; null when unresolved. This is not the source dataset publication date.
             */
            resolvedAt: string | null;
            sourceId?: string | null;
            /** @enum {string} */
            state: "RESOLVED" | "UNRESOLVED";
        };
    };
    responses: {
        /** @description Existing API HTTP 409 conflict semantics. For PATCH, a stale If-Match ETag is reported as STALE_VERSION; for create, this includes conflicting Idempotency-Key reuse. Clients must not infer a new status convention from this feature contract. */
        Conflict: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["ApiError"];
            };
        };
        /** @description Current membership/scope does not authorize this operation. For Field IDs, this does not disclose whether the Field exists. */
        Forbidden: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["ApiError"];
            };
        };
        /** @description Invalid request, location, cursor, or geometry. */
        InvalidRequest: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["ApiError"];
            };
        };
        /** @description The Field ID is absent from the currently authorized Business; absent and out-of-Business IDs have the same response. */
        NotFound: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["ApiError"];
            };
        };
        /** @description Authentication required or no longer valid. */
        Unauthorized: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["ApiError"];
            };
        };
    };
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
};
export type $defs = Record<string, never>;
export interface operations {
    listFields: {
        parameters: {
            query?: {
                /** @description Opaque keyset cursor for name ASC, id ASC ordering. */
                cursor?: string;
                limit?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Authorized Field page. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FieldPage"];
                };
            };
            400: components["responses"]["InvalidRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
        };
    };
    createField: {
        parameters: {
            query?: never;
            header: {
                /** @description Identifies an idempotent create command scoped to the authenticated user, server-resolved Business, and CREATE_FIELD command. Retry the exact same normalized payload and context with the same key to replay the canonical result; changed payload or authentication/Business/command context conflicts with IDEMPOTENCY_KEY_REUSED. A result is never replayed across contexts. */
                "Idempotency-Key": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["FieldCreate"];
            };
        };
        responses: {
            /** @description Canonical result replayed for the same authenticated user, Business, command, key, and normalized payload. */
            200: {
                headers: {
                    /** @description Quoted Field version. */
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FieldDetail"];
                };
            };
            /** @description Field accepted and created. */
            201: {
                headers: {
                    /** @description Quoted Field version. */
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FieldDetail"];
                };
            };
            400: components["responses"]["InvalidRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            409: components["responses"]["Conflict"];
        };
    };
    getField: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                fieldId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Field detail and optional read-only ACTIVE season summary. */
            200: {
                headers: {
                    /** @description Quoted Field version. */
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FieldDetail"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
        };
    };
    updateField: {
        parameters: {
            query?: never;
            header: {
                /** @description ETag returned by Field detail/create; stale versions conflict. */
                "If-Match": string;
            };
            path: {
                fieldId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["FieldUpdate"];
            };
        };
        responses: {
            /** @description Updated current Field state. */
            200: {
                headers: {
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FieldDetail"];
                };
            };
            400: components["responses"]["InvalidRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            /** @description Stale Field version reported as STALE_VERSION. The mobile client reads the latest Field and requires explicit farmer action before another mutation; no automatic overwrite, retry, merge, or rebase. */
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
