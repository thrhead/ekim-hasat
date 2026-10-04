import { FieldLocationValidationError, validateFieldLocation, type FieldLocation, type PolygonLocation } from "@ekim-hasat/domain/fields/field-location";
import type { VerifiedSubject } from "@ekim-hasat/domain/identity/auth-provider";
import { FieldCommandError } from "./fields-command.error.js";
import type { FieldCreateOutcome, FieldCreateRepository } from "./fields-create.repository.js";

export type ValidatedFieldCreateCommand = Readonly<{
  name: string | null;
  location: FieldLocation;
}>;

const allowedBodyKeys = new Set(["name", "location"]);

export function validateFieldIdempotencyKey(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 200) {
    throw new FieldCommandError(400, "INVALID_REQUEST");
  }
  return value;
}

/** Validate and normalize the public Field-create command before persistence. */
export function validateCreateFieldCommand(value: unknown): ValidatedFieldCreateCommand {
  if (!isObject(value) || Object.keys(value).some((key) => !allowedBodyKeys.has(key))) invalid();
  let name: string | null = null;
  if (value.name !== undefined && value.name !== null) {
    if (typeof value.name !== "string") invalid();
    const trimmed = value.name.trim();
    name = trimmed || null;
  }
  const input = value.location;
  if (!isObject(input)) invalid();
  let location: FieldLocation;
  if (input.type === "POINT" && hasOnlyKeys(input, ["type", "point"]) && input.point !== undefined) {
    location = { type: "Point", coordinates: getPointCoordinates(input.point) };
  } else if (input.type === "POLYGON" && hasOnlyKeys(input, ["type", "polygon"]) && input.polygon !== undefined) {
    if (!isObject(input.polygon) || !hasOnlyKeys(input.polygon, ["type", "coordinates"])) invalid();
    if (input.polygon.type !== "Polygon") invalid();
    location = { type: "Polygon", coordinates: input.polygon.coordinates as PolygonLocation["coordinates"] };
  } else invalid();
  try {
    validateFieldLocation(location);
  } catch (error) {
    if (error instanceof FieldLocationValidationError) invalid();
    throw error;
  }
  return { name, location };
}

export class FieldCreateService {
  constructor(private readonly repository: FieldCreateRepository) {}

  async create(identity: VerifiedSubject, body: unknown, key: string): Promise<FieldCreateOutcome> {
    const idempotencyKey = validateFieldIdempotencyKey(key);
    const command = validateCreateFieldCommand(body);
    return this.repository.createField(identity, command, idempotencyKey);
  }
}

function getPointCoordinates(value: unknown): [number, number] {
  if (!isObject(value) || !hasOnlyKeys(value, ["type", "coordinates"]) || value.type !== "Point" || !Array.isArray(value.coordinates)
    || value.coordinates.length !== 2) invalid();
  return value.coordinates as [number, number];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function invalid(): never {
  throw new FieldCommandError(400, "INVALID_REQUEST");
}
