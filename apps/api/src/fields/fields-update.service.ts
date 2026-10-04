import type { FieldComponents } from "@ekim-hasat/api-client";
import { FieldLocationValidationError, validateFieldLocation, type FieldLocation } from "@ekim-hasat/domain/fields/field-location";
import type { VerifiedSubject } from "@ekim-hasat/domain/identity/auth-provider";
import { FieldCommandError } from "./fields-command.error.js";

export type ValidatedFieldUpdateCommand = Readonly<{
  name?: string;
  location?: FieldLocation;
  agriculturalRegionOverride?: Readonly<{ code: string; label: string }> | null;
}>;
export type FieldUpdateOutcome = Readonly<{ field: FieldComponents["schemas"]["FieldDetail"] }>;

export interface FieldUpdateRepositoryPort {
  updateField(identity: VerifiedSubject, fieldId: string, expectedVersion: number, command: ValidatedFieldUpdateCommand): Promise<FieldUpdateOutcome>;
}

function invalid(): never { throw new FieldCommandError(400, "INVALID_REQUEST"); }
function isObject(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }

/** Validate only the documented, current Field fields. Omission always preserves the value. */
export function validateFieldUpdateCommand(value: unknown): ValidatedFieldUpdateCommand {
  if (!isObject(value) || Object.keys(value).length === 0
    || Object.keys(value).some((key) => !["name", "location", "agriculturalRegionOverride"].includes(key))) invalid();
  const command: { name?: string; location?: FieldLocation; agriculturalRegionOverride?: { code: string; label: string } | null } = {};
  if ("name" in value) {
    if (typeof value.name !== "string" || !value.name.trim()) invalid();
    command.name = value.name.trim();
  }
  if ("location" in value) {
    if (!isObject(value.location)) invalid();
    let location: FieldLocation;
    if (value.location.type === "POINT" && isObject(value.location.point)) {
      location = value.location.point as unknown as FieldLocation;
      if (location.type !== "Point") invalid();
    } else if (value.location.type === "POLYGON" && isObject(value.location.polygon)) {
      location = value.location.polygon as unknown as FieldLocation;
      if (location.type !== "Polygon") invalid();
    } else invalid();
    try { validateFieldLocation(location); } catch (error) {
      if (error instanceof FieldLocationValidationError) invalid();
      throw error;
    }
    command.location = location;
  }
  if ("agriculturalRegionOverride" in value) {
    const override = value.agriculturalRegionOverride;
    if (override === null) command.agriculturalRegionOverride = null;
    else {
      if (!isObject(override) || Object.keys(override).some((key) => !["code", "label"].includes(key))
        || typeof override.code !== "string" || !override.code.trim() || typeof override.label !== "string" || !override.label.trim()) invalid();
      command.agriculturalRegionOverride = { code: override.code.trim(), label: override.label.trim() };
    }
  }
  return command;
}

export class FieldUpdateService {
  constructor(private readonly repository: FieldUpdateRepositoryPort) {}

  async update(identity: VerifiedSubject, fieldId: string, expectedVersion: number, body: unknown): Promise<FieldUpdateOutcome> {
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) invalid();
    const command = validateFieldUpdateCommand(body);
    return this.repository.updateField(identity, fieldId, expectedVersion, command);
  }
}
