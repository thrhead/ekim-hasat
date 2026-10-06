export type paths = {
    "/fields/{fieldId}/diary": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read an authorized Field or Season diary page
         * @description Returns a unified projection of canonical accepted observations and existing accepted task completions. Field scope includes observations with and without a Season association. A seasonId filter includes only that Season's observations and completions and is validated against the authorized Field and Business. Deterministic keyset order is occurredAt DESC, kind ASC, source UUID DESC. The cursor binds to authorized Field, optional Season, and the last returned tuple; each continuation queries strictly after it in this global order. Returned records do not repeat and inserts do not permanently skip pre-existing eligible rows. A newly inserted record sorting before the consumed cursor is not injected into that traversal and appears on fresh traversal/refresh; one sorting after it may appear on a later page. This is not snapshot-isolated pagination and has no fixed-snapshot guarantee. Ordering keys remain immutable for supported diary sources.
         */
        get: operations["getFieldDiary"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/fields/{fieldId}/observations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Create an observation for an authorized field
         * @description Requires a committed online request. The API resolves Business and active Membership from authentication; no Business identifier is accepted. Before domain validation and persistence, the server trims leading/trailing Unicode whitespace and requires the canonical description to contain 1..2000 Unicode code points (not UTF-8 bytes or UTF-16 code units); it preserves internal whitespace/content and applies no unrelated Unicode normalization. Server validation is authoritative. Reusing observationId with the same canonical payload, actor, and currently authorized Field/Season context converges on one row: the successful insert returns 201 and an exact replay, including a concurrent losing request after the row exists, returns 200 with that row. Changed canonical payload, actor, or authorized context returns structured 409. A supplied seasonId must belong to this field and Business.
         */
        post: operations["createFieldObservation"];
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
                code: "INVALID_REQUEST" | "IDEMPOTENCY_KEY_REUSED" | "UNAUTHORIZED" | "FORBIDDEN" | "NOT_FOUND" | "UNEXPECTED";
                message: string;
                requestId: string;
            };
        };
        CreateObservationRequest: {
            /** @description Raw submitted text. The server trims leading/trailing Unicode whitespace before validating and persisting; canonical description must contain 1..2000 Unicode code points, not UTF-8 bytes or UTF-16 code units. No unrelated Unicode normalization or internal whitespace/content modification is performed. Do not apply maxLength to the untrimmed raw string; server validation is authoritative and mobile may mirror it for UX. */
            description: string;
            /**
             * Format: uuid
             * @description Stable client-generated identity for the observation and its exact retry.
             */
            observationId: string;
            /**
             * Format: date-time
             * @description Offset-aware RFC 3339 absolute instant corresponding to occurredAtLocal. The API verifies the local value has exactly one valid mapping and that it matches this instant; future instants are rejected. Server acceptance time is separate.
             */
            occurredAt: string;
            /** @description Farmer-entered local date/time without an offset, serialized as YYYY-MM-DDTHH:mm with optional seconds/fraction. The API interprets this value in the authorized Business timezone, or Europe/Istanbul if not configured; device timezone is never authoritative. Nonexistent or ambiguous local values return structured 400 INVALID_REQUEST. */
            occurredAtLocal: string;
            /**
             * Format: uuid
             * @description Optional Season association; must belong to this Field and authorized Business.
             */
            seasonId?: string;
        };
        DiaryPage: {
            businessTimezone: string;
            items: (components["schemas"]["ObservationDiaryEntry"] | components["schemas"]["TaskCompletionDiaryEntry"])[];
            nextCursor: string | null;
        };
        Observation: {
            /** @description Resolved authorized Business timezone used for display. */
            businessTimezone: string;
            description: string;
            /** Format: uuid */
            fieldId: string;
            /** Format: uuid */
            id: string;
            /**
             * Format: date-time
             * @description Original absolute occurrence instant.
             */
            occurredAt: string;
            /** Format: uuid */
            seasonId: string | null;
        };
        ObservationDiaryEntry: {
            description: string;
            /** Format: uuid */
            fieldId: string;
            /** Format: uuid */
            id: string;
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            kind: "OBSERVATION";
            /** Format: date-time */
            occurredAt: string;
            /** Format: uuid */
            seasonId: string | null;
        };
        /** @description Projection of an existing accepted SPEC-003 TaskCompletion; no duplicate diary record is persisted. */
        TaskCompletionDiaryEntry: {
            /** Format: uuid */
            fieldId: string;
            /** Format: uuid */
            id: string;
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            kind: "TASK_COMPLETION";
            /** Format: date-time */
            occurredAt: string;
            /** Format: date */
            plannedLocalDate: string;
            /** Format: uuid */
            seasonId: string;
            /** @enum {string} */
            sourceKind: "MANUAL" | "VALIDATED_TEMPLATE";
            /** Format: uuid */
            taskId: string;
            /** Format: uuid */
            templateVersionId: string | null;
            title: string;
        };
    };
    responses: {
        /** @description No current authorized Business scope. Does not disclose whether a requested Field, Season, or observation exists outside that scope. */
        Forbidden: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["ApiError"];
            };
        };
        /** @description Invalid identifier, payload, canonical description, timestamp, local-time mapping (including DST gaps/folds), limit, or cursor. Returns the shared structured `INVALID_REQUEST` ApiError. */
        InvalidRequest: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["ApiError"];
            };
        };
        /** @description Field, Season, or observation is absent from the authorized scope; absent and cross-Business resources have the same response. */
        NotFound: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["ApiError"];
            };
        };
        /** @description Authentication required or invalid. */
        Unauthorized: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["ApiError"];
            };
        };
        /** @description Unexpected server error. Returns only the safe generic UNEXPECTED presentation and requestId; internal details are not exposed. */
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
    getFieldDiary: {
        parameters: {
            query?: {
                /** @description Opaque continuation token returned by the prior page. */
                cursor?: string;
                limit?: number;
                /** @description Limit entries to this Season belonging to the requested authorized Field. */
                seasonId?: string;
            };
            header?: never;
            path: {
                fieldId: components["parameters"]["FieldId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Bounded page of diary entries in deterministic occurrence order */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DiaryPage"];
                };
            };
            400: components["responses"]["InvalidRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            500: components["responses"]["Unexpected"];
        };
    };
    createFieldObservation: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                fieldId: components["parameters"]["FieldId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateObservationRequest"];
            };
        };
        responses: {
            /** @description Exact retry replayed the previously committed observation */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Observation"];
                };
            };
            /** @description Observation accepted and committed */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Observation"];
                };
            };
            400: components["responses"]["InvalidRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            /** @description Observation identity exists with changed canonical payload, actor, or authorized context */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            500: components["responses"]["Unexpected"];
        };
    };
}
