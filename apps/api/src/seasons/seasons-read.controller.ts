import "reflect-metadata";
import { Controller, Get, Headers, Inject, Module, Param, Res, UnauthorizedException, NotFoundException, UseFilters, type DynamicModule } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import type { VerifiedSubject } from "@ekim-hasat/domain/identity/auth-provider";
import type { operations, components } from "@ekim-hasat/api-client/generated/seasons";
import { CorrelationIdMiddleware, type CorrelationRequest, type CorrelationReply } from "../observability/correlation-id.middleware.js";
import { RequestLogger } from "../observability/request-logger.js";
import { SeasonsErrorFilter } from "./seasons-error.filter.js";

export type SeasonSetupOptionsResponse = operations["getSeasonSetupOptions"]["responses"][200]["content"]["application/json"];
export type SeasonSetupResponse = components["schemas"]["SeasonDraft"] | components["schemas"]["ActiveSeason"];
export type SeasonReadDependencies = Readonly<{
  verify: (token: string) => Promise<VerifiedSubject | null>;
  readOptions: (identity: VerifiedSubject, fieldId: string) => Promise<SeasonSetupOptionsResponse>;
  readSeason: (identity: VerifiedSubject, seasonId: string) => Promise<SeasonSetupResponse>;
}>;
const dependenciesKey = Symbol("SEASON_READ_DEPENDENCIES");

export async function authenticateSeasonRequest(authorization: string | undefined, verify: SeasonReadDependencies["verify"]): Promise<VerifiedSubject> {
  const token = typeof authorization === "string" ? /^Bearer\s+(\S+)$/i.exec(authorization)?.[1] : undefined;
  if (!token) throw new UnauthorizedException();
  let identity: VerifiedSubject | null;
  try { identity = await verify(token); } catch { throw new UnauthorizedException(); }
  if (!identity) throw new UnauthorizedException();
  return identity;
}

export function requireSeasonResourceId(id: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new NotFoundException();
}

@Controller("v1")
@UseFilters(SeasonsErrorFilter)
export class SeasonReadController {
  constructor(@Inject(dependenciesKey) private readonly dependencies: SeasonReadDependencies) {}

  @Get("fields/:fieldId/season-setup-options")
  async getOptions(@Headers("authorization") authorization: string | undefined, @Param("fieldId") fieldId: string): Promise<SeasonSetupOptionsResponse> {
    const identity = await authenticateSeasonRequest(authorization, this.dependencies.verify);
    requireSeasonResourceId(fieldId);
    return this.dependencies.readOptions(identity, fieldId);
  }

  @Get("seasons/:seasonId")
  async getSeason(@Headers("authorization") authorization: string | undefined, @Param("seasonId") seasonId: string,
    @Res({ passthrough: true }) reply: { header: (name: string, value: string) => unknown }): Promise<SeasonSetupResponse> {
    const identity = await authenticateSeasonRequest(authorization, this.dependencies.verify);
    requireSeasonResourceId(seasonId);
    const result = await this.dependencies.readSeason(identity, seasonId);
    reply.header("ETag", `"${result.version}"`);
    return result;
  }
}

export function createSeasonReadModule(dependencies: SeasonReadDependencies): DynamicModule {
  @Module({ controllers: [SeasonReadController], providers: [{ provide: dependenciesKey, useValue: dependencies }] })
  class ConfiguredSeasonReadModule {}
  return { module: ConfiguredSeasonReadModule };
}

/** Used by isolated route tests; production uses the existing shared correlation hooks. */
export function configureSeasonApiObservability(app: NestFastifyApplication): void {
  const correlation = new CorrelationIdMiddleware(new RequestLogger());
  const fastify = app.getHttpAdapter().getInstance();
  fastify.decorateRequest("correlationId", "");
  fastify.decorateRequest("requestStartedAt", 0);
  fastify.addHook("onRequest", (request, reply, done) => correlation.onRequest(request as unknown as CorrelationRequest, reply as unknown as CorrelationReply, done));
  fastify.addHook("onResponse", async (request, reply) => correlation.onResponse(request as unknown as CorrelationRequest, reply as unknown as CorrelationReply));
}

export async function createSeasonReadApp(dependencies: SeasonReadDependencies): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(createSeasonReadModule(dependencies), new FastifyAdapter(), { logger: false });
  configureSeasonApiObservability(app);
  return app;
}
