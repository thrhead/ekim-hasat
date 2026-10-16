import {
  createApiClient,
  type ObservationDiaryComponents,
  type ObservationDiaryOperations,
  type ObservationDiaryPaths,
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

const expenseDiaryResult = client.GET("/fields/{fieldId}/diary", {
  params: {
    path: { fieldId: "8c6705c6-d80c-4b88-8722-b66cc32a6d4f" },
    query: { includeExpenses: true, limit: 50 },
  },
});

type Assert<T extends true> = T;
type HasObservationPaths = Assert<
  "/fields/{fieldId}/observations" | "/fields/{fieldId}/diary" extends keyof paths ? true : false
>;
type HasObservationOperations = Assert<
  "createFieldObservation" | "getFieldDiary" extends keyof ObservationDiaryOperations ? true : false
>;
type HasOptionalCapturedTimezone = Assert<
  "capturedBusinessTimezone" extends keyof ObservationDiaryComponents["schemas"]["CreateObservationRequest"]
    ? (Pick<ObservationDiaryComponents["schemas"]["CreateObservationRequest"], "capturedBusinessTimezone"> extends Required<
        Pick<ObservationDiaryComponents["schemas"]["CreateObservationRequest"], "capturedBusinessTimezone">
      >
        ? false
        : true)
    : false
>;
type HasOnlyExistingObservationOperations = Assert<
  keyof ObservationDiaryOperations extends "createFieldObservation" | "getFieldDiary"
    ? ("createFieldObservation" | "getFieldDiary") extends keyof ObservationDiaryOperations ? true : false
    : false
>;
type HasOneObservationCreateRoute = Assert<
  ObservationDiaryPaths["/fields/{fieldId}/observations"]["post"] extends ObservationDiaryOperations["createFieldObservation"]
    ? true
    : false
>;
type ObservationResponse = ObservationDiaryOperations["createFieldObservation"]["responses"][201]["content"]["application/json"];
type DiaryResponse = ObservationDiaryOperations["getFieldDiary"]["responses"][200]["content"]["application/json"];
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
type ExpenseDiaryVariant = Extract<
  ObservationDiaryComponents["schemas"]["DiaryPage"]["items"][number],
  { kind: "EXPENSE" }
>;
type HasExpenseDiaryVariant = Assert<ExpenseDiaryVariant extends never ? false : true>;
type ExpenseDiaryDateIsDateOnly = Assert<
  ExpenseDiaryVariant extends { expenseDate: string }
    ? ExpenseDiaryVariant["expenseDate"] extends `${string}T${string}` ? false : true
    : false
>;
type ExpenseDiaryHasNoOccurrenceTimestamp = Assert<
  "occurredAt" extends keyof ExpenseDiaryVariant ? false : true
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
  409 extends keyof ObservationDiaryOperations["createFieldObservation"]["responses"]
    ? 500 extends keyof ObservationDiaryOperations["getFieldDiary"]["responses"] ? true : false
    : false
>;

void (0 as unknown as HasObservationPaths);
void (0 as unknown as HasObservationOperations);
void (0 as unknown as HasOptionalCapturedTimezone);
void (0 as unknown as HasOnlyExistingObservationOperations);
void (0 as unknown as HasOneObservationCreateRoute);
void (0 as unknown as GeneratedObservation);
void (0 as unknown as GeneratedDiary);
void (0 as unknown as GeneratedSkippedDiary);
void (0 as unknown as HasExpenseDiaryVariant);
void (0 as unknown as ExpenseDiaryDateIsDateOnly);
void (0 as unknown as ExpenseDiaryHasNoOccurrenceTimestamp);
void (0 as unknown as SkippedDiaryKind);
void (0 as unknown as HasConflictCode);
void (0 as unknown as HasStructuredErrors);
void createResult;
void offlineCreateResult;
void diaryResult;
void expenseDiaryResult;

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
