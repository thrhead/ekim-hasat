import type { RegionResolution } from "@ekim-hasat/domain/fields/field-region-context";

export type RegionLookupPoint = Readonly<{ longitude: number; latitude: number }>;
export type RegionCandidate = RegionResolution;
export type RegionLookupResult = Readonly<
  | { state: "RESOLVED"; candidate: RegionCandidate }
  | { state: "UNRESOLVED"; reason: "SOURCE_UNAVAILABLE" | "NO_COVERAGE" | "INVALID_RESULT" }
>;

/** Adapter boundary uses normalized domain values and never vendor payloads. */
export interface RegionResolverPort {
  resolveAdministrative(point: RegionLookupPoint): Promise<RegionLookupResult>;
  resolveAgricultural(point: RegionLookupPoint): Promise<RegionLookupResult>;
}
