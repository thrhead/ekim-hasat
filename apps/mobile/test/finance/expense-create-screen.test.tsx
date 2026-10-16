import { act, create, type TestRenderer } from "react-test-renderer";
import type { ApiClient } from "../../../../packages/api-client/src/index";
import { ExpenseCreateScreen } from "../../src/features/finance/expense-create-screen";

const id = "11111111-1111-4111-8111-111111111111";
const now = () => new Date("2026-10-05T22:30:00Z");
const accepted = { id, fieldId: "field-1", seasonId: null, amount: "12.345678", currency: "TRY", category: "FERTILIZER", expenseDate: "2026-10-06", note: null };
const context = { data: { businessTimezone: "Europe/Istanbul", items: [], nextCursor: null }, response: { ok: true, status: 200 } };

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
  POST = jest.fn().mockResolvedValue({ data: accepted, response: { ok: true, status: 201 } }),
  GET = jest.fn((path: string) => Promise.resolve(path === "/fields/{fieldId}/diary" ? context : {
    data: [], response: { ok: true, status: 200 },
  })),
  onCreated = jest.fn(),
) {
  let screen!: TestRenderer;
  await act(async () => { screen = create(<ExpenseCreateScreen client={{ GET, POST } as unknown as ApiClient}
    fieldId="field-1" fieldName="Kuzey" now={now} createId={() => id} onCreated={onCreated} />); });
  return screen;
}
async function change(screen: TestRenderer, label: string, value: string) {
  await act(async () => { (node(screen, label).props.onChangeText as (value: string) => void)(value); });
}
async function press(screen: TestRenderer, label: string) {
  await act(async () => { (node(screen, label).props.onPress as () => void)(); });
}
async function validInput(screen: TestRenderer) {
  await change(screen, "Tutar", "12.345678");
  await press(screen, "Para birimi");
  await press(screen, "TRY");
  await press(screen, "Kategori");
  await press(screen, "Gübre");
}

