import { Text } from "react-native";
import { FieldsScreen, FieldDetailScreen } from "../../src/features/fields/fields-screen";

type Element = { type: unknown; props: Record<string, unknown> };
// react-test-renderer v19 ships without declarations; keep the test API narrowly typed.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act, create } = require("react-test-renderer") as {
  act: (callback: () => void | Promise<void>) => Promise<void>;
  create: (element: React.ReactElement) => { root: { findByProps: (props: Record<string, unknown>) => { props: Record<string, unknown> }; findAll: (predicate: (node: Element) => boolean) => Element[] }; toJSON: () => unknown };
};
function callProp(node: { props: Record<string, unknown> }, key: string) {
  const callback = node.props[key];
  if (typeof callback === "function") return (callback as () => unknown)();
  return undefined;
}

function collectElements(node: unknown): Element[] {
  if (Array.isArray(node)) return node.flatMap(collectElements);
  if (node === null || typeof node !== "object" || !("props" in node)) return [];
  const element = node as Element;
  const jsonChildren = "children" in node ? (node as { children?: unknown }).children : undefined;
  return [element, ...collectElements(element.props.children ?? jsonChildren)];
}

const field = {
  id: "field-1",
  name: "Bahçe",
  version: 3,
  representativePoint: { type: "Point" as const, coordinates: [29.02, 41.01] as [number, number] },
  hasCurrentBoundary: true,
};
const detail = {
  ...field,
  regionContext: {
    administrativeLocation: { state: "UNRESOLVED", code: null, label: null, sourceId: null, confidence: null, dataVersion: null, resolvedAt: null },
    agriculturalRegion: { state: "UNRESOLVED", code: null, label: null, sourceId: null, confidence: null, dataVersion: null, resolvedAt: null },
    agriculturalRegionOverride: null,
  },
  boundary: { type: "Polygon", coordinates: [[[29, 41], [29.1, 41], [29.1, 41.1], [29, 41]]] },
  activeSeason: { id: "season-1", status: "ACTIVE" as const, cropLabel: "Arpa", plantingDate: "2026-09-01" },
};

