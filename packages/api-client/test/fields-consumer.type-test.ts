import { createApiClient } from "@ekim-hasat/api-client";
import type { FieldComponents, operations, paths } from "@ekim-hasat/api-client";

const client = createApiClient();
void client.GET("/fields", { params: { query: { limit: 50, cursor: "next" } } });
void client.GET("/fields/{fieldId}", { params: { path: { fieldId: "field-1" } } });
void client.POST("/fields", {
  params: { header: { "Idempotency-Key": "create-field-1" } },
  body: { location: { type: "POINT", point: { type: "Point", coordinates: [29, 41] } } },
});
void client.PATCH("/fields/{fieldId}", {
  params: { path: { fieldId: "field-1" }, header: { "If-Match": '"1"' } },
  body: { name: "North field" },
});

type Assert<T extends true> = T;
type HasFieldPaths = Assert<
  "/fields" | "/fields/{fieldId}" extends keyof paths ? true : false
>;
type HasFieldOperations = Assert<
  "listFields" | "getField" | "createField" | "updateField" extends keyof operations ? true : false
>;
type FieldPage = operations["listFields"]["responses"][200]["content"]["application/json"];
type FieldDetail = operations["getField"]["responses"][200]["content"]["application/json"];
type GeneratedPage = Assert<FieldPage extends FieldComponents["schemas"]["FieldPage"] ? true : false>;
type GeneratedDetail = Assert<FieldDetail extends FieldComponents["schemas"]["FieldDetail"] ? true : false>;
type CreateRequiresIdempotency = Assert<
  operations["createField"]["parameters"]["header"] extends { "Idempotency-Key": string } ? true : false
>;
type UpdateRequiresIfMatch = Assert<
  operations["updateField"]["parameters"]["header"] extends { "If-Match": string } ? true : false
>;
type HasConflictCodes = Assert<
  "STALE_VERSION" | "IDEMPOTENCY_KEY_REUSED" extends FieldComponents["schemas"]["ApiError"]["error"]["code"] ? true : false
>;
type HasPrivacySafeResponses = Assert<
  403 extends keyof operations["getField"]["responses"]
    ? 404 extends keyof operations["getField"]["responses"] ? true : false
    : false
>;
type HasCorrelationId = Assert<
  "requestId" extends keyof FieldComponents["schemas"]["ApiError"]["error"] ? true : false
>;
type HasRegionProvenance = Assert<
  "sourceId" | "confidence" | "dataVersion" | "resolvedAt" extends keyof FieldComponents["schemas"]["RegionSuggestion"] ? true : false
>;
type RegionState = FieldComponents["schemas"]["RegionSuggestion"]["state"];
type HasUnresolvedState = Assert<"UNRESOLVED" extends RegionState ? true : false>;

void (0 as unknown as HasFieldPaths);
void (0 as unknown as HasFieldOperations);
void (0 as unknown as GeneratedPage);
void (0 as unknown as GeneratedDetail);
void (0 as unknown as CreateRequiresIdempotency);
void (0 as unknown as UpdateRequiresIfMatch);
void (0 as unknown as HasConflictCodes);
void (0 as unknown as HasPrivacySafeResponses);
void (0 as unknown as HasCorrelationId);
void (0 as unknown as HasRegionProvenance);
void (0 as unknown as HasUnresolvedState);

// @ts-expect-error Clients cannot choose an authorization Business.
void client.GET("/fields", { params: { query: { businessId: "business-1" } } });
