import { ApiError } from "../observability/api-error.filter.js";

export const FALLBACK_BUSINESS_TIMEZONE = "Europe/Istanbul";

export function resolveBusinessTimezone(timezone: string | null | undefined): string {
  const resolved = timezone || FALLBACK_BUSINESS_TIMEZONE;
  try { new Intl.DateTimeFormat("en", { timeZone: resolved }).format(new Date(0)); }
  catch { throw new Error("Configured business timezone is invalid"); }
  return resolved;
}

/** Resolve a farmer-entered local wall time only when the Business timezone maps it uniquely. */
export function resolveBusinessObservationInstant(
  occurredAtLocal: string,
  submittedOccurredAt: string,
  businessTimezone: string | null | undefined,
): { occurredAt: Date; businessTimezone: string } {
  const timezone = resolveObservationTimezone(businessTimezone);
  const local = parseLocalDateTime(occurredAtLocal);
  if (local === undefined || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(submittedOccurredAt)) {
    throw invalidObservationTime();
  }
  const submitted = new Date(submittedOccurredAt);
  if (!Number.isFinite(submitted.getTime())) throw invalidObservationTime();

  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    fractionalSecondDigits: 3,
  });
  const offsets = new Set<number>();
  for (let delta = -36 * 60; delta <= 36 * 60; delta += 15) {
    const instant = local.epoch + delta * 60_000;
    const parts = Object.fromEntries(formatter.formatToParts(new Date(instant)).map(({ type, value }) => [type, value]));
    const represented = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day),
      Number(parts.hour), Number(parts.minute), Number(parts.second), Number(parts.fractionalSecond));
    offsets.add(represented - instant);
  }
  const matches = [...offsets].map((offset) => new Date(local.epoch - offset))
    .filter((instant) => sameLocalTime(formatter, instant, local));
  if (matches.length !== 1 || matches[0]!.getTime() !== submitted.getTime()) throw invalidObservationTime();
  return { occurredAt: submitted, businessTimezone: timezone };
}

type LocalDateTime = { epoch: number; year: number; month: number; day: number; hour: number; minute: number; second: number; millisecond: number };

function parseLocalDateTime(value: string): LocalDateTime | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(value);
  if (!match) return undefined;
  const [, y, mo, d, h, mi, s = "0", ms = "0"] = match;
  const parts = { year: Number(y), month: Number(mo), day: Number(d), hour: Number(h), minute: Number(mi), second: Number(s), millisecond: Number(ms.padEnd(3, "0")) };
  const epoch = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second, parts.millisecond);
  const check = new Date(epoch);
  if (check.getUTCFullYear() !== parts.year || check.getUTCMonth() + 1 !== parts.month || check.getUTCDate() !== parts.day
      || parts.hour > 23 || parts.minute > 59 || parts.second > 59) return undefined;
  return { ...parts, epoch };
}

function sameLocalTime(formatter: Intl.DateTimeFormat, instant: Date, local: LocalDateTime): boolean {
  const parts = Object.fromEntries(formatter.formatToParts(instant).map(({ type, value }) => [type, value]));
  return Number(parts.year) === local.year && Number(parts.month) === local.month && Number(parts.day) === local.day
    && Number(parts.hour) === local.hour && Number(parts.minute) === local.minute && Number(parts.second) === local.second
    && Number(parts.fractionalSecond) === local.millisecond;
}

function resolveObservationTimezone(value: string | null | undefined): string {
  try { return resolveBusinessTimezone(value); }
  catch { throw invalidObservationTime(); }
}

function invalidObservationTime(): ApiError {
  return new ApiError(400, "INVALID_REQUEST", "Check the observation date and time");
}

export function businessLocalDate(now: Date, timezone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
    const part = (type: string) => parts.find((value) => value.type === type)!.value;
    return `${part("year")}-${part("month")}-${part("day")}`;
  } catch { throw new Error("Configured business timezone is invalid"); }
}
