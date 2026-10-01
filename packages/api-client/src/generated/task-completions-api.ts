export type paths = {
    "/fields/{fieldId}/task-completions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read accepted task completions for an authorized field
         * @description This bounded history contains accepted task completions only. Results are ordered by occurredAt DESC, completionId DESC. The default page size is 50 and the maximum is 100. Farmer-facing items distinguish planned date from actual occurrence, with occurredAt rendered in the authorized Business timezone. recordedAt is persisted server audit/synchronization metadata and is not required in this normal history response; actor attribution is also excluded. A seasonId filter provides the season-specific view. Pending and conflicted device-local commands are not reported as server-accepted history.
         */
        get: operations["getFieldTaskCompletionHistory"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/tasks/{taskId}/completions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Record completion of one actionable task
         * @description The client creates and durably retains completionId and occurredAt before sending. A successful replay requires the same completionId and command payload, the same authenticated actor, and currently authorized task/business context; it returns the original committed completion. A different actor is not given another actor's completion as a replay and receives the already-completed/competing-completion conflict without disclosing the record outside authorized scope. The server resolves business and Membership from authentication and never trusts a client business identifier.
         */
        post: operations["completePlannedTask"];
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
                code: "INVALID_REQUEST" | "IDEMPOTENCY_KEY_REUSED" | "TASK_VERSION_CONFLICT" | "TASK_ALREADY_COMPLETED" | "TASK_NOT_ACTIONABLE" | "UNAUTHORIZED" | "FORBIDDEN" | "NOT_FOUND" | "UNEXPECTED";
                message: string;
                requestId: string;
            };
        };
        CompleteTaskRequest: {
            /**
             * Format: uuid
             * @description Stable client-generated identifier for this completion action and its idempotent retry identity.
             */
            completionId: string;
            /**
             * Format: date-time
             * @description Absolute instant when the farmer recorded the work as done. Captured on the device at the action, including offline; server recording time is separate.
             */
            occurredAt: string;
        };
        Forbidden: {
            error: Record<string, never>;
        };
        InvalidRequest: {
            error: Record<string, never>;
        };
        NotFound: {
            error: Record<string, never>;
        };
        /** @description Farmer-facing accepted completion representation. recordedAt and actor identity remain server-side persisted metadata and are not included in this response. */
        TaskCompletion: {
            /** @description Resolved authorized Business timezone used to render the occurrence. */
            businessTimezone: string;
            /** Format: uuid */
            fieldId: string;
            /**
             * Format: uuid
             * @description Same stable identity as request completionId.
             */
            id: string;
            /**
             * Format: date-time
             * @description Original absolute occurrence instant; never replaced by sync time.
             */
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
            templateVersionId?: string | null;
            title: string;
        };
        TaskCompletionHistoryPage: {
            /** @description Resolved authorized Business timezone for farmer-facing occurrence rendering. */
            businessTimezone: string;
            items: components["schemas"]["TaskCompletion"][];
            /** @description Null when there are no more results. */
            nextCursor: string | null;
        };
        Unauthorized: {
            error: Record<string, never>;
        };
        Unexpected: {
            error: Record<string, never>;
        };
    };
    responses: {
        /** @description No current authorized Business Membership/scope. Does not reveal target record existence. */
        Forbidden: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["ApiError"];
            };
        };
        /** @description Malformed identifier, timestamp, version, or history cursor. */
        InvalidRequest: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["ApiError"];
            };
        };
        /** @description Target task or field is unavailable in the authorized Business scope. */
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
        /** @description Unexpected failure; a retry uses the exact same completionId and payload. */
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
        /** @description Version of the planned task cached from the authorized Today response. Stale version returns 409 and never overwrites server state. */
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
    getFieldTaskCompletionHistory: {
        parameters: {
            query?: {
                /** @description Opaque continuation token from the prior page. */
                cursor?: string;
                limit?: number;
                /** @description Limit results to a season belonging to this authorized field. */
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
            /** @description A page of accepted completions ordered by occurredAt DESC, completionId DESC. Items include plannedLocalDate and occurredAt; recordedAt and actor identity are intentionally omitted from the farmer-facing representation. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TaskCompletionHistoryPage"];
                };
            };
            400: components["responses"]["InvalidRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            500: components["responses"]["Unexpected"];
        };
    };
    completePlannedTask: {
        parameters: {
            query?: never;
            header: {
                /** @description Version of the planned task cached from the authorized Today response. Stale version returns 409 and never overwrites server state. */
                "If-Match": components["parameters"]["ExpectedTaskVersion"];
            };
            path: {
                taskId: components["parameters"]["TaskId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CompleteTaskRequest"];
            };
        };
        responses: {
            /** @description Exact retry by the same authenticated actor in the same currently authorized task/business context replayed the original committed completion */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TaskCompletion"];
                };
            };
            /** @description Completion accepted and committed for the first time */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TaskCompletion"];
                };
            };
            400: components["responses"]["InvalidRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            /** @description Completion ID reused with changed command data or a different actor, stale task version, task already completed by another command (including another actor), or task/season no longer actionable. Such attempts are conflicts, never another actor's successful replay; no completion details outside authorized scope are disclosed, and no conflicting intent is silently accepted or overwritten. */
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
