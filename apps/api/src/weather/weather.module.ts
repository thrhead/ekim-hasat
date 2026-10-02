import type { DynamicModule } from "@nestjs/common";
import type { VerifiedSubject } from "@ekim-hasat/domain/identity/auth-provider";
import type { PrismaClient } from "../generated/prisma/client.js";
import { WeatherRepository } from "./weather.repository.js";
import { createWeatherReadModule } from "./weather.controller.js";

/** Production composition seam; main.ts supplies the existing verifier and Prisma client. */
export function createWeatherModule(options: {
  verify: (token: string) => Promise<VerifiedSubject | null>;
  prisma: PrismaClient;
  maxAgeHours?: number;
  now?: () => Date;
}): DynamicModule {
  const repository = new WeatherRepository(options.prisma, { maxAgeHours: options.maxAgeHours, now: options.now });
  return createWeatherReadModule({
    verify: options.verify,
    readFieldWeather: (identity, fieldId) => repository.readFieldWeather(identity, fieldId),
    readWeatherOverview: (identity, page) => repository.readWeatherOverview(identity, page),
  });
}