describe("Fields list and detail screens", () => {
  test("shows loading, empty, retryable error, and authorized Field navigation states", async () => {
    let resolveList!: (value: unknown) => void;
    const pending = new Promise((resolve) => { resolveList = resolve; });
    const emptyClient = { GET: jest.fn().mockImplementation(() => pending) } as never;
    let root: ReturnType<typeof create>;

    await act(async () => { root = create(<FieldsScreen client={emptyClient} />); });
    expect(JSON.stringify(root!.toJSON())).toContain("Yükleniyor");
    await act(async () => resolveList({ response: { ok: true }, data: { items: [], nextCursor: null }, error: undefined }));
    expect(JSON.stringify(root!.toJSON())).toContain("Henüz tarla yok");

    const get = jest.fn()
      .mockResolvedValueOnce({ response: { ok: false, status: 503 }, error: {} })
      .mockResolvedValueOnce({ response: { ok: true }, data: { items: [field], nextCursor: null }, error: undefined });
    const client = { GET: get } as never;
    const onOpenField = jest.fn();
    await act(async () => { root = create(<FieldsScreen client={client} onOpenField={onOpenField} />); });
    expect(JSON.stringify(root!.toJSON())).toContain("yüklenemedi");
    const retry = root!.root.findByProps({ accessibilityLabel: "Tarlaları yeniden yükle" });
    await act(async () => { await callProp(retry, "onPress"); });
    expect(JSON.stringify(root!.toJSON())).toContain("Bahçe");

    const open = root!.root.findByProps({ accessibilityLabel: "Bahçe tarlasını aç" });
    expect(open.props.accessibilityRole).toBe("button");
    await act(async () => { await callProp(open, "onPress"); });
    expect(onOpenField).toHaveBeenCalledWith(field.id);
    expect(get).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(get.mock.calls[0]?.[0])).toContain("/fields");
  });

  test("loads one page at a time, continues on request, and avoids duplicate Fields", async () => {
    const get = jest.fn()
      .mockResolvedValueOnce({ response: { ok: true }, data: { items: [field], nextCursor: "next" }, error: undefined })
      .mockResolvedValueOnce({ response: { ok: true }, data: { items: [field, { ...field, id: "field-2", name: "Zeytinlik" }, { ...field, id: "field-2", name: "Zeytinlik" }], nextCursor: null }, error: undefined });
    let root: ReturnType<typeof create>;
    await act(async () => { root = create(<FieldsScreen client={{ GET: get } as never} />); });
    expect(JSON.stringify(root!.toJSON())).not.toContain("Zeytinlik");
    expect(get).toHaveBeenCalledTimes(1);
    const more = root!.root.findByProps({ accessibilityLabel: "Daha fazla tarla yükle" });
    await act(async () => { await callProp(more, "onPress"); });
    expect(JSON.stringify(root!.toJSON())).toContain("Zeytinlik");
    const rendered = collectElements(root!.toJSON());
    expect(rendered.filter((node) => node.props.accessibilityLabel === "Bahçe tarlasını aç")).toHaveLength(1);
    expect(rendered.filter((node) => node.props.accessibilityLabel === "Zeytinlik tarlasını aç")).toHaveLength(1);
    expect(get).toHaveBeenNthCalledWith(2, "/fields", expect.objectContaining({ params: expect.objectContaining({ query: { limit: 50, cursor: "next" } }) }));
    expect(get).toHaveBeenCalledTimes(2);
  });

  test("retries the failed continuation cursor without reloading the first page", async () => {
    const get = jest.fn()
      .mockResolvedValueOnce({ response: { ok: true }, data: { items: [field], nextCursor: "next" }, error: undefined })
      .mockResolvedValueOnce({ response: { ok: false, status: 503 }, error: {} })
      .mockResolvedValueOnce({ response: { ok: true }, data: { items: [{ ...field, id: "field-2", name: "Zeytinlik" }], nextCursor: null }, error: undefined });
    let root: ReturnType<typeof create>;
    await act(async () => { root = create(<FieldsScreen client={{ GET: get } as never} />); });
    const more = root!.root.findByProps({ accessibilityLabel: "Daha fazla tarla yükle" });
    await act(async () => { await callProp(more, "onPress"); });
    expect(JSON.stringify(root!.toJSON())).toContain("Tarlalar yüklenemedi");
    const retry = root!.root.findByProps({ accessibilityLabel: "Kalan tarlaları yeniden yükle" });
    await act(async () => { await callProp(retry, "onPress"); });
    expect(JSON.stringify(root!.toJSON())).toContain("Zeytinlik");
    expect(get).toHaveBeenCalledTimes(3);
    for (const call of get.mock.calls.slice(1)) {
      expect(call[1].params.query).toEqual({ limit: 50, cursor: "next" });
    }
  });

  test("detail explains unresolved region and shows only a read-only ACTIVE season summary", async () => {
    const get = jest.fn().mockResolvedValue({ response: { ok: true }, data: detail, error: undefined });
    const client = { GET: get } as never;
    let root: ReturnType<typeof create>;
    await act(async () => { root = create(<FieldDetailScreen client={client} fieldId={field.id} onBack={jest.fn()} />); });

    const view = JSON.stringify(root!.toJSON());
    expect(view).toContain("Bahçe");
    expect(view).toContain("29.02");
    expect(view).toContain("Polygon");
    expect(view).toContain("41.00000, 29.00000");
    expect(view).toContain("Bölge bilgisi henüz belirlenmedi");
    expect(view).toContain('"accessibilityLiveRegion":"polite"');
    expect(view).toContain("Arpa");
    expect(view).toContain("1 Eyl 2026");
    expect(view).not.toContain("Düzenle");
    expect(collectElements(root!.toJSON()).some(({ type, props }) => type === Text && props.accessibilityRole === "progressbar")).toBe(false);
    expect(get).toHaveBeenCalledTimes(1);
    expect(get.mock.calls[0]?.[1].params.path.fieldId).toBe(field.id);
  });

  test("denied detail access has a retry action without exposing private record details", async () => {
    const get = jest.fn().mockResolvedValueOnce({ response: { ok: false, status: 403 }, error: { message: "private Business details" } })
      .mockResolvedValueOnce({ response: { ok: true }, data: { ...detail, activeSeason: null }, error: undefined });
    const client = { GET: get } as never;
    let root: ReturnType<typeof create>;
    await act(async () => { root = create(<FieldDetailScreen client={client} fieldId={field.id} onBack={jest.fn()} />); });

    const deniedView = JSON.stringify(root!.toJSON());
    expect(deniedView).toContain("erişim");
    expect(deniedView).not.toContain("private Business");
    const retry = root!.root.findByProps({ accessibilityLabel: "Tarlayı yeniden yükle" });
    expect(retry.props.accessibilityRole).toBe("button");
    await act(async () => { await callProp(retry, "onPress"); });
    expect(JSON.stringify(root!.toJSON())).toContain("Bahçe");
    expect(JSON.stringify(root!.toJSON())).not.toContain("Arpa");
  });
});
