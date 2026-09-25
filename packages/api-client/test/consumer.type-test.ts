import { createApiClient } from "@ekim-hasat/api-client";
import type { components, operations, paths } from "@ekim-hasat/api-client";

const client = createApiClient();

// Consumers can call each operation using only generated contract types.
void client.GET("/onboarding/status");
void client.POST("/onboarding/complete", {
  params: { header: { "Idempotency-Key": "first-field-try-1" } },
  body: {
    location: { type: "Point", coordinates: [25.1, 39.2] },
  },
});

const summary: components["schemas"]["FirstFieldSummary"] = {
  id: "field-1",
  name: "Tarla 1",
  representativePoint: { type: "Point", coordinates: [25.1, 39.2] },
  createdAt: "2026-09-24T00:00:00Z",
};
void summary;

type Assert<T extends true> = T;
type HasStatusOperation = Assert<"/onboarding/status" extends keyof paths ? true : false>;
type HasCompletionOperation = Assert<"/onboarding/complete" extends keyof paths ? true : false>;
type OnlyCurrentOperations = Assert<
  [keyof paths] extends ["/onboarding/status" | "/onboarding/complete"]
    ? ["/onboarding/status" | "/onboarding/complete"] extends [keyof paths]
      ? true
      : false
    : false
>;
type HasStatus401 = Assert<401 extends keyof operations["getFarmerOnboardingStatus"]["responses"] ? true : false>;
type HasStatus403 = Assert<403 extends keyof operations["getFarmerOnboardingStatus"]["responses"] ? true : false>;
type HasCompletion5xx = Assert<"5XX" extends keyof operations["completeFarmerOnboarding"]["responses"] ? true : false>;
void (0 as unknown as HasStatusOperation);
void (0 as unknown as HasCompletionOperation);
void (0 as unknown as OnlyCurrentOperations);
void (0 as unknown as HasStatus401);
void (0 as unknown as HasStatus403);
void (0 as unknown as HasCompletion5xx);

const privacySafeError: components["schemas"]["Error"] = {
  code: "FORBIDDEN",
  message: "This request is not available",
  correlationId: "request-1234",
  retryable: false,
};
void privacySafeError;

// @ts-expect-error SPEC-002 field listing is outside this contract.
void client.GET("/fields");

void client.POST("/onboarding/complete", {
  params: { header: { "Idempotency-Key": "first-field-try-2" } },
  body: {
    // @ts-expect-error MultiPolygon is outside SPEC-001.
    location: { type: "MultiPolygon", coordinates: [] },
  },
});

void client.POST("/onboarding/complete", {
  params: { header: { "Idempotency-Key": "first-field-try-3" } },
  body: {
    location: { type: "Point", coordinates: [25.1, 39.2] },
    // @ts-expect-error Business selection is not a completion request field.
    businessId: "client-cannot-select-this",
  },
});
