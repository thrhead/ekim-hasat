jest.mock("@react-native-async-storage/async-storage", () => (
  jest.requireActual("@react-native-async-storage/async-storage/jest/async-storage-mock")
));

import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { CalendarScreen } from "../../src/features/calendar/calendar-screen";
import { CalendarRequestState } from "../../src/features/calendar/calendar-state";
import type { ApiClient, CalendarComponents } from "../../../../packages/api-client/src/index";

type TestRenderer = ReturnType<typeof create> & { toJSON: () => unknown; update: (element: React.ReactElement) => void };
const id = "11111111-1111-4111-8111-111111111111";
const businessId = "22222222-2222-4222-8222-222222222222";
const fieldId = "33333333-3333-4333-8333-333333333333";

function read(selectedDate: string): CalendarComponents["schemas"]["CalendarRead"] {
  const monthStart = `${selectedDate.slice(0, 7)}-01`;
  const lastDate = new Date(Date.UTC(Number(selectedDate.slice(0, 4)), Number(selectedDate.slice(5, 7)), 0)).getUTCDate();
  const monthEnd = `${selectedDate.slice(0, 7)}-${String(lastDate).padStart(2, "0")}`;
  const scope = {
    businessId, asOf: "2026-10-06T09:00:00.000Z", businessTimezone: "Europe/Istanbul",
    businessLocalToday: "2026-10-06", selectedDate, monthStart, monthEnd,
    fieldScope: { mode: "allAuthorized" as const, includedFieldIds: [fieldId] },
  };
  const indicators = Array.from({ length: lastDate }, (_, index) => ({ date: `${selectedDate.slice(0, 7)}-${String(index + 1).padStart(2, "0")}`, hasWork: false }));
  return {
    readId: id, asOf: scope.asOf, expiresAt: "2026-10-06T09:15:00.000Z", businessId,
    businessTimezone: "Europe/Istanbul", businessLocalToday: scope.businessLocalToday, selectedDate,
    monthStart, monthEnd, fieldScope: scope.fieldScope, activeSeasonExists: true, hasAnyUnfinishedWork: false,
    monthIndicatorsComplete: true, monthIndicators: indicators,
    selectedDateTasksPage: { readId: id, group: "selectedDateTasks", complete: true, readScope: scope, items: [] },
    overdueTasksPage: { readId: id, group: "overdueTasks", complete: true, readScope: scope, items: [] },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => { resolve = accept; });
  return { promise, resolve };
}

describe("Calendar request races", () => {
  it("binds the active read to account, Business, selected date and readId", () => {
    const state = new CalendarRequestState();
    const client = {} as ApiClient;
    const first = state.beginRead("account-1", client);
    expect(state.acceptRead(first, read("2026-10-06"))).toBe(true);
    const page = state.beginPage(first, read("2026-10-06").readId);
    expect(page).not.toBeNull();

    const nextRead = state.beginRead("account-1", client);
    expect(state.isCurrent(first)).toBe(false);
    expect(state.acceptRead(first, read("2026-10-06"))).toBe(false);
    expect(state.acceptRead(nextRead, { ...read("2026-10-07"), businessId: "88888888-8888-4888-8888-888888888888" })).toBe(true);
    expect(state.isCurrentRead(nextRead, read("2026-10-07").readId, "88888888-8888-4888-8888-888888888888")).toBe(true);
    expect(state.isCurrentRead(nextRead, read("2026-10-07").readId, businessId)).toBe(false);

    const accountSwitch = state.beginRead("account-2", client);
    expect(state.isCurrent(page!)).toBe(false);
    expect(state.currentIdentity()).toBeNull();
    expect(state.isCurrent(accountSwitch)).toBe(true);
  });

  it("invalidates expired continuation identity before starting a replacement read", () => {
    const state = new CalendarRequestState();
    const client = {} as ApiClient;
    const token = state.beginRead("account-1", client);
    const expired = read("2026-10-06");
    state.acceptRead(token, expired);
    expect(state.restartExpiredRead(token, expired.readId, expired.businessId)).toBe(true);
    expect(state.isCurrent(token)).toBe(false);
    expect(state.currentIdentity()).toBeNull();
    const replacement = state.beginRead("account-1", client);
    const replacementRead = { ...read("2026-10-06"), readId: "77777777-7777-4777-8777-777777777777" };
    expect(state.acceptRead(replacement, replacementRead)).toBe(true);
    expect(state.currentIdentity()?.readId).toBe(replacementRead.readId);
  });

  it("discards an older read when account and authorized client context change", async () => {
    const oldRequest = deferred<unknown>();
    const oldClient = { POST: jest.fn().mockReturnValue(oldRequest.promise) };
    const nextRead = read("2026-10-07");
    const newClient = { POST: jest.fn().mockResolvedValue({ data: nextRead, response: { ok: true, status: 201 } }) };
    let screen!: TestRenderer;
    await act(async () => {
      screen = create(createElement(CalendarScreen, { client: oldClient as unknown as ApiClient, accountId: "account-1" })) as unknown as TestRenderer;
    });
    await act(async () => {
      screen.update(createElement(CalendarScreen, { client: newClient as unknown as ApiClient, accountId: "account-2" }));
    });
    expect(JSON.stringify(screen.toJSON())).toContain("7 Ekim 2026");
    await act(async () => { oldRequest.resolve({ data: read("2026-10-06"), response: { ok: true, status: 201 } }); });
    expect(JSON.stringify(screen.toJSON())).toContain("7 Ekim 2026");
    const dateButtons = screen.root.findAll((node) => typeof node.props.accessibilityLabel === "string" && String(node.props.accessibilityLabel).startsWith("Tarihi seç:"));
    expect(dateButtons.find((node) => node.props.accessibilityLabel === "Tarihi seç: 7 Ekim 2026")?.props.accessibilityState).toMatchObject({ selected: true });
    expect(dateButtons.find((node) => node.props.accessibilityLabel === "Tarihi seç: 6 Ekim 2026")?.props.accessibilityState).toMatchObject({ selected: false });
  });
});
