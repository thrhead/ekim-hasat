import { LocalDateValidationError, validateLocalDate, type LocalDate } from "../seasons/local-date.js";

export type HarvestUnit = "KG" | "METRIC_TONNE";

export type HarvestRecordInput = Readonly<{
  id: string;
  businessId: string;
  fieldId: string;
  seasonId: string;
  actorUserId: string;
  actorMembershipId: string;
  harvestDate: LocalDate;
  quantity: string;
  unit: HarvestUnit;
}>;

export type CreateHarvestRecordInput = Readonly<{
  id: unknown;
  businessId: unknown;
  fieldId: unknown;
  seasonId: unknown;
  actorUserId: unknown;
  actorMembershipId: unknown;
  harvestDate: unknown;
  quantity: unknown;
  unit: unknown;
}>;

const HARVEST_QUANTITY_PATTERN = /^(?=.*[1-9])(?:0|[1-9]\d{0,10})(?:\.\d{1,3})?$/;
const HARVEST_UNITS = new Set<HarvestUnit>(["KG", "METRIC_TONNE"]);

export function createHarvestRecord(input: CreateHarvestRecordInput): HarvestRecordInput {
  requireUuid(input.id, "id");
  requireUuid(input.businessId, "businessId");
  requireUuid(input.fieldId, "fieldId");
  requireUuid(input.seasonId, "seasonId");
  requireUuid(input.actorUserId, "actorUserId");
  requireUuid(input.actorMembershipId, "actorMembershipId");

  let harvestDate: LocalDate;
  try {
    harvestDate = validateLocalDate(input.harvestDate);
  } catch (error) {
    if (!(error instanceof LocalDateValidationError)) throw error;
    throw new TypeError("harvestDate must be a valid YYYY-MM-DD calendar date");
  }

  if (typeof input.quantity !== "string" || !HARVEST_QUANTITY_PATTERN.test(input.quantity)) {
    throw new TypeError("quantity must be a positive decimal string with at most 11 integer digits and 3 fractional digits");
  }

  if (typeof input.unit !== "string" || !HARVEST_UNITS.has(input.unit as HarvestUnit)) {
    throw new TypeError("unit must be KG or METRIC_TONNE");
  }

  return Object.freeze({
    id: input.id as string,
    businessId: input.businessId as string,
    fieldId: input.fieldId as string,
    seasonId: input.seasonId as string,
    actorUserId: input.actorUserId as string,
    actorMembershipId: input.actorMembershipId as string,
    harvestDate,
    quantity: input.quantity,
    unit: input.unit as HarvestUnit,
  });
}

function requireUuid(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || !/^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(value)) {
    throw new TypeError(`${name} must be a UUID`);
  }
}
