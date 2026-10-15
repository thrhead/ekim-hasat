import { act, create, type TestRenderer } from "react-test-renderer";
import type { ApiClient } from "../../../../packages/api-client/src/index";
import { IrrigationRecordCreateScreen } from "../../src/features/operations/irrigation-record-create-screen";

const id = "11111111-1111-4111-8111-111111111111";
const now = () => new Date("2026-10-05T10:00:00Z");
const record = {
  id, fieldId: "field-1", seasonId: null, occurredAt: "2026-10-05T09:00:00.000Z",
  businessTimezone: "Europe/Istanbul", method: null, durationMinutes: null,
  waterVolumeCubicMetres: null, note: null, recordedAt: "2026-10-05T10:00:00.000Z",
};

function node(screen: TestRenderer, label: string) {
  const found = screen.root.findAll(({ props }) => props.accessibilityLabel === label)[0];
  expect(found).toBeDefined();
  return found!;
}

function text(screen: TestRenderer) {
  return screen.root.findAll(({ props }) => typeof props.children === "string" || Array.isArray(props.children))
    .flatMap(({ props }) => [props.children].flat().filter((child) => typeof child === "string")).join(" ");
}

async function mount(
  POST = jest.fn().mockResolvedValue({ data: record, response: { ok: true, status: 201 } }),
  GET = jest.fn().mockResolvedValue({ data: { businessTimezone: "Europe/Istanbul", items: [], nextCursor: null }, response: { ok: true, status: 200 } }),
  onCreated = jest.fn(),
) {
  let screen!: TestRenderer;
  await act(async () => {
    screen = create(<IrrigationRecordCreateScreen
      client={{ GET, POST } as unknown as ApiClient} fieldId="field-1" fieldName="Kuzey"
      now={now} createId={() => id} onCreated={onCreated}
    />);
  });
  return screen;
}

async function fill(
  screen: TestRenderer,
  values: { method?: string; time?: string; duration?: string; volume?: string; note?: string } = {},
) {
  await act(async () => {
    if (values.method !== undefined) (node(screen, "Sulama yöntemi").props.onChangeText as (value: string) => void)(values.method);
    if (values.time !== undefined) (node(screen, "Sulama tarihi ve saati").props.onChangeText as (value: string) => void)(values.time);
    if (values.duration !== undefined) (node(screen, "Süre (dakika)").props.onChangeText as (value: string) => void)(values.duration);
    if (values.volume !== undefined) (node(screen, "Su miktarı (m³)").props.onChangeText as (value: string) => void)(values.volume);
    if (values.note !== undefined) (node(screen, "Sulama notu").props.onChangeText as (value: string) => void)(values.note);
  });
}

async function press(screen: TestRenderer, label = "Sulamayı kaydet") {
  await act(async () => { (node(screen, label).props.onPress as () => void)(); });
}

describe("online irrigation record create", () => {
  it("loads authorized Business time and defaults occurrence to now in that timezone", async () => {
    const GET = jest.fn().mockResolvedValue({
      data: { businessTimezone: "America/New_York", items: [], nextCursor: null }, response: { ok: true, status: 200 },
    });
    const screen = await mount(jest.fn(), GET);
    expect(GET).toHaveBeenCalledWith("/fields/{fieldId}/diary", {
      params: { path: { fieldId: "field-1" }, query: { limit: 1 } },
    });
    expect(node(screen, "Sulama tarihi ve saati").props.value).toBe("2026-10-05T06:00");
    await act(async () => screen.unmount());
  });

  it("submits optional details only when entered and reports the server-confirmed record", async () => {
    const POST = jest.fn().mockResolvedValue({ data: record, response: { ok: true, status: 201 } });
    const onCreated = jest.fn();
    const screen = await mount(POST, undefined, onCreated);
    await fill(screen, { time: "2026-10-05T12:00", method: " Damla sulama ", duration: "30", volume: "2.5", note: " Sabah sulaması " });
    await press(screen);
    expect(POST).toHaveBeenCalledWith("/fields/{fieldId}/irrigation-records", {
      params: { path: { fieldId: "field-1" } },
      body: {
        irrigationRecordId: id, occurredAtLocal: "2026-10-05T12:00", occurredAt: "2026-10-05T09:00:00.000Z",
        capturedBusinessTimezone: "Europe/Istanbul", method: "Damla sulama", durationMinutes: 30,
        waterVolumeCubicMetres: "2.5", note: "Sabah sulaması",
      },
    });
    expect(onCreated).toHaveBeenCalledWith(record);
    expect(text(screen)).toContain("Sulama kaydedildi");
    await act(async () => screen.unmount());
  });

  it("allows Field-only capture with every optional detail omitted", async () => {
    const POST = jest.fn().mockResolvedValue({ data: record, response: { ok: true, status: 201 } });
    const screen = await mount(POST);
    await press(screen);
    expect(POST.mock.calls[0]![1].body).toEqual({
      irrigationRecordId: id, occurredAtLocal: "2026-10-05T13:00", occurredAt: "2026-10-05T10:00:00.000Z",
      capturedBusinessTimezone: "Europe/Istanbul",
    });
    expect(POST.mock.calls[0]![1].body).not.toHaveProperty("seasonId");
    await act(async () => screen.unmount());
  });

  it("keeps invalid and unauthorized results unaccepted and shows a recovery message", async () => {
    const POST = jest.fn()
      .mockResolvedValueOnce({ error: { error: { code: "INVALID_REQUEST", message: "Invalid", requestId: "r1" } }, response: { ok: false, status: 400 } })
      .mockResolvedValueOnce({ error: { error: { code: "FORBIDDEN", message: "Forbidden", requestId: "r2" } }, response: { ok: false, status: 403 } });
    const onCreated = jest.fn();
    const screen = await mount(POST, undefined, onCreated);
    await press(screen);
    expect(onCreated).not.toHaveBeenCalled();
    expect(text(screen)).toContain("tarih ile saati kontrol edin");
    await press(screen);
    expect(onCreated).not.toHaveBeenCalled();
    expect(text(screen)).toContain("erişiminizi kontrol edin");
    await act(async () => screen.unmount());
  });

  it("keeps a connectivity retry in the active form and never reports an unconfirmed save", async () => {
    const POST = jest.fn()
      .mockRejectedValueOnce(new TypeError("Network request failed"))
      .mockResolvedValueOnce({ data: record, response: { ok: true, status: 200 } });
    const onCreated = jest.fn();
    const screen = await mount(POST, undefined, onCreated);
    await fill(screen, { method: "Damla sulama" });
    await press(screen);
    expect(onCreated).not.toHaveBeenCalled();
    expect(text(screen)).not.toContain("Sulama kaydedildi");
    expect(text(screen)).toContain("bağlantınızı kontrol edip aynı kaydı yeniden deneyin");
    expect(POST).toHaveBeenCalledTimes(1);
    await press(screen, "Kaydı yeniden dene");
    expect(POST.mock.calls[0]).toEqual(POST.mock.calls[1]);
    expect(onCreated).toHaveBeenCalledWith(record);
    await act(async () => screen.unmount());
  });
});
