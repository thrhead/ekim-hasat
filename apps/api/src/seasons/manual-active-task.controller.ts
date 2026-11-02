import "reflect-metadata";
import { Body, Catch, Controller, Headers, Inject, Module, Param, Post, Res, UnauthorizedException, UseFilters, type ArgumentsHost, type DynamicModule, type ExceptionFilter } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import type { VerifiedSubject } from "@ekim-hasat/domain/identity/auth-provider";
import { authenticateSeasonRequest, configureSeasonApiObservability } from "./seasons-read.controller.js";
import { ManualTaskCommandError } from "./manual-active-task.error.js";
import type { ManualActiveTaskInput } from "./manual-active-task.repository.js";
import { parseManualActiveTaskInput } from "./manual-active-task.service.js";

export { ManualTaskCommandError } from "./manual-active-task.error.js";
type Receipt = Record<string, unknown>;
export type ManualTaskDependencies = Readonly<{
  verify: (token: string) => Promise<VerifiedSubject | null>;
  create: (identity: VerifiedSubject, seasonId: string, input: ManualActiveTaskInput) => Promise<{ replay: boolean; receipt: unknown }>;
}>;
const key = Symbol("MANUAL_ACTIVE_TASK_DEPENDENCIES");

@Catch()
class ManualTaskErrorFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<{ status: (status: number) => { send: (body: unknown) => void } }>();
    const normalized = error instanceof ManualTaskCommandError ? error : error instanceof UnauthorizedException
      ? new ManualTaskCommandError(401, "AUTHENTICATION_REQUIRED") : null;
    reply.status(normalized?.getStatus() ?? 500).send({ error: normalized?.presentation ?? { code: "UNEXPECTED", message: "The task could not be added." } });
  }
}
@Controller("v1/seasons/:seasonId/manual-tasks")
@UseFilters(ManualTaskErrorFilter)
class ManualActiveTaskController {
  constructor(@Inject(key) private readonly deps: ManualTaskDependencies) {}
  @Post()
  async create(@Headers("authorization") authorization: string | undefined, @Param("seasonId") seasonId: string,
    @Body() body: unknown, @Res({ passthrough: true }) reply: { status: (status: number) => void }): Promise<Receipt> {
    const identity = await authenticateSeasonRequest(authorization, this.deps.verify);
    const result = await this.deps.create(identity, seasonId, parseManualActiveTaskInput(body));
    reply.status(result.replay ? 200 : 201);
    return result.receipt as Receipt;
  }
}
export function createManualActiveTaskModule(deps: ManualTaskDependencies): DynamicModule {
  @Module({ controllers: [ManualActiveTaskController], providers: [{ provide: key, useValue: deps }] })
  class ConfiguredManualActiveTaskModule {}
  return { module: ConfiguredManualActiveTaskModule };
}
export async function createManualActiveTaskApp(deps: ManualTaskDependencies): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(createManualActiveTaskModule(deps), new FastifyAdapter(), { logger: false });
  configureSeasonApiObservability(app);
  return app;
}
