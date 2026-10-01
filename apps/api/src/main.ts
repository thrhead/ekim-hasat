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
  const onboardingStatusModule = createOnboardingStatusModule({
    verify: (token) => authenticator.verify(token),
    readStatus: createOnboardingStatusReader(onboardingRepository),
  });
  const onboardingCompletionModule = createOnboardingCompletionModule({
    verify: (token) => authenticator.verify(token),
    complete: (identity, request) => completeOnboarding(identity, request, onboardingRepository),
  });
  const app = await NestFactory.create<NestFastifyApplication>(
    { module: ApiModule, imports: [onboardingStatusModule, onboardingCompletionModule] },
    new FastifyAdapter(),
  );
  configureApiObservability(app);

  await app.listen(env.PORT, "0.0.0.0");
}

void bootstrap();
