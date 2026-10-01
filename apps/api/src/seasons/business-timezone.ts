export const FALLBACK_BUSINESS_TIMEZONE = "Europe/Istanbul";

export function resolveBusinessTimezone(timezone: string | null | undefined): string {
  const resolved = timezone || FALLBACK_BUSINESS_TIMEZONE;
  try { new Intl.DateTimeFormat("en", { timeZone: resolved }).format(new Date(0)); }
  catch { throw new Error("Configured business timezone is invalid"); }
  return resolved;
}

export function businessLocalDate(now: Date, timezone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
    const part = (type: string) => parts.find((value) => value.type === type)!.value;
    return `${part("year")}-${part("month")}-${part("day")}`;
  } catch { throw new Error("Configured business timezone is invalid"); }
}
