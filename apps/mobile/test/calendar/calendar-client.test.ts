import { readCalendar, readCalendarPage } from "../../src/features/calendar/calendar-client";
import type { ApiClient } from "../../src/api/onboarding-client";
import { createApiClient } from "../../../../packages/api-client/src/index";

const readId = "11111111-1111-4111-8111-111111111111";
const businessId = "22222222-2222-4222-8222-222222222222";
const fieldId = "33333333-3333-4333-8333-333333333333";
const monthIndicators = Array.from({ length: 31 }, (_, index) => ({ date: `2026-10-${String(index + 1).padStart(2, "0")}`, hasWork: index === 5 }));
const read = {
  readId,
  asOf: "2026-10-06T09:00:00.000Z",
  expiresAt: "2026-10-06T09:15:00.000Z",
  businessId,
  businessTimezone: "Europe/Istanbul",
  businessLocalToday: "2026-10-06",
  selectedDate: "2026-10-06",
  monthStart: "2026-10-01",
  monthEnd: "2026-10-31",
  fieldScope: { mode: "allAuthorized" as const, includedFieldIds: [fieldId] },
  activeSeasonExists: true,
  hasAnyUnfinishedWork: true,
  monthIndicatorsComplete: true as const,
  monthIndicators,
  selectedDateTasksPage: {
    readId, group: "selectedDateTasks" as const, complete: true, readScope: {
      businessId, asOf: "2026-10-06T09:00:00.000Z", businessTimezone: "Europe/Istanbul",
      businessLocalToday: "2026-10-06", selectedDate: "2026-10-06", monthStart: "2026-10-01", monthEnd: "2026-10-31",
      fieldScope: { mode: "allAuthorized" as const, includedFieldIds: [fieldId] },
    }, items: [],
  },
  overdueTasksPage: {
    readId, group: "overdueTasks" as const, complete: true, readScope: {
      businessId, asOf: "2026-10-06T09:00:00.000Z", businessTimezone: "Europe/Istanbul",
      businessLocalToday: "2026-10-06", selectedDate: "2026-10-06", monthStart: "2026-10-01", monthEnd: "2026-10-31",
      fieldScope: { mode: "allAuthorized" as const, includedFieldIds: [fieldId] },
    }, items: [],
  },
};

describe("Calendar mobile client", () => {
  it("starts without a device-selected date and accepts the server-resolved read identity", async () => {
    const POST = jest.fn().mockResolvedValue({ data: read, response: { ok: true, status: 201 } });
    await expect(readCalendar({ POST } as unknown as ApiClient)).resolves.toEqual(read);
    expect(POST).toHaveBeenCalledWith("/v1/calendar/reads", { body: {} });
  });

  it("resolves the frozen /v1 Calendar path exactly once against the mobile API base URL", async () => {
    const requestedUrls: string[] = [];
    const page = { readId, group: "overdueTasks", requestedCursor: "opaque-cursor", readScope: read.overdueTasksPage.readScope, items: [], complete: true };
    const responses = [read, page];
    const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
      requestedUrls.push(String(input instanceof Request ? input.url : input));
      return new Response(JSON.stringify(responses.shift()), { status: requestedUrls.length === 1 ? 201 : 200, headers: { "content-type": "application/json" } });
    });
    const client = createApiClient({ baseUrl: "https://api.example.test/v1", fetch: fetchMock as typeof fetch });
    await readCalendar(client, {});
    await readCalendarPage(client, { readId, group: "overdueTasks", cursor: "opaque-cursor", readScope: read.overdueTasksPage.readScope });
    expect(requestedUrls.map((value) => new URL(value).pathname)).toEqual([
      "/v1/calendar/reads", `/v1/calendar/reads/${readId}/pages`,
    ]);
    expect(new URL(requestedUrls[1]!).searchParams.get("cursor")).toBe("opaque-cursor");
  });

  it("maps explicit browsing scope and a recorded cursor through generated page types", async () => {
    const GET = jest.fn().mockResolvedValue({
      data: { readId, group: "overdueTasks", requestedCursor: "opaque-cursor", readScope: read.overdueTasksPage.readScope, items: [], complete: true },
      response: { ok: true, status: 200 },
    });
    await expect(readCalendarPage({ GET } as unknown as ApiClient, {
      readId, group: "overdueTasks", cursor: "opaque-cursor", readScope: read.overdueTasksPage.readScope,
    })).resolves.toMatchObject({ readId, group: "overdueTasks", requestedCursor: "opaque-cursor" });
    expect(GET).toHaveBeenCalledWith("/v1/calendar/reads/{readId}/pages", {
      params: { path: { readId }, query: { group: "overdueTasks", cursor: "opaque-cursor" } },
    });
  });

  it("rejects mismatched read identity, date, and scope instead of merging another view", async () => {
    const POST = jest.fn().mockResolvedValue({ data: { ...read, selectedDateTasksPage: { ...read.selectedDateTasksPage, readId: businessId } }, response: { ok: true, status: 201 } });
    await expect(readCalendar({ POST } as unknown as ApiClient)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("validates page identity against the saved read scope before exposing rows", async () => {
    const GET = jest.fn().mockResolvedValue({
      data: { readId, group: "overdueTasks", requestedCursor: "opaque-cursor", readScope: { ...read.overdueTasksPage.readScope, selectedDate: "2026-10-07" }, items: [], complete: true },
      response: { ok: true, status: 200 },
    });
    await expect(readCalendarPage({ GET } as unknown as ApiClient, {
      readId, group: "overdueTasks", cursor: "opaque-cursor", readScope: read.overdueTasksPage.readScope,
    })).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
});
