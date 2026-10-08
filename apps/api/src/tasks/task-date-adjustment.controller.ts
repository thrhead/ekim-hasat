import "reflect-metadata";
import { Body, Controller, Get, Headers, Inject, Module, Param, Post, Query, Res, UseFilters, type DynamicModule } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import type { VerifiedSubject } from "@ekim-hasat/domain/identity/auth-provider";
import { authenticateSeasonRequest, configureSeasonApiObservability, requireSeasonResourceId, type SeasonReadDependencies } from "../seasons/seasons-read.controller.js";
import { parseTaskDateAdjustmentHistoryQuery, parseTaskDateAdjustmentRequest, parseTaskDateAdjustmentVersion } from "./task-date-adjustment.dto.js";
import type { AdjustTaskDateInput, TaskDateAdjustmentHistoryPage, TaskDateAdjustmentOutcome } from "./task-date-adjustment.repository.js";
import { TaskDateAdjustmentErrorFilter } from "./task-date-adjustment.error.filter.js";

export type TaskDateAdjustmentDependencies = Readonly<{
  verify: SeasonReadDependencies["verify"];
  adjust: (identity: VerifiedSubject, taskId: string, baseTaskVersion: number, input: AdjustTaskDateInput) => Promise<TaskDateAdjustmentOutcome>;
  readHistory: (identity: VerifiedSubject, taskId: string, query: ReturnType<typeof parseTaskDateAdjustmentHistoryQuery>) => Promise<TaskDateAdjustmentHistoryPage>;
}>;

const dependenciesKey = Symbol("TASK_DATE_ADJUSTMENT_DEPENDENCIES");

@Controller("v1")
@UseFilters(TaskDateAdjustmentErrorFilter)
export class TaskDateAdjustmentController {
  constructor(@Inject(dependenciesKey) private readonly dependencies: TaskDateAdjustmentDependencies) {}

  @Post("tasks/:taskId/date-adjustments")
  async adjust(@Headers("authorization") authorization: string | undefined, @Headers("if-match") ifMatch: unknown,
    @Param("taskId") taskId: string, @Body() body: unknown,
    @Res({ passthrough: true }) reply: { status: (statusCode: number) => unknown }) {
    const identity = await authenticateSeasonRequest(authorization, this.dependencies.verify);
    requireSeasonResourceId(taskId);
    const outcome = await this.dependencies.adjust(identity, taskId, parseTaskDateAdjustmentVersion(ifMatch), parseTaskDateAdjustmentRequest(body));
    reply.status(outcome.kind === "accepted" ? 201 : 200);
    return outcome.adjustment;
  }

  @Get("tasks/:taskId/date-adjustments")
  async history(@Headers("authorization") authorization: string | undefined, @Param("taskId") taskId: string,
    @Query() query: Record<string, unknown>): Promise<TaskDateAdjustmentHistoryPage> {
    const identity = await authenticateSeasonRequest(authorization, this.dependencies.verify);
    requireSeasonResourceId(taskId);
    return this.dependencies.readHistory(identity, taskId, parseTaskDateAdjustmentHistoryQuery(query ?? {}));
  }
}

export function createTaskDateAdjustmentModule(dependencies: TaskDateAdjustmentDependencies): DynamicModule {
  @Module({ controllers: [TaskDateAdjustmentController], providers: [{ provide: dependenciesKey, useValue: dependencies }] })
  class ConfiguredTaskDateAdjustmentModule {}
  return { module: ConfiguredTaskDateAdjustmentModule };
}

export async function createTaskDateAdjustmentApp(dependencies: TaskDateAdjustmentDependencies): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(createTaskDateAdjustmentModule(dependencies), new FastifyAdapter(), { logger: false });
  configureSeasonApiObservability(app);
  return app;
}
