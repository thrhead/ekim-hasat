import "reflect-metadata";
import { BadRequestException, Catch, Controller, Get, Headers, HttpException, Inject, Module, Param, Query, UnauthorizedException, UseFilters, type ArgumentsHost, type DynamicModule, type ExceptionFilter } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import type { VerifiedSubject } from "@ekim-hasat/domain/identity/auth-provider";
import type { WeatherComponents } from "@ekim-hasat/api-client";
import { CorrelationIdMiddleware, type CorrelationRequest, type CorrelationReply } from "../observability/correlation-id.middleware.js";
import { getRequestContext } from "../observability/request-context.js";
import { RequestLogger } from "../observability/request-logger.js";

export type FieldWeather = WeatherComponents["schemas"]["FieldWeather"];
export type WeatherOverviewPage = WeatherComponents["schemas"]["WeatherFieldOverviewPage"];
export type WeatherReadDependencies = Readonly<{
  verify: (token: string) => Promise<VerifiedSubject | null>;
  readFieldWeather: (identity: VerifiedSubject, fieldId: string) => Promise<FieldWeather>;
  readWeatherOverview: (identity: VerifiedSubject, page: { limit: number; cursor?: string }) => Promise<WeatherOverviewPage>;
}>;

const dependenciesKey = Symbol("WEATHER_READ_DEPENDENCIES");

export async function authenticateWeatherRequest(authorization: string | undefined, verify: WeatherReadDependencies["verify"]): Promise<VerifiedSubject> {
  const token = typeof authorization === "string" ? /^Bearer\s+(\S+)$/i.exec(authorization)?.[1] : undefined;
  if (!token) throw new UnauthorizedException();
  try {
    const identity = await verify(token);
    if (!identity) throw new UnauthorizedException();
    return identity;
  } catch {
    throw new UnauthorizedException();
  }
}

function requireFieldId(id: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new BadRequestException();
}

@Catch()
export class WeatherErrorFilter implements ExceptionFilter {
  private readonly logger = new RequestLogger();
  catch(exception: unknown, host: ArgumentsHost): void {
    const request = host.switchToHttp().getRequest<{ method: string; correlationId?: string }>();
    const reply = host.switchToHttp().getResponse<{ status: (code: number) => { send: (body: unknown) => unknown } }>();
    const requestId = getRequestContext()?.correlationId ?? request.correlationId ?? "unavailable";
    const status = exception instanceof HttpException ? exception.getStatus() : 500;
    const code = status === 400 ? "INVALID_REQUEST" : status === 401 ? "UNAUTHORIZED" : status === 403 ? "FORBIDDEN" : status === 404 ? "NOT_FOUND" : "UNEXPECTED";
    const message = status === 400 ? "Check the information and try again" : status === 401 ? "Sign in to continue" : status === 403 ? "This request is not available" : status === 404 ? "The requested item is not available" : "Something went wrong";
    const logCategory = code === "UNAUTHORIZED" ? "AUTHENTICATION_REQUIRED" : code === "UNEXPECTED" ? "INTERNAL_ERROR" : code;
    this.logger.requestFailed({ correlationId: requestId, method: request.method, statusCode: status, errorCategory: logCategory });
    reply.status(status).send({ error: { code, message, requestId } });
  }
}

@Controller("v1")
@UseFilters(WeatherErrorFilter)
export class WeatherController {
  constructor(@Inject(dependenciesKey) private readonly dependencies: WeatherReadDependencies) {}

  @Get("fields/:fieldId/weather")
  async getFieldWeather(@Headers("authorization") authorization: string | undefined, @Param("fieldId") fieldId: string): Promise<FieldWeather> {
    const identity = await authenticateWeatherRequest(authorization, this.dependencies.verify);
    requireFieldId(fieldId);
    return this.dependencies.readFieldWeather(identity, fieldId);
  }

  @Get("weather/fields")
  async getOverview(@Headers("authorization") authorization: string | undefined, @Query("limit") rawLimit?: string, @Query("cursor") cursor?: string): Promise<WeatherOverviewPage> {
    const identity = await authenticateWeatherRequest(authorization, this.dependencies.verify);
    const limit = rawLimit === undefined ? 50 : Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || (cursor !== undefined && (cursor.length < 1 || cursor.length > 512))) throw new BadRequestException();
    return this.dependencies.readWeatherOverview(identity, { limit, ...(cursor === undefined ? {} : { cursor }) });
  }
}

export function createWeatherReadModule(dependencies: WeatherReadDependencies): DynamicModule {
  @Module({ controllers: [WeatherController], providers: [{ provide: dependenciesKey, useValue: dependencies }] })
  class ConfiguredWeatherReadModule {}
  return { module: ConfiguredWeatherReadModule };
}

export function configureWeatherApiObservability(app: NestFastifyApplication): void {
  const correlation = new CorrelationIdMiddleware(new RequestLogger());
  const fastify = app.getHttpAdapter().getInstance();
  fastify.decorateRequest("correlationId", "");
  fastify.decorateRequest("requestStartedAt", 0);
  fastify.addHook("onRequest", (request, reply, done) => correlation.onRequest(request as unknown as CorrelationRequest, reply as unknown as CorrelationReply, done));
  fastify.addHook("onResponse", async (request, reply) => correlation.onResponse(request as unknown as CorrelationRequest, reply as unknown as CorrelationReply));
}

export async function createWeatherReadApp(dependencies: WeatherReadDependencies): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(createWeatherReadModule(dependencies), new FastifyAdapter(), { logger: false });
  configureWeatherApiObservability(app);
  return app;
}
