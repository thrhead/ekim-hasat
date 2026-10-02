import type { WeatherForecastRequest, WeatherProviderForecast } from "./weather.types.js";

/** External weather acquisition boundary. Implementations remain behind adapters. */
export interface WeatherProvider {
  getForecast(request: WeatherForecastRequest): Promise<WeatherProviderForecast>;
}
