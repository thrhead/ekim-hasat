import type { PointLocation, PolygonLocation } from "./field-location.js";

export type RegionResolution = Readonly<{
  code: string;
  label: string;
  sourceId: string;
  confidence: number;
  dataVersion: string;
  /** Server UTC time at which this result was accepted. */
  resolvedAt: string;
}>;

export type RegionSuggestion = Readonly<
  | { state: "UNRESOLVED"; result?: never }
  | { state: "RESOLVED"; result: RegionResolution }
>;

export type AgriculturalRegionOverride = Readonly<{ code: string; label: string }>;

export type FieldRegionContextInput = Readonly<{
  resolutionLocationKey: string;
  administrative: RegionSuggestion;
  agricultural: RegionSuggestion;
  agriculturalOverride?: AgriculturalRegionOverride | null;
}>;

export type FieldRegionContext = Readonly<{
  resolutionLocationKey: string;
  administrative: RegionSuggestion;
  agricultural: RegionSuggestion;
  agriculturalOverride: AgriculturalRegionOverride | null;
}>;

export type EffectiveAgriculturalRegion = Readonly<
  | { state: "RESOLVED"; code: string; label: string; source: "MANUAL_OVERRIDE" | "AUTOMATIC" }
  | { state: "UNRESOLVED" }
>;

export type FieldRegionResolutionUpdate = Readonly<{
  target: "administrative" | "agricultural";
  resolutionLocationKey: string;
} & (
  | { state: "UNRESOLVED" }
  | { state: "RESOLVED"; result: RegionResolution }
)>;

export type ApplyFieldRegionResolutionResult = Readonly<
  | { kind: "stale"; context: FieldRegionContext }
  | { kind: "unchanged"; context: FieldRegionContext }
  | { kind: "applied"; context: FieldRegionContext }
>;

function assertText(value: string, name: string): void {
  if (!value.trim()) throw new TypeError(`${name} must not be empty`);
}

function validateSuggestion(suggestion: RegionSuggestion, name: string): void {
  if (suggestion.state === "UNRESOLVED") return;
  const result = suggestion.result;
  assertText(result.code, `${name}.code`);
  assertText(result.label, `${name}.label`);
  assertText(result.sourceId, `${name}.sourceId`);
  assertText(result.dataVersion, `${name}.dataVersion`);
  if (!Number.isFinite(result.confidence) || result.confidence < 0 || result.confidence > 1) {
    throw new TypeError(`${name}.confidence must be between 0 and 1`);
  }
  if (!Number.isFinite(Date.parse(result.resolvedAt)) || !result.resolvedAt.endsWith("Z")) {
    throw new TypeError(`${name}.resolvedAt must be a server UTC timestamp`);
  }
}

/** Build immutable, provider-neutral current suggestion state for one location key. */
export function createFieldRegionContext(input: FieldRegionContextInput): FieldRegionContext {
  assertText(input.resolutionLocationKey, "resolutionLocationKey");
  validateSuggestion(input.administrative, "administrative");
  validateSuggestion(input.agricultural, "agricultural");
  const override = input.agriculturalOverride ?? null;
  if (override) {
    assertText(override.code, "agriculturalOverride.code");
    assertText(override.label, "agriculturalOverride.label");
  }
  return Object.freeze({
    resolutionLocationKey: input.resolutionLocationKey,
    administrative: Object.freeze({ ...input.administrative }),
    agricultural: Object.freeze({ ...input.agricultural }),
    agriculturalOverride: override ? Object.freeze({ ...override }) : null,
  });
}

/** The explicit farmer choice always wins over an automatic agricultural suggestion. */
export function effectiveAgriculturalRegion(context: FieldRegionContext): EffectiveAgriculturalRegion {
  if (context.agriculturalOverride) {
    return { ...context.agriculturalOverride, state: "RESOLVED", source: "MANUAL_OVERRIDE" };
  }
  if (context.agricultural.state === "RESOLVED") {
    return { ...context.agricultural.result, state: "RESOLVED", source: "AUTOMATIC" };
  }
  return { state: "UNRESOLVED" };
}

function sameSourceVersion(current: RegionSuggestion, next: RegionSuggestion): boolean {
  if (current.state !== next.state) return false;
  if (current.state === "UNRESOLVED" || next.state === "UNRESOLVED") return true;
  return current.result.code === next.result.code
    && current.result.label === next.result.label
    && current.result.sourceId === next.result.sourceId
    && current.result.dataVersion === next.result.dataVersion
    && current.result.confidence === next.result.confidence;
}

/** Apply only a current-key result; preserve the independent stream and manual choice. */
export function applyFieldRegionResolution(
  current: FieldRegionContext,
  update: FieldRegionResolutionUpdate,
): ApplyFieldRegionResolutionResult {
  if (update.resolutionLocationKey !== current.resolutionLocationKey) {
    return { kind: "stale", context: current };
  }
  const nextSuggestion: RegionSuggestion = update.state === "RESOLVED"
    ? { state: "RESOLVED", result: update.result }
    : { state: "UNRESOLVED" };
  const existing = current[update.target];
  if (sameSourceVersion(existing, nextSuggestion)) return { kind: "unchanged", context: current };
  return {
    kind: "applied",
    context: createFieldRegionContext({
      resolutionLocationKey: current.resolutionLocationKey,
      administrative: update.target === "administrative" ? nextSuggestion : current.administrative,
      agricultural: update.target === "agricultural" ? nextSuggestion : current.agricultural,
      agriculturalOverride: current.agriculturalOverride,
    }),
  };
}

type LocationKeyInput = Readonly<{
  representativePoint: PointLocation;
  polygon?: PolygonLocation | null;
}>;

function fnv1a64(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

/**
 * Versioned region-resolution identity. It intentionally has its own inputs and
 * namespace; SPEC-004 weather fingerprints remain independent.
 */
export function fieldResolutionLocationKey(input: LocationKeyInput): string {
  const serialized = JSON.stringify({
    version: 1,
    representativePoint: input.representativePoint.coordinates,
    polygon: input.polygon?.coordinates ?? null,
  });
  return `field-region:v1:${fnv1a64(serialized)}`;
}
