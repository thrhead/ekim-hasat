import { createApiClient, type ManualTaskComponents, type ManualTaskOperations, type paths } from "@ekim-hasat/api-client";
const client = createApiClient();
void client.POST("/seasons/{seasonId}/manual-tasks", {
  params: { path: { seasonId: "season" } },
  body: { taskId: "task", mutationId: "mutation", title: "Kontrol", plannedLocalDate: "2026-10-31" },
});
type Assert<T extends true> = T;
type HasPath = Assert<"/seasons/{seasonId}/manual-tasks" extends keyof paths ? true : false>;
type Op = ManualTaskOperations["createActiveSeasonManualTask"];
type Request = Op["requestBody"]["content"]["application/json"];
type Accepted = Op["responses"][201]["content"]["application/json"];
type Replay = Op["responses"][200]["content"]["application/json"];
type Codes = Exclude<400 | 401 | 403 | 404 | 409 | 422, keyof Op["responses"]>;
type AllErrors = Assert<Codes extends never ? true : false>;
type SameReceipt = Assert<Accepted extends Replay ? true : false>;
const command: Request = { taskId: "task", mutationId: "mutation", title: "x", plannedLocalDate: "2026-10-31" };
const code: ManualTaskComponents["schemas"]["Error"]["error"]["code"] = "IDENTITY_CONFLICT";
void [command, code, null as unknown as HasPath, null as unknown as AllErrors, null as unknown as SameReceipt];

type CalendarTask = import("@ekim-hasat/api-client").CalendarComponents["schemas"]["CalendarTask"];
type SeasonRecord = import("@ekim-hasat/api-client").SeasonComponents["schemas"]["SeasonRecord"];
type CalendarHasOrigin = Assert<"sourceKind" extends keyof CalendarTask ? true : false>;
type CalendarHasTemplate = Assert<"templateVersionId" extends keyof CalendarTask ? true : false>;
type SeasonHasRole = Assert<"viewerRole" extends keyof SeasonRecord ? true : false>;
type SeasonHasPlanStatus = Assert<"status" extends keyof SeasonRecord["plan"] ? true : false>;
void (0 as unknown as CalendarHasOrigin); void (0 as unknown as CalendarHasTemplate);
void (0 as unknown as SeasonHasRole); void (0 as unknown as SeasonHasPlanStatus);
