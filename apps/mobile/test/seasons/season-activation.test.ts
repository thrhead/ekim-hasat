import { activateSeason, readTodayPlannedWork, refreshSeasonAfterConflict } from "../../src/features/seasons/season-activation";
import { SeasonSetupActionButton } from "../../src/features/seasons/season-setup-screen";
import { TodayContent } from "../../src/features/seasons/today-screen";
import { Pressable, Text } from "react-native";
import type { ApiClient, SeasonComponents } from "../../src/api/onboarding-client";

type Element = { type: unknown; props: Record<string, unknown> };
function collectElements(node: unknown): Element[] {
  if (Array.isArray(node)) return node.flatMap(collectElements);
  if (node === null || typeof node !== "object" || !("props" in node)) return [];
  const element = node as Element;
  return [element, ...collectElements(element.props.children)];
}

const draft = (source: "MANUAL" | "VALIDATED_TEMPLATE", tasks: SeasonComponents["schemas"]["PlanTask"][] = [{ id: "task-1", title: "Gözlem", plannedLocalDate: "2026-08-02", version: 1 }]): SeasonComponents["schemas"]["SeasonDraft"] => ({
  id: "season-1", fieldId: "field-1", cropDisplayName: "Arpa", sowingPlantingDate: "2026-08-01", status: "DRAFT", version: 3,
  plan: { source: { kind: source, validationLabel: source === "MANUAL" ? "NOT_CENTRALLY_VALIDATED" : "CENTRALLY_VALIDATED", ...(source === "VALIDATED_TEMPLATE" ? { templateVersionId: "template-1" } : {}) }, tasks },
});
const active: SeasonComponents["schemas"]["ActiveSeason"] = { ...draft("MANUAL"), status: "ACTIVE", activatedAt: "2026-08-02T03:00:00.000Z" };

describe("mobile server-authoritative activation and Today", () => {
  it.each(["MANUAL", "VALIDATED_TEMPLATE"] as const)("explains zero-task %s drafts without calling activation", async (source) => {
    const POST = jest.fn();
    await expect(activateSeason({ POST } as unknown as ApiClient, draft(source, []), "activation-key")).rejects.toThrow(/en az bir görev/);
    expect(POST).not.toHaveBeenCalled();
  });

  it("sends the draft version and stable idempotency key and returns the server activation", async () => {
    const POST = jest.fn().mockResolvedValue({ data: active, error: undefined, response: { ok: true, status: 200 } });
    await expect(activateSeason({ POST } as unknown as ApiClient, draft("MANUAL"), "activation-key")).resolves.toMatchObject({ season: active, kind: "activated" });
    expect(POST).toHaveBeenCalledWith("/seasons/{seasonId}/activate", { params: { path: { seasonId: "season-1" }, header: { "If-Match": '"3"', "Idempotency-Key": "activation-key" } } });
  });

  it("does not report activation success on 409 and requires a fresh season read", async () => {
    const POST = jest.fn().mockResolvedValue({ data: undefined, error: { error: { code: "SEASON_STATE_CONFLICT" } }, response: { ok: false, status: 409 } });
    const GET = jest.fn().mockResolvedValue({ data: active, error: undefined, response: { ok: true } });
    await expect(activateSeason({ POST } as unknown as ApiClient, draft("VALIDATED_TEMPLATE"), "activation-key")).rejects.toMatchObject({ status: 409 });
    await expect(refreshSeasonAfterConflict({ GET } as unknown as ApiClient, "season-1")).resolves.toEqual(active);
    expect(GET).toHaveBeenCalledWith("/seasons/{seasonId}", { params: { path: { seasonId: "season-1" } } });
  });

  it("renders Today's server-local date and tasks without a completion callback", async () => {
    const payload = { localDate: "2026-08-02", businessTimezone: "Europe/Istanbul", tasks: [{ id: "task-1", seasonId: "season-1", fieldId: "field-1", cropDisplayName: "Arpa", title: "Gözlem", plannedLocalDate: "2026-08-02", sourceKind: "MANUAL" as const, taskVersion: 1 }] };
    const GET = jest.fn().mockResolvedValue({ data: payload, error: undefined, response: { ok: true } });
    await expect(readTodayPlannedWork({ GET } as unknown as ApiClient)).resolves.toEqual(payload);
    expect(GET).toHaveBeenCalledWith("/today");
    const zeroTasks = { ...payload, tasks: [] };
    expect(zeroTasks.tasks).toHaveLength(0);
    expect(SeasonSetupActionButton({ label: "Planı onayla ve sezonu başlat", onPress: jest.fn(), disabled: true }).props.accessibilityState.disabled).toBe(true);
    const view = collectElements(TodayContent({ loading: false, error: null, data: payload, onRetry: jest.fn() }));
    expect(view.some(({ type, props }) => type === Text && props.accessibilityLabel === "İş tarihi 2026-08-02")).toBe(true);
    expect(view.some(({ type, props }) => type === Text && props.children === "Gözlem")).toBe(true);
    expect(view.some(({ type }) => type === Pressable)).toBe(false);
  });

  it("renders accessible loading, empty-day, and retry error states", () => {
    const loading = collectElements(TodayContent({ loading: true, error: null, data: null, onRetry: jest.fn() }));
    expect(loading.some(({ type, props }) => type === Text && props.accessibilityRole === "progressbar"
      && props.accessibilityLabel === "Bugünün işleri yükleniyor")).toBe(true);

    const empty = collectElements(TodayContent({ loading: false, error: null, data: { localDate: "2026-08-02", businessTimezone: "Europe/Istanbul", tasks: [] }, onRetry: jest.fn() }));
    expect(empty.some(({ type, props }) => type === Text && props.children === "Bugün için planlanmış iş yok.")).toBe(true);

    const onRetry = jest.fn();
    const failed = collectElements(TodayContent({ loading: false, error: "Yüklenemedi", data: null, onRetry }));
    expect(failed.some(({ type, props }) => type === Text && props.accessibilityRole === "alert")).toBe(true);
    const retry = failed.find(({ type, props }) => type === Pressable && props.accessibilityLabel === "Bugünün işlerini yeniden yükle");
    expect(retry?.props.accessibilityRole).toBe("button");
    (retry?.props.onPress as (() => void) | undefined)?.();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("rejects Today API errors for retry UI instead of deriving a device date", async () => {
    const GET = jest.fn().mockResolvedValue({ data: undefined, error: { error: { code: "UNEXPECTED" } }, response: { ok: false, status: 500 } });
    await expect(readTodayPlannedWork({ GET } as unknown as ApiClient)).rejects.toMatchObject({ status: 500 });
    expect(GET).toHaveBeenCalledTimes(1);
  });
});
