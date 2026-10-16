export type paths = {
    "/fields/{fieldId}/expenses": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Record an expense for an authorized Field
         * @description The server resolves the active Business and Membership from the authenticated subject, requires OWNER, and validates the Field and optional Season in that scope. Business ID is never accepted from the request. expenseId is unique within the authorized Business. An exact retry by the same actor and with the same canonical payload replays the accepted Expense; changed actor, payload, Field, or Season returns 409. Current authorization is revalidated before replay. This operation requires connectivity and does not queue offline work.
         */
        post: operations["createFieldExpense"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/fields/{fieldId}/expenses/seasons": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List available Seasons for an authorized Field Expense
         * @description The server resolves current Business membership and requires OWNER. It returns only DRAFT and ACTIVE Seasons belonging to the path Field and authorized Business. Business ID is never accepted from the request.
         */
        get: operations["listFieldExpenseSeasons"];
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
        ApiError: {
            error: {
                /** @enum {string} */
                code: "INVALID_REQUEST" | "IDEMPOTENCY_KEY_REUSED" | "UNAUTHORIZED" | "FORBIDDEN" | "NOT_FOUND" | "UNEXPECTED";
                message: string;
                requestId: string;
            };
        };
        CreateExpenseRequest: {
            /** @description Positive exact decimal string; at most 18 integer digits and 6 fractional digits. Excess precision/range is rejected without rounding. */
            amount: string;
            /** @enum {string} */
            category: "SEED_SEEDLING" | "FERTILIZER" | "PESTICIDE" | "FUEL" | "LABOR" | "IRRIGATION" | "OTHER";
            /** @description Required uppercase ISO 4217 alphabetic code; the server validates it against the repository-pinned, versioned ISO 4217 code set. */
            currency: string;
            /**
             * Format: date
             * @description Calendar date when the expense occurred; no time or timezone conversion.
             */
            expenseDate: string;
            /**
             * Format: uuid
             * @description Stable identity created once for this online submission and its retries.
             */
            expenseId: string;
            /** @description Optional note. No feature-specific length cap or trimming rule is defined. */
            note?: string;
            /**
             * Format: uuid
             * @description Optional Season belonging to the path Field and authorized Business.
             */
            seasonId?: string;
        };
        Expense: {
            /** @description Exact decimal string; never a JSON floating-point number. */
            amount: string;
            /** @enum {string} */
            category: "SEED_SEEDLING" | "FERTILIZER" | "PESTICIDE" | "FUEL" | "LABOR" | "IRRIGATION" | "OTHER";
            currency: string;
            /** Format: date */
            expenseDate: string;
            /** Format: uuid */
            fieldId: string;
            /** Format: uuid */
            id: string;
            note: string | null;
            /** Format: uuid */
            seasonId: string | null;
        };
        ExpenseSeasonOption: {
            cropLabel: string;
            /** Format: uuid */
            id: string;
            /** @enum {string} */
            status: "DRAFT" | "ACTIVE";
        };
        ExpenseSeasonOptions: components["schemas"]["ExpenseSeasonOption"][];
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
};
export type $defs = Record<string, never>;
export interface operations {
    createFieldExpense: {
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
                "application/json": components["schemas"]["CreateExpenseRequest"];
            };
        };
        responses: {
            /** @description Exact retry replayed the previously accepted Expense */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Expense"];
                };
            };
            /** @description Expense accepted and committed */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Expense"];
                };
            };
            /** @description Invalid amount, currency, category, date, or request shape */
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
            /** @description Current membership does not authorize Finance access */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Field or optional Season is unavailable in this authorized context */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Expense ID was reused with a changed actor, payload, or context */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unexpected server failure */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    listFieldExpenseSeasons: {
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
            /** @description Available same-Field Seasons, in stable creation order */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ExpenseSeasonOptions"];
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
            /** @description Current membership does not authorize Finance access */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Field is unavailable in this authorized context */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unexpected server failure */
            500: {
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
