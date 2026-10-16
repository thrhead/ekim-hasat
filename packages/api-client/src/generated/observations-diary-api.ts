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
         * @description Returns a unified projection of canonical accepted observations, task completions, task skips, and opt-in record types. Irrigation history is included only when includeIrrigation=true. Expense history is included only when includeExpenses=true and is available to the current Business OWNER. Field scope includes observations with and without a Season association. A seasonId filter includes only that Season's records and is validated against the authorized Field and Business. The default projection and version-1 cursor behavior remain unchanged when includeExpenses=false. Expense-enabled requests use a version-2 cursor with a date-only mixed ordering key bound to Field, Season, both include flags, and resolved Business timezone; V2 cursors cannot be reused with the default projection. For V2, Business-local calendar day sorts descending; within each day timed events sort by instant descending, kind ascending, and source UUID descending; date-only Expenses follow timed events and sort by Expense UUID descending. Expense dates are never represented as timestamps. Each continuation queries strictly after its global tuple. Returned records do not repeat; this is keyset pagination, not snapshot isolation.
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
            /** @description Optional offline-capture precondition. On first acceptance the server requires this saved Business timezone to equal the current authoritative Business timezone. An already accepted exact replay remains valid under current authorization after a later timezone change. Omission preserves older online-client behavior. */
            capturedBusinessTimezone?: string;
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
            items: (components["schemas"]["ObservationDiaryEntry"] | components["schemas"]["IrrigationDiaryEntry"] | components["schemas"]["TaskCompletionDiaryEntry"] | components["schemas"]["TaskSkippedDiaryEntry"] | components["schemas"]["ExpenseDiaryEntry"])[];
            nextCursor: string | null;
        };
        /** @description Projection of an accepted immutable Expense. expenseDate is a calendar date only; no time-of-day is known or implied. */
        ExpenseDiaryEntry: {
            /** @description Exact decimal amount. */
            amount: string;
            /** @enum {string} */
            category: "SEED_SEEDLING" | "FERTILIZER" | "PESTICIDE" | "FUEL" | "LABOR" | "IRRIGATION" | "OTHER";
            currency: string;
            /** Format: date */
            expenseDate: string;
            /** Format: uuid */
            fieldId: string;
            /**
             * Format: uuid
             * @description Stable Expense ID used for ordering and pagination.
             */
            id: string;
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            kind: "EXPENSE";
            note: string | null;
            /** Format: uuid */
            seasonId: string | null;
        };
        /** @description Projection of an accepted IrrigationRecord; it retains its own identity and is not an observation. */
        IrrigationDiaryEntry: {
            businessTimezone: string;
            durationMinutes: number | null;
            /** Format: uuid */
            fieldId: string;
            /**
             * Format: uuid
             * @description Stable irrigation record ID used for ordering and pagination.
             */
            id: string;
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            kind: "IRRIGATION";
            method: string | null;
            note: string | null;
            /** Format: date-time */
            occurredAt: string;
            /** Format: date-time */
            recordedAt: string;
            /** Format: uuid */
            seasonId: string | null;
            waterVolumeCubicMetres: string | null;
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
        /** @description Projection of an existing accepted SPEC-009 TaskSkip; no duplicate diary record is persisted. */
        TaskSkippedDiaryEntry: {
            /** Format: uuid */
            fieldId: string;
            /**
             * Format: uuid
             * @description Stable event ID used for ordering and pagination.
             */
            id: string;
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            kind: "TASK_SKIPPED";
            /** Format: date */
            plannedLocalDate: string;
            /** Format: uuid */
            seasonId: string;
            /** Format: uuid */
            skipId: string;
            /**
             * Format: date-time
             * @description Server acceptance time in UTC.
             */
            skippedAt: string;
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
                /** @description Include date-only EXPENSE entries. Requires current OWNER finance visibility. Uses V2 cursor semantics; omit or set false for the existing V1 projection. */
                includeExpenses?: boolean;
                /** @description Include accepted irrigation records as distinct IRRIGATION diary entries. */
                includeIrrigation?: boolean;
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
