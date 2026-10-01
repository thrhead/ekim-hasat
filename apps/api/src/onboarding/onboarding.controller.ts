import {
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Inject,
  Module,
  Post,
  Res,
  Body,
  UnauthorizedException,
  BadRequestException,
  ConflictException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { DynamicModule } from "@nestjs/common";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import {
  DefaultBusinessContextUnauthorizedError as DomainDefaultBusinessContextUnauthorizedError,
  getOnboardingStatus,
  type OnboardingStatusRepository,
} from "@ekim-hasat/domain/onboarding/get-onboarding-status";
import {
  OnboardingAuthenticationRequiredError,
  OnboardingCommandInputError,
  type OnboardingCompletionResult,
} from "@ekim-hasat/domain/onboarding/complete-onboarding";
import type { components } from "@ekim-hasat/api-client/generated";
import type { VerifiedSubject } from "@ekim-hasat/domain/identity/auth-provider";
import { DefaultBusinessContextUnauthorizedError } from "./onboarding.repository.js";
import {
  CorrelationIdMiddleware,
  type CorrelationReply,
  type CorrelationRequest,
} from "../observability/correlation-id.middleware.js";
import { RequestErrorFilter } from "../observability/request-error.filter.js";
import { RequestLogger } from "../observability/request-logger.js";
import { onboardingObservability } from "./onboarding.observability.js";

export type OnboardingStatusDependencies = Readonly<{
  verify: (token: string) => Promise<VerifiedSubject | null>;
  readStatus: (identity: VerifiedSubject) => Promise<{ firstFieldOnboardingNeeded: boolean }>;
}>;

export type OnboardingCompletionDependencies = Readonly<{
  verify: (token: string) => Promise<VerifiedSubject | null>;
  complete: (identity: VerifiedSubject, request: {
    idempotencyKey: string;
    name?: unknown;
    location: unknown;
  }) => Promise<OnboardingCompletionResult>;
}>;

const ONBOARDING_STATUS_DEPENDENCIES = Symbol("ONBOARDING_STATUS_DEPENDENCIES");
const ONBOARDING_COMPLETION_DEPENDENCIES = Symbol("ONBOARDING_COMPLETION_DEPENDENCIES");

@Controller("v1/onboarding")
export class OnboardingStatusController {
  constructor(
    @Inject(ONBOARDING_STATUS_DEPENDENCIES)
    private readonly dependencies: OnboardingStatusDependencies,
  ) {}

  @Get("status")
  async getStatus(
    @Headers("authorization") authorization: string | undefined,
  ): Promise<{ firstFieldOnboardingNeeded: boolean }> {
    const token = getBearerToken(authorization);
    if (!token) throw new UnauthorizedException();

    let identity: VerifiedSubject | null;
    try {
      identity = await this.dependencies.verify(token);
    } catch {
      throw new UnauthorizedException();
    }
    if (!identity) throw new UnauthorizedException();

    const startedAt = performance.now();
    onboardingObservability.started();
    try {
      const status = await this.dependencies.readStatus(identity);
      onboardingObservability.defaultBusinessContextResolved(performance.now() - startedAt);
      return { firstFieldOnboardingNeeded: status.firstFieldOnboardingNeeded };
    } catch (error) {
      onboardingObservability.defaultBusinessContextResolved(performance.now() - startedAt, "failed");
      onboardingObservability.recoverableFailure(
        error instanceof DefaultBusinessContextUnauthorizedError ||
          error instanceof DomainDefaultBusinessContextUnauthorizedError
          ? "FORBIDDEN"
          : "INTERNAL_ERROR",
        performance.now() - startedAt,
      );
      if (
        error instanceof DefaultBusinessContextUnauthorizedError ||
        error instanceof DomainDefaultBusinessContextUnauthorizedError
      ) {
        throw new ForbiddenException();
      }
      throw error;
    }
  }
}

@Controller("v1/onboarding")
export class OnboardingCompletionController {
  constructor(
    @Inject(ONBOARDING_COMPLETION_DEPENDENCIES)
    private readonly dependencies: OnboardingCompletionDependencies,
  ) {}

  @Post("complete")
  async complete(
    @Headers("authorization") authorization: string | undefined,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: { code: (status: number) => unknown },
  ): Promise<components["schemas"]["OnboardingResult"]> {
    const token = getBearerToken(authorization);
    if (!token) throw new UnauthorizedException();

    let identity: VerifiedSubject | null;
    try {
      identity = await this.dependencies.verify(token);
    } catch {
      throw new UnauthorizedException();
    }
    if (!identity) throw new UnauthorizedException();

    if (typeof idempotencyKey !== "string" || idempotencyKey.length === 0 || idempotencyKey.length > 200) {
      throw new BadRequestException();
    }
    const request = typeof body === "object" && body !== null
      ? body as { name?: unknown; location?: unknown; [key: string]: unknown }
      : null;
    if (!request || Object.keys(request).some((key) => key !== "name" && key !== "location") || !("location" in request)) {
      throw new BadRequestException();
    }
    const startedAt = performance.now();
    onboardingObservability.started();
    let outcome: OnboardingCompletionResult;
    try {
      outcome = await this.dependencies.complete(identity, {
        idempotencyKey,
        ...(request.name !== undefined ? { name: request.name } : {}),
        location: request.location,
      });
    } catch (error) {
      onboardingObservability.recoverableFailure(
        error instanceof OnboardingAuthenticationRequiredError
          ? "AUTHENTICATION_REQUIRED"
          : error instanceof DefaultBusinessContextUnauthorizedError ||
              error instanceof DomainDefaultBusinessContextUnauthorizedError
            ? "FORBIDDEN"
            : error instanceof OnboardingCommandInputError ||
                (error instanceof Error && error.name === "FieldLocationValidationError")
              ? "VALIDATION_FAILED"
              : "INTERNAL_ERROR",
        performance.now() - startedAt,
      );
      if (error instanceof OnboardingAuthenticationRequiredError) throw new UnauthorizedException();
      if (error instanceof OnboardingCommandInputError) throw new BadRequestException();
      if (error instanceof Error && error.name === "FieldLocationValidationError") {
        throw new UnprocessableEntityException();
      }
      if (error instanceof DefaultBusinessContextUnauthorizedError || error instanceof DomainDefaultBusinessContextUnauthorizedError) {
        throw new BadRequestException();
      }
      throw error;
    }
    if (outcome.kind === "conflict") {
      onboardingObservability.recoverableFailure("CONFLICT", performance.now() - startedAt);
      throw new ConflictException();
    }
    onboardingObservability.fieldSaved(performance.now() - startedAt);
    reply.code(outcome.kind === "created" ? 201 : 200);
    const source = outcome.field;
    const field: components["schemas"]["FirstFieldSummary"] = {
      id: source.id,
      name: source.name,
      representativePoint: source.representativePoint,
      createdAt: source.createdAt instanceof Date
        ? source.createdAt.toISOString()
        : new Date(source.createdAt).toISOString(),
      ...(source.boundary ? {
        boundary: {
          id: source.boundary.id,
          version: source.boundary.version,
          geometry: source.boundary.geometry,
          verificationStatus: source.boundary.verificationStatus.toLowerCase() as "unverified" | "verified",
        },
      } : {}),
    };
    return { field };
  }
}

/** Build the Nest module with explicit auth and read-model boundaries. */
export function createOnboardingStatusModule(
  dependencies: OnboardingStatusDependencies,
): DynamicModule {
  @Module({
    controllers: [OnboardingStatusController],
    providers: [{ provide: ONBOARDING_STATUS_DEPENDENCIES, useValue: dependencies }],
  })
  class ConfiguredOnboardingStatusModule {}

  return { module: ConfiguredOnboardingStatusModule };
}

export function createOnboardingCompletionModule(
  dependencies: OnboardingCompletionDependencies,
): DynamicModule {
  @Module({
    controllers: [OnboardingCompletionController],
    providers: [{ provide: ONBOARDING_COMPLETION_DEPENDENCIES, useValue: dependencies }],
  })
  class ConfiguredOnboardingCompletionModule {}

  return { module: ConfiguredOnboardingCompletionModule };
}

/** Injectable app factory used by the T017 contract tests and local composition. */
export async function createOnboardingStatusApp(
  dependencies: OnboardingStatusDependencies,
): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(
    createOnboardingStatusModule(dependencies),
    new FastifyAdapter(),
    { logger: false },
  );
  configureApiObservability(app);
  return app;
}

