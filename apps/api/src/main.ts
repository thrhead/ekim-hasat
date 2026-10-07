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
import { SeasonActivationRepository } from "./seasons/seasons-activation.repository.js";
import { createSeasonActivationModule } from "./seasons/seasons-activation.controller.js";
import { TodayRepository } from "./seasons/today.repository.js";
import { TaskCompletionRepository } from "./tasks/task-completion.repository.js";
import { TaskCompletionService } from "./tasks/task-completion.service.js";
import { createTaskCompletionModule } from "./tasks/task-completion.controller.js";
import { ObservationCreateRepository } from "./observations/observation.repository.js";
import { ObservationDiaryRepository } from "./observations/observation-diary.repository.js";
import { createObservationModule } from "./observations/observation.controller.js";
import { createTodayModule } from "./seasons/today.controller.js";
import { createWeatherModule } from "./weather/weather.module.js";
import { FieldsReadRepository } from "./fields/fields-read.repository.js";
import { FieldsReadService } from "./fields/fields-read.service.js";
import { createFieldsModule } from "./fields/fields.module.js";
import { MembershipScopeService } from "./authorization/membership-scope.service.js";
import { FieldCreateRepository } from "./fields/fields-create.repository.js";
import { FieldCreateService } from "./fields/fields-create.service.js";
import { FieldUpdateRepository } from "./fields/fields-update.repository.js";
import { FieldUpdateService } from "./fields/fields-update.service.js";
import { createRegionsModule } from "./regions/regions.module.js";
import { UnavailableRegionResolver } from "./regions/unavailable-region-resolver.js";
import { createCalendarModule } from "./calendar/calendar.module.js";
import { CalendarReadRepository } from "./calendar/calendar-read.repository.js";
import { CalendarPagesService } from "./calendar/calendar-pages.service.js";
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
  const seasonActivationRepository = new SeasonActivationRepository(prisma);
  const todayRepository = new TodayRepository(prisma);
  const taskCompletionRepository = new TaskCompletionRepository(prisma);
  const taskCompletionService = new TaskCompletionService(taskCompletionRepository);
  const observationCreateRepository = new ObservationCreateRepository(prisma);
  const observationDiaryRepository = new ObservationDiaryRepository(prisma, taskCompletionRepository);
  const verify = (token: string) => authenticator.verify(token);
  const regionResolver = new UnavailableRegionResolver();
  const fieldsReadService = new FieldsReadService(new MembershipScopeService(prisma), new FieldsReadRepository(prisma));
  const fieldsCreateService = new FieldCreateService(new FieldCreateRepository(prisma, regionResolver));
  const fieldsUpdateService = new FieldUpdateService(new FieldUpdateRepository(prisma, regionResolver));
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
  const seasonActivationModule = createSeasonActivationModule({
    verify,
    activate: (identity, seasonId, expectedVersion, key) => seasonActivationRepository.activate(identity, seasonId, expectedVersion, key),
  });
  const todayModule = createTodayModule({
    verify,
    readToday: (identity) => todayRepository.readToday(identity),
  });
  const taskCompletionModule = createTaskCompletionModule({
    verify,
    complete: (identity, taskId, version, input) => taskCompletionService.complete(identity, taskId, version, input),
    readHistory: (identity, fieldId, filters) => taskCompletionService.readHistory(identity, fieldId, filters),
  });
  const observationModule = createObservationModule({
    verify,
    create: (identity, fieldId, request) => observationCreateRepository.create(identity, fieldId, request),
    readDiary: (identity, fieldId, filters) => observationDiaryRepository.read(identity, fieldId, filters),
  });
  const weatherModule = createWeatherModule({
    verify,
    prisma,
    maxAgeHours: env.WEATHER_SNAPSHOT_MAX_AGE_HOURS,
  });
  const fieldsModule = createFieldsModule({
    read: {
      verify,
      readPage: (identity, query) => fieldsReadService.list(identity, query),
      readField: (identity, fieldId) => fieldsReadService.read(identity, fieldId),
    },
    create: { verify, createField: (identity, body, key) => fieldsCreateService.create(identity, body, key) },
    update: { verify, updateField: async (identity, fieldId, version, body) => (await fieldsUpdateService.update(identity, fieldId, version, body)).field },
  });
  const regionsModule = createRegionsModule({ prisma, resolver: regionResolver });
  const calendarMembershipScope = new MembershipScopeService(prisma);
  const calendarReadRepository = new CalendarReadRepository(prisma, calendarMembershipScope);
  const calendarPagesService = new CalendarPagesService(prisma, calendarMembershipScope);
  const calendarModule = createCalendarModule({
    verify,
    membershipScope: calendarMembershipScope,
    createRead: (identity, request) => calendarReadRepository.createRead(identity, request),
    readPage: (identity, request) => calendarPagesService.read(identity, request),
  });
  const app = await NestFactory.create<NestFastifyApplication>(
    { module: ApiModule, imports: [onboardingStatusModule, onboardingCompletionModule, seasonReadModule, seasonCreateModule, seasonPlanTaskModule, seasonActivationModule, todayModule, taskCompletionModule, observationModule, weatherModule, fieldsModule, regionsModule, calendarModule] },
    new FastifyAdapter(),
  );
  configureApiObservability(app);

  await app.listen(env.PORT, "0.0.0.0");
}

void bootstrap();
