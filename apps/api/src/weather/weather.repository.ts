import { BadRequestException, NotFoundException } from "@nestjs/common";
import type { VerifiedSubject } from "@ekim-hasat/domain/identity/auth-provider";
import type { WeatherComponents } from "@ekim-hasat/api-client";
import type { PrismaClient } from "../generated/prisma/client.js";
import { BusinessScopeForbiddenError, MembershipScopeService } from "../authorization/membership-scope.service.js";
import { businessLocalDate, resolveBusinessTimezone } from "../seasons/business-timezone.js";
import { classifyWeatherFreshness } from "./weather-freshness.js";
import type { WeatherRefreshRepository, WeatherRefreshTarget, WeatherSnapshotOrdering } from "./weather-refresh.service.js";
import type { WeatherSnapshotCandidate, WeatherLocation } from "./weather.types.js";

const fallbackTimezone = "Europe/Istanbul";
function datesFrom(now: Date, timezone: string): [string, string, string] {
  const today = businessLocalDate(now, timezone);
  const date = new Date(`${today}T00:00:00.000Z`);
  const plus = (days: number) => { const d = new Date(date); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
  return [today, plus(1), plus(2)];
}
function fingerprint(point: WeatherLocation | null): string | null {
  return point && Number.isFinite(point.longitude) && Number.isFinite(point.latitude)
    && point.longitude >= -180 && point.longitude <= 180 && point.latitude >= -90 && point.latitude <= 90
    ? `${point.longitude.toFixed(6)},${point.latitude.toFixed(6)}` : null;
}
function encodeCursor(name: string, id: string): string { return Buffer.from(JSON.stringify([name, id])).toString("base64url"); }
function decodeCursor(cursor?: string): [string, string] | null {
  if (cursor === undefined) return null;
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (Array.isArray(value) && value.length === 2 && value.every((part) => typeof part === "string")) return [value[0], value[1]];
  } catch { /* invalid opaque cursor */ }
  throw new BadRequestException();
}

type PointRow = { id: string; longitude: number | null; latitude: number | null };
type RawSnapshot = {
  id: string; fieldId: string; locationFingerprint: string; businessTimezone: string; coverageStart: Date; coverageEnd: Date;
  forecastLocalDates: string[]; fetchedAt: Date; refreshStartedAt: Date; providerIssuedAt: Date | null;
  observedAt: Date; conditionCode: string; conditionLabel: string | null; temperatureC: number;
  dailyForecasts: Array<{ localDate: Date; conditionCode: string; conditionLabel: string | null; temperatureHighC: number; temperatureLowC: number; precipitationChancePercent: number; windSpeedKph: number }>;
};

