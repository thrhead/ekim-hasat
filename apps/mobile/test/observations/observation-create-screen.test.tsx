import { act, create, type TestRenderer } from "react-test-renderer";
import { createApiClient, type ApiClient, type ObservationDiaryComponents } from "../../../../packages/api-client/src/index";
import { ObservationCreateScreen } from "../../src/features/observations/observation-create-screen";
import { localObservationInstant, submitObservation, validateObservationNote } from "../../src/features/observations/observation-client";

const id = "11111111-1111-4111-8111-111111111111";
const now = () => new Date("2026-10-05T10:00:00Z");
const observation: ObservationDiaryComponents["schemas"]["Observation"] = {
  id, fieldId: "field-1", seasonId: "season-1", description: "Yapraklar sarardı", occurredAt: "2026-10-05T09:00:00Z", businessTimezone: "Europe/Istanbul",
};
function node(screen: TestRenderer, label: string) {
  const found = screen.root.findAll(({ props }) => props.accessibilityLabel === label)[0];
  expect(found).toBeDefined();
  return found!;
}
function text(screen: TestRenderer) {
  return screen.root.findAll(({ props }) => typeof props.children === "string" || Array.isArray(props.children)).flatMap(({ props }) => [props.children].flat().filter((child) => typeof child === "string")).join(" ");
}
async function mount(POST = jest.fn(), GET = jest.fn().mockResolvedValue({ data: { businessTimezone: "Europe/Istanbul", items: [], nextCursor: null }, response: { ok: true, status: 200 } }), onCreated = jest.fn()) {
  let screen!: TestRenderer;
  await act(async () => { screen = create(<ObservationCreateScreen client={{ GET, POST } as unknown as ApiClient} fieldId="field-1" fieldName="Kuzey" seasonId="season-1" seasonName="Buğday" now={now} createId={() => id} onCreated={onCreated} />); });
  return screen;
}
async function fill(screen: TestRenderer, note = "Yapraklar sarardı", time = "2026-10-05T12:00") {
  await act(async () => {
    (node(screen, "Gözlem notu").props.onChangeText as (s: string) => void)(note);
    (node(screen, "Gözlem tarihi ve saati").props.onChangeText as (s: string) => void)(time);
  });
}
async function press(screen: TestRenderer, label = "Gözlemi kaydet") {
  await act(async () => { (node(screen, label).props.onPress as () => void)(); });
}

