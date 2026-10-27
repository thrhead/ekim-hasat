jest.mock("@react-native-async-storage/async-storage", () => (
  jest.requireActual("@react-native-async-storage/async-storage/jest/async-storage-mock")
));
jest.mock("expo-sqlite", () => ({ openDatabaseAsync: jest.fn(), openDatabaseSync: jest.fn() }));

import { act, create, type TestRenderer } from "react-test-renderer";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SQLite from "expo-sqlite";
import type { ComponentType } from "react";
import { BackHandler, StyleSheet, type ViewStyle } from "react-native";
import type { ApiClient } from "../../../../packages/api-client/src/index";
import { FieldDiaryScreen } from "../../src/features/observations/field-diary-screen";
import { renderObservationContextRoute } from "../../App";

const fieldId = "11111111-1111-4111-8111-111111111111";
const seasonId = "22222222-2222-4222-8222-222222222222";
const harvestId = "33333333-3333-4333-8333-333333333333";
const accepted = { id: harvestId, fieldId, seasonId, harvestDate: "2026-10-06", quantity: "12.375", unit: "KG", recordedAt: "2026-10-06T12:00:00Z" };

function node(screen: TestRenderer, label: string) {
  return screen.root.findAll(({ props }) => props.accessibilityLabel === label)[0];
}

async function diary(viewerRole: string | undefined, onAddHarvest = jest.fn()) {
  const GET = jest.fn().mockResolvedValue({
    data: { items: [], nextCursor: null, businessTimezone: "Europe/Istanbul", ...(viewerRole ? { viewerRole } : {}) },
    response: { ok: true, status: 200 },
  });
  const props = {
    client: { GET } as unknown as ApiClient, fieldId, fieldName: "Kuzey", seasonId, seasonName: "Buğday", onAddHarvest,
  };
  let screen!: TestRenderer;
  await act(async () => { screen = create(<FieldDiaryScreen {...props} />); });
  return { screen, GET, onAddHarvest };
}

function text(screen: TestRenderer) {
  return screen.root.findAll(({ props }) => typeof props.children === "string" || Array.isArray(props.children))
    .flatMap(({ props }) => [props.children].flat().filter((child) => typeof child === "string")).join(" ");
}

async function press(screen: TestRenderer, label: string) {
  const button = node(screen, label);
  expect(button).toBeDefined();
  const onPress = button?.props.onPress;
  expect(typeof onPress).toBe("function");
  await act(async () => { if (typeof onPress === "function") onPress(); });
}

async function change(screen: TestRenderer, label: string, value: string) {
  const input = node(screen, label);
  expect(input).toBeDefined();
  const onChangeText = input?.props.onChangeText;
  expect(typeof onChangeText).toBe("function");
  await act(async () => { if (typeof onChangeText === "function") onChangeText(value); });
}

async function capture(options: {
  POST?: jest.Mock;
  GET?: jest.Mock;
  onCreated?: jest.Mock;
  onBack?: jest.Mock;
  createId?: jest.Mock;
} = {}) {
  // Resolve inside the test so the still-missing form does not mask executable Diary assertions.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { HarvestCreateScreen } = require("../../src/features/harvest/harvest-create-screen") as {
    HarvestCreateScreen: ComponentType<Record<string, unknown>>;
  };
  const POST = options.POST ?? jest.fn().mockResolvedValue({ data: accepted, response: { ok: true, status: 201 } });
  const GET = options.GET ?? jest.fn().mockResolvedValue({ data: {
    items: [], nextCursor: null, businessTimezone: "Europe/Istanbul", viewerRole: "OWNER",
  }, response: { ok: true, status: 200 } });
  const onCreated = options.onCreated ?? jest.fn();
  const onBack = options.onBack ?? jest.fn();
  const createId = options.createId ?? jest.fn(() => harvestId);
  let screen!: TestRenderer;
  await act(async () => { screen = create(<HarvestCreateScreen client={{ GET, POST } as unknown as ApiClient}
    fieldId={fieldId} fieldName="Kuzey" seasonId={seasonId} seasonName="Buğday"
    now={() => new Date("2026-10-06T10:00:00Z")} createId={createId}
    onCreated={onCreated} onBack={onBack} />); });
  return { screen, POST, GET, onCreated, onBack, createId };
}