export class WeatherRepository implements WeatherRefreshRepository {
  private readonly membershipScope: MembershipScopeService;
  constructor(private readonly prisma: PrismaClient, private readonly options: { now?: () => Date; maxAgeHours?: number } = {}) {
    this.membershipScope = new MembershipScopeService(prisma);
  }
  private now(): Date { return (this.options.now ?? (() => new Date()))(); }
  private async scope(identity: VerifiedSubject) {
    const scope = await this.membershipScope.resolveDefaultBusinessScope(identity);
    if (!scope) throw new BusinessScopeForbiddenError();
    return scope;
  }
  private async point(fieldId: string): Promise<WeatherLocation | null> {
    const rows = await this.prisma.$queryRaw<PointRow[]>`SELECT id::text, ST_X(representative_point) AS longitude, ST_Y(representative_point) AS latitude FROM fields WHERE id = ${fieldId}::uuid`;
    const row = rows[0];
    return row && row.longitude !== null && row.latitude !== null ? { longitude: row.longitude, latitude: row.latitude } : null;
  }
  private async weatherView(field: { id: string; name: string; businessId: string }, timezone: string): Promise<WeatherComponents["schemas"]["FieldWeather"]> {
    const point = await this.point(field.id);
    const snapshot = await this.prisma.weatherSnapshot.findUnique({ where: { fieldId_businessId: { fieldId: field.id, businessId: field.businessId } }, include: { dailyForecasts: { orderBy: { localDate: "asc" } } } }) as RawSnapshot | null;
    return this.weatherValue(field, timezone, point, snapshot);
  }
  private weatherValue(field: { id: string; name: string; businessId: string }, timezone: string, point: WeatherLocation | null, snapshot: RawSnapshot | null) {
    const now = this.now();
    const dates = datesFrom(now, timezone);
    const status = classifyWeatherFreshness({ snapshot: snapshot ? { fetchedAt: snapshot.fetchedAt, businessTimezone: snapshot.businessTimezone, forecastLocalDates: snapshot.forecastLocalDates as [string, string, string], locationFingerprint: snapshot.locationFingerprint } : null,
      now, maxAgeHours: this.options.maxAgeHours ?? 6, requestedLocalDates: dates, businessTimezone: timezone,
      currentLocationFingerprint: fingerprint(point), hasUsableRepresentativePoint: fingerprint(point) !== null });
    const visible = status === "UNAVAILABLE" ? null : snapshot;
    return { fieldId: field.id, fieldName: field.name, status, businessTimezone: timezone,
      fetchedAt: visible?.fetchedAt.toISOString() ?? null,
      coverage: visible ? { startAt: visible.coverageStart.toISOString(), endAt: visible.coverageEnd.toISOString(), localStartDate: visible.forecastLocalDates[0]!, localEndDate: visible.forecastLocalDates[2]! } : null,
      current: visible ? { observedAt: visible.observedAt.toISOString(), conditionCode: visible.conditionCode as WeatherComponents["schemas"]["WeatherCondition"], conditionLabel: visible.conditionLabel, temperatureC: visible.temperatureC } : null,
      dailyForecasts: visible ? visible.dailyForecasts.map((day) => ({ localDate: day.localDate.toISOString().slice(0, 10), conditionCode: day.conditionCode as WeatherComponents["schemas"]["WeatherCondition"], conditionLabel: day.conditionLabel, temperatureHighC: day.temperatureHighC, temperatureLowC: day.temperatureLowC, precipitationChancePercent: day.precipitationChancePercent, windSpeedKph: day.windSpeedKph })) : [] };
  }
  async readFieldWeather(identity: VerifiedSubject, fieldId: string) {
    const scope = await this.scope(identity);
    const business = await this.prisma.business.findFirst({ where: { id: scope.businessId, memberships: { some: { id: scope.membershipId, userId: scope.userId, status: "ACTIVE" } } }, select: { timezone: true } });
    if (!business) throw new BusinessScopeForbiddenError();
    const field = await this.prisma.field.findFirst({ where: { id: fieldId, businessId: scope.businessId, business: { memberships: { some: { id: scope.membershipId, userId: scope.userId, status: "ACTIVE" } } } }, select: { id: true, name: true, businessId: true } });
    if (!field) throw new NotFoundException();
    return this.weatherView(field, resolveBusinessTimezone(business.timezone) ?? fallbackTimezone);
  }
  async readWeatherOverview(identity: VerifiedSubject, page: { limit: number; cursor?: string }) {
    const scope = await this.scope(identity);
    const business = await this.prisma.business.findFirst({ where: { id: scope.businessId, memberships: { some: { id: scope.membershipId, userId: scope.userId, status: "ACTIVE" } } }, select: { timezone: true } });
    if (!business) throw new BusinessScopeForbiddenError();
    const after = decodeCursor(page.cursor);
    const rows = await this.prisma.field.findMany({ where: { businessId: scope.businessId, business: { memberships: { some: { id: scope.membershipId, userId: scope.userId, status: "ACTIVE" } } }, ...(after ? { OR: [{ name: { gt: after[0] } }, { name: after[0], id: { gt: after[1] } }] } : {}) }, select: { id: true, name: true, businessId: true }, orderBy: [{ name: "asc" }, { id: "asc" }], take: page.limit + 1 });
    const hasMore = rows.length > page.limit;
    const fields = rows.slice(0, page.limit);
    const timezone = resolveBusinessTimezone(business.timezone) ?? fallbackTimezone;
    const fieldIds = fields.map((field) => field.id);
    const [pointRows, snapshots] = fieldIds.length === 0 ? [[], []] : await Promise.all([
      this.prisma.$queryRaw<PointRow[]>`SELECT id::text, ST_X(representative_point) AS longitude, ST_Y(representative_point) AS latitude FROM fields WHERE business_id = ${scope.businessId}::uuid AND id = ANY(${fieldIds}::uuid[])`,
      this.prisma.weatherSnapshot.findMany({ where: { businessId: scope.businessId, fieldId: { in: fieldIds } }, include: { dailyForecasts: { orderBy: { localDate: "asc" } } } }) as Promise<RawSnapshot[]>,
    ]);
    const pointsByField = new Map(pointRows.map((row) => [row.id, row.longitude !== null && row.latitude !== null ? { longitude: row.longitude, latitude: row.latitude } : null]));
    const snapshotsByField = new Map(snapshots.map((snapshot) => [snapshot.fieldId, snapshot]));
    const items = fields.map((field) => this.weatherValue(field, timezone, pointsByField.get(field.id) ?? null, snapshotsByField.get(field.id) ?? null));
    const last = fields.at(-1);
    return { items, nextCursor: hasMore && last ? encodeCursor(last.name, last.id) : null };
  }

