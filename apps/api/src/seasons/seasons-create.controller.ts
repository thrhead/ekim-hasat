import "reflect-metadata";
import { Body, Controller, Headers, Inject, Module, Param, Post, Res, UseFilters, type DynamicModule } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import type { VerifiedSubject } from "@ekim-hasat/domain/identity/auth-provider";
import { authenticateSeasonRequest, requireSeasonResourceId, configureSeasonApiObservability, type SeasonReadDependencies } from "./seasons-read.controller.js";
import { SeasonsErrorFilter } from "./seasons-error.filter.js";
import { validateCreateSeasonCommand, validateSeasonIdempotencyKey, type SeasonCreateOutcome } from "./seasons-create.repository.js";

export type SeasonCreateDependencies = Readonly<{
  verify: SeasonReadDependencies["verify"];
  createDraft: (identity: VerifiedSubject, fieldId: string, body: unknown, key: string) => Promise<SeasonCreateOutcome>;
}>;
const dependenciesKey = Symbol("SEASON_CREATE_DEPENDENCIES");
@Controller("v1")
@UseFilters(SeasonsErrorFilter)
export class SeasonCreateController {
  constructor(@Inject(dependenciesKey) private readonly dependencies: SeasonCreateDependencies) {}

  @Post("fields/:fieldId/seasons")
  async create(@Headers("authorization") authorization: string | undefined, @Param("fieldId") fieldId: string,
    @Body() body: unknown, @Headers("idempotency-key") key: unknown,
    @Res({ passthrough: true }) reply: { header: (name: string, value: string) => unknown; status: (status: number) => unknown }) {
    const identity = await authenticateSeasonRequest(authorization, this.dependencies.verify);
    requireSeasonResourceId(fieldId);
    const idempotencyKey = validateSeasonIdempotencyKey(key);
    validateCreateSeasonCommand(body);
    const outcome = await this.dependencies.createDraft(identity, fieldId, body, idempotencyKey);
    reply.status(outcome.kind === "created" ? 201 : 200);
    reply.header("ETag", `"${outcome.season.version}"`);
    return outcome.season;
  }
}
export function createSeasonCreateModule(dependencies: SeasonCreateDependencies): DynamicModule {
  @Module({ controllers: [SeasonCreateController], providers: [{ provide: dependenciesKey, useValue: dependencies }] })
  class ConfiguredSeasonCreateModule {}
  return { module: ConfiguredSeasonCreateModule };
}
export async function createSeasonCreateApp(dependencies: SeasonCreateDependencies): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(createSeasonCreateModule(dependencies), new FastifyAdapter(), { logger: false });
  configureSeasonApiObservability(app);
  return app;
}