async function validCapture(screen: TestRenderer) {
  await change(screen, "Hasat tarihi", "2026-10-06");
  await change(screen, "Miktar", "12.375");
  await press(screen, "Birim");
  await press(screen, "KG");
}

describe("Harvest capture entry from an active Season Diary", () => {
  it.each(["OWNER", "WORKER"])("offers Hasat ekle to %s from the server-derived role", async (role) => {
    const { screen, onAddHarvest } = await diary(role);
    const button = node(screen, "Hasat ekle");
    expect(button).toBeDefined();
    expect(button?.props.accessibilityRole).toBe("button");
    const onPress = button?.props.onPress;
    await act(async () => { if (typeof onPress === "function") onPress(); });
    expect(onAddHarvest).toHaveBeenCalledTimes(1);
    await act(async () => screen.unmount());
  });

  it.each(["ADVISOR", undefined])("hides Hasat ekle when viewerRole is %s", async (role) => {
    const { screen, onAddHarvest } = await diary(role);
    expect(node(screen, "Hasat ekle")).toBeUndefined();
    expect(onAddHarvest).not.toHaveBeenCalled();
    await act(async () => screen.unmount());
  });

  it("does not infer the create role from app or provider metadata", async () => {
    const GET = jest.fn().mockResolvedValue({ data: {
      items: [], nextCursor: null, businessTimezone: "Europe/Istanbul",
    }, response: { ok: true, status: 200 } });
    const client = { GET, providerRole: "OWNER", appRole: "OWNER" } as unknown as ApiClient;
    let screen!: TestRenderer;
    const props = { client, fieldId, seasonId, onAddHarvest: jest.fn() };
    await act(async () => { screen = create(<FieldDiaryScreen {...props} />); });
    expect(node(screen, "Hasat ekle")).toBeUndefined();
    await act(async () => screen.unmount());
  });

  it("keeps the create action hidden while the authorized Diary role is unavailable", async () => {
    const GET = jest.fn().mockRejectedValue(new TypeError("offline"));
    const props = { client: { GET } as unknown as ApiClient, fieldId, seasonId, onAddHarvest: jest.fn() };
    let screen!: TestRenderer;
    await act(async () => { screen = create(<FieldDiaryScreen {...props} />); });
    expect(node(screen, "Hasat ekle")).toBeUndefined();
    expect(node(screen, "Günlüğü yeniden dene")).toBeDefined();
    await act(async () => screen.unmount());
  });

  it("does not offer capture from a Field-only Diary without an active Season context", async () => {
    const GET = jest.fn().mockResolvedValue({ data: {
      items: [], nextCursor: null, businessTimezone: "Europe/Istanbul", viewerRole: "OWNER",
    }, response: { ok: true, status: 200 } });
    let screen!: TestRenderer;
    const props = { client: { GET } as unknown as ApiClient, fieldId, onAddHarvest: jest.fn() };
    await act(async () => { screen = create(<FieldDiaryScreen {...props} />); });
    expect(node(screen, "Hasat ekle")).toBeUndefined();
    await act(async () => screen.unmount());
  });

  it("wires the active Season Diary entry and server-confirmed return through the app route", () => {
    const showHarvestCreate = jest.fn();
    const returnToFieldDiary = jest.fn();
    const composition = { showHarvestCreate, returnToFieldDiary };
    const state = { entry: "field-diary", client: {} as ApiClient, accountId: "account-1", diaryFieldId: fieldId, diarySeasonId: seasonId };
    const diaryRoute = renderObservationContextRoute(state as never, composition as never);
    expect(diaryRoute?.props.onAddHarvest).toEqual(expect.any(Function));
    diaryRoute?.props.onAddHarvest();
    expect(showHarvestCreate).toHaveBeenCalledTimes(1);
    const createRoute = renderObservationContextRoute({ ...state, entry: "harvest-create" } as never, composition as never);
    expect(createRoute?.props).toMatchObject({ fieldId, seasonId });
    createRoute?.props.onCreated(accepted);
    expect(returnToFieldDiary).toHaveBeenCalledWith(true);
    const returnedDiary = renderObservationContextRoute({ ...state, harvestSaved: true } as never, composition as never);
    expect(returnedDiary?.props.harvestSaved).toBe(true);
  });

  it("announces confirmed Harvest success in the returned Diary", async () => {
    const GET = jest.fn().mockResolvedValue({ data: { items: [], nextCursor: null, businessTimezone: "Europe/Istanbul", viewerRole: "OWNER" }, response: { ok: true, status: 200 } });
    let screen!: TestRenderer;
    await act(async () => { screen = create(<FieldDiaryScreen client={{ GET } as unknown as ApiClient} fieldId={fieldId} seasonId={seasonId} harvestSaved />); });
    expect(text(screen)).toContain("Hasat kaydedildi");
    await act(async () => screen.unmount());
  });
});

