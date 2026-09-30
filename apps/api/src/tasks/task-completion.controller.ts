import "reflect-metadata";
import { Body, Controller, Get, Headers, Inject, Module, Param, Post, Query, Res, UseFilters, type DynamicModule } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import type { VerifiedSubject } from "@ekim-hasat/domain/identity/auth-provider";
import { authenticateSeasonRequest, configureSeasonApiObservability, requireSeasonResourceId, type SeasonReadDependencies } from "../seasons/seasons-read.controller.js";
import { type CompleteTaskInput, type TaskCompletionHistoryFilters, type TaskCompletionHistoryPage, type TaskCompletionOutcome } from "./task-completion.repository.js";
import { TaskCompletionError } from "./task-completion.error.js";
import { TaskCompletionErrorFilter } from "./task-completion.error.filter.js";

export type TaskCompletionDependencies = Readonly<{
  verify: SeasonReadDependencies["verify"];
  complete: (identity: VerifiedSubject, taskId: string, baseTaskVersion: number, input: CompleteTaskInput) => Promise<TaskCompletionOutcome>;
  readHistory: (identity: VerifiedSubject, fieldId: string, filters: TaskCompletionHistoryFilters) => Promise<TaskCompletionHistoryPage>;
}>;
const dependenciesKey = Symbol("TASK_COMPLETION_DEPENDENCIES");

function parseVersion(value: unknown): number {
  if (typeof value !== "string" || !/^\"?[1-9]\d*\"?$/.test(value)) throw new TaskCompletionError("INVALID_REQUEST");
  const version = Number(value.replaceAll('"', ""));
  if (!Number.isSafeInteger(version)) throw new TaskCompletionError("INVALID_REQUEST");
  return version;
}

function parseBody(value: unknown): CompleteTaskInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TaskCompletionError("INVALID_REQUEST");
  const body = value as Record<string, unknown>;
  if (Object.keys(body).length !== 2 || typeof body.completionId !== "string" || typeof body.occurredAt !== "string") throw new TaskCompletionError("INVALID_REQUEST");
  return { completionId: body.completionId, occurredAt: body.occurredAt };
}

function parseHistoryFilters(value: Record<string, unknown>): TaskCompletionHistoryFilters {
  const seasonId = value.seasonId;
  const cursor = value.cursor;
  const rawLimit = value.limit;
  let limit: number | undefined;
  if (rawLimit !== undefined) {
    if (typeof rawLimit !== "string" || !/^[1-9]\d*$/.test(rawLimit)) throw new TaskCompletionError("INVALID_REQUEST");
    limit = Number(rawLimit);
    if (!Number.isSafeInteger(limit) || limit > 100) throw new TaskCompletionError("INVALID_REQUEST");
  }
  if (seasonId !== undefined && (typeof seasonId !== "string" || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(seasonId))) throw new TaskCompletionError("INVALID_REQUEST");
  if (cursor !== undefined && (typeof cursor !== "string" || !cursor.length || cursor.length > 512)) throw new TaskCompletionError("INVALID_REQUEST");
  return { ...(typeof seasonId === "string" ? { seasonId } : {}), ...(typeof cursor === "string" ? { cursor } : {}), ...(limit === undefined ? {} : { limit }) };
}

@Controller("v1")
@UseFilters(TaskCompletionErrorFilter)
export class TaskCompletionController {
  constructor(@Inject(dependenciesKey) private readonly dependencies: TaskCompletionDependencies) {}

  @Post("tasks/:taskId/completions")
  async complete(@Headers("authorization") authorization: string | undefined, @Headers("if-match") ifMatch: unknown,
    @Param("taskId") taskId: string, @Body() body: unknown,
    @Res({ passthrough: true }) reply: { status: (statusCode: number) => unknown }) {
    const identity = await authenticateSeasonRequest(authorization, this.dependencies.verify);
    requireSeasonResourceId(taskId);
    const outcome = await this.dependencies.complete(identity, taskId, parseVersion(ifMatch), parseBody(body));
    reply.status(outcome.kind === "accepted" ? 201 : 200);
    return outcome.completion;
  }

  @Get("fields/:fieldId/task-completions")
  async history(@Headers("authorization") authorization: string | undefined, @Param("fieldId") fieldId: string,
    @Query() query: Record<string, unknown>): Promise<TaskCompletionHistoryPage> {
    const identity = await authenticateSeasonRequest(authorization, this.dependencies.verify);
    requireSeasonResourceId(fieldId);
    return this.dependencies.readHistory(identity, fieldId, parseHistoryFilters(query ?? {}));
  }
}

export function createTaskCompletionModule(dependencies: TaskCompletionDependencies): DynamicModule {
  @Module({ controllers: [TaskCompletionController], providers: [{ provide: dependenciesKey, useValue: dependencies }] })
  class ConfiguredTaskCompletionModule {}
  return { module: ConfiguredTaskCompletionModule };
}

export async function createTaskCompletionApp(dependencies: TaskCompletionDependencies): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(createTaskCompletionModule(dependencies), new FastifyAdapter(), { logger: false });
  configureSeasonApiObservability(app);
  return app;
}
