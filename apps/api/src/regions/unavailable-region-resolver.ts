import type { RegionLookupResult, RegionResolverPort } from "./region-resolver.port.js";

/** Default until a source passes qualification; both streams remain explicitly unresolved. */
export class UnavailableRegionResolver implements RegionResolverPort {
  async resolveAdministrative(): Promise<RegionLookupResult> {
    return { state: "UNRESOLVED", reason: "SOURCE_UNAVAILABLE" };
  }

  async resolveAgricultural(): Promise<RegionLookupResult> {
    return { state: "UNRESOLVED", reason: "SOURCE_UNAVAILABLE" };
  }
}
