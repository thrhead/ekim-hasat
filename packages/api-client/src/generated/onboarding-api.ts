export type paths = {
    "/onboarding/complete": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Atomically complete first-field onboarding for the authenticated farmer
         * @description Resolves or creates the application User, default Business, OWNER Membership, first Field, default-business context pointer, durable completion record, and retained idempotency result in one PostgreSQL transaction. The client accepts no client-selected business or membership. The operation is online-only. Membership is the sole authorization authority and the default business pointer selects context only. An unusable default-business context fails with HTTP 400 using the normal privacy-safe Error schema; this command does not return 403 and does not reveal whether another business exists. No success response is returned until the transaction commits. A Repeated requests with the same idempotency key and payload return the original logical result. A durable completed-onboarding domain check returns the current first-field summary without creating another first field, even after idempotency cache retention expires. Tenant scope is enforced server-side. A submitted polygon is unverified unless a real verification process has occurred. The returned FirstFieldSummary is used for post-save confirmation/current first-field state; general field listing remains SPEC-002. Location input supports Point and Polygon only; MultiPolygon is outside SPEC-001.
         */
        post: operations["completeFarmerOnboarding"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/onboarding/status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read whether first-field onboarding is needed
         * @description Returns only the minimum state needed to decide whether first-field onboarding is needed. This is not a general field-list endpoint. Application tenant enforcement is mandatory; PostgreSQL RLS is optional defense-in-depth and is not required for MVP. If the server-owned default business context is unusable or lacks an active Membership for the authenticated user, the operation returns a privacy-safe 403. It does not reveal whether another business exists and does not fall back to another Membership or select another business.
         */
        get: operations["getFarmerOnboardingStatus"];
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
        BoundaryVersion: {
            geometry: components["schemas"]["PolygonGeometry"];
            id: string;
            /**
             * @description SPEC-001 stores submitted boundaries as unverified.
             * @enum {string}
             */
            verificationStatus: "unverified" | "verified";
            version: number;
        };
        CompleteOnboardingRequest: {
            /** @description A Point representative location or a drawn Polygon. MultiPolygon is not supported by SPEC-001. When Polygon-only input is supplied, the server derives a representative point on the polygon and stores the polygon as an unverified boundary version. */
            location: components["schemas"]["PointGeometry"] | components["schemas"]["PolygonGeometry"];
            /** @description Optional first-field name. The server trims leading and trailing whitespace. If the value is omitted or empty after trimming, the server assigns exactly "Tarla 1"; otherwise it stores the trimmed value. General subsequent-field numbering is outside SPEC-001. */
            name?: string;
        };
        Error: {
            code: string;
            correlationId: string;
            message: string;
            retryable?: boolean;
        };
        Field: {
            boundary?: components["schemas"]["BoundaryVersion"];
            /** Format: date-time */
            createdAt: string;
            id: string;
            name: string;
            representativePoint: components["schemas"]["PointGeometry"];
        };
        FirstFieldSummary: {
            boundary?: components["schemas"]["BoundaryVersion"];
            /** Format: date-time */
            createdAt: string;
            id: string;
            name: string;
            representativePoint: components["schemas"]["PointGeometry"];
        };
        OnboardingResult: {
            field: components["schemas"]["FirstFieldSummary"];
        };
        OnboardingStatus: {
            /** @description Whether the authenticated farmer needs first-field onboarding. */
            firstFieldOnboardingNeeded: boolean;
        };
        PointGeometry: {
            /** @description GeoJSON longitude, latitude in WGS 84 / SRID 4326. */
            coordinates: [
                number,
                number
            ];
            /** @constant */
            type: "Point";
        };
        PolygonGeometry: {
            /** @description GeoJSON polygon rings; server validates closure and geometry validity. */
            coordinates: [
                number,
                number
            ][][];
            /** @constant */
            type: "Polygon";
        };
    };
    responses: {
        /** @description The authenticated user's default context is unusable or lacks an active Membership. This response does not reveal whether another business exists and uses the normal privacy-safe error schema. */
        Forbidden: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["Error"];
            };
        };
        /** @description The key was reused with a different onboarding command payload. */
        IdempotencyConflict: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["Error"];
            };
        };
        /** @description Request fields are invalid. */
        InvalidInput: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["Error"];
            };
        };
        /** @description Point or polygon geometry is invalid. */
        InvalidLocation: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["Error"];
            };
        };
        /** @description Connectivity or server failure; client must not infer commit success. */
        ServerFailure: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["Error"];
            };
        };
        /** @description Authentication is missing, invalid, or expired. */
        Unauthorized: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["Error"];
            };
        };
    };
    parameters: {
        /** @description Stable identity for retries of one logical onboarding command. It is scoped to the authenticated user. Reusing a retained key with a different payload returns 409. After the key record expires, durable completion takes precedence: return the existing first-field summary with 200 and perform no mutation. Retention duration is operational configuration. */
        IdempotencyKey: string;
    };
    requestBodies: never;
    headers: never;
    pathItems: never;
};
export type $defs = Record<string, never>;
export interface operations {
    completeFarmerOnboarding: {
        parameters: {
            query?: never;
            header: {
                /** @description Stable identity for retries of one logical onboarding command. It is scoped to the authenticated user. Reusing a retained key with a different payload returns 409. After the key record expires, durable completion takes precedence: return the existing first-field summary with 200 and perform no mutation. Retention duration is operational configuration. */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CompleteOnboardingRequest"];
            };
        };
        responses: {
            "5XX": components["responses"]["ServerFailure"];
            /** @description An idempotent retry or already-completed onboarding returned the current first-field summary. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OnboardingResult"];
                };
            };
            /** @description The command committed the first onboarding result and returned its summary. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OnboardingResult"];
                };
            };
            400: components["responses"]["InvalidInput"];
            401: components["responses"]["Unauthorized"];
            409: components["responses"]["IdempotencyConflict"];
            422: components["responses"]["InvalidLocation"];
        };
    };
    getFarmerOnboardingStatus: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Minimal onboarding status. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OnboardingStatus"];
                };
            };
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
        };
    };
}
