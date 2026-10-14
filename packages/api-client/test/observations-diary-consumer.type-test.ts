import {
  createApiClient,
  type ObservationDiaryComponents,
  type operations,
  type paths,
} from "@ekim-hasat/api-client";

const client = createApiClient();

const createResult = client.POST("/fields/{fieldId}/observations", {
  params: { path: { fieldId: "8c6705c6-d80c-4b88-8722-b66cc32a6d4f" } },
  body: {
    observationId: "9c071bf4-5fa3-46d7-b015-1fd32dc8c33c",
    description: "Check north row",
    occurredAtLocal: "2026-10-05T09:30",
    occurredAt: "2026-10-05T06:30:00Z",
  },
});

const offlineCreateResult = client.POST("/fields/{fieldId}/observations", {
  params: { path: { fieldId: "8c6705c6-d80c-4b88-8722-b66cc32a6d4f" } },
  body: {
    observationId: "9c071bf4-5fa3-46d7-b015-1fd32dc8c33c",
    description: "Check north row",
    occurredAtLocal: "2026-10-05T09:30",
    occurredAt: "2026-10-05T06:30:00Z",
    capturedBusinessTimezone: "Europe/Istanbul",
  },
});

const diaryResult = client.GET("/fields/{fieldId}/diary", {
  params: {
    path: { fieldId: "8c6705c6-d80c-4b88-8722-b66cc32a6d4f" },
    query: { seasonId: "d04f1ae7-fc54-45cf-86a8-c9e7fa3a3ef2", limit: 50 },
  },
});

type Assert<T extends true> = T;
type HasObservationPaths = Assert<
  "/fields/{fieldId}/observations" | "/fields/{fieldId}/diary" extends keyof paths ? true : false
>;
type HasObservationOperations = Assert<
  "createFieldObservation" | "getFieldDiary" extends keyof operations ? true : false
>;
type HasOptionalCapturedTimezone = Assert<
  "capturedBusinessTimezone" extends keyof ObservationDiaryComponents["schemas"]["CreateObservationRequest"] ? true : false
>;
type ObservationResponse = operations["createFieldObservation"]["responses"][201]["content"]["application/json"];
type DiaryResponse = operations["getFieldDiary"]["responses"][200]["content"]["application/json"];
type GeneratedObservation = Assert<
  ObservationResponse extends ObservationDiaryComponents["schemas"]["Observation"] ? true : false
>;
type GeneratedDiary = Assert<
  DiaryResponse extends ObservationDiaryComponents["schemas"]["DiaryPage"] ? true : false
>;
type GeneratedSkippedDiary = Assert<
  ObservationDiaryComponents["schemas"]["TaskSkippedDiaryEntry"] extends ObservationDiaryComponents["schemas"]["DiaryPage"]["items"][number]
    ? true
    : false
>;
type SkippedDiaryKind = Assert<
  ObservationDiaryComponents["schemas"]["TaskSkippedDiaryEntry"]["kind"] extends "TASK_SKIPPED"
    ? true
    : false
>;
type HasConflictCode = Assert<
  "IDEMPOTENCY_KEY_REUSED" extends ObservationDiaryComponents["schemas"]["ApiError"]["error"]["code"]
    ? true
    : false
>;
type HasStructuredErrors = Assert<
  409 extends keyof operations["createFieldObservation"]["responses"]
    ? 500 extends keyof operations["getFieldDiary"]["responses"] ? true : false
    : false
>;

void (0 as unknown as HasObservationPaths);
void (0 as unknown as HasObservationOperations);
void (0 as unknown as HasOptionalCapturedTimezone);
void (0 as unknown as GeneratedObservation);
void (0 as unknown as GeneratedDiary);
void (0 as unknown as GeneratedSkippedDiary);
void (0 as unknown as SkippedDiaryKind);
void (0 as unknown as HasConflictCode);
void (0 as unknown as HasStructuredErrors);
void createResult;
void offlineCreateResult;
void diaryResult;

const skippedDiary: ObservationDiaryComponents["schemas"]["TaskSkippedDiaryEntry"] = {
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
void skippedDiary;
