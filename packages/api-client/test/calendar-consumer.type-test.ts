import { createApiClient } from "@ekim-hasat/api-client";
import type { CalendarComponents, operations, paths } from "@ekim-hasat/api-client";

const client = createApiClient();

// An initial Calendar read can omit selectedDate so the server chooses Business-local today.
void client.POST("/v1/calendar/reads", { body: {} });
void client.POST("/v1/calendar/reads", { body: { selectedDate: "2026-10-06" } });

type Assert<T extends true> = T;
type CalendarPaths = Assert<
  "/v1/calendar/reads" | "/v1/calendar/reads/{readId}/pages" extends keyof paths ? true : false
>;
type CalendarOperations = Assert<
  "createCalendarRead" | "readCalendarPage" extends keyof operations ? true : false
>;
type ResolvedDateIsRequired = Assert<
  CalendarComponents["schemas"]["CalendarRead"] extends { selectedDate: string } ? true : false
>;
void (0 as unknown as CalendarPaths);
void (0 as unknown as CalendarOperations);
void (0 as unknown as ResolvedDateIsRequired);
