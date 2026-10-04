import { Text, TextInput } from "react-native";
import type { FieldComponents } from "../../../../packages/api-client/src/index";
import { FieldEditScreen } from "../../src/features/fields/field-edit-screen";

type Renderer = {
  root: {
    findByProps: (props: Record<string, unknown>) => { type: unknown; props: Record<string, unknown> };
    findAll: (predicate: (node: { type: unknown; props: Record<string, unknown> }) => boolean) => Array<{ type: unknown; props: Record<string, unknown> }>;
  };
  toJSON: () => unknown;
};
// react-test-renderer v19 ships without declarations; keep this test API narrow.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act, create } = require("react-test-renderer") as {
  act: (callback: () => void | Promise<void>) => Promise<void>;
  create: (element: React.ReactElement) => Renderer;
};
function callProp(node: { props: Record<string, unknown> }, key: string, ...args: unknown[]) {
  const callback = node.props[key];
  if (typeof callback === "function") return (callback as (...values: unknown[]) => unknown)(...args);
  return undefined;
}

const field: FieldComponents["schemas"]["FieldDetail"] = {
  id: "field-1", name: "North field", version: 1,
  representativePoint: { type: "Point", coordinates: [29.02, 41.01] },
  hasCurrentBoundary: false, boundary: null, activeSeason: null,
  regionContext: {
    administrativeLocation: { state: "UNRESOLVED", resolvedAt: null },
    agriculturalRegion: { state: "UNRESOLVED", resolvedAt: null },
    agriculturalRegionOverride: null,
  },
};

