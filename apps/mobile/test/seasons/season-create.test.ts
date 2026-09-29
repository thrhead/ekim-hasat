import type { ApiClient, SeasonComponents } from "../../src/api/onboarding-client";
import {
  buildSeasonCreateRequest,
  createSeasonSetupFlow,
  getManualPlanExplanation,
  validatePlantingDate,
} from "../../src/features/seasons/season-setup-screen";
import {
  createSeasonCreateCommandStore,
  type SeasonCreateCommandStorage,
  type SeasonCreateResult,
} from "../../src/features/seasons/season-create-command-store";

type CropChoice = SeasonComponents["schemas"]["CropChoice"];

const centralCrop: CropChoice = {
  id: "crop-1",
  displayName: "Arpa",
  source: "CENTRAL",
  templateAvailability: "AVAILABLE",
  manualPlanAllowed: false,
};

const emptyTemplateCrop: CropChoice = {
  ...centralCrop,
  templateAvailability: "EMPTY_TASK_DEFINITIONS",
  manualPlanAllowed: true,
};

const result: SeasonCreateResult = {
  id: "season-1",
  fieldId: "field-1",
  cropDisplayName: "Arpa",
  sowingPlantingDate: "2026-09-25",
  status: "DRAFT",
  version: 1,
  plan: {
    source: { kind: "VALIDATED_TEMPLATE", validationLabel: "CENTRALLY_VALIDATED" },
    tasks: [],
  },
};

function createStorage(): SeasonCreateCommandStorage {
  let unresolved: Parameters<SeasonCreateCommandStorage["saveCommand"]>[1] | null = null;
  let lastSuccess: { idempotencyKey: string; result: SeasonCreateResult } | null = null;
  return {
    async read() { return { unresolved, lastSuccess }; },
    async saveCommand(_accountId, command) { unresolved = command; },
    async recordSuccess(_accountId, idempotencyKey, created) {
      lastSuccess = { idempotencyKey, result: created };
      unresolved = null;
    },
    async clearSuccess(_accountId, idempotencyKey) {
      if (lastSuccess?.idempotencyKey === idempotencyKey) lastSuccess = null;
    },
  };
}

describe("season create flow", () => {
  it("builds a central crop request and leaves validated template selection implicit", () => {
    expect(buildSeasonCreateRequest(centralCrop, "", " 2026-09-25 ", false)).toEqual({
      crop: { centralCropId: "crop-1" },
      sowingPlantingDate: "2026-09-25",
    });
  });

  it("requires an explicit MANUAL choice for custom and empty-template crops", () => {
    expect(buildSeasonCreateRequest(null, "  Yulaf  ", "2026-09-25", false)).toBeNull();
    expect(buildSeasonCreateRequest(null, "  Yulaf  ", "2026-09-25", true)).toEqual({
      crop: { customCropName: "Yulaf" },
      sowingPlantingDate: "2026-09-25",
      planSource: "MANUAL",
    });
    expect(getManualPlanExplanation(emptyTemplateCrop, false)).toMatch(/görev yok/);
    expect(buildSeasonCreateRequest(emptyTemplateCrop, "", "2026-09-25", false)).toBeNull();
    expect(buildSeasonCreateRequest(emptyTemplateCrop, "", "2026-09-25", true)).toEqual({
      crop: { centralCropId: "crop-1" },
      sowingPlantingDate: "2026-09-25",
      planSource: "MANUAL",
    });
  });

  it("validates actual local dates and creates through the generated API operation", async () => {
    expect(validatePlantingDate("2026-09-25", "2026-09-29")).toBeNull();
    expect(validatePlantingDate("2026-09-30", "2026-09-29")).toMatch(/bugün veya geçmiş/);
    const post = jest.fn().mockResolvedValue({
      data: result,
      error: undefined,
      response: new Response(null, { status: 201 }),
    });
    const client = { POST: post } as unknown as ApiClient;
    const store = createSeasonCreateCommandStore({ storage: createStorage() });
    const flow = createSeasonSetupFlow(client, store);
    const request = buildSeasonCreateRequest(centralCrop, "", "2026-09-25", false)!;

    await expect(flow.createOrRetry("account-1", "field-1", request)).resolves.toEqual({
      season: result,
      planSource: "VALIDATED_TEMPLATE",
    });
    expect(post).toHaveBeenCalledWith("/fields/{fieldId}/seasons", expect.objectContaining({
      params: { path: { fieldId: "field-1" }, header: { "Idempotency-Key": expect.any(String) } },
      body: request,
    }));
  });
});
