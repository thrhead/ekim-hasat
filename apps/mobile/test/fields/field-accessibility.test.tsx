import { Text } from "react-native";
import type { FieldComponents } from "../../../../packages/api-client/src/index";
import { FieldRegionContextView } from "../../src/features/fields/field-region-context";
import { FieldStatusAnnouncement } from "../../src/features/fields/field-status-announcement";

type Element = { type: unknown; props: Record<string, unknown> };
// react-test-renderer v19 ships without declarations; keep its API narrowly typed.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act, create } = require("react-test-renderer") as {
  act: (callback: () => void | Promise<void>) => Promise<void>;
  create: (element: React.ReactElement) => {
    root: { findAll: (predicate: (node: Element) => boolean) => Element[] };
    update: (element: React.ReactElement) => void;
    toJSON: () => unknown;
  };
};

function collectElements(node: unknown): Element[] {
  if (Array.isArray(node)) return node.flatMap(collectElements);
  if (node === null || typeof node !== "object" || !("props" in node)) return [];
  const element = node as Element;
  return [element, ...collectElements(element.props.children)];
}

const unresolved: FieldComponents["schemas"]["RegionContext"] = {
  administrativeLocation: { state: "UNRESOLVED", resolvedAt: null },
  agriculturalRegion: { state: "UNRESOLVED", resolvedAt: null },
  agriculturalRegionOverride: null,
};

const resolvedWithOverride: FieldComponents["schemas"]["RegionContext"] = {
  administrativeLocation: {
    state: "RESOLVED", code: "ADM-1", label: "Administrative area", sourceId: "source-a",
    confidence: 0.9, dataVersion: "2026-09", resolvedAt: "2026-10-02T12:00:00.000Z",
  },
  agriculturalRegion: {
    state: "RESOLVED", code: "AUTO-1", label: "Automatic area", sourceId: "source-b",
    confidence: 0.8, dataVersion: "2026-09", resolvedAt: "2026-10-02T12:00:00.000Z",
  },
  agriculturalRegionOverride: { code: "MANUAL-1", label: "Farmer choice" },
};

describe("Field region accessibility", () => {
  it("shows loading and unresolved meaning in text, independent of color", () => {
    const tree = collectElements(FieldRegionContextView({
      context: unresolved,
      resolutionState: "LOADING",
    }));
    const text = tree.filter(({ type }) => type === Text).map(({ props }) => String(props.children)).join(" ");
    expect(text).toContain("Bölge önerileri kontrol ediliyor");
    expect(text).toContain("Bölge bilgisi henüz belirlenmedi");
    expect(tree.some(({ props }) => props.accessibilityRole === "progressbar")).toBe(true);
  });

  it("shows resolved administrative data and the farmer override instead of the automatic agricultural suggestion", () => {
    const tree = collectElements(FieldRegionContextView({ context: resolvedWithOverride, resolutionState: "IDLE" }));
    const text = tree.filter(({ type }) => type === Text).map(({ props }) => String(props.children)).join(" ");
    expect(text).toContain("Administrative area");
    expect(text).toContain("Farmer choice");
    expect(text).not.toContain("Automatic area");
  });

  it("shows lookup errors and location conflicts as readable text", () => {
    const error = collectElements(FieldRegionContextView({
      context: unresolved,
      resolutionState: "ERROR",
      errorMessage: "Bölge bilgisi alınamadı. Daha sonra tekrar deneyin.",
    }));
    const conflict = collectElements(FieldRegionContextView({
      context: unresolved,
      resolutionState: "CONFLICT",
      errorMessage: "Konum değişti. Bölge önerileri yeniden kontrol edilecek.",
    }));
    expect(error.filter(({ type }) => type === Text).map(({ props }) => String(props.children)).join(" "))
      .toContain("Bölge bilgisi alınamadı");
    expect(conflict.filter(({ type }) => type === Text).map(({ props }) => String(props.children)).join(" "))
      .toContain("Konum değişti");
  });

  it("announces one screen-level message for each meaningful async transition and deduplicates repeated renders", async () => {
    let root: ReturnType<typeof create>;
    await act(async () => {
      root = create(<FieldStatusAnnouncement transitionKey="field-save:pending" message="Tarla kaydediliyor" />);
    });
    const liveText = () => root!.root.findAll((node) => node.type === Text && node.props.accessibilityLiveRegion === "polite");
    expect(liveText()).toHaveLength(1);
    expect(liveText()[0]?.props.children).toBe("Tarla kaydediliyor");

    await act(async () => {
      root!.update(<FieldStatusAnnouncement transitionKey="field-save:pending" message="Tarla kaydediliyor" />);
      root!.update(<FieldStatusAnnouncement transitionKey="field-save:pending" message="Tarla kaydediliyor" />);
    });
    expect(liveText()).toHaveLength(1);

    await act(async () => {
      root!.update(<FieldStatusAnnouncement transitionKey="region-resolution:complete" message="Bölge önerileri güncellendi" />);
    });
    expect(liveText()).toHaveLength(1);
    expect(liveText()[0]?.props.children).toBe("Bölge önerileri güncellendi");
    expect(liveText()[0]?.props.accessibilityRole).toBe("text");
  });

  it("clears an inactive status and permits a later attempt with the same transition identity", async () => {
    let root: ReturnType<typeof create>;
    await act(async () => { root = create(<FieldStatusAnnouncement transitionKey="save:pending" message="Tarla kaydediliyor" />); });
    const liveText = () => root!.root.findAll((node) => node.type === Text && node.props.accessibilityLiveRegion === "polite");
    await act(async () => { root!.update(<FieldStatusAnnouncement transitionKey={null} message={null} />); });
    expect(liveText()).toHaveLength(0);
    await act(async () => { root!.update(<FieldStatusAnnouncement transitionKey="save:pending" message="Tarla kaydediliyor" />); });
    expect(liveText()).toHaveLength(1);
  });

  it("announces resolved and unavailable region-result transitions and clears the message while loading", async () => {
    let root: ReturnType<typeof create>;
    await act(async () => { root = create(<FieldRegionContextView context={unresolved} resolutionState="LOADING" />); });
    const liveText = () => root!.root.findAll((node) => node.type === Text && node.props.accessibilityLiveRegion === "polite");
    expect(liveText().map((node) => node.props.children).join(" ")).toContain("Bölge önerileri kontrol ediliyor");
    expect(liveText().map((node) => node.props.children).join(" ")).not.toContain("Bölge bilgisi henüz belirlenmedi.");
    await act(async () => { root!.update(<FieldRegionContextView context={resolvedWithOverride} resolutionState="IDLE" />); });
    expect(liveText().map((node) => node.props.children).join(" ")).toContain("Bölge bilgileri güncellendi");
    expect(liveText()).toHaveLength(1);
    await act(async () => { root!.update(<FieldRegionContextView context={unresolved} resolutionState="LOADING" />); });
    expect(liveText().map((node) => node.props.children).join(" ")).not.toContain("Bölge bilgileri güncellendi");
    await act(async () => { root!.update(<FieldRegionContextView context={unresolved} resolutionState="ERROR" />); });
    expect(liveText().map((node) => node.props.children).join(" ")).toContain("Bölge bilgisi alınamadı");
    expect(liveText()).toHaveLength(1);
  });
});
