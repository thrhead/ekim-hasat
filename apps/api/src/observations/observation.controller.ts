import "reflect-metadata";
import { Body, Controller, Get, Headers, Inject, Module, Param, Post, Query, Res, UseFilters, type DynamicModule } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import type { VerifiedSubject } from "@ekim-hasat/domain/identity/auth-provider";
import type { ObservationDiaryComponents } from "@ekim-hasat/api-client";
import { ApiError, ApiErrorFilter } from "../observability/api-error.filter.js";
import { authenticateSeasonRequest, configureSeasonApiObservability } from "../seasons/seasons-read.controller.js";

export type CreateObservationRequest = ObservationDiaryComponents["schemas"]["CreateObservationRequest"];
export type ObservationPublic = ObservationDiaryComponents["schemas"]["Observation"];
export type ObservationCreateOutcome = Readonly<{ kind: "accepted" | "replayed"; observation: ObservationPublic }>;
export type ObservationDiaryFilters = Readonly<{ seasonId?: string; cursor?: string; limit?: number }>;
export type ObservationDiaryPage = ObservationDiaryComponents["schemas"]["DiaryPage"];
export type ObservationDependencies = Readonly<{
  verify: (token: string) => Promise<VerifiedSubject | null>;
  create: (identity: VerifiedSubject, fieldId: string, request: CreateObservationRequest) => Promise<ObservationCreateOutcome>;
  readDiary: (identity: VerifiedSubject, fieldId: string, filters: ObservationDiaryFilters) => Promise<ObservationDiaryPage>;
}>;
const dependenciesKey = Symbol("FIELD_OBSERVATION_DEPENDENCIES");
const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

function parseCreateBody(value: unknown): CreateObservationRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalidRequest();
  const body = value as Record<string, unknown>;
  const required = ["observationId", "description", "occurredAtLocal", "occurredAt"];
  if (required.some((key) => !(key in body)) || Object.keys(body).some((key) => ![...required, "seasonId"].includes(key))) throw invalidRequest();
  if (typeof body.observationId !== "string" || !uuid.test(body.observationId)
      || typeof body.description !== "string" || typeof body.occurredAtLocal !== "string" || typeof body.occurredAt !== "string"
      || (body.seasonId !== undefined && (typeof body.seasonId !== "string" || !uuid.test(body.seasonId)))) throw invalidRequest();
  return { observationId: body.observationId, description: body.description, occurredAtLocal: body.occurredAtLocal,
    occurredAt: body.occurredAt, ...(typeof body.seasonId === "string" ? { seasonId: body.seasonId } : {}) };
}

function invalidRequest(): ApiError { return new ApiError(400, "INVALID_REQUEST", "Check the observation information and try again"); }

@Controller("v1")
@UseFilters(ApiErrorFilter)
export class ObservationController {
  constructor(@Inject(dependenciesKey) private readonly dependencies: ObservationDependencies) {}

  @Post("fields/:fieldId/observations")
  async create(@Headers("authorization") authorization: string | undefined, @Param("fieldId") fieldId: string,
    @Body() body: unknown, @Res({ passthrough: true }) reply: { status: (statusCode: number) => unknown }) {
    const identity = await authenticateSeasonRequest(authorization, this.dependencies.verify);
    if (!uuid.test(fieldId)) throw invalidRequest();
    const outcome = await this.dependencies.create(identity, fieldId, parseCreateBody(body));
    reply.status(outcome.kind === "accepted" ? 201 : 200);
    return outcome.observation;
  }

  @Get("fields/:fieldId/diary")
  async diary(@Headers("authorization") authorization: string | undefined, @Param("fieldId") fieldId: string,
    @Query() query: Record<string, unknown>): Promise<ObservationDiaryPage> {
    const identity = await authenticateSeasonRequest(authorization, this.dependencies.verify);
    if (!uuid.test(fieldId)) throw invalidRequest();
    const seasonId = query.seasonId;
    const cursor = query.cursor;
    const rawLimit = query.limit;
    let limit: number | undefined;
    if (rawLimit !== undefined) {
      if (typeof rawLimit !== "string" || !/^[1-9]\d*$/.test(rawLimit)) throw invalidRequest();
      limit = Number(rawLimit);
      if (!Number.isSafeInteger(limit) || limit > 100) throw invalidRequest();
    }
    if (seasonId !== undefined && (typeof seasonId !== "string" || !uuid.test(seasonId))) throw invalidRequest();
    if (cursor !== undefined && (typeof cursor !== "string" || !cursor.length || cursor.length > 512)) throw invalidRequest();
    return this.dependencies.readDiary(identity, fieldId, { ...(typeof seasonId === "string" ? { seasonId } : {}),
      ...(typeof cursor === "string" ? { cursor } : {}), ...(limit === undefined ? {} : { limit }) });
  }
}

export function createObservationModule(dependencies: ObservationDependencies): DynamicModule {
  @Module({ controllers: [ObservationController], providers: [{ provide: dependenciesKey, useValue: dependencies }] })
  class ConfiguredObservationModule {}
  return { module: ConfiguredObservationModule };
}

export async function createObservationApp(dependencies: ObservationDependencies): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(createObservationModule(dependencies), new FastifyAdapter(), { logger: false });
  configureSeasonApiObservability(app);
  return app;
}
