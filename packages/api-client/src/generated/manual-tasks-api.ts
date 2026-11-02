export type paths = {
    "/seasons/{seasonId}/manual-tasks": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Create one manual task in an approved active season
         * @description Authenticated current OWNER only. First acceptance validates same-Business field, season, APPROVED plan and ACTIVE status, plus existing task and local-date rules. Task and durable receipt commit atomically. Exact same actor, IDs, context and canonical input replay the original accepted result after current authorization, even if task date or season status subsequently changes. Any reused identity with different input, actor or context conflicts. A denial or conflict cannot resolve an earlier possibly committed request; clients retain an unconfirmed outcome until authoritative evidence resolves it. No offline status is server acceptance.
         */
        post: operations["createActiveSeasonManualTask"];
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
        AcceptedManualTask: {
            /** Format: date-time */
            acceptedAt: string;
            description?: string | null;
            /** Format: uuid */
            fieldId: string;
            /** Format: uuid */
            mutationId: string;
            /**
             * Format: date
             * @description Original accepted planned date; later current date is read through task views
             */
            plannedLocalDate: string;
            /** Format: uuid */
            seasonId: string;
            /** @constant */
            sourceKind: "MANUAL";
            /** Format: uuid */
            taskId: string;
            templateVersionId: null;
            title: string;
        };
        CreateManualTask: {
            /** @description Existing optional task description validation applies */
            description?: string | null;
            /**
             * Format: uuid
             * @description Stable client-generated logical mutation identity
             */
            mutationId: string;
            /**
             * Format: date
             * @description Business-local calendar date on or after actual planting; past dates otherwise allowed
             */
            plannedLocalDate: string;
            /**
             * Format: uuid
             * @description Stable client-generated task identity
             */
            taskId: string;
            /** @description Existing task title validation and normalization apply */
            title: string;
        };
        Error: {
            error: {
                /** @enum {string} */
                code: "INVALID_COMMAND" | "AUTHENTICATION_REQUIRED" | "ACCESS_DENIED" | "RESOURCE_UNAVAILABLE" | "SEASON_INELIGIBLE" | "IDENTITY_CONFLICT" | "INVALID_TASK";
                /** @description Privacy-safe explanation suitable for mapping to farmer-facing feedback */
                message: string;
            };
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
    createActiveSeasonManualTask: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                seasonId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateManualTask"];
            };
        };
        responses: {
            /** @description Transient failure; a client cannot assume whether a prior request committed */
            "5XX": {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Exact authorized replay of original acceptance */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AcceptedManualTask"];
                };
            };
            /** @description First authoritative acceptance committed */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AcceptedManualTask"];
                };
            };
            /** @description Malformed command or date syntax (INVALID_COMMAND) */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Authentication required (AUTHENTICATION_REQUIRED) */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Current membership or role not authorized (ACCESS_DENIED) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource unavailable within authorized Business (RESOURCE_UNAVAILABLE); foreign existence is not disclosed */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Season or plan ineligible (SEASON_INELIGIBLE), or identity bound to different input, actor or context (IDENTITY_CONFLICT) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Task validation failed (INVALID_TASK), including date before actual planting */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
}
