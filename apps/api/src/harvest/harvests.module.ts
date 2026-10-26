import "reflect-metadata";
import { Module, type DynamicModule } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import type { VerifiedSubject } from "@ekim-hasat/domain/identity/auth-provider";
import type { HarvestCreateOutcome, HarvestCreateRequest } from "./harvests.repository.js";
import { HarvestsController } from "./harvests.controller.js";
import { configureSeasonApiObservability } from "../seasons/seasons-read.controller.js";

export type HarvestsDependencies = Readonly<{
  verify: (token: string) => Promise<VerifiedSubject | null>;
  create: (identity: VerifiedSubject, fieldId: string, request: HarvestCreateRequest) => Promise<HarvestCreateOutcome>;
}>;

const dependenciesKey = Symbol.for("HARVESTS_DEPENDENCIES");

export function createHarvestsModule(dependencies: HarvestsDependencies): DynamicModule {
  @Module({ controllers: [HarvestsController], providers: [{ provide: dependenciesKey, useValue: dependencies }] })
  class ConfiguredHarvestsModule {}
  return { module: ConfiguredHarvestsModule };
}

export async function createHarvestsApp(dependencies: HarvestsDependencies): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(createHarvestsModule(dependencies), new FastifyAdapter(), { logger: false });
  configureSeasonApiObservability(app);
  return app;
}
