import "reflect-metadata";
import { Body, Controller, Headers, Inject, Module, Param, Patch, Res, UseFilters, type DynamicModule } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import type { FieldComponents } from "@ekim-hasat/api-client";
import type { VerifiedSubject } from "@ekim-hasat/domain/identity/auth-provider";
import { ApiError, ApiErrorFilter } from "../observability/api-error.filter.js";
import { authenticateFieldsRequest, configureFieldsReadApiObservability } from "./fields-read.controller.js";
import { FieldUpdateService, validateFieldUpdateCommand } from "./fields-update.service.js";

export type FieldUpdateDependencies = Readonly<{
  verify: (token: string) => Promise<VerifiedSubject | null>;
  updateField: (identity: VerifiedSubject, fieldId: string, expectedVersion: number, body: unknown) => Promise<FieldComponents["schemas"]["FieldDetail"]>;
}>;

const dependenciesKey = Symbol("FIELDS_UPDATE_DEPENDENCIES");
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Controller("v1")
@UseFilters(ApiErrorFilter)
class FieldsUpdateController {
  constructor(@Inject(dependenciesKey) private readonly dependencies: FieldUpdateDependencies) {}

  @Patch("fields/:fieldId")
  async update(
    @Headers("authorization") authorization: string | undefined,
    @Headers("if-match") ifMatch: unknown,
    @Param("fieldId") fieldId: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: { header: (name: string, value: string) => unknown },
  ): Promise<FieldComponents["schemas"]["FieldDetail"]> {
    const identity = await authenticateFieldsRequest(authorization, this.dependencies.verify);
    if (!uuidPattern.test(fieldId) || typeof ifMatch !== "string") throw new ApiError(400, "INVALID_REQUEST", "Check the Field information and try again");
    const version = /^"([1-9][0-9]*)"$/.exec(ifMatch)?.[1];
    if (!version || !Number.isSafeInteger(Number(version))) throw new ApiError(400, "INVALID_REQUEST", "Check the Field version and try again");
    validateFieldUpdateCommand(body);
    const field = await this.dependencies.updateField(identity, fieldId, Number(version), body);
    reply.header("ETag", `"${field.version}"`);
    return field;
  }
}

export function createFieldUpdateModule(dependencies: FieldUpdateDependencies): DynamicModule {
  @Module({ controllers: [FieldsUpdateController], providers: [{ provide: dependenciesKey, useValue: dependencies }] })
  class ConfiguredFieldsUpdateModule {}
  return { module: ConfiguredFieldsUpdateModule };
}

export async function createFieldUpdateApp(dependencies: FieldUpdateDependencies): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(createFieldUpdateModule(dependencies), new FastifyAdapter(), { logger: false });
  configureFieldsReadApiObservability(app);
  return app;
}

/** Production dependency helper shared by the root Fields composition. */
export function fieldUpdateDependencies(
  verify: FieldUpdateDependencies["verify"],
  service: FieldUpdateService,
): FieldUpdateDependencies {
  return { verify, updateField: async (identity, fieldId, version, body) => (await service.update(identity, fieldId, version, body)).field };
}
