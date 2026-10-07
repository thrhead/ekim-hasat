import "reflect-metadata";

import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { configureApiObservability } from "../../src/onboarding/onboarding.controller.js";
import { createCalendarModule, type CalendarModuleDependencies } from "../../src/calendar/calendar.module.js";

@Module({})
class CalendarTestRoot {}

/** Builds the Calendar module with the same auth, observability, and membership seams as production. */
export async function createCalendarTestApp(options: CalendarModuleDependencies) {
  const module = createCalendarModule(options);
  const app = await NestFactory.create<NestFastifyApplication>(
    { module: CalendarTestRoot, imports: [module] },
    new FastifyAdapter(),
    { logger: false },
  );
  configureApiObservability(app);
  await app.listen(0, "127.0.0.1");

  return {
    app,
    baseUrl: await app.getUrl(),
    close: () => app.close(),
  };
}
