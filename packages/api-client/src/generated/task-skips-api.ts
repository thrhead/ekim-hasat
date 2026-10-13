export type paths = {
    "/fields/{fieldId}/task-history": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read completed and skipped task outcomes for an authorized Field
         * @description Returns a bounded chronological page of canonical completed and skipped task outcomes, optionally limited to a Season belonging to this Field and Business. Outcomes use a discriminator and never classify Skip as completion. Authorization is revalidated for every page. The existing completion-only endpoint remains available unchanged.
         */
        get: operations["getFieldTaskHistory"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/tasks/{taskId}/skips": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Skip one eligible unfinished task
         * @description Requires the current PlannedTask version in If-Match and a stable, client-generated skipId for exact retries. Current authorization is revalidated before replay. A new command is accepted only for an unfinished task in an ACTIVE Season with an APPROVED plan and activation snapshot. Skip is terminal and distinct from completion, deletion, cancellation and date adjustment. Canonical version increment and the append-only Skip record commit atomically. Completion, Skip and date adjustment are serialized on the same task row; the first committed incompatible outcome wins. No offline queue is supported.
         */
        post: operations["skipPlannedTask"];
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
                code: "INVALID_REQUEST" | "IDEMPOTENCY_KEY_REUSED" | "TASK_ALREADY_COMPLETED" | "TASK_ALREADY_SKIPPED" | "TASK_NOT_ACTIONABLE" | "TASK_VERSION_CONFLICT" | "UNAUTHORIZED" | "FORBIDDEN" | "NOT_FOUND" | "UNEXPECTED";
                message: string;
                requestId: string;
            };
        };
        SkipPlannedTaskRequest: {
            /**
             * Format: uuid
             * @description Stable client-generated identity for this online Skip and exact retries; not an offline queued command.
             */
            skipId: string;
        };
        TaskCompletionHistoryEntry: {
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
        TaskHistoryPage: {
            businessTimezone: string;
            items: (components["schemas"]["TaskCompletionHistoryEntry"] | components["schemas"]["TaskSkippedHistoryEntry"])[];
            nextCursor: string | null;
        };
        TaskSkip: {
            acceptedTaskVersion: number;
            baseTaskVersion: number;
            /** Format: uuid */
            fieldId: string;
            /**
             * Format: date
             * @description Current canonical date captured when Skip was accepted.
             */
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
            /** Format: uuid */
            taskId: string;
            taskTitle: string;
        };
        TaskSkippedHistoryEntry: {
            /** Format: uuid */
            fieldId: string;
            /**
             * Format: uuid
             * @description Stable event ID used for pagination.
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
            /** Format: date-time */
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
        /** @description No current authorized Business membership or task scope. */
        Forbidden: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["ApiError"];
            };
        };
        /** @description Invalid identifier, version, cursor, limit, or payload. */
        InvalidRequest: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["ApiError"];
            };
        };
        /** @description Field, Season, or task is unavailable in the authorized scope; foreign existence is not disclosed. */
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
        /** @description Unexpected failure. Retry only the exact Skip request with its original skipId and If-Match value. */
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
        /** @description Current PlannedTask.version from an authorized read; stale value returns 409. */
        ExpectedTaskVersion: string;
        FieldId: string;
        TaskId: string;
    };
    requestBodies: never;
    headers: never;
    pathItems: never;
};
export type $defs = Record<string, never>;
export interface operations {
    getFieldTaskHistory: {
        parameters: {
            query?: {
                cursor?: string;
                limit?: number;
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
            /** @description Bounded page in stable event-time, kind and event-ID order. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TaskHistoryPage"];
                };
            };
            400: components["responses"]["InvalidRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            500: components["responses"]["Unexpected"];
        };
    };
    skipPlannedTask: {
        parameters: {
            query?: never;
            header: {
                /** @description Current PlannedTask.version from an authorized read; stale value returns 409. */
                "If-Match": components["parameters"]["ExpectedTaskVersion"];
            };
            path: {
                taskId: components["parameters"]["TaskId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SkipPlannedTaskRequest"];
            };
        };
        responses: {
            /** @description Exact retry returned the original accepted Skip event. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TaskSkip"];
                };
            };
            /** @description Skip accepted and committed for the first time. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TaskSkip"];
                };
            };
            400: components["responses"]["InvalidRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            /** @description Task is completed/skipped/not actionable, version is stale, or skipId was reused with different input. No second terminal event is accepted and no stale command is reapplied. */
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
