import { createApiClient } from "@ekim-hasat/api-client";
import type { operations, paths, SeasonComponents } from "@ekim-hasat/api-client";

const client = createApiClient();
void client.GET("/onboarding/status");
void client.GET("/fields/{fieldId}/season-setup-options", {
  params: { path: { fieldId: "field-1" } },
});
void client.GET("/seasons/{seasonId}", {
  params: { path: { seasonId: "season-1" } },
});
void client.GET("/today");

type Assert<T extends true> = T;
type SeasonPaths = Assert<
  "/fields/{fieldId}/season-setup-options" | "/fields/{fieldId}/seasons" |
  "/seasons/{seasonId}" | "/seasons/{seasonId}/plan-tasks" |
  "/seasons/{seasonId}/plan-tasks/{taskId}" | "/seasons/{seasonId}/activate" |
  "/today" extends keyof paths ? true : false
>;
type SeasonOperations = Assert<
  "getSeasonSetupOptions" | "createSeasonDraft" | "getSeasonSetup" |
  "addSeasonPlanTask" | "editSeasonPlanTask" | "removeSeasonPlanTask" |
  "activateSeason" | "getTodayPlannedTasks" extends keyof operations ? true : false
>;
type ActivationConflict = Assert<409 extends keyof operations["activateSeason"]["responses"] ? true : false>;
void (0 as unknown as SeasonPaths);
void (0 as unknown as SeasonOperations);
void (0 as unknown as ActivationConflict);

const manualDraft: SeasonComponents["schemas"]["CreateSeasonDraftRequest"] = {
  crop: { centralCropId: "crop-1" },
  sowingPlantingDate: "2026-09-28",
  planSource: "MANUAL",
};
void client.POST("/fields/{fieldId}/seasons", {
  params: { path: { fieldId: "field-1" }, header: { "Idempotency-Key": "create-season-1" } },
  body: manualDraft,
});
void client.POST("/fields/{fieldId}/seasons", {
  params: { path: { fieldId: "field-1" }, header: { "Idempotency-Key": "create-season-2" } },
  body: {
    crop: { customCropName: "Custom crop" },
    sowingPlantingDate: "2026-09-28",
    planSource: "MANUAL",
    // @ts-expect-error The contract never accepts client business authority.
    businessId: "client-business",
  },
});
void client.POST("/seasons/{seasonId}/activate", {
  params: {
    path: { seasonId: "season-1" },
    header: { "Idempotency-Key": "activate-season-1", "If-Match": "1" },
  },
});

void client.POST("/seasons/{seasonId}/activate", {
  params: { path: { seasonId: "season-1" },
    // @ts-expect-error Activation must carry the generated optimistic concurrency header.
    header: { "Idempotency-Key": "activate-season-2" } },
});
