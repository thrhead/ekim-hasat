export type paths = {
    "/tasks/{taskId}/date-adjustments": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read current task date and its accepted adjustment history
         * @description Returns current canonical task date/version and a bounded page of accepted adjustments after current authorization is checked. This task-scoped read is separate from Diary and completion history. A completed task may retain readable adjustment history but is not adjustable.
         */
        get: operations["getPlannedTaskAdjustmentHistory"];
        put?: never;
        /**
         * Change one unfinished ACTIVE-season task's planned date
         * @description Requires the current task version in If-Match and a stable adjustmentId for exact retries. Current authorization is revalidated before resolving accepted retries. Exact accepted retries replay before live eligibility and version checks; new commands validate eligibility and If-Match before checking for NO_DATE_CHANGE. Accepts only a currently authorized task in an ACTIVE Season with an APPROVED plan and no accepted completion. Canonical task update and append-only adjustment record commit atomically. No offline queue is supported.
         */
        post: operations["adjustPlannedTaskDate"];
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
        AdjustPlannedTaskDateRequest: {
            /**
             * Format: uuid
             * @description Stable client-generated identity for this accepted command and exact online retries; not an offline queued command.
             */
            adjustmentId: string;
            /**
             * Format: date
             * @description Business-local calendar date on or after actual planting date.
             */
            newPlannedLocalDate: string;
        };
        ApiError: {
            error: {
                /** @enum {string} */
                code: "INVALID_REQUEST" | "NO_DATE_CHANGE" | "IDEMPOTENCY_KEY_REUSED" | "TASK_VERSION_CONFLICT" | "TASK_ALREADY_COMPLETED" | "TASK_NOT_ACTIONABLE" | "UNAUTHORIZED" | "FORBIDDEN" | "NOT_FOUND" | "UNEXPECTED";
                message: string;
                requestId: string;
            };
        };
        CurrentTaskAdjustmentState: {
            /** @description True only for an unfinished task in an ACTIVE Season with an APPROVED plan. */
            adjustable: boolean;
            /**
             * Format: date
             * @description Current canonical date.
             */
            plannedLocalDate: string;
            /** Format: uuid */
            taskId: string;
            taskVersion: number;
        };
        InvalidRequestError: {
            error: {
                /** @constant */
                code: "INVALID_REQUEST";
                message: string;
                requestId: string;
            };
        };
        NoDateChangeError: {
            error: {
                /** @constant */
                code: "NO_DATE_CHANGE";
                message: string;
                requestId: string;
            };
        };
        TaskDateAdjustment: {
            acceptedTaskVersion: number;
            /**
             * Format: date-time
             * @description Server acceptance timestamp in UTC.
             */
            adjustedAt: string;
            /** Format: uuid */
            adjustmentId: string;
            baseTaskVersion: number;
            /** Format: date */
            newPlannedLocalDate: string;
            /** Format: date */
            previousPlannedLocalDate: string;
            /** Format: uuid */
            taskId: string;
        };
        TaskDateAdjustmentHistoryItem: {
            /** Format: date-time */
            adjustedAt: string;
            /** Format: uuid */
            adjustmentId: string;
            /** Format: date */
            newPlannedLocalDate: string;
            /** Format: date */
            previousPlannedLocalDate: string;
        };
        TaskDateAdjustmentHistoryPage: {
            items: components["schemas"]["TaskDateAdjustmentHistoryItem"][];
            nextCursor: string | null;
            task: components["schemas"]["CurrentTaskAdjustmentState"];
        };
    };
    responses: {
        /** @description Invalid request shape uses INVALID_REQUEST. A new adjustment command requesting the current canonical date returns NO_DATE_CHANGE only after authorization, eligibility, and If-Match validation. That outcome creates no state, version, history, or accepted idempotency receipt. Exact replay of a previously accepted adjustment is handled before live eligibility/version validation and does not return NO_DATE_CHANGE only because the task version later advanced. */
        AdjustmentValidationError: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["InvalidRequestError"] | components["schemas"]["NoDateChangeError"];
            };
        };
        /** @description No current authorized Business Membership/scope. */
        Forbidden: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["ApiError"];
            };
        };
        /** @description Malformed task ID, version, date, cursor, or limit. */
        InvalidRequest: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["ApiError"];
            };
        };
        /** @description Task is unavailable in the authorized Business scope. */
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
        /** @description Unexpected failure. Retry only the exact request with its original adjustmentId and If-Match value. */
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
        TaskId: string;
    };
    requestBodies: never;
    headers: never;
    pathItems: never;
};
export type $defs = Record<string, never>;
export interface operations {
    getPlannedTaskAdjustmentHistory: {
        parameters: {
            query?: {
                cursor?: string;
                limit?: number;
            };
            header?: never;
            path: {
                taskId: components["parameters"]["TaskId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Current task state and one history page, newest adjustment first. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TaskDateAdjustmentHistoryPage"];
                };
            };
            400: components["responses"]["InvalidRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            500: components["responses"]["Unexpected"];
        };
    };
    adjustPlannedTaskDate: {
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
                "application/json": components["schemas"]["AdjustPlannedTaskDateRequest"];
            };
        };
        responses: {
            /** @description Exact retry returned the original accepted adjustment; reload task detail for current canonical state. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TaskDateAdjustment"];
                };
            };
            /** @description Accepted and committed for the first time. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TaskDateAdjustment"];
                };
            };
            400: components["responses"]["AdjustmentValidationError"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            /** @description Stale task version, task no longer adjustable, task already completed, or adjustmentId reused with different input. No stale date is automatically reapplied. */
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
