import type {
  NormalizedDailyForecast,
  WeatherConditionCode,
  WeatherNormalizationInput,
  WeatherSnapshotCandidate,
} from "./weather.types.js";

const conditionCodes: Record<string, WeatherConditionCode> = {
  clear: "CLEAR", sun: "CLEAR", sunny: "CLEAR",
  partly_cloudy: "PARTLY_CLOUDY", "partly cloudy": "PARTLY_CLOUDY",
  cloudy: "CLOUDY", overcast: "CLOUDY",
  fog: "FOG", mist: "FOG",
  rain: "RAIN", drizzle: "RAIN",
  snow: "SNOW",
  thunderstorm: "THUNDERSTORM", storm: "THUNDERSTORM",
  windy: "WINDY",
};

function requireFinite(value: number, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Invalid weather ${name}`);
  return value;
}

function parseTimestamp(value: string, name: string, now: Date): Date {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new Error(`Invalid weather ${name}`);
  const result = new Date(value);
  if (result.getTime() > now.getTime()) throw new Error(`Future weather ${name}`);
  return result;
}

function condition(value: string): WeatherConditionCode {
  if (typeof value !== "string") throw new Error("Invalid weather condition");
  return conditionCodes[value.trim().toLowerCase()] ?? "UNKNOWN";
}

function toCelsius(value: number, unit: string): number {
  requireFinite(value, "temperature");
  if (unit === "C") return value;
  if (unit === "F") return (value - 32) * 5 / 9;
  throw new Error("Unsupported weather temperature unit");
}

function toKph(value: number, unit: string): number {
  requireFinite(value, "wind speed");
  if (unit === "km/h") return value;
  if (unit === "mph") return value * 1.609344;
  if (unit === "m/s") return value * 3.6;
  throw new Error("Unsupported weather wind speed unit");
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function nextDate(value: string): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function validateDates(dates: readonly string[]): asserts dates is readonly [string, string, string] {
  if (dates.length !== 3 || dates.some((date) => !isIsoDate(date)) || dates[1] !== nextDate(dates[0]!) || dates[2] !== nextDate(dates[1]!)) {
    throw new Error("Weather forecast must cover three consecutive local dates");
  }
}

function localMidnightUtc(localDate: string, timeZone: string): Date {
  const [year, month, day] = localDate.split("-").map(Number);
  const target = Date.UTC(year!, month! - 1, day!);
  let candidate = target;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(candidate)).map((part) => [part.type, part.value]));
    const represented = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
    const delta = target - represented;
    candidate += delta;
    if (delta === 0) break;
  }
  return new Date(candidate);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export function normalizeWeatherSnapshot(input: WeatherNormalizationInput, now = new Date()): WeatherSnapshotCandidate {
  const { longitude, latitude } = input.location;
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180 || !Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    throw new Error("Invalid weather coordinates");
  }
  if (!Number.isFinite(now.getTime())) throw new Error("Invalid weather validation time");
  if (!input.businessTimezone) throw new Error("Invalid business timezone");
  // Validate timezone before producing timestamps.
  new Intl.DateTimeFormat("en-US", { timeZone: input.businessTimezone }).format(now);
  validateDates(input.requestedLocalDates);

  const fetchedAt = parseTimestamp(input.fetchedAt, "fetchedAt", now);
  const refreshStartedAt = parseTimestamp(input.refreshStartedAt ?? input.fetchedAt, "refreshStartedAt", now);
  const providerIssuedAt = input.providerIssuedAt == null ? null : parseTimestamp(input.providerIssuedAt, "providerIssuedAt", now);
  const observedAt = parseTimestamp(input.current.observedAt, "observedAt", now);
  const temperatureC = toCelsius(input.current.temperature, input.current.temperatureUnit);
  const currentCode = condition(input.current.condition);

  const dailyForecasts = input.dailyForecasts.map((day, index): NormalizedDailyForecast => {
    if (day.localDate !== input.requestedLocalDates[index]) throw new Error("Weather forecast dates do not match requested local dates");
    const temperatureHighC = toCelsius(day.temperatureHigh, day.temperatureUnit);
    const temperatureLowC = toCelsius(day.temperatureLow, day.temperatureUnit);
    const precipitationChancePercent = requireFinite(day.precipitationChance, "precipitation chance");
    const windSpeedKph = toKph(day.windSpeed, day.windSpeedUnit);
    if (temperatureHighC < temperatureLowC) throw new Error("Weather daily high is below low");
    if (precipitationChancePercent < 0 || precipitationChancePercent > 100) throw new Error("Invalid weather precipitation chance");
    if (windSpeedKph < 0) throw new Error("Invalid weather wind speed");
    const code = condition(day.condition);
    return {
      localDate: day.localDate,
      conditionCode: code,
      conditionLabel: null,
      temperatureHighC: round(temperatureHighC),
      temperatureLowC: round(temperatureLowC),
      precipitationChancePercent,
      windSpeedKph: round(windSpeedKph),
    };
  });
  if (dailyForecasts.length !== 3) throw new Error("Weather forecast must contain three daily summaries");

  const coverageEndDate = nextDate(input.requestedLocalDates[2]);
  const locationFingerprint = `${longitude.toFixed(6)},${latitude.toFixed(6)}`;
  return {
    representativePoint: { longitude, latitude },
    locationFingerprint,
    businessTimezone: input.businessTimezone,
    coverageStart: localMidnightUtc(input.requestedLocalDates[0], input.businessTimezone),
    coverageEnd: localMidnightUtc(coverageEndDate, input.businessTimezone),
    forecastLocalDates: input.requestedLocalDates,
    fetchedAt,
    refreshStartedAt,
    providerIssuedAt,
    qualityStatus: "ACCEPTED",
    current: { observedAt, conditionCode: currentCode, conditionLabel: null, temperatureC: round(temperatureC) },
    dailyForecasts: dailyForecasts as [NormalizedDailyForecast, NormalizedDailyForecast, NormalizedDailyForecast],
  };
}
