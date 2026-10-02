import type { WeatherFreshnessInput, WeatherFreshnessStatus } from "./weather.types.js";

export function classifyWeatherFreshness(input: WeatherFreshnessInput): WeatherFreshnessStatus {
  if (!input.hasUsableRepresentativePoint || !input.currentLocationFingerprint || !input.snapshot) return "UNAVAILABLE";
  if (input.snapshot.locationFingerprint !== input.currentLocationFingerprint) return "UNAVAILABLE";
  if (!Number.isFinite(input.maxAgeHours) || input.maxAgeHours <= 0) throw new Error("Weather maximum age must be positive");

  const ageMs = input.now.getTime() - input.snapshot.fetchedAt.getTime();
  if (ageMs < 0 || ageMs > input.maxAgeHours * 60 * 60 * 1000) return "STALE";
  if (input.snapshot.businessTimezone !== input.businessTimezone) return "STALE";
  if (input.snapshot.forecastLocalDates.length !== 3 ||
      input.snapshot.forecastLocalDates.some((date, index) => date !== input.requestedLocalDates[index])) return "STALE";
  return "CURRENT";
}
