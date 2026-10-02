export const WEATHER_CONDITION_CODES = [
  "CLEAR",
  "PARTLY_CLOUDY",
  "CLOUDY",
  "FOG",
  "RAIN",
  "SNOW",
  "THUNDERSTORM",
  "WINDY",
  "UNKNOWN",
] as const;

export type WeatherConditionCode = (typeof WEATHER_CONDITION_CODES)[number];
export type WeatherFreshnessStatus = "CURRENT" | "STALE" | "UNAVAILABLE";
export type TemperatureUnit = "C" | "F";
export type WindSpeedUnit = "km/h" | "mph" | "m/s";

export type WeatherLocation = Readonly<{ longitude: number; latitude: number }>;

export type ProviderCurrentConditions = Readonly<{
  observedAt: string;
  condition: string;
  temperature: number;
  temperatureUnit: TemperatureUnit;
}>;

export type ProviderDailyForecast = Readonly<{
  localDate: string;
  condition: string;
  temperatureHigh: number;
  temperatureLow: number;
  temperatureUnit: TemperatureUnit;
  precipitationChance: number;
  windSpeed: number;
  windSpeedUnit: WindSpeedUnit;
}>;

/** Provider-neutral output after an adapter has translated its vendor payload. */
export type WeatherProviderForecast = Readonly<{
  providerIssuedAt?: string;
  current: ProviderCurrentConditions;
  dailyForecasts: readonly ProviderDailyForecast[];
}>;

export type WeatherForecastRequest = Readonly<{
  location: WeatherLocation;
  businessTimezone: string;
  requestedLocalDates: readonly [string, string, string];
}>;

export type NormalizedCurrentConditions = Readonly<{
  observedAt: Date;
  conditionCode: WeatherConditionCode;
  conditionLabel: string | null;
  temperatureC: number;
}>;

export type NormalizedDailyForecast = Readonly<{
  localDate: string;
  conditionCode: WeatherConditionCode;
  conditionLabel: string | null;
  temperatureHighC: number;
  temperatureLowC: number;
  precipitationChancePercent: number;
  windSpeedKph: number;
}>;

export type WeatherSnapshotCandidate = Readonly<{
  representativePoint: WeatherLocation;
  locationFingerprint: string;
  businessTimezone: string;
  coverageStart: Date;
  coverageEnd: Date;
  forecastLocalDates: readonly [string, string, string];
  fetchedAt: Date;
  refreshStartedAt: Date;
  providerIssuedAt: Date | null;
  qualityStatus: "ACCEPTED";
  current: NormalizedCurrentConditions;
  dailyForecasts: readonly [NormalizedDailyForecast, NormalizedDailyForecast, NormalizedDailyForecast];
}>;

export type WeatherNormalizationInput = WeatherForecastRequest & WeatherProviderForecast & Readonly<{
  fetchedAt: string;
  refreshStartedAt?: string;
}>;

export type WeatherFreshnessInput = Readonly<{
  snapshot: Pick<WeatherSnapshotCandidate, "fetchedAt" | "businessTimezone" | "forecastLocalDates" | "locationFingerprint"> | null;
  now: Date;
  maxAgeHours: number;
  requestedLocalDates: readonly [string, string, string];
  businessTimezone: string;
  currentLocationFingerprint: string | null;
  hasUsableRepresentativePoint: boolean;
}>;
