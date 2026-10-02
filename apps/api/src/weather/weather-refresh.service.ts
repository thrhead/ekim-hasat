import { normalizeWeatherSnapshot } from "./weather-normalizer.js";
import type { WeatherProvider } from "./weather-provider.port.js";
import type { WeatherLocation, WeatherSnapshotCandidate, WeatherProviderForecast } from "./weather.types.js";

export type WeatherRefreshTarget = Readonly<{
  businessId: string;
  fieldId: string;
  businessTimezone: string;
  representativePoint: WeatherLocation | null;
  requestedLocalDates: readonly [string, string, string];
}>;

export type WeatherSnapshotOrdering = Readonly<{
  providerIssuedAt: Date | null;
  refreshStartedAt: Date;
}>;

export interface WeatherRefreshRepository {
  listEligibleRefreshTargets(limit: number): Promise<readonly WeatherRefreshTarget[]>;
  markRefreshAttempted(target: WeatherRefreshTarget, at: Date): Promise<void>;
  getSnapshotOrdering(target: WeatherRefreshTarget): Promise<WeatherSnapshotOrdering | null>;
  /** Must recheck point and ordering transactionally immediately before replacement. */
  persistValidatedSnapshot(target: WeatherRefreshTarget, candidate: WeatherSnapshotCandidate): Promise<boolean>;
}

export type WeatherRefreshOutcome = Readonly<{
  requestId: string;
  fieldId: string;
  outcome: "REFRESHED" | "FAILED" | "REJECTED";
  reason?: "PROVIDER_ERROR" | "INVALID_PROVIDER_OUTPUT" | "OLDER_RESULT" | "LOCATION_CHANGED" | "PERSISTENCE_ERROR";
}>;

export class WeatherRefreshService {
  constructor(private readonly options: Readonly<{
    provider: WeatherProvider;
    repository: WeatherRefreshRepository;
    now?: () => Date;
    maxBatchSize?: number;
    reportOutcome?: (outcome: WeatherRefreshOutcome) => void;
  }>) {}

  async refreshEligibleFields(requestId: string): Promise<{ refreshed: number; failed: number; rejected: number }> {
    if (!requestId.trim()) throw new Error("Weather refresh requires a correlation ID");
    const maxBatchSize = this.options.maxBatchSize ?? 25;
    if (!Number.isInteger(maxBatchSize) || maxBatchSize < 1 || maxBatchSize > 100) {
      throw new Error("Weather refresh batch size must be between 1 and 100");
    }

    const targets = await this.options.repository.listEligibleRefreshTargets(maxBatchSize);
    const totals = { refreshed: 0, failed: 0, rejected: 0 };
    for (const target of targets.slice(0, maxBatchSize)) {
      try {
        await this.options.repository.markRefreshAttempted(target, this.now());
      } catch {
        totals.failed += 1;
        this.report({ requestId, fieldId: target.fieldId, outcome: "FAILED", reason: "PERSISTENCE_ERROR" });
        continue;
      }
      if (!target.representativePoint) {
        totals.rejected += 1;
        this.report({ requestId, fieldId: target.fieldId, outcome: "REJECTED", reason: "LOCATION_CHANGED" });
        continue;
      }
      const refreshStartedAt = this.now();
      let providerResult: WeatherProviderForecast;
      try {
        providerResult = await this.options.provider.getForecast({
          location: target.representativePoint,
          businessTimezone: target.businessTimezone,
          requestedLocalDates: target.requestedLocalDates,
        });
      } catch {
        totals.failed += 1;
        this.report({ requestId, fieldId: target.fieldId, outcome: "FAILED", reason: "PROVIDER_ERROR" });
        continue;
      }

      let candidate: WeatherSnapshotCandidate;
      try {
        candidate = normalizeWeatherSnapshot({
          ...providerResult,
          location: target.representativePoint,
          businessTimezone: target.businessTimezone,
          requestedLocalDates: target.requestedLocalDates,
          fetchedAt: this.now().toISOString(),
          refreshStartedAt: refreshStartedAt.toISOString(),
        }, this.now());
      } catch {
        totals.rejected += 1;
        this.report({ requestId, fieldId: target.fieldId, outcome: "REJECTED", reason: "INVALID_PROVIDER_OUTPUT" });
        continue;
      }

      try {
        const existing = await this.options.repository.getSnapshotOrdering(target);
        if (existing && this.isOlder(candidate, existing)) {
          totals.rejected += 1;
          this.report({ requestId, fieldId: target.fieldId, outcome: "REJECTED", reason: "OLDER_RESULT" });
          continue;
        }
        if (!await this.options.repository.persistValidatedSnapshot(target, candidate)) {
          totals.rejected += 1;
          this.report({ requestId, fieldId: target.fieldId, outcome: "REJECTED", reason: "LOCATION_CHANGED" });
          continue;
        }
        totals.refreshed += 1;
        this.report({ requestId, fieldId: target.fieldId, outcome: "REFRESHED" });
      } catch {
        totals.failed += 1;
        this.report({ requestId, fieldId: target.fieldId, outcome: "FAILED", reason: "PERSISTENCE_ERROR" });
      }
    }
    return totals;
  }

  private now(): Date {
    const date = (this.options.now ?? (() => new Date()))();
    if (!Number.isFinite(date.getTime())) throw new Error("Invalid weather refresh clock");
    return date;
  }

  private isOlder(candidate: WeatherSnapshotCandidate, existing: WeatherSnapshotOrdering): boolean {
    if (candidate.providerIssuedAt && existing.providerIssuedAt) {
      return candidate.providerIssuedAt.getTime() < existing.providerIssuedAt.getTime();
    }
    return candidate.refreshStartedAt.getTime() < existing.refreshStartedAt.getTime();
  }

  private report(outcome: WeatherRefreshOutcome): void {
    try { this.options.reportOutcome?.(outcome); } catch { /* Observability must not change refresh behavior. */ }
  }
}
