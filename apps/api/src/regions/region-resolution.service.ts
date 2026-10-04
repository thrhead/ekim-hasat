import { createFieldRegionContext } from "@ekim-hasat/domain/fields/field-region-context";
import type { RegionLookupPoint, RegionLookupResult, RegionResolverPort } from "./region-resolver.port.js";

export type RegionSourceValue = Readonly<{ code: string; label: string; confidence: number }>;
export interface QualifiedRegionSource {
  readonly qualified: boolean;
  readonly sourceId: string;
  readonly dataVersion: string;
  resolve(point: RegionLookupPoint): Promise<RegionSourceValue | null>;
}

export type RegionSourceSet = Readonly<{
  administrative?: QualifiedRegionSource;
  agricultural?: QualifiedRegionSource;
}>;

/** Selects only explicitly qualified immutable sources and normalizes their results. */
export class RegionResolutionService implements RegionResolverPort {
  constructor(
    private readonly sources: RegionSourceSet = {},
    private readonly now: () => Date = () => new Date(),
  ) {}

  resolveAdministrative(point: RegionLookupPoint): Promise<RegionLookupResult> {
    return this.resolve(point, this.sources.administrative);
  }

  resolveAgricultural(point: RegionLookupPoint): Promise<RegionLookupResult> {
    return this.resolve(point, this.sources.agricultural);
  }

  private async resolve(point: RegionLookupPoint, source?: QualifiedRegionSource): Promise<RegionLookupResult> {
    if (!source?.qualified) return { state: "UNRESOLVED", reason: "SOURCE_UNAVAILABLE" };
    let value: RegionSourceValue | null;
    try {
      value = await source.resolve(point);
    } catch {
      return { state: "UNRESOLVED", reason: "SOURCE_UNAVAILABLE" };
    }
    if (value === null) return { state: "UNRESOLVED", reason: "NO_COVERAGE" };
    const now = this.now();
    if (!Number.isFinite(now.getTime())) return { state: "UNRESOLVED", reason: "INVALID_RESULT" };
    const candidate = {
      code: typeof value.code === "string" ? value.code.trim() : "",
      label: typeof value.label === "string" ? value.label.trim() : "",
      sourceId: source.sourceId.trim(),
      confidence: value.confidence,
      dataVersion: source.dataVersion.trim(),
      resolvedAt: now.toISOString(),
    };
    try {
      createFieldRegionContext({
        resolutionLocationKey: "validation-only",
        administrative: { state: "RESOLVED", result: candidate },
        agricultural: { state: "UNRESOLVED" },
      });
    } catch {
      return { state: "UNRESOLVED", reason: "INVALID_RESULT" };
    }
    return { state: "RESOLVED", candidate: {
      code: candidate.code,
      label: candidate.label,
      sourceId: candidate.sourceId,
      confidence: candidate.confidence,
      dataVersion: candidate.dataVersion,
      resolvedAt: candidate.resolvedAt,
    } };
  }
}
