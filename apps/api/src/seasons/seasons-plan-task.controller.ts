import "reflect-metadata";
import { Body, Controller, Delete, Headers, Inject, Module, Param, Patch, Post, Res, UseFilters, type DynamicModule } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import type { VerifiedSubject } from "@ekim-hasat/domain/identity/auth-provider";
import { authenticateSeasonRequest, requireSeasonResourceId, configureSeasonApiObservability, type SeasonReadDependencies } from "./seasons-read.controller.js";
import { SeasonsErrorFilter } from "./seasons-error.filter.js";
import { validateAddPlanTaskCommand, validateEditPlanTaskCommand, validateExpectedSeasonVersion, validatePlanTaskIdempotencyKey, type PlanTaskCommandOutcome } from "./seasons-plan-task.repository.js";

export type SeasonPlanTaskDependencies = Readonly<{
  verify: SeasonReadDependencies["verify"];
  addTask: (identity: VerifiedSubject, seasonId: string, expectedVersion: number, key: string, body: unknown) => Promise<PlanTaskCommandOutcome>;
  editTask: (identity: VerifiedSubject, seasonId: string, taskId: string, expectedVersion: number, body: unknown) => Promise<PlanTaskCommandOutcome>;
  removeTask: (identity: VerifiedSubject, seasonId: string, taskId: string, expectedVersion: number) => Promise<PlanTaskCommandOutcome>;
}>;
const dependenciesKey = Symbol("SEASON_PLAN_TASK_DEPENDENCIES");

@Controller("v1/seasons/:seasonId/plan-tasks")
@UseFilters(SeasonsErrorFilter)
export class SeasonPlanTaskController {
  constructor(@Inject(dependenciesKey) private readonly dependencies: SeasonPlanTaskDependencies) {}

  @Post()
  async add(@Headers("authorization") authorization: string | undefined, @Headers("if-match") ifMatch: unknown,
    @Headers("idempotency-key") key: unknown, @Param("seasonId") seasonId: string, @Body() body: unknown,
    @Res({ passthrough: true }) reply: { header: (name: string, value: string) => unknown; status: (status: number) => unknown }) {
    const identity = await authenticateSeasonRequest(authorization, this.dependencies.verify);
    requireSeasonResourceId(seasonId);
    const expectedVersion = validateExpectedSeasonVersion(ifMatch);
    const idempotencyKey = validatePlanTaskIdempotencyKey(key);
    const command = validateAddPlanTaskCommand(body);
    const outcome = await this.dependencies.addTask(identity, seasonId, expectedVersion, idempotencyKey, command);
    reply.status(201);
    reply.header("ETag", `"${outcome.season.version}"`);
    return outcome.season;
  }

  @Patch(":taskId")
  async edit(@Headers("authorization") authorization: string | undefined, @Headers("if-match") ifMatch: unknown,
    @Param("seasonId") seasonId: string, @Param("taskId") taskId: string, @Body() body: unknown,
    @Res({ passthrough: true }) reply: { header: (name: string, value: string) => unknown }) {
    const identity = await authenticateSeasonRequest(authorization, this.dependencies.verify);
    requireSeasonResourceId(seasonId);
    requireSeasonResourceId(taskId);
    const patch = validateEditPlanTaskCommand(body);
    const outcome = await this.dependencies.editTask(identity, seasonId, taskId, validateExpectedSeasonVersion(ifMatch), patch);
    reply.header("ETag", `"${outcome.season.version}"`);
    return outcome.season;
  }

  @Delete(":taskId")
  async remove(@Headers("authorization") authorization: string | undefined, @Headers("if-match") ifMatch: unknown,
    @Param("seasonId") seasonId: string, @Param("taskId") taskId: string,
    @Res({ passthrough: true }) reply: { header: (name: string, value: string) => unknown }) {
    const identity = await authenticateSeasonRequest(authorization, this.dependencies.verify);
    requireSeasonResourceId(seasonId);
    requireSeasonResourceId(taskId);
    const outcome = await this.dependencies.removeTask(identity, seasonId, taskId, validateExpectedSeasonVersion(ifMatch));
    reply.header("ETag", `"${outcome.season.version}"`);
    return outcome.season;
  }
}

export function createSeasonPlanTaskModule(dependencies: SeasonPlanTaskDependencies): DynamicModule {
  @Module({ controllers: [SeasonPlanTaskController], providers: [{ provide: dependenciesKey, useValue: dependencies }] })
  class ConfiguredSeasonPlanTaskModule {}
  return { module: ConfiguredSeasonPlanTaskModule };
}

export async function createSeasonPlanTaskApp(dependencies: SeasonPlanTaskDependencies): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(createSeasonPlanTaskModule(dependencies), new FastifyAdapter(), { logger: false });
  configureSeasonApiObservability(app);
  return app;
}
