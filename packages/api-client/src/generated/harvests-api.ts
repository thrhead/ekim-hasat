export type paths = {
    "/fields/{fieldId}/harvests": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Record a Harvest for an authorized Field and ACTIVE Season
         * @description The server resolves current Business, Membership, and role from the authenticated subject. OWNER and WORKER may create; ADVISOR may not. Business identity is never accepted from the request. The required Season must belong to this Field and authorized Business and be ACTIVE for first acceptance. harvestDate is a calendar date: the server rejects dates after the authorized Business-local current date or before the Season actual planting date. quantity is an exact decimal string, positive, with at most 11 integer and 3 fractional digits; unit is retained per record and no rounding or conversion occurs. A stable harvestId is the canonical Harvest identity. An exact retry by the same currently authorized actor with unchanged payload and Field/Season context returns the original record; changed actor, payload, Field, or Season returns 409. Concurrent exact requests converge to one canonical record. This endpoint does not queue offline work.
         */
        post: operations["createFieldHarvest"];
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
        CreateHarvestRequest: {
            /**
             * Format: date
             * @description Farmer-entered calendar date. It is not a timestamp; Business-local future and Season planting-date checks are authoritative on the server.
             */
            harvestDate: string;
            /**
             * Format: uuid
             * @description Stable client-generated identity for this logical create and exact retry.
             */
            harvestId: string;
            /** @description Exact positive decimal string with at most 11 integer digits and 3 fractional digits, less than 100000000000. No binary floating-point transport, rounding, or unit conversion. The server is authoritative. */
            quantity: string;
            /**
             * Format: uuid
             * @description Required ACTIVE Season belonging to the path Field and authorized Business.
             */
            seasonId: string;
            /**
             * @description Selected unit retained on this Harvest; records are never converted.
             * @enum {string}
             */
            unit: "KG" | "METRIC_TONNE";
        };
        Harvest: {
            /** Format: uuid */
            fieldId: string;
            /**
             * Format: date
             * @description Original calendar date of harvest; no time-of-day is known or implied.
             */
            harvestDate: string;
            /** Format: uuid */
            id: string;
            /** @description Exact accepted positive decimal quantity, returned without binary floating-point conversion. */
            quantity: string;
            /**
             * Format: date-time
             * @description Server UTC acceptance time, separate from harvestDate.
             */
            recordedAt: string;
            /** Format: uuid */
            seasonId: string;
            /** @enum {string} */
            unit: "KG" | "METRIC_TONNE";
        };
    };
    responses: never;
    parameters: {
        FieldId: string;
    };
    requestBodies: never;
    headers: never;
    pathItems: never;
};
export type $defs = Record<string, never>;
export interface operations {
    createFieldHarvest: {
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
                "application/json": components["schemas"]["CreateHarvestRequest"];
            };
        };
        responses: {
            /** @description Exact retry replayed the previously accepted Harvest */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Harvest"];
                };
            };
            /** @description Harvest accepted and committed */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Harvest"];
                };
            };
            /** @description Invalid Harvest date, quantity, unit, or request identity */
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
            /** @description Current Membership or role does not authorize Harvest creation */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Field or Season is unavailable in this authorized context */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Harvest identity was reused with a changed actor, payload, or context */
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
}