export async function createOnboardingCompletionApp(
  dependencies: OnboardingCompletionDependencies,
): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(
    createOnboardingCompletionModule(dependencies),
    new FastifyAdapter(),
    { logger: false },
  );
  configureApiObservability(app);
  return app;
}

/** Keep correlation IDs and the shared privacy-safe error response on this route. */
export function configureApiObservability(app: NestFastifyApplication): void {
  const logger = new RequestLogger();
  const correlation = new CorrelationIdMiddleware(logger);
  const fastify = app.getHttpAdapter().getInstance();
  fastify.decorateRequest("correlationId", "");
  fastify.decorateRequest("requestStartedAt", 0);
  fastify.addHook("onRequest", (request, reply, done) => {
    correlation.onRequest(
      request as unknown as CorrelationRequest,
      reply as unknown as CorrelationReply,
      done,
    );
  });
  fastify.addHook("onResponse", async (request, reply) => {
    correlation.onResponse(
      request as unknown as CorrelationRequest,
      reply as unknown as CorrelationReply,
    );
  });
  app.useGlobalFilters(new RequestErrorFilter(logger));
}

/** Production read-model composition; authorization remains in T019's domain use case. */
export function createOnboardingStatusReader(
  repository: OnboardingStatusRepository,
): OnboardingStatusDependencies["readStatus"] {
  return (identity) => getOnboardingStatus(identity, repository);
}

function getBearerToken(authorization: string | undefined): string | null {
  if (typeof authorization !== "string") return null;
  const match = /^Bearer\s+(\S+)$/i.exec(authorization);
  return match?.[1] ?? null;
}
