import "reflect-metadata";
import { Body, Controller, Headers, Inject, Module, Post, Res, UseFilters, type DynamicModule } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import type { VerifiedSubject } from "@ekim-hasat/domain/identity/auth-provider";
import type { FieldComponents } from "@ekim-hasat/api-client";
import { ApiErrorFilter } from "../observability/api-error.filter.js";
import { CorrelationIdMiddleware } from "../observability/correlation-id.middleware.js";
import { RequestLogger } from "../observability/request-logger.js";
import { authenticateSeasonRequest, type SeasonReadDependencies } from "../seasons/seasons-read.controller.js";
import { validateCreateFieldCommand, validateFieldIdempotencyKey } from "./fields-create.service.js";
import type { FieldCreateOutcome } from "./fields-create.repository.js";

export type FieldCreateDependencies = Readonly<{
  verify: SeasonReadDependencies["verify"];
  createField: (identity: VerifiedSubject, body: unknown, key: string) => Promise<FieldCreateOutcome>;
}>;

const dependenciesKey = Symbol("FIELD_CREATE_DEPENDENCIES");

@Controller("v1")
@UseFilters(ApiErrorFilter)
export class FieldCreateController {
  constructor(@Inject(dependenciesKey) private readonly dependencies: FieldCreateDependencies) {}

  @Post("fields")
  async create(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: unknown,
    @Headers("idempotency-key") key: unknown,
    @Res({ passthrough: true }) reply: { header: (name: string, value: string) => unknown; status: (status: number) => unknown },
  ): Promise<FieldComponents["schemas"]["FieldDetail"]> {
    const identity = await authenticateSeasonRequest(authorization, this.dependencies.verify);
    const idempotencyKey = validateFieldIdempotencyKey(key);
    validateCreateFieldCommand(body);
    const outcome = await this.dependencies.createField(identity, body, idempotencyKey);
    reply.status(outcome.kind === "created" ? 201 : 200);
    reply.header("ETag", `"${outcome.field.version}"`);
    return outcome.field;
  }
}

export function createFieldCreateModule(dependencies: FieldCreateDependencies): DynamicModule {
  @Module({ controllers: [FieldCreateController], providers: [{ provide: dependenciesKey, useValue: dependencies }] })
  class ConfiguredFieldCreateModule {}
  return { module: ConfiguredFieldCreateModule };
}

export async function createFieldCreateApp(dependencies: FieldCreateDependencies): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(createFieldCreateModule(dependencies), new FastifyAdapter(), { logger: false });
  const correlation = new CorrelationIdMiddleware(new RequestLogger());
  const fastify = app.getHttpAdapter().getInstance();
  fastify.decorateRequest("correlationId", "");
  fastify.decorateRequest("requestStartedAt", 0);
  fastify.addHook("onRequest", (request, reply, done) => {
    correlation.onRequest(request as never, reply as never, done);
  });
  fastify.addHook("onResponse", async (request, reply) => {
    correlation.onResponse(request as never, reply as never);
  });
  return app;
}
