import { canEditPlan, mutatePlan, planSourceLabel, readSeason, validatePlanTaskDate } from "../../src/features/seasons/season-setup-screen";
import type { ApiClient, SeasonComponents } from "../../src/api/onboarding-client";
import { Pressable } from "react-native";
import { SeasonSetupActionButton } from "../../src/features/seasons/season-setup-screen";

const date = (value: string, planting = "2026-09-20") => validatePlanTaskDate(value, planting);

describe("season plan review date rules", () => {
  it("accepts the planting day and later dates without imposing task chronology", () => {
    expect(date("2026-09-20")).toBeNull();
    expect(date("2026-09-19", "2026-09-18")).toBeNull();
    expect(date("2026-09-20", "2026-09-21")).toMatch(/ekim tarihinden önce/);
  });

  it("rejects malformed and impossible local dates", () => {
    expect(date("2026-9-20")).toMatch(/YYYY-AA-GG/);
    expect(date("2026-02-29")).toMatch(/takvim tarihi geçerli değil/);
    expect(date("2024-02-29", "2024-02-28")).toBeNull();
  });
});

const draft: SeasonComponents["schemas"]["SeasonDraft"] = {
  id: "season-1", fieldId: "field-1", cropDisplayName: "Buğday", sowingPlantingDate: "2026-09-20", status: "DRAFT", version: 4,
  plan: { source: { kind: "MANUAL", validationLabel: "NOT_CENTRALLY_VALIDATED" }, tasks: [] },
};

describe("season plan review server refresh", () => {
  it("reads the current server draft through the generated operation", async () => {
    const GET = jest.fn().mockResolvedValue({ data: draft, error: undefined, response: { ok: true } });
    const client = { GET } as unknown as ApiClient;
    await expect(readSeason(client, "season-1")).resolves.toEqual(draft);
    expect(GET).toHaveBeenCalledWith("/seasons/{seasonId}", { params: { path: { seasonId: "season-1" } } });
  });

  it("does not report a refresh success when the server read fails", async () => {
    const GET = jest.fn().mockResolvedValue({ data: undefined, error: { error: { code: "UNEXPECTED" } }, response: { ok: false } });
    await expect(readSeason({ GET } as unknown as ApiClient, "season-1")).rejects.toThrow(/Yeniden deneyin/);
  });

  it("can retry a failed read and receive the latest authoritative draft", async () => {
    const GET = jest.fn()
      .mockResolvedValueOnce({ data: undefined, error: { error: { code: "UNAVAILABLE" } }, response: { ok: false } })
      .mockResolvedValueOnce({ data: draft, error: undefined, response: { ok: true } });
    const client = { GET } as unknown as ApiClient;
    await expect(readSeason(client, "season-1")).rejects.toThrow();
    await expect(readSeason(client, "season-1")).resolves.toEqual(draft);
    expect(GET).toHaveBeenCalledTimes(2);
  });

  it("gives task edit and remove controls named button semantics", () => {
    for (const label of ["Görevi düzenle", "Görevi kaldır", "Görev ekle"]) {
      const control = SeasonSetupActionButton({ label, onPress: jest.fn() });
      expect(control.type).toBe(Pressable);
      expect(control.props.accessibilityRole).toBe("button");
      expect(control.props.accessibilityLabel).toBe(label);
    }
  });

  it("keeps source visible and allows editing an empty DRAFT while hiding editing for ACTIVE", () => {
    expect(planSourceLabel("MANUAL")).toMatch(/MANUAL/);
    expect(planSourceLabel("VALIDATED_TEMPLATE")).toMatch(/VALIDATED_TEMPLATE/);
    expect(draft.plan.tasks).toHaveLength(0);
    expect(canEditPlan(draft)).toBe(true);
    expect(canEditPlan({ status: "ACTIVE" })).toBe(false);
  });

  it("sends add, edit, and remove through generated operations with the server version", async () => {
    const updated = { ...draft, version: 5 };
    const POST = jest.fn().mockResolvedValue({ data: updated, error: undefined, response: { ok: true, status: 201 } });
    const PATCH = jest.fn().mockResolvedValue({ data: updated, error: undefined, response: { ok: true, status: 200 } });
    const DELETE = jest.fn().mockResolvedValue({ data: updated, error: undefined, response: { ok: true, status: 200 } });
    const client = { POST, PATCH, DELETE } as unknown as ApiClient;
    const newTask: SeasonComponents["schemas"]["PlanTaskInput"] = { title: "Sulama", plannedLocalDate: "2026-09-20" };
    const edit: SeasonComponents["schemas"]["EditPlanTaskRequest"] = { title: "Kontrollü sulama" };

    await expect(mutatePlan(client, draft, "add", null, newTask)).resolves.toEqual(updated);
    await mutatePlan(client, draft, "edit", "task-1", edit);
    await mutatePlan(client, draft, "remove", "task-1");
    expect(POST).toHaveBeenCalledWith("/seasons/{seasonId}/plan-tasks", expect.objectContaining({
      params: { path: { seasonId: draft.id }, header: { "If-Match": "4", "Idempotency-Key": expect.any(String) } }, body: newTask,
    }));
    expect(PATCH).toHaveBeenCalledWith("/seasons/{seasonId}/plan-tasks/{taskId}", expect.objectContaining({
      params: { path: { seasonId: draft.id, taskId: "task-1" }, header: { "If-Match": "4" } }, body: edit,
    }));
    expect(DELETE).toHaveBeenCalledWith("/seasons/{seasonId}/plan-tasks/{taskId}", {
      params: { path: { seasonId: draft.id, taskId: "task-1" }, header: { "If-Match": "4" } },
    });
  });

  it("does not report mutation success on stale-version conflict", async () => {
    const POST = jest.fn().mockResolvedValue({ data: undefined, error: { error: { code: "STALE_SEASON_VERSION" } }, response: { ok: false, status: 409 } });
    await expect(mutatePlan({ POST } as unknown as ApiClient, draft, "add", null, { title: "Sulama", plannedLocalDate: "2026-09-20" }))
      .rejects.toMatchObject({ status: 409 });
  });
});
