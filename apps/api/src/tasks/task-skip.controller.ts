import "reflect-metadata";
import { Body, Controller, Headers, Inject, Module, Param, Post, Res, UseFilters, type DynamicModule } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import type { VerifiedSubject } from "@ekim-hasat/domain/identity/auth-provider";
import { authenticateSeasonRequest, configureSeasonApiObservability, requireSeasonResourceId, type SeasonReadDependencies } from "../seasons/seasons-read.controller.js";
import { parseTaskSkipRequest, parseTaskSkipVersion } from "./task-skip.dto.js";
import type { TaskSkipOutcome } from "./task-skip.repository.js";
import { TaskSkipErrorFilter } from "./task-skip.error.filter.js";

export type TaskSkipDependencies = Readonly<{
  verify: SeasonReadDependencies["verify"];
  skip: (identity: VerifiedSubject, taskId: string, baseTaskVersion: number, input: ReturnType<typeof parseTaskSkipRequest>) => Promise<TaskSkipOutcome>;
}>;

const dependenciesKey = Symbol("TASK_SKIP_DEPENDENCIES");

@Controller("v1")
@UseFilters(TaskSkipErrorFilter)
export class TaskSkipController {
  constructor(@Inject(dependenciesKey) private readonly dependencies: TaskSkipDependencies) {}

  @Post("tasks/:taskId/skips")
  async skip(@Headers("authorization") authorization: string | undefined, @Headers("if-match") ifMatch: unknown,
    @Param("taskId") taskId: string, @Body() body: unknown,
    @Res({ passthrough: true }) reply: { status: (statusCode: number) => unknown }) {
    const identity = await authenticateSeasonRequest(authorization, this.dependencies.verify);
    requireSeasonResourceId(taskId);
    const outcome = await this.dependencies.skip(identity, taskId, parseTaskSkipVersion(ifMatch), parseTaskSkipRequest(body));
    reply.status(outcome.kind === "accepted" ? 201 : 200);
    return outcome.skip;
  }
}

export function createTaskSkipModule(dependencies: TaskSkipDependencies): DynamicModule {
  @Module({ controllers: [TaskSkipController], providers: [{ provide: dependenciesKey, useValue: dependencies }] })
  class ConfiguredTaskSkipModule {}
  return { module: ConfiguredTaskSkipModule };
}

export async function createTaskSkipApp(dependencies: TaskSkipDependencies): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(createTaskSkipModule(dependencies), new FastifyAdapter(), { logger: false });
  configureSeasonApiObservability(app);
  return app;
}
