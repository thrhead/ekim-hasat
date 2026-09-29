import "reflect-metadata";

import { Controller, Get, Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { SupabaseAuthAdapter } from "./auth/supabase-auth.adapter.js";
import { parseEnv } from "./config/env.js";
import { PrismaClient } from "./generated/prisma/client.js";
import { OnboardingRepository } from "./onboarding/onboarding.repository.js";
import { completeOnboarding } from "@ekim-hasat/domain/onboarding/complete-onboarding";
import { SeasonCreateRepository } from "./seasons/seasons-create.repository.js";
import { createSeasonCreateModule } from "./seasons/seasons-create.controller.js";
import { SeasonReadRepository } from "./seasons/seasons-read.repository.js";
import { createSeasonReadModule } from "./seasons/seasons-read.controller.js";
import { SeasonPlanTaskRepository } from "./seasons/seasons-plan-task.repository.js";
import { createSeasonPlanTaskModule } from "./seasons/seasons-plan-task.controller.js";
import {
  configureApiObservability,
  createOnboardingCompletionModule,
  createOnboardingStatusModule,
  createOnboardingStatusReader,
} from "./onboarding/onboarding.controller.js";

@Controller("health")
class HealthController {
  @Get()
  getHealth(): { status: "ok" } {
    return { status: "ok" };
  }
}

@Module({
  controllers: [HealthController],
})
class ApiModule {}

async function bootstrap(): Promise<void> {
  const env = parseEnv(process.env);
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: env.DATABASE_URL }),
  });
  const authenticator = new SupabaseAuthAdapter({
    url: env.SUPABASE_URL,
    anonKey: env.SUPABASE_ANON_KEY,
  });
  const onboardingRepository = new OnboardingRepository(prisma);
  const seasonReadRepository = new SeasonReadRepository(prisma);
  const seasonCreateRepository = new SeasonCreateRepository(prisma);
  const seasonPlanTaskRepository = new SeasonPlanTaskRepository(prisma);
  const verify = (token: string) => authenticator.verify(token);
  const onboardingStatusModule = createOnboardingStatusModule({
    verify,
    readStatus: createOnboardingStatusReader(onboardingRepository),
  });
  const onboardingCompletionModule = createOnboardingCompletionModule({
    verify,
    complete: (identity, request) => completeOnboarding(identity, request, onboardingRepository),
  });
  const seasonReadModule = createSeasonReadModule({
    verify,
    readOptions: (identity, fieldId) => seasonReadRepository.readOptions(identity, fieldId),
    readSeason: (identity, seasonId) => seasonReadRepository.readSeason(identity, seasonId),
  });
  const seasonCreateModule = createSeasonCreateModule({
    verify,
    createDraft: (identity, fieldId, body, key) => seasonCreateRepository.createDraft(identity, fieldId, body, key),
  });
  const seasonPlanTaskModule = createSeasonPlanTaskModule({
    verify,
    addTask: (identity, seasonId, expectedVersion, key, body) => seasonPlanTaskRepository.addTask(identity, seasonId, expectedVersion, key, body),
    editTask: (identity, seasonId, taskId, expectedVersion, body) => seasonPlanTaskRepository.editTask(identity, seasonId, taskId, expectedVersion, body),
    removeTask: (identity, seasonId, taskId, expectedVersion) => seasonPlanTaskRepository.removeTask(identity, seasonId, taskId, expectedVersion),
  });
  const app = await NestFactory.create<NestFastifyApplication>(
    { module: ApiModule, imports: [onboardingStatusModule, onboardingCompletionModule, seasonReadModule, seasonCreateModule, seasonPlanTaskModule] },
    new FastifyAdapter(),
  );
  configureApiObservability(app);

  await app.listen(env.PORT, "0.0.0.0");
}

void bootstrap();
