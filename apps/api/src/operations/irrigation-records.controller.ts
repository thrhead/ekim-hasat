import "reflect-metadata";
import { Body, Controller, Headers, Inject, Param, Post, Res, UseFilters } from "@nestjs/common";
import type { VerifiedSubject } from "@ekim-hasat/domain/identity/auth-provider";
import type { IrrigationRecordCreateOutcome, IrrigationRecordCreateRequest } from "./irrigation-records.repository.js";
import { ApiError, ApiErrorFilter } from "../observability/api-error.filter.js";
import { authenticateSeasonRequest } from "../seasons/seasons-read.controller.js";
import type { IrrigationRecordsDependencies } from "./irrigation-records.module.js";

const dependenciesKey = Symbol.for("IRRIGATION_RECORDS_DEPENDENCIES");
const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const localDateTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/;
const positiveVolume = /^(?=.*[1-9])[\d]{1,11}(?:\.\d)?$/;

function invalidRequest(): ApiError {
  return new ApiError(400, "INVALID_REQUEST", "Check the irrigation information and try again");
}

function parseCreateBody(value: unknown): IrrigationRecordCreateRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalidRequest();
  const body = value as Record<string, unknown>;
  const required = ["irrigationRecordId", "occurredAtLocal", "occurredAt", "capturedBusinessTimezone"];
  const allowed = [...required, "seasonId", "method", "durationMinutes", "waterVolumeCubicMetres", "note"];
  if (required.some((key) => !(key in body)) || Object.keys(body).some((key) => !allowed.includes(key))) throw invalidRequest();
  if (typeof body.irrigationRecordId !== "string" || !uuid.test(body.irrigationRecordId)
      || typeof body.occurredAtLocal !== "string" || !localDateTime.test(body.occurredAtLocal)
      || typeof body.occurredAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(body.occurredAt)
      || !Number.isFinite(Date.parse(body.occurredAt))
      || typeof body.capturedBusinessTimezone !== "string" || !body.capturedBusinessTimezone) throw invalidRequest();
  try { new Intl.DateTimeFormat("en", { timeZone: body.capturedBusinessTimezone as string }); }
  catch { throw invalidRequest(); }
  if (body.seasonId !== undefined && (typeof body.seasonId !== "string" || !uuid.test(body.seasonId))) throw invalidRequest();
  if (body.method !== undefined && (typeof body.method !== "string" || Array.from(body.method).length > 120)) throw invalidRequest();
  if (body.durationMinutes !== undefined && (!Number.isSafeInteger(body.durationMinutes) || (body.durationMinutes as number) <= 0)) throw invalidRequest();
  if (body.waterVolumeCubicMetres !== undefined && (typeof body.waterVolumeCubicMetres !== "string" || !positiveVolume.test(body.waterVolumeCubicMetres))) throw invalidRequest();
  if (body.note !== undefined && (typeof body.note !== "string" || Array.from(body.note).length > 2000)) throw invalidRequest();
  return {
    irrigationRecordId: body.irrigationRecordId,
    occurredAtLocal: body.occurredAtLocal,
    occurredAt: body.occurredAt,
    capturedBusinessTimezone: body.capturedBusinessTimezone,
    ...(typeof body.seasonId === "string" ? { seasonId: body.seasonId } : {}),
    ...(typeof body.method === "string" ? { method: body.method } : {}),
    ...(typeof body.durationMinutes === "number" ? { durationMinutes: body.durationMinutes } : {}),
    ...(typeof body.waterVolumeCubicMetres === "string" ? { waterVolumeCubicMetres: body.waterVolumeCubicMetres } : {}),
    ...(typeof body.note === "string" ? { note: body.note } : {}),
  };
}

export type IrrigationCreateDependencies = IrrigationRecordsDependencies;

@Controller("v1")
@UseFilters(ApiErrorFilter)
export class IrrigationRecordsController {
  constructor(@Inject(dependenciesKey) private readonly dependencies: IrrigationCreateDependencies) {}

  @Post("fields/:fieldId/irrigation-records")
  async create(
    @Headers("authorization") authorization: string | undefined,
    @Param("fieldId") fieldId: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: { status: (statusCode: number) => unknown },
  ): Promise<IrrigationRecordCreateOutcome["record"]> {
    const identity: VerifiedSubject = await authenticateSeasonRequest(authorization, this.dependencies.verify);
    if (!uuid.test(fieldId)) throw invalidRequest();
    const outcome = await this.dependencies.create(identity, fieldId, parseCreateBody(body));
    reply.status(outcome.kind === "accepted" ? 201 : 200);
    return outcome.record;
  }
}
