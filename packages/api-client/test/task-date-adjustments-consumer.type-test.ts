import { createApiClient } from "@ekim-hasat/api-client";
import type { operations, paths, TaskDateAdjustmentComponents } from "@ekim-hasat/api-client";

const client = createApiClient();
void client.POST("/tasks/{taskId}/date-adjustments", {
  params: { path: { taskId: "task-id" }, header: { "If-Match": "3" } },
  body: { adjustmentId: "adjustment-id", newPlannedLocalDate: "2026-10-08" },
});
void client.GET("/tasks/{taskId}/date-adjustments", {
  params: { path: { taskId: "task-id" }, query: { limit: 50 } },
});

type Assert<T extends true> = T;
type AdjustmentPaths = Assert<
  "/tasks/{taskId}/date-adjustments" extends keyof paths ? true : false
>;
type AdjustmentOperations = Assert<
  "adjustPlannedTaskDate" | "getPlannedTaskAdjustmentHistory" extends keyof operations ? true : false
>;
type NoDateChange = Assert<
  400 extends keyof operations["adjustPlannedTaskDate"]["responses"] ? true : false
>;
void (0 as unknown as AdjustmentPaths);
void (0 as unknown as AdjustmentOperations);
void (0 as unknown as NoDateChange);

const noDateChange: TaskDateAdjustmentComponents["schemas"]["NoDateChangeError"] = {
  error: { code: "NO_DATE_CHANGE", message: "Choose a different date.", requestId: "request-id" },
};
void noDateChange;

void client.POST("/tasks/{taskId}/date-adjustments", {
  params: { path: { taskId: "task-id" },
    // @ts-expect-error The adjustment command requires the captured task version.
    header: {} },
  body: { adjustmentId: "adjustment-id", newPlannedLocalDate: "2026-10-08" },
});
