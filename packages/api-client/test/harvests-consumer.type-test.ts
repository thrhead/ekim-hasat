import {
  createApiClient,
  type HarvestComponents,
  type HarvestOperations,
  type HarvestPaths,
  type operations,
  type paths,
} from "@ekim-hasat/api-client";

const client = createApiClient();

void client.POST("/fields/{fieldId}/harvests", {
  params: { path: { fieldId: "11111111-1111-4111-8111-111111111111" } },
  body: {
    harvestId: "22222222-2222-4222-8222-222222222222",
    seasonId: "33333333-3333-4333-8333-333333333333",
    harvestDate: "2026-10-17",
    quantity: "12.375",
    unit: "METRIC_TONNE",
  },
});

type Assert<T extends true> = T;
type HasHarvestPath = Assert<"/fields/{fieldId}/harvests" extends keyof paths ? true : false>;
type HasCreateHarvestOperation = Assert<"createFieldHarvest" extends keyof operations ? true : false>;
type HasOperationExport = Assert<"createFieldHarvest" extends keyof HarvestOperations ? true : false>;
type HasPathExport = Assert<"/fields/{fieldId}/harvests" extends keyof HarvestPaths ? true : false>;
type RequestBody = HarvestOperations["createFieldHarvest"]["requestBody"]["content"]["application/json"];
type QuantityIsString = Assert<RequestBody["quantity"] extends string ? true : false>;
type NumberIsNotQuantity = Assert<number extends RequestBody["quantity"] ? false : true>;
type UnitIsContractEnum = Assert<RequestBody["unit"] extends "KG" | "METRIC_TONNE" ? true : false>;
type Response201 = HarvestOperations["createFieldHarvest"]["responses"][201]["content"]["application/json"];
type Response200 = HarvestOperations["createFieldHarvest"]["responses"][200]["content"]["application/json"];
type AcceptedResponse = Assert<Response201 extends HarvestComponents["schemas"]["Harvest"] ? true : false>;
type ReplayResponse = Assert<Response200 extends HarvestComponents["schemas"]["Harvest"] ? true : false>;
type MissingDeclaredErrors = Exclude<400 | 401 | 403 | 404 | 409 | 500,
  keyof HarvestOperations["createFieldHarvest"]["responses"]>;
type HasAllDeclaredErrors = Assert<MissingDeclaredErrors extends never ? true : false>;

void (0 as unknown as HasHarvestPath);
void (0 as unknown as HasCreateHarvestOperation);
void (0 as unknown as HasOperationExport);
void (0 as unknown as HasPathExport);
void (0 as unknown as QuantityIsString);
void (0 as unknown as NumberIsNotQuantity);
void (0 as unknown as UnitIsContractEnum);
void (0 as unknown as AcceptedResponse);
void (0 as unknown as ReplayResponse);
void (0 as unknown as HasAllDeclaredErrors);

void client.POST("/fields/{fieldId}/harvests", {
  params: { path: { fieldId: "11111111-1111-4111-8111-111111111111" } },
  body: {
    harvestId: "22222222-2222-4222-8222-222222222222",
    seasonId: "33333333-3333-4333-8333-333333333333",
    harvestDate: "2026-10-17",
    // @ts-expect-error Harvest quantities remain exact decimal strings.
    quantity: 12.375,
    // @ts-expect-error Only contract units are supported.
    unit: "TONNE",
  },
});

// @ts-expect-error Season is required for every Harvest create.
const missingSeason: HarvestComponents["schemas"]["CreateHarvestRequest"] = {
  harvestId: "22222222-2222-4222-8222-222222222222",
  harvestDate: "2026-10-17",
  quantity: "12.375",
  unit: "KG",
};
void missingSeason;
