import { createApiClient } from "@ekim-hasat/api-client";
import type { operations, paths, TaskSkipComponents } from "@ekim-hasat/api-client";

const client = createApiClient();

void client.POST("/tasks/{taskId}/skips", {
  params: { path: { taskId: "task-id" }, header: { "If-Match": "3" } },
  body: { skipId: "skip-id" },
});
void client.GET("/fields/{fieldId}/task-history", {
  params: {
    path: { fieldId: "field-id" },
    query: { seasonId: "season-id", cursor: "cursor", limit: 50 },
  },
});

type Assert<T extends true> = T;
type HasSkipPaths = Assert<
  "/tasks/{taskId}/skips" | "/fields/{fieldId}/task-history" extends keyof paths ? true : false
>;
type HasSkipOperations = Assert<
  "skipPlannedTask" | "getFieldTaskHistory" extends keyof operations ? true : false
>;
type SkipAccepted = Assert<201 extends keyof operations["skipPlannedTask"]["responses"] ? true : false>;
type SkipReplay = Assert<200 extends keyof operations["skipPlannedTask"]["responses"] ? true : false>;
type SkipConflict = Assert<409 extends keyof operations["skipPlannedTask"]["responses"] ? true : false>;
type HistoryResponse = operations["getFieldTaskHistory"]["responses"][200]["content"]["application/json"];
type HasHistoryPage = Assert<
  HistoryResponse extends TaskSkipComponents["schemas"]["TaskHistoryPage"] ? true : false
>;
type HasSkippedOutcome = Assert<
  TaskSkipComponents["schemas"]["TaskSkippedHistoryEntry"] extends TaskSkipComponents["schemas"]["TaskHistoryPage"]["items"][number]
    ? true
    : false
>;
void (0 as unknown as HasSkipPaths);
void (0 as unknown as HasSkipOperations);
void (0 as unknown as SkipAccepted);
void (0 as unknown as SkipReplay);
void (0 as unknown as SkipConflict);
void (0 as unknown as HasHistoryPage);
void (0 as unknown as HasSkippedOutcome);

const accepted: TaskSkipComponents["schemas"]["TaskSkip"] = {
  skipId: "skip-id",
  taskId: "task-id",
  taskTitle: "Tarlayı kontrol et",
  seasonId: "season-id",
  fieldId: "field-id",
  plannedLocalDate: "2026-10-09",
  baseTaskVersion: 3,
  acceptedTaskVersion: 4,
  skippedAt: "2026-10-09T07:45:00.000Z",
};
void accepted;

const skippedHistory: TaskSkipComponents["schemas"]["TaskSkippedHistoryEntry"] = {
  kind: "TASK_SKIPPED",
  id: "event-id",
  skipId: "skip-id",
  taskId: "task-id",
  seasonId: "season-id",
  fieldId: "field-id",
  title: "Tarlayı kontrol et",
  plannedLocalDate: "2026-10-09",
  skippedAt: "2026-10-09T07:45:00.000Z",
  sourceKind: "MANUAL",
  templateVersionId: null,
};
void skippedHistory;

void client.POST("/tasks/{taskId}/skips", {
  params: {
    path: { taskId: "task-id" },
    // @ts-expect-error Skip requires the captured task version.
    header: {},
  },
  body: { skipId: "skip-id" },
});

const invalidRequest: TaskSkipComponents["schemas"]["SkipPlannedTaskRequest"] = {
  skipId: "skip-id",
  // @ts-expect-error Client-supplied Business identity cannot authorize Skip.
  businessId: "business-id",
};
void invalidRequest;