describe("online observation create", () => {
  it("validates trimmed Unicode code points while preserving internal content", () => {
    expect(validateObservationNote(" \u2003 ")).toBeTruthy();
    expect(validateObservationNote(` \u2003${"🌾".repeat(2000)} \u2003`)).toBeNull();
    expect(validateObservationNote("🌾".repeat(2001))).toBeTruthy();
    expect(validateObservationNote("İç  boşluk\nkorunur")).toBeNull();
  });

  it("maps entered local time using Business timezone rather than device timezone", () => {
    expect(localObservationInstant("2026-10-05T12:00", "Europe/Istanbul")).toBe("2026-10-05T09:00:00.000Z");
    expect(localObservationInstant("2026-07-05T12:00", "America/New_York")).toBe("2026-07-05T16:00:00.000Z");
    expect(() => localObservationInstant("2026-03-08T02:30", "America/New_York")).toThrow();
    expect(() => localObservationInstant("2026-11-01T01:30", "America/New_York")).toThrow();
    expect(() => localObservationInstant("2026-02-30T12:00", "Europe/Istanbul")).toThrow();
  });

  it("uses the generated API endpoint and returns only server-confirmed results", async () => {
    const fetchMock = jest.fn().mockResolvedValue(new Response(JSON.stringify(observation), { status: 201, headers: { "Content-Type": "application/json" } }));
    const request = { observationId: id, description: "Yapraklar sarardı", occurredAtLocal: "2026-10-05T12:00", occurredAt: "2026-10-05T09:00:00.000Z" };
    expect(await submitObservation(createApiClient({ fetch: fetchMock }), "field-1", request)).toEqual(observation);
    const sent = fetchMock.mock.calls[0]![0] as Request;
    expect(new URL(sent.url).pathname).toBe("/v1/fields/field-1/observations");
    expect(JSON.parse(await sent.text())).toEqual(request);
  });

  it("loads authorized Field/Season context and defaults time in that timezone", async () => {
    const GET = jest.fn().mockResolvedValue({ data: { businessTimezone: "America/New_York", items: [], nextCursor: null }, response: { ok: true, status: 200 } });
    const screen = await mount(jest.fn(), GET);
    expect(GET).toHaveBeenCalledWith("/fields/{fieldId}/diary", { params: { path: { fieldId: "field-1" }, query: { limit: 1, seasonId: "season-1" } } });
    expect(node(screen, "Gözlem tarihi ve saati").props.value).toBe("2026-10-05T06:00");
    expect(text(screen)).toContain("Kuzey");
    expect(text(screen)).toContain("Buğday");
    expect(text(screen)).toContain("İnternet bağlantısı gerekir");
    await act(async () => screen.unmount());
  });

  it("retains exact UUID, note and time after network failure and accepts only after retry confirmation", async () => {
    const POST = jest.fn().mockRejectedValueOnce(new TypeError("Network request failed")).mockResolvedValueOnce({ data: observation, response: { ok: true, status: 200 } });
    const onCreated = jest.fn();
    const screen = await mount(POST, undefined, onCreated);
    await fill(screen, " \u2003Yapraklar sarardı ");
    await press(screen);
    expect(onCreated).not.toHaveBeenCalled();
    expect(text(screen)).not.toContain("Gözlem kaydedildi");
    expect(node(screen, "Gözlem notu").props.value).toBe(" \u2003Yapraklar sarardı ");
    expect(node(screen, "Gözlem tarihi ve saati").props.value).toBe("2026-10-05T12:00");
    expect(node(screen, "Gözlem notu").props.editable).toBe(false);
    await press(screen, "Kaydı yeniden dene");
    expect(POST.mock.calls[0]).toEqual(POST.mock.calls[1]);
    expect(POST).toHaveBeenCalledWith("/fields/{fieldId}/observations", { params: { path: { fieldId: "field-1" } }, body: { observationId: id, description: "Yapraklar sarardı", seasonId: "season-1", occurredAtLocal: "2026-10-05T12:00", occurredAt: "2026-10-05T09:00:00.000Z" } });
    expect(onCreated).toHaveBeenCalledWith(observation);
    expect(node(screen, "Gözlem kaydedildi").props.accessibilityLiveRegion).toBe("polite");
    await act(async () => screen.unmount());
  });

  it("retains attempted input after server INVALID_REQUEST and asks for valid unambiguous time", async () => {
    const POST = jest.fn().mockResolvedValue({ error: { error: { code: "INVALID_REQUEST", message: "DST invalid", requestId: "r1" } }, response: { ok: false, status: 400 } });
    const screen = await mount(POST);
    await fill(screen);
    await press(screen);
    expect(node(screen, "Gözlem notu").props.value).toBe("Yapraklar sarardı");
    expect(node(screen, "Gözlem tarihi ve saati").props.value).toBe("2026-10-05T12:00");
    expect(node(screen, "Gözlem tarihi ve saati").props.editable).toBe(true);
    expect(text(screen)).toContain("başka bir geçerli tarih ve saat");
    expect(screen.root.findAll(({ props }) => props.accessibilityRole === "alert" && props.accessibilityLiveRegion === "assertive")).not.toHaveLength(0);
    await act(async () => screen.unmount());
  });

  it("prevents empty, excessive and future inputs from making a request", async () => {
    const POST = jest.fn();
    const screen = await mount(POST);
    await fill(screen, " \u2003 "); await press(screen);
    await fill(screen, "🌾".repeat(2001)); await press(screen);
    await fill(screen, "Yaprak", "2026-10-06T12:00"); await press(screen);
    expect(POST).not.toHaveBeenCalled();
    expect(text(screen)).toContain("gelecek");
    await act(async () => screen.unmount());
  });

  it("blocks save when timezone context is offline and exposes an accessible context retry", async () => {
    const POST = jest.fn();
    const GET = jest.fn().mockRejectedValueOnce(new TypeError("offline")).mockResolvedValueOnce({ data: { businessTimezone: "Europe/Istanbul", items: [], nextCursor: null }, response: { ok: true, status: 200 } });
    const screen = await mount(POST, GET);
    expect(node(screen, "Gözlemi kaydet").props.accessibilityState).toMatchObject({ disabled: true });
    await press(screen, "Bilgileri yeniden yükle");
    expect(node(screen, "Gözlem tarihi ve saati").props.value).toBe("2026-10-05T13:00");
    expect(POST).not.toHaveBeenCalled();
    await act(async () => screen.unmount());
  });

  it("keeps saving announced and prevents duplicate submits before server confirmation", async () => {
    let resolve!: (value: unknown) => void;
    const POST = jest.fn(() => new Promise((accept) => { resolve = accept; }));
    const onCreated = jest.fn();
    const screen = await mount(POST, undefined, onCreated);
    await fill(screen);
    const save = node(screen, "Gözlemi kaydet").props.onPress as () => void;
    await act(async () => { save(); save(); });
    expect(POST).toHaveBeenCalledTimes(1);
    expect(onCreated).not.toHaveBeenCalled();
    expect(node(screen, "Gözlem kaydediliyor").props.accessibilityLiveRegion).toBe("polite");
    expect(node(screen, "Gözlemi kaydet").props.accessibilityState).toMatchObject({ disabled: true, busy: true });
    await act(async () => { resolve({ data: observation, response: { ok: true, status: 201 } }); });
    expect(onCreated).toHaveBeenCalledWith(observation);
    await act(async () => screen.unmount());
  });

  it("creates a Field-only observation without inventing a Season association", async () => {
    const GET = jest.fn().mockResolvedValue({ data: { businessTimezone: "Europe/Istanbul", items: [], nextCursor: null }, response: { ok: true, status: 200 } });
    const POST = jest.fn().mockResolvedValue({ data: { ...observation, seasonId: null }, response: { ok: true, status: 201 } });
    let screen!: TestRenderer;
    await act(async () => { screen = create(<ObservationCreateScreen client={{ GET, POST } as unknown as ApiClient} fieldId="field-1" now={now} createId={() => id} />); });
    await fill(screen); await press(screen);
    expect(GET.mock.calls[0]![1].params.query).toEqual({ limit: 1 });
    expect(POST.mock.calls[0]![1].body).not.toHaveProperty("seasonId");
    await act(async () => screen.unmount());
  });

  it("discards a previous Field form and its late response when navigation context changes", async () => {
    let resolve!: (value: unknown) => void;
    const POST = jest.fn(() => new Promise((accept) => { resolve = accept; }));
    const GET = jest.fn().mockResolvedValue({ data: { businessTimezone: "Europe/Istanbul", items: [], nextCursor: null }, response: { ok: true, status: 200 } });
    const client = { GET, POST } as unknown as ApiClient;
    const onCreated = jest.fn();
    let screen!: TestRenderer;
    await act(async () => { screen = create(<ObservationCreateScreen client={client} fieldId="field-1" now={now} onCreated={onCreated} />); });
    await fill(screen); await press(screen);
    await act(async () => { screen.update(<ObservationCreateScreen client={client} fieldId="field-2" now={now} onCreated={onCreated} />); });
    expect(node(screen, "Gözlem notu").props.value).toBe("");
    await act(async () => { resolve({ data: observation, response: { ok: true, status: 201 } }); });
    expect(onCreated).not.toHaveBeenCalled();
    expect(text(screen)).not.toContain("Gözlem kaydedildi");
    await act(async () => screen.unmount());
  });

  it("retains exact retry when a successful response has no canonical confirmation body", async () => {
    const POST = jest.fn().mockResolvedValueOnce({ data: undefined, response: { ok: true, status: 200 } }).mockResolvedValueOnce({ data: observation, response: { ok: true, status: 200 } });
    const onCreated = jest.fn();
    const screen = await mount(POST, undefined, onCreated);
    await fill(screen); await press(screen);
    expect(onCreated).not.toHaveBeenCalled();
    await press(screen, "Kaydı yeniden dene");
    expect(POST.mock.calls[0]).toEqual(POST.mock.calls[1]);
    expect(onCreated).toHaveBeenCalledWith(observation);
    await act(async () => screen.unmount());
  });
});
