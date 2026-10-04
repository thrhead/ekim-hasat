import "reflect-metadata";
import { Controller, Get, Headers, Inject, Module, NotFoundException, Param, Query, Res, UnauthorizedException, UseFilters, type DynamicModule } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import type { VerifiedSubject } from "@ekim-hasat/domain/identity/auth-provider";
import { ApiError, ApiErrorFilter } from "../observability/api-error.filter.js";
import { CorrelationIdMiddleware, type CorrelationReply, type CorrelationRequest } from "../observability/correlation-id.middleware.js";
import { RequestLogger } from "../observability/request-logger.js";
import type { FieldDetail, FieldPage, FieldPageQuery } from "./fields-read.repository.js";

export type FieldsReadDependencies = Readonly<{
  verify: (token: string) => Promise<VerifiedSubject | null>;
  readPage: (identity: VerifiedSubject, query: FieldPageQuery) => Promise<FieldPage>;
  readField: (identity: VerifiedSubject, fieldId: string) => Promise<FieldDetail | null>;
}>;

const dependenciesKey = Symbol("FIELDS_READ_DEPENDENCIES");
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function authenticateFieldsRequest(
  authorization: string | undefined,
  verify: FieldsReadDependencies["verify"],
): Promise<VerifiedSubject> {
  const token = typeof authorization === "string" ? /^Bearer\s+(\S+)$/i.exec(authorization)?.[1] : undefined;
  if (!token) throw new UnauthorizedException();
  let identity: VerifiedSubject | null;
  try { identity = await verify(token); } catch { throw new UnauthorizedException(); }
  if (!identity) throw new UnauthorizedException();
  return identity;
}

function invalidRequest(): never {
  throw new ApiError(400, "INVALID_REQUEST", "Check the Field list request and try again");
}

function parseLimit(value: string | undefined): number {
  if (value === undefined) return 50;
  if (!/^[0-9]+$/.test(value)) return invalidRequest();
  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) return invalidRequest();
  return limit;
}

/** Reject malformed opaque cursor syntax before handing it to the read port. */
function validateCursorSyntax(cursor: string | undefined): void {
  if (cursor === undefined) return;
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(cursor)) return invalidRequest();
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    if (Buffer.from(decoded, "utf8").toString("base64url") !== cursor) return invalidRequest();
    const parsed: unknown = JSON.parse(decoded);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return invalidRequest();
    const value = parsed as Record<string, unknown>;
    if (value.v !== 1 || typeof value.businessId !== "string" || !uuidPattern.test(value.businessId)
      || typeof value.name !== "string" || !value.name.trim() || typeof value.id !== "string" || !uuidPattern.test(value.id)) return invalidRequest();
  } catch {
    return invalidRequest();
  }
}

@Controller("v1")
@UseFilters(ApiErrorFilter)
export class FieldsReadController {
  constructor(@Inject(dependenciesKey) private readonly dependencies: FieldsReadDependencies) {}

  @Get("fields")
  async list(
    @Headers("authorization") authorization: string | undefined,
    @Query("limit") limitValue: string | undefined,
    @Query("cursor") cursor: string | undefined,
  ): Promise<FieldPage> {
    const identity = await authenticateFieldsRequest(authorization, this.dependencies.verify);
    const limit = parseLimit(limitValue);
    validateCursorSyntax(cursor);
    return this.dependencies.readPage(identity, { limit, ...(cursor === undefined ? {} : { cursor }) });
  }

  @Get("fields/:fieldId")
  async detail(
    @Headers("authorization") authorization: string | undefined,
    @Param("fieldId") fieldId: string,
    @Res({ passthrough: true }) reply: { header: (name: string, value: string) => unknown },
  ): Promise<FieldDetail> {
    const identity = await authenticateFieldsRequest(authorization, this.dependencies.verify);
    if (!uuidPattern.test(fieldId)) throw new NotFoundException();
    const field = await this.dependencies.readField(identity, fieldId);
    if (!field) throw new NotFoundException();
    reply.header("ETag", `"${field.version}"`);
    return field;
  }
}

export function createFieldsReadModule(dependencies: FieldsReadDependencies): DynamicModule {
  @Module({ controllers: [FieldsReadController], providers: [{ provide: dependenciesKey, useValue: dependencies }] })
  class ConfiguredFieldsReadModule {}
  return { module: ConfiguredFieldsReadModule };
}

/** Used by isolated route tests; production API composition installs the same shared hooks. */
export function configureFieldsReadApiObservability(app: NestFastifyApplication): void {
  const correlation = new CorrelationIdMiddleware(new RequestLogger());
  const fastify = app.getHttpAdapter().getInstance();
  fastify.decorateRequest("correlationId", "");
  fastify.decorateRequest("requestStartedAt", 0);
  fastify.addHook("onRequest", (request, reply, done) => correlation.onRequest(request as unknown as CorrelationRequest, reply as unknown as CorrelationReply, done));
  fastify.addHook("onResponse", async (request, reply) => correlation.onResponse(request as unknown as CorrelationRequest, reply as unknown as CorrelationReply));
}

/** Used by route contract tests; production uses the composed root API module. */
export async function createFieldsReadApp(dependencies: FieldsReadDependencies): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(createFieldsReadModule(dependencies), new FastifyAdapter(), { logger: false });
  configureFieldsReadApiObservability(app);
  return app;
}