describe("Field edit stale-version recovery", () => {
  test("keeps an ordinary save error visible through only one announcement path", async () => {
    const PATCH = jest.fn().mockRejectedValue(new Error("Connection failed. Try again."));
    let root!: Renderer;
    await act(async () => { root = create(<FieldEditScreen client={{ PATCH } as never} field={field} onSaved={jest.fn()} />); });
    const save = root.root.findByProps({ accessibilityLabel: "Değişiklikleri kaydet" });
    await act(async () => { await callProp(save, "onPress"); });

    const announcements = root.root.findAll((node) => node.type === Text && (
      node.props.accessibilityLiveRegion === "polite" || node.props.accessibilityRole === "alert"
    ));
    expect(JSON.stringify(root.toJSON())).toContain("Tarla bilgileri kaydedilemedi. Bağlantınızı kontrol edin.");
    expect(announcements).toHaveLength(1);
    expect(announcements[0]?.props.accessibilityLiveRegion).toBe("polite");
  });

  test("announces an explicit retry as a new save attempt after a stale conflict", async () => {
    const latest = { ...field, name: "Changed elsewhere", version: 2 };
    let resolveRetry!: (result: unknown) => void;
    const GET = jest.fn().mockResolvedValue({ data: latest, error: undefined, response: { ok: true, status: 200 } });
    const PATCH = jest.fn()
      .mockResolvedValueOnce({ data: undefined, error: { error: { code: "STALE_VERSION" } }, response: { ok: false, status: 409 } })
      .mockImplementationOnce(() => new Promise((resolve) => { resolveRetry = resolve; }));
    let root!: Renderer;
    const onSaved = jest.fn();
    await act(async () => { root = create(<FieldEditScreen client={{ GET, PATCH } as never} field={field} onSaved={onSaved} />); });
    const save = root.root.findByProps({ accessibilityLabel: "Değişiklikleri kaydet" });
    await act(async () => { await callProp(save, "onPress"); });
    const announcements = () => root.root.findAll((node) => node.type === Text && (
      node.props.accessibilityLiveRegion === "polite" || node.props.accessibilityRole === "alert"
    ));
    expect(JSON.stringify(root.toJSON())).toContain("Değişiklik başka bir cihazda güncellendi");
    expect(announcements()).toHaveLength(1);
    const retry = root.root.findByProps({ accessibilityLabel: "Kendi değişikliğimi yeniden gönder" });
    await act(async () => { callProp(retry, "onPress"); await Promise.resolve(); });

    expect(JSON.stringify(root.toJSON())).toContain("Tarla değişiklikleri kaydediliyor");
    expect(announcements()).toHaveLength(1);
    await act(async () => {
      resolveRetry({ data: latest, error: undefined, response: { ok: true, status: 200 } });
      await Promise.resolve();
    });
    expect(onSaved).toHaveBeenCalledWith(latest);
    expect(announcements()).toHaveLength(0);
  });

  test("preserves attempted values and waits for an explicit farmer choice before another mutation", async () => {
    const latest = { ...field, name: "Changed elsewhere", version: 2,
      representativePoint: { type: "Point" as const, coordinates: [30.2, 42.3] as [number, number] },
      hasCurrentBoundary: true, boundary: { type: "Polygon" as const, coordinates: [[[30, 42], [31, 42], [31, 43], [30, 42]]] },
      regionContext: { ...field.regionContext, agriculturalRegionOverride: { code: "R-2", label: "Northern Region" } } };
    const saved = { ...field, name: "My attempted name", version: 3 };
    const GET = jest.fn().mockResolvedValue({ data: latest, error: undefined, response: { ok: true, status: 200 } });
    const PATCH = jest.fn()
      .mockResolvedValueOnce({ data: undefined, error: { error: { code: "STALE_VERSION", message: "Stale", requestId: "request-1" } }, response: { ok: false, status: 409 } })
      .mockResolvedValueOnce({ data: saved, error: undefined, response: { ok: true, status: 200 } });
    const client = { GET, PATCH } as never;
    let root!: Renderer;

    await act(async () => { root = create(<FieldEditScreen client={client} field={field} onSaved={jest.fn()} />); });
    const name = root.root.findByProps({ accessibilityLabel: "Tarla adı" });
    expect(name.type).toBe(TextInput);
    await act(async () => { callProp(name, "onChangeText", "My attempted name"); });
    const code = root.root.findByProps({ accessibilityLabel: "Tarımsal bölge kodu" });
    const label = root.root.findByProps({ accessibilityLabel: "Tarımsal bölge adı" });
    await act(async () => {
      callProp(code, "onChangeText", "ATTEMPT-REGION");
      callProp(label, "onChangeText", "My attempted region");
    });
    const polygonMode = root.root.findByProps({ accessibilityLabel: "Tarla sınırı çiz" });
    await act(async () => { await callProp(polygonMode, "onPress"); });
    const map = root.root.findByProps({ testID: "onboarding-map" });
    const tap = (longitude: number, latitude: number) => callProp(map, "onPress", { nativeEvent: { coordinate: { longitude, latitude } } });
    await act(async () => {
      tap(30, 42);
      tap(31, 42);
      tap(31, 43);
    });
    const finishPolygon = root.root.findByProps({ accessibilityLabel: "Sınırı tamamla" });
    await act(async () => { await callProp(finishPolygon, "onPress"); });
    const save = root.root.findByProps({ accessibilityLabel: "Değişiklikleri kaydet" });
    expect(typeof save.props.onPress).toBe("function");
    await act(async () => { await callProp(save, "onPress"); });

    let view = JSON.stringify(root.toJSON());
    expect(view).toContain("Değişiklik başka bir cihazda güncellendi");
    expect(view).toContain("Changed elsewhere");
    expect(view).toContain("My attempted name");
    expect(view).toContain("30.2");
    expect(view).toContain("Northern Region");
    expect(view).toContain("Polygon");
    expect(view).toContain("42.00000, 30.00000");
    expect(root.root.findByProps({ accessibilityLabel: "Tarımsal bölge kodu" }).props.value).toBe("ATTEMPT-REGION");
    expect(root.root.findByProps({ accessibilityLabel: "Tarımsal bölge adı" }).props.value).toBe("My attempted region");
    expect(PATCH).toHaveBeenCalledTimes(1);
    expect(GET).toHaveBeenCalledTimes(1);

    const retry = root.root.findByProps({ accessibilityLabel: "Kendi değişikliğimi yeniden gönder" });
    await act(async () => { await callProp(retry, "onPress"); });
    view = JSON.stringify(root.toJSON());
    expect(PATCH).toHaveBeenCalledTimes(2);
    expect(PATCH.mock.calls[1]?.[1].params.header["If-Match"]).toBe('"2"');
    expect(PATCH.mock.calls[1]?.[1].body).toEqual({
      name: "My attempted name",
      location: { type: "POLYGON", polygon: { type: "Polygon", coordinates: [[[30, 42], [31, 42], [31, 43], [30, 42]]] } },
      agriculturalRegionOverride: { code: "ATTEMPT-REGION", label: "My attempted region" },
    });
    expect(view).toContain("My attempted name");
  });
});
