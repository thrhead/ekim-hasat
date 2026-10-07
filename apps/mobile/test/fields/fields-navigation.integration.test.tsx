jest.mock("@react-native-async-storage/async-storage", () => (
  jest.requireActual("@react-native-async-storage/async-storage/jest/async-storage-mock")
));

import { createAppComposition, APP_PRIMARY_NAVIGATION } from "../../src/app-composition";
import { renderObservationContextRoute } from "../../App";
import { ObservationCreateScreen } from "../../src/features/observations/observation-create-screen";
import { FieldDiaryScreen } from "../../src/features/observations/field-diary-screen";

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
    app.showObservationCreate("field-1");
    expect(app.getState()).toMatchObject({ entry: "observation-create", fieldId: "field-1", observationSeasonId: null });
    app.showObservationCreate("field-1", "season-1");
    expect(app.getState()).toMatchObject({ entry: "observation-create", fieldId: "field-1", observationSeasonId: "season-1" });
    app.showFieldDiary("field-1", "season-1");
    expect(app.getState()).toMatchObject({ entry: "field-diary", diaryFieldId: "field-1", diarySeasonId: "season-1" });
    app.showFieldDiary("field-1");
    expect(app.getState()).toMatchObject({ entry: "field-diary", diaryFieldId: "field-1", diarySeasonId: null });
    app.startFieldCreate();
    expect(app.getState().entry).toBe("field-create");
    app.showHistory("field-1", "season-1");
    expect(app.getState()).toMatchObject({ entry: "history", historyFieldId: "field-1", historySeasonId: "season-1" });
    app.dispose();
  });

  it("adds Calendar without changing the existing Today and History route meanings", () => {
    const app = setup();
    app.showCalendar();
    expect(app.getState().entry).toBe("calendar");
    app.showToday();
    expect(app.getState().entry).toBe("today");
    app.showHistory("field-2");
    expect(app.getState()).toMatchObject({ entry: "history", historyFieldId: "field-2", historySeasonId: null });
    app.dispose();
  });

  it("renders the observation and diary screens from their contextual App routes", () => {
    const client = {} as never;
    const app = setup();
    const create = renderObservationContextRoute({ entry: "observation-create", client, fieldId: "field-1", accountId: "account-1", observationSeasonId: "season-1" } as never, app as never);
    expect(create?.type).toBe(ObservationCreateScreen);
    expect(create?.props).toMatchObject({ fieldId: "field-1", seasonId: "season-1" });
    create?.props.onBack();
    expect(app.getState()).toMatchObject({ entry: "field-detail", fieldId: "field-1" });
    app.showObservationCreate("field-1", "season-1");
    const explicitCreate = renderObservationContextRoute({ entry: "observation-create", client, fieldId: "field-1", accountId: "account-1", observationSeasonId: "season-1" } as never, app as never);
    explicitCreate?.props.onCreated();
    expect(app.getState()).toMatchObject({ entry: "field-detail", fieldId: "field-1" });
    const diary = renderObservationContextRoute({ entry: "field-diary", client, diaryFieldId: "field-1", accountId: "account-1", diarySeasonId: null } as never, app as never);
    expect(diary?.type).toBe(FieldDiaryScreen);
    expect(diary?.props).toMatchObject({ fieldId: "field-1", seasonId: undefined });
    app.dispose();
  });
});
