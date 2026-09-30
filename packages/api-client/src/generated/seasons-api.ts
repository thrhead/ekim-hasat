export type paths = {
    "/fields/{fieldId}/season-setup-options": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List crop choices and template availability for an authorized field */
        get: operations["getSeasonSetupOptions"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/fields/{fieldId}/seasons": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Create or recover the logical season draft and its template-backed or manual plan */
        post: operations["createSeasonDraft"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/seasons/{seasonId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Read a draft or active season in the authorized business scope */
        get: operations["getSeasonSetup"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/seasons/{seasonId}/activate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Approve the current draft plan and activate the season */
        post: operations["activateSeason"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/seasons/{seasonId}/plan-tasks": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Add a task to a draft season plan */
        post: operations["addSeasonPlanTask"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/seasons/{seasonId}/plan-tasks/{taskId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Remove a task from a draft plan */
        delete: operations["removeSeasonPlanTask"];
        options?: never;
        head?: never;
        /** Edit a task's title or planned date in a draft plan */
        patch: operations["editSeasonPlanTask"];
        trace?: never;
    };
    "/today": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Read the authorized business's planned work for its current local day across its fields */
        get: operations["getTodayPlannedTasks"];
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
        ActiveSeason: components["schemas"]["SeasonRecord"] & {
            /** Format: date-time */
            activatedAt: string;
            /** @constant */
            status: "ACTIVE";
        };
        ApiError: {
            error: {
                /** @enum {string} */
                code: "INVALID_REQUEST" | "SEASON_DATE_IN_FUTURE" | "TASK_BEFORE_SEASON_DATE" | "IDEMPOTENCY_KEY_REUSED" | "STALE_VERSION" | "SEASON_STATE_CONFLICT" | "PLAN_HAS_NO_VALID_TASKS" | "MANUAL_PLAN_CHOICE_REQUIRED" | "UNAUTHORIZED" | "FORBIDDEN" | "NOT_FOUND" | "UNEXPECTED";
                message: string;
                requestId: string;
            };
        };
        CreateSeasonDraftRequest: {
            crop: components["schemas"]["CropSelection"];
            /**
             * @description Explicit farmer choice to continue manually when no usable applicable validated template exists, including NOT_APPLICABLE and EMPTY_TASK_DEFINITIONS. This choice is required before manual draft creation in those cases. If an applicable nonempty template exists, omit this field and the server selects it; the client cannot select a template version.
             * @enum {string}
             */
            planSource?: "MANUAL";
            /**
             * Format: date
             * @description Actual planting local date; today or any past date is valid without a lookback limit. Future dates are rejected.
             */
            sowingPlantingDate: string;
        };
        CropChoice: {
            displayName: string;
            /** Format: uuid */
            id: string;
            /** @description True only when no usable applicable validated template exists (NOT_APPLICABLE or EMPTY_TASK_DEFINITIONS); false when a nonempty applicable validated template must be used. */
            manualPlanAllowed: boolean;
            /** @enum {string} */
            source: "CENTRAL";
            /**
             * @description EMPTY_TASK_DEFINITIONS means the applicable published version contains no tasks; it is unavailable for generation and requires an explicit manual-plan choice.
             * @enum {string}
             */
            templateAvailability: "AVAILABLE" | "NOT_APPLICABLE" | "EMPTY_TASK_DEFINITIONS";
        };
        CropSelection: {
            /** Format: uuid */
            centralCropId: string;
        } | {
            customCropName: string;
        };
        EditPlanTaskRequest: {
            description?: string;
            /**
             * Format: date
             * @description Local calendar date on or after the season's actual sowing/planting date; equality is allowed.
             */
            plannedLocalDate?: string;
            title?: string;
        };
        PlanSource: {
            /** @enum {string} */
            kind: "VALIDATED_TEMPLATE" | "MANUAL";
            /** Format: uuid */
            templateVersionId?: string | null;
            /** @enum {string} */
            validationLabel: "CENTRALLY_VALIDATED" | "NOT_CENTRALLY_VALIDATED";
        };
        PlanTask: components["schemas"]["PlanTaskInput"] & {
            /** Format: uuid */
            id: string;
            version: number;
        };
        PlanTaskInput: {
            description?: string;
            /**
             * Format: date
             * @description Local calendar date on or after the season's actual sowing/planting date; equality is allowed.
             */
            plannedLocalDate: string;
            title: string;
        };
        SeasonDraft: components["schemas"]["SeasonRecord"] & {
            /** @constant */
            status: "DRAFT";
        };
        SeasonRecord: {
            cropDisplayName: string;
            /** Format: uuid */
            fieldId: string;
            /** Format: uuid */
            id: string;
            plan: {
                source: components["schemas"]["PlanSource"];
                tasks: components["schemas"]["PlanTask"][];
            };
            /** Format: date */
            sowingPlantingDate: string;
            /** @enum {string} */
            status: "DRAFT" | "ACTIVE";
            version: number;
        };
        TodayPlannedTask: {
            cropDisplayName: string;
            /** Format: uuid */
            fieldId: string;
            /** Format: uuid */
            id: string;
            /** Format: date */
            plannedLocalDate: string;
            /** Format: uuid */
            seasonId: string;
            /** @enum {string} */
            sourceKind?: "VALIDATED_TEMPLATE" | "MANUAL";
            /** @description Base version for a completion command; additive for older clients. */
            taskVersion: number;
            title: string;
        };
    };
    responses: {
        /** @description Idempotency payload/version mismatch, stale version, DRAFT-only mutation against ACTIVE, activation state conflict, or explicit manual-plan choice required for an empty published template */
        Conflict: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["ApiError"];
            };
        };
        /** @description Scope is not authorized; response does not disclose record existence */
        Forbidden: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["ApiError"];
            };
        };
        /** @description Invalid input, future actual sowing/planting date, planned task before the season date, or invalid title */
        InvalidRequest: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["ApiError"];
            };
        };
        /** @description Resource is unavailable or not visible in the authorized scope */
        NotFound: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["ApiError"];
            };
        };
        /** @description Authentication is missing or invalid */
        Unauthorized: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["ApiError"];
            };
        };
        /** @description Unexpected server failure with a stable privacy-safe error */
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
        /** @description ETag/version returned with the draft; stale writes return 409. */
        ExpectedVersion: string;
        FieldId: string;
        /** @description Identifies an idempotent command execution. After a lost response or app restart, the client retries the exact same command with the same key; reusing a key with a different payload or version conflicts. For season creation and activation, the client durably retains the unresolved command until it records the successful result. */
        IdempotencyKey: string;
        SeasonId: string;
        TaskId: string;
    };
    requestBodies: never;
    headers: never;
    pathItems: never;
};
export type $defs = Record<string, never>;
export interface operations {
    getSeasonSetupOptions: {
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
            /** @description Available central crops and validated-template availability for this field. An applicable published template with zero definitions is reported as empty/unavailable and diagnosed as a content-quality issue. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        crops: components["schemas"]["CropChoice"][];
                        /** @constant */
                        customCropAllowed: true;
                        /** Format: uuid */
                        fieldId: string;
                    };
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            500: components["responses"]["Unexpected"];
        };
    };
    createSeasonDraft: {
        parameters: {
            query?: never;
            header: {
                /** @description Identifies an idempotent command execution. After a lost response or app restart, the client retries the exact same command with the same key; reusing a key with a different payload or version conflicts. For season creation and activation, the client durably retains the unresolved command until it records the successful result. */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path: {
                fieldId: components["parameters"]["FieldId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateSeasonDraftRequest"];
            };
        };
        responses: {
            /** @description Existing result replayed for the same idempotency key and request, or unchanged existing season returned for a matching authorized business/field/crop/actual-date logical identity, including concurrent different-key requests */
            200: {
                headers: {
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SeasonDraft"] | components["schemas"]["ActiveSeason"];
                };
            };
            /** @description Draft season and initial plan created atomically */
            201: {
                headers: {
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SeasonDraft"];
                };
            };
            400: components["responses"]["InvalidRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            /** @description Idempotency key reused with a different request, or explicit manual-plan choice required because no usable applicable validated template exists */
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
    getSeasonSetup: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                seasonId: components["parameters"]["SeasonId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Current season, plan source, tasks, and version for recovery/review */
            200: {
                headers: {
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SeasonDraft"] | components["schemas"]["ActiveSeason"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            500: components["responses"]["Unexpected"];
        };
    };
    activateSeason: {
        parameters: {
            query?: never;
            header: {
                /** @description Identifies an idempotent command execution. After a lost response or app restart, the client retries the exact same command with the same key; reusing a key with a different payload or version conflicts. For season creation and activation, the client durably retains the unresolved command until it records the successful result. */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                /** @description ETag/version returned with the draft; stale writes return 409. */
                "If-Match": components["parameters"]["ExpectedVersion"];
            };
            path: {
                seasonId: components["parameters"]["SeasonId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Season activated, or the original result replayed for the exact same idempotency key and activation command */
            200: {
                headers: {
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ActiveSeason"];
                };
            };
            400: components["responses"]["InvalidRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            /** @description Same key with changed payload/version, stale DRAFT version, different-key concurrent activation loser, or different-key activation against ACTIVE; client must re-read the season */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description MANUAL or VALIDATED_TEMPLATE draft has no valid planned tasks; draft remains editable and no placeholder task is added */
            422: {
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
    addSeasonPlanTask: {
        parameters: {
            query?: never;
            header: {
                /** @description Identifies an idempotent command execution. After a lost response or app restart, the client retries the exact same command with the same key; reusing a key with a different payload or version conflicts. For season creation and activation, the client durably retains the unresolved command until it records the successful result. */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                /** @description ETag/version returned with the draft; stale writes return 409. */
                "If-Match": components["parameters"]["ExpectedVersion"];
            };
            path: {
                seasonId: components["parameters"]["SeasonId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PlanTaskInput"];
            };
        };
        responses: {
            /** @description Task added; returns the updated plan and version */
            201: {
                headers: {
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SeasonDraft"];
                };
            };
            400: components["responses"]["InvalidRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            /** @description Stale draft version or season is ACTIVE; plan-task mutation is permitted only while DRAFT */
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
    removeSeasonPlanTask: {
        parameters: {
            query?: never;
            header: {
                /** @description ETag/version returned with the draft; stale writes return 409. */
                "If-Match": components["parameters"]["ExpectedVersion"];
            };
            path: {
                seasonId: components["parameters"]["SeasonId"];
                taskId: components["parameters"]["TaskId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Task removed; returns the updated plan and version */
            200: {
                headers: {
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SeasonDraft"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            /** @description Stale draft version or season is ACTIVE; plan-task mutation is permitted only while DRAFT */
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
    editSeasonPlanTask: {
        parameters: {
            query?: never;
            header: {
                /** @description ETag/version returned with the draft; stale writes return 409. */
                "If-Match": components["parameters"]["ExpectedVersion"];
            };
            path: {
                seasonId: components["parameters"]["SeasonId"];
                taskId: components["parameters"]["TaskId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["EditPlanTaskRequest"];
            };
        };
        responses: {
            /** @description Task edited; returns the updated plan and version */
            200: {
                headers: {
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SeasonDraft"];
                };
            };
            400: components["responses"]["InvalidRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            /** @description Stale draft version or season is ACTIVE; plan-task mutation is permitted only while DRAFT */
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
    getTodayPlannedTasks: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Planned tasks whose local date equals the authorized business-local date, including an empty list when none are due. Use the configured business timezone, or configured Europe/Istanbul fallback when absent; device timezone and server UTC do not define today's boundary. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Resolved authorized business timezone used for local-date and occurrence rendering. */
                        businessTimezone: string;
                        /**
                         * Format: date
                         * @description Current date in the authorized business timezone across all fields/seasons in that business.
                         */
                        localDate: string;
                        tasks: components["schemas"]["TodayPlannedTask"][];
                    };
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            500: components["responses"]["Unexpected"];
        };
    };
}
