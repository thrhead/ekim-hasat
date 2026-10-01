import type { CropReference } from "./types.js";

export type CentralCropCatalogEntry = Readonly<{
  id: string;
  cropKey: string;
  displayName: string;
  selectable: boolean;
}>;

export type BusinessCustomCrop = Readonly<{
  id: string;
  businessId: string;
  displayName: string;
}>;

export type CropLogicalIdentity =
  | Readonly<{ kind: "CENTRAL"; cropKey: string }>
  | Readonly<{ kind: "CUSTOM"; businessId: string; customCropId: string }>;

export class CropSelectionError extends Error {
  constructor(public readonly code: "CROP_NOT_AVAILABLE" | "INVALID_CUSTOM_CROP_NAME", message: string) {
    super(message);
    this.name = "CropSelectionError";
  }
}

function centralReference(entry: CentralCropCatalogEntry): Extract<CropReference, { kind: "CENTRAL" }> {
  return Object.freeze({
    kind: "CENTRAL",
    cropKey: entry.cropKey,
    cropDefinitionVersionId: entry.id,
    displayName: entry.displayName,
  });
}

/** The server supplies the runtime catalog; template availability never filters crop identity. */
export function listSelectableCentralCrops(
  catalog: readonly CentralCropCatalogEntry[],
): readonly Extract<CropReference, { kind: "CENTRAL" }>[] {
  return catalog.filter((entry) => entry.selectable).map(centralReference);
}

export function selectCentralCrop(
  cropDefinitionVersionId: string,
  catalog: readonly CentralCropCatalogEntry[],
): Extract<CropReference, { kind: "CENTRAL" }> {
  const entry = catalog.find((candidate) => candidate.id === cropDefinitionVersionId && candidate.selectable);
  if (!entry) {
    throw new CropSelectionError("CROP_NOT_AVAILABLE", "The selected crop is unavailable.");
  }
  return centralReference(entry);
}

/** A display name is presentation data. Preserve its spelling and internal whitespace. */
export function normalizeCustomCropDisplayName(value: unknown): string {
  if (typeof value !== "string") {
    throw new CropSelectionError("INVALID_CUSTOM_CROP_NAME", "A crop name is required.");
  }
  const displayName = value.trim();
  if (displayName.length === 0 || Array.from(displayName).length > 120) {
    throw new CropSelectionError("INVALID_CUSTOM_CROP_NAME", "A crop name of 1 to 120 characters is required.");
  }
  return displayName;
}

/** The application allocates the ID; equal labels never cause reuse or central aliasing. */
export function createCustomCropReference(
  customCropId: string,
  authorizedBusinessId: string,
  displayName: unknown,
): Extract<CropReference, { kind: "CUSTOM" }> {
  return Object.freeze({
    kind: "CUSTOM",
    customCropId,
    businessId: authorizedBusinessId,
    displayName: normalizeCustomCropDisplayName(displayName),
  });
}

/** Membership authorization remains the application's responsibility; this checks crop ownership. */
export function selectCustomCrop(
  customCropId: string,
  authorizedBusinessId: string,
  crops: readonly BusinessCustomCrop[],
): Extract<CropReference, { kind: "CUSTOM" }> {
  const crop = crops.find((candidate) => candidate.id === customCropId && candidate.businessId === authorizedBusinessId);
  if (!crop) {
    throw new CropSelectionError("CROP_NOT_AVAILABLE", "The selected crop is unavailable.");
  }
  return createCustomCropReference(crop.id, authorizedBusinessId, crop.displayName);
}

/** Definition versions are context; the stable crop identity controls season uniqueness. */
export function cropLogicalIdentity(crop: CropReference): CropLogicalIdentity {
  return crop.kind === "CENTRAL"
    ? { kind: "CENTRAL", cropKey: crop.cropKey }
    : { kind: "CUSTOM", businessId: crop.businessId, customCropId: crop.customCropId };
}
