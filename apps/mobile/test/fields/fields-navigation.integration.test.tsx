jest.mock("@react-native-async-storage/async-storage", () => (
  jest.requireActual("@react-native-async-storage/async-storage/jest/async-storage-mock")
));

import { createAppComposition, APP_PRIMARY_NAVIGATION } from "../../src/app-composition";

function setup() {
  const listeners = new Set<(state: { status: "authenticated"; accountId: string }) => void>();
  const client = { GET: jest.fn().mockResolvedValue({ data: { firstFieldOnboardingNeeded: false }, error: undefined, response: { ok: true } }) };
  const getState = () => ({ status: "authenticated" as const, accountId: "account-1" });
  const controller = {
    getState,
    subscribe(listener: (state: { status: "authenticated"; accountId: string }) => void) { listeners.add(listener); listener(getState()); return () => listeners.delete(listener); },
    start: async () => {},
    getAuthenticatedApiClient: () => client,
    getAuthenticatedApiSession: () => ({ accountId: "account-1", client }),
  } as never;
  return createAppComposition(controller);
}

describe("production Tarlalar navigation", () => {
  it("keeps the approved navigation order and exposes Field list, detail, and add routes", () => {
    expect(APP_PRIMARY_NAVIGATION.map((item) => item.label)).toEqual(["Bugün", "Takvim", "Tarlalar", "+", "Daha Fazla"]);
    const app = setup();
    app.showToday();
    expect(app.getState().entry).toBe("today");
    app.showFields();
    expect(app.getState().entry).toBe("fields-list");
    app.openField("field-1");
    expect(app.getState()).toMatchObject({ entry: "field-detail", fieldId: "field-1" });
    app.startFieldCreate();
    expect(app.getState().entry).toBe("field-create");
    app.showHistory("field-1", "season-1");
    expect(app.getState()).toMatchObject({ entry: "history", historyFieldId: "field-1", historySeasonId: "season-1" });
    app.dispose();
  });

  it("does not add a Calendar route or change the existing Today and History route meanings", () => {
    const app = setup();
    expect("showCalendar" in app).toBe(false);
    app.showToday();
    expect(app.getState().entry).toBe("today");
    app.showHistory("field-2");
    expect(app.getState()).toMatchObject({ entry: "history", historyFieldId: "field-2", historySeasonId: null });
    app.dispose();
  });
});