  async listEligibleRefreshTargets(limit: number): Promise<readonly WeatherRefreshTarget[]> {
    const now = this.now();
    const fields = await this.prisma.field.findMany({ select: {
      id: true, businessId: true, business: { select: { timezone: true } },
      weatherSnapshot: { select: { fetchedAt: true, businessTimezone: true, forecastLocalDates: true, locationFingerprint: true } },
      weatherRefreshState: { select: { lastAttemptOrder: true } },
    } });
    const ids = fields.map((field) => field.id);
    const points = ids.length === 0 ? [] : await this.prisma.$queryRaw<PointRow[]>`SELECT id::text, ST_X(representative_point) AS longitude, ST_Y(representative_point) AS latitude FROM fields WHERE id = ANY(${ids}::uuid[])`;
    const pointsByField = new Map(points.map((row) => [row.id, row.longitude !== null && row.latitude !== null ? { longitude: row.longitude, latitude: row.latitude } : null]));
    const candidates = fields.flatMap((field) => {
      const timezone = resolveBusinessTimezone(field.business.timezone) ?? fallbackTimezone;
      const requestedLocalDates = datesFrom(now, timezone);
      const representativePoint = pointsByField.get(field.id) ?? null;
      if (!fingerprint(representativePoint)) return [];
      const status = classifyWeatherFreshness({
        snapshot: field.weatherSnapshot ? { ...field.weatherSnapshot, forecastLocalDates: field.weatherSnapshot.forecastLocalDates as [string, string, string] } : null,
        now,
        maxAgeHours: this.options.maxAgeHours ?? 6,
        requestedLocalDates,
        businessTimezone: timezone,
        currentLocationFingerprint: fingerprint(representativePoint),
        hasUsableRepresentativePoint: true,
      });
      if (status === "CURRENT") return [];
      return [{ target: { businessId: field.businessId, fieldId: field.id, businessTimezone: timezone, representativePoint, requestedLocalDates }, lastAttemptOrder: field.weatherRefreshState?.lastAttemptOrder ?? null }];
    });
    candidates.sort((left, right) => {
      const leftOrder = left.lastAttemptOrder ?? 0n;
      const rightOrder = right.lastAttemptOrder ?? 0n;
      return (leftOrder < rightOrder ? -1 : leftOrder > rightOrder ? 1 : 0) || left.target.fieldId.localeCompare(right.target.fieldId);
    });
    return candidates.slice(0, limit).map(({ target }) => target);
  }
  async markRefreshAttempted(target: WeatherRefreshTarget, at: Date): Promise<void> {
    await this.prisma.$executeRaw`INSERT INTO weather_refresh_states (business_id, field_id, last_attempted_at, last_attempt_order)
      VALUES (${target.businessId}::uuid, ${target.fieldId}::uuid, ${at}, nextval('weather_refresh_states_last_attempt_order_seq'))
      ON CONFLICT (field_id, business_id) DO UPDATE
      SET last_attempted_at = EXCLUDED.last_attempted_at, last_attempt_order = EXCLUDED.last_attempt_order`;
  }
  async getSnapshotOrdering(target: WeatherRefreshTarget): Promise<WeatherSnapshotOrdering | null> {
    const row = await this.prisma.weatherSnapshot.findUnique({ where: { fieldId_businessId: { fieldId: target.fieldId, businessId: target.businessId } }, select: { providerIssuedAt: true, refreshStartedAt: true } });
    return row ?? null;
  }
  async persistValidatedSnapshot(target: WeatherRefreshTarget, candidate: WeatherSnapshotCandidate): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<PointRow[]>`SELECT id::text, ST_X(representative_point) AS longitude, ST_Y(representative_point) AS latitude FROM fields WHERE id = ${target.fieldId}::uuid AND business_id = ${target.businessId}::uuid FOR UPDATE`;
      const currentPoint = rows[0] && rows[0].longitude !== null && rows[0].latitude !== null ? { longitude: rows[0].longitude, latitude: rows[0].latitude } : null;
      if (fingerprint(currentPoint) !== candidate.locationFingerprint) return false;
      const existing = await tx.weatherSnapshot.findUnique({ where: { fieldId_businessId: { fieldId: target.fieldId, businessId: target.businessId } }, select: { id: true, providerIssuedAt: true, refreshStartedAt: true } });
      const older = existing && (candidate.providerIssuedAt && existing.providerIssuedAt
        ? candidate.providerIssuedAt < existing.providerIssuedAt : candidate.refreshStartedAt < existing.refreshStartedAt);
      if (older) return false;
      const data = { locationFingerprint: candidate.locationFingerprint,
        businessTimezone: candidate.businessTimezone, coverageStart: candidate.coverageStart, coverageEnd: candidate.coverageEnd,
        forecastLocalDates: [...candidate.forecastLocalDates], fetchedAt: candidate.fetchedAt, refreshStartedAt: candidate.refreshStartedAt,
        providerIssuedAt: candidate.providerIssuedAt, qualityStatus: candidate.qualityStatus, observedAt: candidate.current.observedAt,
        conditionCode: candidate.current.conditionCode, conditionLabel: candidate.current.conditionLabel, temperatureC: candidate.current.temperatureC };
      let snapshotId: string;
      if (existing) {
        snapshotId = existing.id;
        await tx.weatherDailyForecast.deleteMany({ where: { snapshotId } });
        await tx.weatherSnapshot.update({ where: { id: snapshotId }, data });
        await tx.$executeRaw`UPDATE weather_snapshots SET representative_point = ST_GeomFromText(${`POINT(${candidate.representativePoint.longitude} ${candidate.representativePoint.latitude})`}, 4326) WHERE id = ${snapshotId}::uuid`;
      } else {
        snapshotId = crypto.randomUUID();
        await tx.$executeRaw`INSERT INTO weather_snapshots (id, business_id, field_id, representative_point, location_fingerprint, business_timezone, coverage_start, coverage_end, forecast_local_dates, fetched_at, refresh_started_at, provider_issued_at, quality_status, observed_at, condition_code, condition_label, temperature_c) VALUES (${snapshotId}::uuid, ${target.businessId}::uuid, ${target.fieldId}::uuid, ST_GeomFromText(${`POINT(${candidate.representativePoint.longitude} ${candidate.representativePoint.latitude})`}, 4326), ${candidate.locationFingerprint}, ${candidate.businessTimezone}, ${candidate.coverageStart}, ${candidate.coverageEnd}, ${[...candidate.forecastLocalDates]}, ${candidate.fetchedAt}, ${candidate.refreshStartedAt}, ${candidate.providerIssuedAt}, ${candidate.qualityStatus}, ${candidate.current.observedAt}, ${candidate.current.conditionCode}, ${candidate.current.conditionLabel}, ${candidate.current.temperatureC})`;
      }
      await tx.weatherDailyForecast.createMany({ data: candidate.dailyForecasts.map((day) => ({ snapshotId, localDate: new Date(`${day.localDate}T00:00:00.000Z`), conditionCode: day.conditionCode, conditionLabel: day.conditionLabel, temperatureHighC: day.temperatureHighC, temperatureLowC: day.temperatureLowC, precipitationChancePercent: day.precipitationChancePercent, windSpeedKph: day.windSpeedKph })) });
      return true;
    }, { isolationLevel: "Serializable" });
  }
}