describe("online Field expense capture", () => {
  it("requires an explicit currency on each new form, even after an earlier form selected TRY", async () => {
    const POST = jest.fn();
    const first = await mount(POST);
    expect(node(first, "Para birimi").props.value ?? "").toBe("");
    await change(first, "Tutar", "12.345678");
    await press(first, "Kategori"); await press(first, "Gübre");
    await press(first, "Gideri kaydet");
    expect(POST).not.toHaveBeenCalled();
    await press(first, "Para birimi"); await press(first, "TRY");
    await act(async () => first.unmount());
    const second = await mount(POST);
    expect(node(second, "Para birimi").props.value ?? "").toBe("");
    await act(async () => second.unmount());
  });

  it("offers the seven fixed categories with Turkish labels and accessible required and optional fields", async () => {
    const screen = await mount();
    for (const label of ["Tutar", "Para birimi", "Kategori", "Gider tarihi", "Not (isteğe bağlı)"]) {
      expect(node(screen, label)).toBeDefined();
    }
    expect(text(screen)).toContain("Kuzey");
    await press(screen, "Kategori");
    for (const label of ["Tohum / fide", "Gübre", "İlaç", "Yakıt", "İşçilik", "Sulama", "Diğer"]) {
      expect(node(screen, label)).toBeDefined();
    }
    await act(async () => screen.unmount());
  });

  it("searches the full ISO currency list by code", async () => {
    const screen = await mount();
    await press(screen, "Para birimi");
    await change(screen, "Para birimi ara", "USD");
    expect(node(screen, "USD")).toBeDefined();
    expect(screen.root.findAll(({ props }) => props.accessibilityLabel === "TRY")).toHaveLength(0);
    await act(async () => screen.unmount());
  });

  it("accepts the Turkish decimal separator and sends exact canonical decimal text", async () => {
    const POST = jest.fn().mockResolvedValue({ data: accepted, response: { ok: true, status: 201 } });
    const screen = await mount(POST);
    await change(screen, "Tutar", "12,345678");
    await press(screen, "Para birimi"); await press(screen, "TRY");
    await press(screen, "Kategori"); await press(screen, "Gübre");
    await press(screen, "Gideri kaydet");
    expect(POST.mock.calls[0]![1].body.amount).toBe("12.345678");
    expect(screen.root.findAll(({ props }) => props.accessibilityRole === "alert")).toHaveLength(0);
    await act(async () => screen.unmount());
  });

  it("submits exact decimal text and the chosen calendar date without constructing a timestamp", async () => {
    const POST = jest.fn().mockResolvedValue({ data: accepted, response: { ok: true, status: 201 } });
    const onCreated = jest.fn();
    const screen = await mount(POST, undefined, onCreated);
    await validInput(screen);
    expect(node(screen, "Gider tarihi").props.value).toBe("2026-10-06"); // Business-local today, UTC is still Oct 5.
    await press(screen, "Gideri kaydet");
    expect(POST).toHaveBeenCalledWith("/fields/{fieldId}/expenses", {
      params: { path: { fieldId: "field-1" } },
      body: { expenseId: id, amount: "12.345678", currency: "TRY", category: "FERTILIZER", expenseDate: "2026-10-06" },
    });
    expect(POST.mock.calls[0]![1].body).not.toHaveProperty("seasonId");
    expect(POST.mock.calls[0]![1].body).not.toHaveProperty("occurredAt");
    expect(onCreated).toHaveBeenCalledWith(accepted);
    await act(async () => screen.unmount());
  });

  it("rejects zero amount and a future Business-local date before sending a request", async () => {
    const POST = jest.fn();
    const screen = await mount(POST);
    await validInput(screen);
    await change(screen, "Tutar", "0");
    await press(screen, "Gideri kaydet");
    expect(POST).not.toHaveBeenCalled();
    await change(screen, "Tutar", "12.345678");
    await change(screen, "Gider tarihi", "2026-10-07");
    await press(screen, "Gideri kaydet");
    expect(POST).not.toHaveBeenCalled();
    expect(screen.root.findAll(({ props }) => props.accessibilityRole === "alert")).not.toHaveLength(0);
    await act(async () => screen.unmount());
  });

  it("shows pending status and accepts only after server confirmation", async () => {
    let resolve!: (value: unknown) => void;
    const POST = jest.fn(() => new Promise((accept) => { resolve = accept; }));
    const onCreated = jest.fn();
    const screen = await mount(POST, undefined, onCreated);
    await validInput(screen);
    const save = node(screen, "Gideri kaydet").props.onPress as () => void;
    await act(async () => { save(); save(); });
    expect(POST).toHaveBeenCalledTimes(1);
    expect(onCreated).not.toHaveBeenCalled();
    expect(node(screen, "Gider kaydediliyor").props.accessibilityRole).toBe("progressbar");
    expect(node(screen, "Gideri kaydet").props.accessibilityState).toMatchObject({ disabled: true, busy: true });
    await act(async () => { resolve({ data: accepted, response: { ok: true, status: 201 } }); });
    expect(onCreated).toHaveBeenCalledWith(accepted);
    await act(async () => screen.unmount());
  });

  it("retains the exact request in active form memory after an uncertain network result", async () => {
    const POST = jest.fn().mockRejectedValueOnce(new TypeError("Network request failed"))
      .mockResolvedValueOnce({ data: accepted, response: { ok: true, status: 200 } });
    const onCreated = jest.fn();
    const screen = await mount(POST, undefined, onCreated);
    await validInput(screen);
    await press(screen, "Gideri kaydet");
    expect(onCreated).not.toHaveBeenCalled();
    expect(text(screen)).not.toContain("Gider kaydedildi");
    expect(node(screen, "Tutar").props.value).toBe("12.345678");
    await press(screen, "Kaydı yeniden dene");
    expect(POST.mock.calls[1]).toEqual(POST.mock.calls[0]);
    expect(onCreated).toHaveBeenCalledTimes(1);
    expect(onCreated).toHaveBeenCalledWith(accepted);
    await act(async () => screen.unmount());
  });

  it("retains the exact request when a successful response has no parsed body", async () => {
    const POST = jest.fn().mockResolvedValueOnce({ data: undefined, response: { ok: true, status: 201 } })
      .mockResolvedValueOnce({ data: accepted, response: { ok: true, status: 200 } });
    const onCreated = jest.fn();
    const screen = await mount(POST, undefined, onCreated);
    await validInput(screen);
    await press(screen, "Gideri kaydet");
    expect(onCreated).not.toHaveBeenCalled();
    expect(text(screen)).not.toContain("Gider kaydedildi");
    expect(node(screen, "Tutar").props.value).toBe("12.345678");
    await press(screen, "Kaydı yeniden dene");
    expect(POST).toHaveBeenCalledTimes(2);
    expect(POST.mock.calls[1]).toEqual(POST.mock.calls[0]);
    expect(onCreated).toHaveBeenCalledWith(accepted);
    await act(async () => screen.unmount());
  });

  it.each([
    [400, "INVALID_REQUEST"], [403, "FORBIDDEN"], [500, "UNEXPECTED"],
  ])("keeps a %i %s response unaccepted and exposes an alert", async (status, code) => {
    const POST = jest.fn().mockResolvedValue({ error: { error: { code, message: "private detail", requestId: "r1" } }, response: { ok: false, status } });
    const onCreated = jest.fn();
    const screen = await mount(POST, undefined, onCreated);
    await validInput(screen);
    await press(screen, "Gideri kaydet");
    expect(onCreated).not.toHaveBeenCalled();
    expect(text(screen)).not.toContain("Gider kaydedildi");
    expect(text(screen)).not.toContain("private detail");
    expect(screen.root.findAll(({ props }) => props.accessibilityRole === "alert")).not.toHaveLength(0);
    await act(async () => screen.unmount());
  });

  it("blocks submission while Business context is unavailable and offers a retry", async () => {
    const POST = jest.fn();
    const GET = jest.fn().mockRejectedValueOnce(new TypeError("offline")).mockResolvedValueOnce(context);
    const screen = await mount(POST, GET);
    expect(node(screen, "Gideri kaydet").props.accessibilityState).toMatchObject({ disabled: true });
    await press(screen, "Bilgileri yeniden yükle");
    expect(GET).toHaveBeenCalledTimes(4);
    expect(GET.mock.calls.map(([path]) => path)).toEqual([
      "/fields/{fieldId}/diary", "/fields/{fieldId}/expenses/seasons", "/fields/{fieldId}/diary", "/fields/{fieldId}/expenses/seasons",
    ]);
    expect(POST).not.toHaveBeenCalled();
    await act(async () => screen.unmount());
  });
});