describe("online Harvest create form", () => {
  it("announces the selected unit and whether its options are expanded", async () => {
    const { screen } = await capture();
    expect(node(screen, "Birim")?.props.accessibilityValue).toEqual({ text: "Kilogram" });
    expect(node(screen, "Birim")?.props.accessibilityState).toMatchObject({ expanded: false });
    await press(screen, "Birim");
    expect(node(screen, "Birim")?.props.accessibilityState).toMatchObject({ expanded: true });
    await press(screen, "Ton");
    expect(node(screen, "Birim")?.props.accessibilityValue).toEqual({ text: "Ton" });
    await act(async () => screen.unmount());
  });

  it("explains an invalid date in Turkish", async () => {
    const { screen } = await capture();
    await change(screen, "Hasat tarihi", "2026-02-30");
    await press(screen, "Hasadı kaydet");
    expect(text(screen)).toContain("Geçerli bir hasat tarihi girin");
    await act(async () => screen.unmount());
  });

  it("returns to the diary on Android system Back", async () => {
    const add = jest.spyOn(BackHandler, "addEventListener");
    const { screen, onBack } = await capture();
    const handler = add.mock.calls.find(([event]) => event === "hardwareBackPress")?.[1];
    expect(handler).toBeDefined();
    expect(handler?.()).toBe(true);
    expect(onBack).toHaveBeenCalledTimes(1);
    await act(async () => screen.unmount());
    add.mockRestore();
  });
  it("keeps the Field and Season fixed and submits the exact date, quantity, selected unit and stable identity", async () => {
    const { screen, POST, onCreated, createId } = await capture();
    expect(text(screen)).toContain("Kuzey");
    expect(text(screen)).toContain("Buğday");
    expect(node(screen, "Tarla seç")).toBeUndefined();
    expect(node(screen, "Sezon seç")).toBeUndefined();
    await validCapture(screen);
    await press(screen, "Hasadı kaydet");
    expect(POST).toHaveBeenCalledWith("/fields/{fieldId}/harvests", {
      params: { path: { fieldId } },
      body: { harvestId, seasonId, harvestDate: "2026-10-06", quantity: "12.375", unit: "KG" },
    });
    expect(createId).toHaveBeenCalledTimes(1);
    expect(onCreated).toHaveBeenCalledWith(accepted);
    expect(POST.mock.calls[0]?.[1]?.body).not.toHaveProperty("note");
    await act(async () => screen.unmount());
  });

  it("submits METRIC_TONNE without converting or rounding the entered quantity", async () => {
    const tonneAccepted = { ...accepted, unit: "METRIC_TONNE" };
    const POST = jest.fn().mockResolvedValue({ data: tonneAccepted, response: { ok: true, status: 201 } });
    const { screen, onCreated } = await capture({ POST });
    await change(screen, "Hasat tarihi", "2026-10-06");
    await change(screen, "Miktar", "12.375");
    await press(screen, "Birim");
    await press(screen, "Ton");
    await press(screen, "Hasadı kaydet");
    expect(POST.mock.calls[0]?.[1]?.body).toMatchObject({ quantity: "12.375", unit: "METRIC_TONNE" });
    expect(onCreated).toHaveBeenCalledWith(tonneAccepted);
    await act(async () => screen.unmount());
  });

  it.each(["0", "-1", "12.3751", "100000000000"])("rejects invalid quantity %s before sending", async (quantity) => {
    const POST = jest.fn();
    const { screen } = await capture({ POST });
    await validCapture(screen);
    await change(screen, "Miktar", quantity);
    await press(screen, "Hasadı kaydet");
    expect(POST).not.toHaveBeenCalled();
    expect(screen.root.findAll(({ props }) => props.accessibilityRole === "alert")).not.toHaveLength(0);
    await act(async () => screen.unmount());
  });

  it.each(["2026-02-30", "2026-10-07"])("rejects invalid or future harvest date %s before sending", async (harvestDate) => {
    const POST = jest.fn();
    const { screen } = await capture({ POST });
    await validCapture(screen);
    await change(screen, "Hasat tarihi", harvestDate);
    await press(screen, "Hasadı kaydet");
    expect(POST).not.toHaveBeenCalled();
    expect(screen.root.findAll(({ props }) => props.accessibilityRole === "alert")).not.toHaveLength(0);
    await act(async () => screen.unmount());
  });

  it("does not claim success or submit offline when Business context cannot load", async () => {
    const GET = jest.fn().mockRejectedValue(new TypeError("offline"));
    const POST = jest.fn();
    const onCreated = jest.fn();
    const { screen } = await capture({ GET, POST, onCreated });
    expect(node(screen, "Hasadı kaydet")?.props.accessibilityState).toMatchObject({ disabled: true });
    expect(text(screen)).not.toContain("Hasat kaydedildi");
    expect(onCreated).not.toHaveBeenCalled();
    expect(POST).not.toHaveBeenCalled();
    expect(node(screen, "Bilgileri yeniden yükle")).toBeDefined();
    await act(async () => screen.unmount());
  });

  it("does not write an uncertain Harvest to local storage or an outbox after context loads", async () => {
    const setItem = jest.spyOn(AsyncStorage, "setItem");
    const openAsync = SQLite.openDatabaseAsync as jest.Mock;
    const openSync = SQLite.openDatabaseSync as jest.Mock;
    openAsync.mockClear(); openSync.mockClear();
    try {
      const POST = jest.fn().mockRejectedValue(new TypeError("Network request failed"));
      const onCreated = jest.fn();
      const { screen, GET } = await capture({ POST, onCreated });
      expect(GET).toHaveBeenCalled();
      await validCapture(screen);
      await press(screen, "Hasadı kaydet");
      expect(POST).toHaveBeenCalledTimes(1);
      expect(onCreated).not.toHaveBeenCalled();
      expect(text(screen)).not.toContain("Hasat kaydedildi");
      expect(setItem).not.toHaveBeenCalled();
      expect(openAsync).not.toHaveBeenCalled();
      expect(openSync).not.toHaveBeenCalled();
      await act(async () => screen.unmount());
    } finally {
      setItem.mockRestore();
    }
  });

  it("reports acceptance only after the server returns a committed record", async () => {
    let resolve!: (value: unknown) => void;
    const POST = jest.fn(() => new Promise((done) => { resolve = done; }));
    const onCreated = jest.fn();
    const { screen } = await capture({ POST, onCreated });
    await validCapture(screen);
    await press(screen, "Hasadı kaydet");
    expect(POST).toHaveBeenCalledTimes(1);
    expect(onCreated).not.toHaveBeenCalled();
    expect(text(screen)).not.toContain("Hasat kaydedildi");
    expect(node(screen, "Hasat kaydediliyor")?.props.accessibilityRole).toBe("progressbar");
    await act(async () => { resolve({ data: accepted, response: { ok: true, status: 201 } }); });
    expect(onCreated).toHaveBeenCalledWith(accepted);
    await act(async () => screen.unmount());
  });

  it("retries an uncertain response with the same identity and unchanged body only while the form stays open", async () => {
    const POST = jest.fn().mockRejectedValueOnce(new TypeError("Network request failed"))
      .mockResolvedValueOnce({ data: accepted, response: { ok: true, status: 200 } });
    const onCreated = jest.fn();
    const createId = jest.fn(() => harvestId);
    const { screen } = await capture({ POST, onCreated, createId });
    await validCapture(screen);
    await press(screen, "Hasadı kaydet");
    expect(onCreated).not.toHaveBeenCalled();
    expect(text(screen)).not.toContain("Hasat kaydedildi");
    const quantityInput = node(screen, "Miktar");
    if (quantityInput?.props.editable === false) {
      expect(quantityInput.props.editable).toBe(false);
    } else {
      await change(screen, "Miktar", "25");
      expect(node(screen, "Miktar")?.props.value).toBe("25");
    }
    await press(screen, "Kaydı yeniden dene");
    expect(POST.mock.calls[1]).toEqual(POST.mock.calls[0]);
    expect(createId).toHaveBeenCalledTimes(1);
    expect(onCreated).toHaveBeenCalledWith(accepted);
    await act(async () => screen.unmount());
  });

  it("does not treat an empty HTTP 201 body as confirmed acceptance", async () => {
    const POST = jest.fn().mockResolvedValueOnce({ data: undefined, response: { ok: true, status: 201 } })
      .mockResolvedValueOnce({ data: accepted, response: { ok: true, status: 200 } });
    const onCreated = jest.fn();
    const { screen } = await capture({ POST, onCreated });
    await validCapture(screen);
    await press(screen, "Hasadı kaydet");
    expect(onCreated).not.toHaveBeenCalled();
    await press(screen, "Kaydı yeniden dene");
    expect(POST.mock.calls[1]).toEqual(POST.mock.calls[0]);
    expect(onCreated).toHaveBeenCalledWith(accepted);
    await act(async () => screen.unmount());
  });

  it.each([
    [400, "INVALID_REQUEST", /bilgi|tarih|miktar|kontrol/i],
    [403, "FORBIDDEN", /erişim|yetki/i],
    [409, "IDEMPOTENCY_KEY_REUSED", /çakış|farklı|kimlik/i],
    [500, "UNEXPECTED", /sunucu|tekrar/i],
  ])("keeps HTTP %i %s unaccepted and explains the distinct failure", async (status, code, expectedMessage) => {
      const POST = jest.fn().mockResolvedValue({ error: { error: { code, message: "private detail", requestId: "r1" } }, response: { ok: false, status } });
      const onCreated = jest.fn();
      const { screen } = await capture({ POST, onCreated });
      await validCapture(screen);
      await press(screen, "Hasadı kaydet");
      expect(onCreated).not.toHaveBeenCalled();
      expect(text(screen)).not.toContain("Hasat kaydedildi");
      expect(text(screen)).not.toContain("private detail");
      const alerts = screen.root.findAll(({ props }) => props.accessibilityRole === "alert");
      expect(alerts).not.toHaveLength(0);
      expect(alerts.map(({ props }) => props.children).join(" ")).toMatch(expectedMessage);
      await act(async () => screen.unmount());
    });

  it("keeps a stale OWNER Diary CTA honest when the create server now denies access", async () => {
    const { screen: diaryScreen } = await diary("OWNER");
    await press(diaryScreen, "Hasat ekle");
    await act(async () => diaryScreen.unmount());
    const POST = jest.fn().mockResolvedValue({ error: { error: { code: "FORBIDDEN", message: "private detail", requestId: "r1" } }, response: { ok: false, status: 403 } });
    const onCreated = jest.fn();
    const { screen } = await capture({ POST, onCreated });
    await validCapture(screen);
    await press(screen, "Hasadı kaydet");
    expect(onCreated).not.toHaveBeenCalled();
    expect(text(screen)).toMatch(/erişim|yetki/i);
    await act(async () => screen.unmount());
  });

  it("gives controls accessible labels, usable touch targets, and scalable text", async () => {
    const { screen } = await capture();
    for (const label of ["Hasat tarihi", "Miktar", "Birim", "Hasadı kaydet"]) expect(node(screen, label)).toBeDefined();
    const button = node(screen, "Hasadı kaydet");
    const style = StyleSheet.flatten(button?.props.style as ViewStyle);
    expect(style?.minHeight ?? style?.height).toBeGreaterThanOrEqual(44);
    const readable = screen.root.findAll(({ props }) => ["text", "header"].includes(String(props.accessibilityRole)));
    expect(readable.length).toBeGreaterThan(0);
    for (const item of readable) expect(item.props.allowFontScaling).not.toBe(false);
    await act(async () => screen.unmount());
  });
});
