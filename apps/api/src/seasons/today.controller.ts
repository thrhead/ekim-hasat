import "reflect-metadata";
import { Controller, Get, Headers, Inject, Module, UnauthorizedException, UseFilters, type DynamicModule } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import type { VerifiedSubject } from "@ekim-hasat/domain/identity/auth-provider";
import type { operations } from "@ekim-hasat/api-client/generated/seasons";
import { CorrelationIdMiddleware, type CorrelationRequest, type CorrelationReply } from "../observability/correlation-id.middleware.js";
import { RequestLogger } from "../observability/request-logger.js";
import { SeasonsErrorFilter } from "./seasons-error.filter.js";

export type TodayPlannedTasksResponse = operations["getTodayPlannedTasks"]["responses"][200]["content"]["application/json"];
export type TodayDependencies = Readonly<{
  verify: (token: string) => Promise<VerifiedSubject | null>;
  readToday: (identity: VerifiedSubject) => Promise<TodayPlannedTasksResponse>;
}>;
const dependenciesKey = Symbol("TODAY_DEPENDENCIES");

@Controller("v1")
@UseFilters(SeasonsErrorFilter)
export class TodayController {
  constructor(@Inject(dependenciesKey) private readonly dependencies: TodayDependencies) {}

  @Get("today")
  async getToday(@Headers("authorization") authorization: string | undefined): Promise<TodayPlannedTasksResponse> {
    const token = typeof authorization === "string" ? /^Bearer\s+(\S+)$/i.exec(authorization)?.[1] : undefined;
    if (!token) throw new UnauthorizedException();
    let identity: VerifiedSubject | null;
    try { identity = await this.dependencies.verify(token); } catch { throw new UnauthorizedException(); }
    if (!identity) throw new UnauthorizedException();
    return this.dependencies.readToday(identity);
  }
}

export function createTodayModule(dependencies: TodayDependencies): DynamicModule {
  @Module({ controllers: [TodayController], providers: [{ provide: dependenciesKey, useValue: dependencies }] })
  class ConfiguredTodayModule {}
  return { module: ConfiguredTodayModule };
}

/** Used by isolated route tests; production uses the existing shared correlation hooks. */
export function configureTodayApiObservability(app: NestFastifyApplication): void {
  const correlation = new CorrelationIdMiddleware(new RequestLogger());
  const fastify = app.getHttpAdapter().getInstance();
  fastify.decorateRequest("correlationId", "");
  fastify.decorateRequest("requestStartedAt", 0);
  fastify.addHook("onRequest", (request, reply, done) => correlation.onRequest(request as unknown as CorrelationRequest, reply as unknown as CorrelationReply, done));
  fastify.addHook("onResponse", async (request, reply) => correlation.onResponse(request as unknown as CorrelationRequest, reply as unknown as CorrelationReply));
}

export async function createTodayApp(dependencies: TodayDependencies): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(createTodayModule(dependencies), new FastifyAdapter(), { logger: false });
  configureTodayApiObservability(app);
  return app;
}
