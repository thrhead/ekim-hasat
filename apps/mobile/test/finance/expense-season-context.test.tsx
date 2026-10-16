import { act, create, type TestRenderer } from "react-test-renderer";
import type { ApiClient } from "../../../../packages/api-client/src/index";
import { ExpenseCreateScreen } from "../../src/features/finance/expense-create-screen";

const expenseId = "11111111-1111-4111-8111-111111111111";
const accepted = { id: expenseId, fieldId: "field-1", seasonId: "season-1", amount: "12.50", currency: "TRY", category: "FERTILIZER", expenseDate: "2026-10-06", note: null };
const context = { data: { businessTimezone: "Europe/Istanbul", items: [], nextCursor: null }, response: { ok: true, status: 200 } };

function node(screen: TestRenderer, label: string) {
  const found = screen.root.findAll(({ props }) => props.accessibilityLabel === label)[0];
  expect(found).toBeDefined();
  return found!;
}
async function change(screen: TestRenderer, label: string, value: string) {
  await act(async () => { (node(screen, label).props.onChangeText as (value: string) => void)(value); });
}
async function press(screen: TestRenderer, label: string) {
  await act(async () => { (node(screen, label).props.onPress as () => void)(); });
}

describe("Expense Season context", () => {
  it("offers all available same-Field Seasons and keeps Season optional", async () => {
    const POST = jest.fn().mockResolvedValue({ data: accepted, response: { ok: true, status: 201 } });
    const GET = jest.fn((path: string) => Promise.resolve(path === "/fields/{fieldId}/diary" ? context : {
      data: [
        { id: "season-draft", cropLabel: "Buğday", status: "DRAFT" },
        { id: "season-1", cropLabel: "Arpa", status: "ACTIVE" },
      ],
      response: { ok: true, status: 200 },
    }));
    let screen!: TestRenderer;
    await act(async () => { screen = create(<ExpenseCreateScreen
      client={{ GET, POST } as unknown as ApiClient} fieldId="field-1" fieldName="Kuzey"
      now={() => new Date("2026-10-05T22:30:00Z")} createId={() => expenseId} />); });
    expect(GET).toHaveBeenCalledWith("/fields/{fieldId}/expenses/seasons", { params: { path: { fieldId: "field-1" } } });
    expect(screen.root.findAll(({ props }) => props.children === "Sezon seçin").length).toBeGreaterThan(0);
    await press(screen, "Sezon");
    expect(node(screen, "Buğday · Taslak")).toBeDefined();
    expect(node(screen, "Arpa · Aktif")).toBeDefined();
    expect(screen.root.findAll(({ props }) => props.accessibilityLabel === "season-from-another-field")).toHaveLength(0);
    await press(screen, "Buğday · Taslak");
    await change(screen, "Tutar", "12.50");
    await press(screen, "Para birimi"); await press(screen, "TRY");
    await press(screen, "Kategori"); await press(screen, "Gübre");
    await press(screen, "Gideri kaydet");
    expect(POST.mock.calls[0]![1].params.path.fieldId).toBe("field-1");
    expect(POST.mock.calls[0]![1].body.seasonId).toBe("season-draft");
    await act(async () => screen.unmount());
  });

  it("keeps the Field fixed and submits only the Season supplied by its Field Diary context", async () => {
    const POST = jest.fn().mockResolvedValue({ data: accepted, response: { ok: true, status: 201 } });
    const GET = jest.fn((path: string) => Promise.resolve(path === "/fields/{fieldId}/diary" ? context : {
      data: [], response: { ok: true, status: 200 },
    }));
    let screen!: TestRenderer;
    await act(async () => { screen = create(<ExpenseCreateScreen
      client={{ GET, POST } as unknown as ApiClient}
      fieldId="field-1" fieldName="Kuzey" seasonId="season-1" now={() => new Date("2026-10-05T22:30:00Z")}
      createId={() => expenseId} />); });
    expect(node(screen, "Tutar")).toBeDefined();
    expect(screen.root.findAll(({ props }) => props.accessibilityLabel === "Tarla seç")).toHaveLength(0);
    await change(screen, "Tutar", "12.50");
    await press(screen, "Para birimi"); await press(screen, "TRY");
    await press(screen, "Kategori"); await press(screen, "Gübre");
    await press(screen, "Gideri kaydet");
    expect(POST).toHaveBeenCalledWith("/fields/{fieldId}/expenses", {
      params: { path: { fieldId: "field-1" } },
      body: { expenseId, amount: "12.50", currency: "TRY", category: "FERTILIZER", expenseDate: "2026-10-06", seasonId: "season-1" },
    });
    expect(screen.root.findAll(({ props }) => props.children === "Seçili sezon").length).toBeGreaterThan(0);
    await act(async () => screen.unmount());
  });

  it("leaves Season omitted for a Field-only capture", async () => {
    const POST = jest.fn().mockResolvedValue({ data: { ...accepted, seasonId: null }, response: { ok: true, status: 201 } });
    const GET = jest.fn((path: string) => Promise.resolve(path === "/fields/{fieldId}/diary" ? context : {
      data: [], response: { ok: true, status: 200 },
    }));
    let screen!: TestRenderer;
    await act(async () => { screen = create(<ExpenseCreateScreen
      client={{ GET, POST } as unknown as ApiClient}
      fieldId="field-1" fieldName="Kuzey" now={() => new Date("2026-10-05T22:30:00Z")} createId={() => expenseId} />); });
    await change(screen, "Tutar", "12.50");
    await press(screen, "Para birimi"); await press(screen, "TRY");
    await press(screen, "Kategori"); await press(screen, "Gübre");
    await press(screen, "Gideri kaydet");
    expect(POST.mock.calls[0]![1].params.path.fieldId).toBe("field-1");
    expect(POST.mock.calls[0]![1].body).not.toHaveProperty("seasonId");
    expect(screen.root.findAll(({ props }) => props.accessibilityLabel === "Sezonla ilişkilendirildi")).toHaveLength(0);
    await act(async () => screen.unmount());
  });
});
