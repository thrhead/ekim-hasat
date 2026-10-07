export type paths = {
    "/v1/calendar/reads": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Create one coherent, short-lived Calendar read */
        post: operations["createCalendarRead"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/calendar/reads/{readId}/pages": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Continue a task group from the same immutable Calendar read */
        get: operations["readCalendarPage"];
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
        CalendarRead: {
            activeSeasonExists: boolean;
            /**
             * Format: date-time
             * @description UTC statement-start time for the first statement establishing the PostgreSQL MVCC snapshot; Business-local today and an omitted selectedDate are derived from it.
             */
            asOf: string;
            /**
             * Format: uuid
             * @description Server-resolved Business identity for saved-data partitioning only; never an authorization input.
             */
            businessId: string;
            /** Format: date */
            businessLocalToday: string;
            /** @description Server-resolved Business timezone, using the existing Europe/Istanbul fallback when none is configured. */
            businessTimezone: string;
            /**
             * Format: date-time
             * @description Continuation expires 15 minutes after read creation; an already complete local saved view remains usable under SPEC-007 offline rules.
             */
            expiresAt: string;
            fieldScope: components["schemas"]["FieldScope"];
            /** @description Fact scoped to this Business and Field selection. */
            hasAnyUnfinishedWork: boolean;
            /** Format: date */
            monthEnd: string;
            /** @description One complete presence entry for every Business-local date in this month; this is not task-row coverage for dates other than selectedDate. */
            monthIndicators: {
                /** Format: date */
                date: string;
                hasWork: boolean;
                /** @description Optional exact count; presence semantics are required. */
                taskCount?: number;
            }[];
            /** @constant */
            monthIndicatorsComplete: true;
            /** Format: date */
            monthStart: string;
            overdueTasksPage: components["schemas"]["CalendarTaskPageFirst"];
            /** Format: uuid */
            readId: string;
            /**
             * Format: date
             * @description Resolved selected date; equals the validated supplied date or Business-local today when omitted.
             */
            selectedDate: string;
            selectedDateTasksPage: components["schemas"]["CalendarTaskPageFirst"];
        };
        CalendarReadScope: {
            /**
             * Format: date-time
             * @description UTC statement-start time for the first statement establishing the PostgreSQL MVCC snapshot.
             */
            asOf: string;
            /**
             * Format: uuid
             * @description Server-resolved scope identity
             */
            businessId: string;
            /** Format: date */
            businessLocalToday: string;
            /** @description Server-resolved Business timezone, using the existing Europe/Istanbul fallback when none is configured. */
            businessTimezone: string;
            fieldScope: components["schemas"]["FieldScope"];
            /** Format: date */
            monthEnd: string;
            /** Format: date */
            monthStart: string;
            /**
             * Format: date
             * @description Resolved date bound to this Calendar read identity.
             */
            selectedDate: string;
        };
        CalendarTask: {
            /** Format: uuid */
            fieldId: string;
            fieldName: string;
            /** @description Derived as of this read's Business-local today; never changes plannedLocalDate. */
            overdue: boolean;
            planContext?: string;
            /** Format: date */
            plannedLocalDate: string;
            seasonContext?: string;
            /** Format: uuid */
            seasonId: string;
            /** Format: uuid */
            taskId: string;
            taskVersion?: number;
            title: string;
        };
        CalendarTaskPage: components["schemas"]["CalendarTaskPageFirst"] & {
            /** @description Echo of the cursor consumed by this response */
            requestedCursor: string;
        };
        CalendarTaskPageFirst: {
            /** @description True only when this group has no later page in this immutable read. Selected-date tasks exclude overdue rows */
            complete: boolean;
            /** @enum {string} */
            group: "selectedDateTasks" | "overdueTasks";
            items: components["schemas"]["CalendarTask"][];
            /** @description Random server-issued continuation token for this read/group; absent when complete. */
            nextCursor?: string;
            /** Format: uuid */
            readId: string;
            readScope: components["schemas"]["CalendarReadScope"];
        };
        FieldScope: {
            /** Format: uuid */
            fieldId?: string;
            /** @description Exact Fields in this read; presence never grants current access. */
            includedFieldIds: string[];
            /** @enum {string} */
            mode: "allAuthorized" | "oneField";
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
    createCalendarRead: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /**
                     * Format: uuid
                     * @description Optional Field narrowing; validated within server-resolved authorized Business scope.
                     */
                    fieldId?: string;
                    /**
                     * Format: date
                     * @description Optional explicit Business-local ISO date (YYYY-MM-DD). When omitted, the server derives current Business-local today from its clock after resolving current Membership, authorized Business, and Business timezone. If no Business timezone is configured, the server uses the existing Europe/Istanbul fallback. Device timezone is never authoritative.
                     */
                    selectedDate?: string;
                };
            };
        };
        responses: {
            /** @description One immutable point-in-time read. When selectedDate is omitted, the server resolves it to current Business-local today. The resolved selectedDate is returned explicitly. Month indicators and first pages come from the same PostgreSQL repeatable-read transaction. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CalendarRead"];
                };
            };
            /** @description Invalid selected date or Field ID. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Authentication required; saved fallback is prohibited. */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Explicit access denial; saved fallback is prohibited. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Field is absent from the authorized Business scope. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    readCalendarPage: {
        parameters: {
            query: {
                /** @description Random server-issued continuation token recorded for this read and group; unissued and cross-group tokens are rejected. */
                cursor: string;
                group: "selectedDateTasks" | "overdueTasks";
            };
            header?: never;
            path: {
                /** @description Server-generated opaque lookup ID; never a bearer credential. */
                readId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Immutable page from the specified read identity. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CalendarTaskPage"];
                };
            };
            /** @description Invalid or unissued cursor/group. No page data is returned. */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Authentication required; saved fallback is prohibited. */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Current membership or Field authorization is denied; saved fallback is prohibited. */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Read ID is unknown or does not belong to the authenticated scope. */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Read snapshot expired or invalidated; discard staged pages and create a new read. */
            410: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
}
