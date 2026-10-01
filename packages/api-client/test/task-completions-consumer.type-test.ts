import { createApiClient } from "@ekim-hasat/api-client";
import type { operations, paths, TaskCompletionComponents } from "@ekim-hasat/api-client";

const client = createApiClient();
void client.POST("/tasks/{taskId}/completions", {
  params: { path: { taskId: "task-id" }, header: { "If-Match": "3" } },
  body: { completionId: "completion-id", occurredAt: "2026-09-29T07:45:00.000Z" },
});
void client.GET("/fields/{fieldId}/task-completions", {
  params: { path: { fieldId: "field-id" }, query: { seasonId: "season-id", limit: 50 } },
});

type Assert<T extends true> = T;
type CompletionPaths = Assert<
  "/tasks/{taskId}/completions" | "/fields/{fieldId}/task-completions" extends keyof paths ? true : false
>;
type CompletionOperations = Assert<
  "completePlannedTask" | "getFieldTaskCompletionHistory" extends keyof operations ? true : false
>;
type CompletionReplay = Assert<200 extends keyof operations["completePlannedTask"]["responses"] ? true : false>;
type CompletionAccepted = Assert<201 extends keyof operations["completePlannedTask"]["responses"] ? true : false>;
void (0 as unknown as CompletionPaths);
void (0 as unknown as CompletionOperations);
void (0 as unknown as CompletionReplay);
void (0 as unknown as CompletionAccepted);

const accepted: TaskCompletionComponents["schemas"]["TaskCompletion"] = {
  id: "completion-id",
  taskId: "task-id",
  seasonId: "season-id",
  fieldId: "field-id",
  title: "Tarlayı kontrol et",
  plannedLocalDate: "2026-09-28",
  occurredAt: "2026-09-29T07:45:00.000Z",
  sourceKind: "MANUAL",
  templateVersionId: null,
  businessTimezone: "Europe/Istanbul",
};
void accepted;

void client.POST("/tasks/{taskId}/completions", {
  params: { path: { taskId: "task-id" },
    // @ts-expect-error Completion must include the captured task version.
    header: {} },
  body: { completionId: "completion-id", occurredAt: "2026-09-29T07:45:00.000Z" },
});
const invalidRequest: TaskCompletionComponents["schemas"]["CompleteTaskRequest"] = {
  completionId: "completion-id",
  occurredAt: "2026-09-29T07:45:00.000Z",
  // @ts-expect-error The generated request schema does not include client business authority.
  businessId: "business-id",
};
void invalidRequest;

type CompletionHasNoRecordedAt = Assert<
  "recordedAt" extends keyof TaskCompletionComponents["schemas"]["TaskCompletion"] ? false : true
>;
void (0 as unknown as CompletionHasNoRecordedAt);
