import "reflect-metadata";
import { Controller, Headers, Inject, Module, Param, Post, Res, UseFilters, type DynamicModule } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import type { VerifiedSubject } from "@ekim-hasat/domain/identity/auth-provider";
import { authenticateSeasonRequest, requireSeasonResourceId, configureSeasonApiObservability, type SeasonReadDependencies } from "./seasons-read.controller.js";
import { SeasonsErrorFilter } from "./seasons-error.filter.js";
import { validateActivationExpectedVersion, validateActivationIdempotencyKey, type SeasonActivationOutcome } from "./seasons-activation.repository.js";

export type SeasonActivationDependencies = Readonly<{
  verify: SeasonReadDependencies["verify"];
  activate: (identity: VerifiedSubject, seasonId: string, expectedVersion: number, key: string) => Promise<SeasonActivationOutcome>;
}>;
const dependenciesKey = Symbol("SEASON_ACTIVATION_DEPENDENCIES");

@Controller("v1/seasons/:seasonId/activate")
@UseFilters(SeasonsErrorFilter)
export class SeasonActivationController {
  constructor(@Inject(dependenciesKey) private readonly dependencies: SeasonActivationDependencies) {}

  @Post()
  async activate(@Headers("authorization") authorization: string | undefined, @Headers("if-match") ifMatch: unknown,
    @Headers("idempotency-key") key: unknown, @Param("seasonId") seasonId: string,
    @Res({ passthrough: true }) reply: { header: (name: string, value: string) => unknown; status: (status: number) => unknown }) {
    const identity = await authenticateSeasonRequest(authorization, this.dependencies.verify);
    requireSeasonResourceId(seasonId);
    const expectedVersion = validateActivationExpectedVersion(ifMatch);
    const idempotencyKey = validateActivationIdempotencyKey(key);
    const outcome = await this.dependencies.activate(identity, seasonId, expectedVersion, idempotencyKey);
    reply.status(200);
    reply.header("ETag", `"${outcome.season.version}"`);
    return outcome.season;
  }
}

export function createSeasonActivationModule(dependencies: SeasonActivationDependencies): DynamicModule {
  @Module({ controllers: [SeasonActivationController], providers: [{ provide: dependenciesKey, useValue: dependencies }] })
  class ConfiguredSeasonActivationModule {}
  return { module: ConfiguredSeasonActivationModule };
}

export async function createSeasonActivationApp(dependencies: SeasonActivationDependencies): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(createSeasonActivationModule(dependencies), new FastifyAdapter(), { logger: false });
  configureSeasonApiObservability(app);
  return app;
}
