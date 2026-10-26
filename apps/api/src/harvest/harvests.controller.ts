import "reflect-metadata";
import { Body, Controller, Headers, Inject, Param, Post, Res, UseFilters } from "@nestjs/common";
import type { HarvestUnit } from "@ekim-hasat/domain/harvest/harvest-record";
import type { VerifiedSubject } from "@ekim-hasat/domain/identity/auth-provider";
import type { HarvestCreateOutcome, HarvestCreateRequest } from "./harvests.repository.js";
import { ApiError, ApiErrorFilter } from "../observability/api-error.filter.js";
import { authenticateSeasonRequest } from "../seasons/seasons-read.controller.js";
import type { HarvestsDependencies } from "./harvests.module.js";

const dependenciesKey = Symbol.for("HARVESTS_DEPENDENCIES");
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const required = ["harvestId", "seasonId", "harvestDate", "quantity", "unit"];

function invalidRequest(): ApiError {
  return new ApiError(400, "INVALID_REQUEST", "Check the harvest information and try again");
}

function parseCreateBody(value: unknown): HarvestCreateRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalidRequest();
  const body = value as Record<string, unknown>;
  if (required.some((key) => !(key in body)) || Object.keys(body).some((key) => !required.includes(key))) throw invalidRequest();
  if (typeof body.harvestId !== "string" || !uuid.test(body.harvestId)
    || typeof body.seasonId !== "string" || !uuid.test(body.seasonId)
    || typeof body.harvestDate !== "string" || typeof body.quantity !== "string" || typeof body.unit !== "string") throw invalidRequest();
  return { harvestId: body.harvestId, seasonId: body.seasonId, harvestDate: body.harvestDate,
    quantity: body.quantity, unit: body.unit as HarvestUnit };
}

export type HarvestCreateDependencies = HarvestsDependencies;

@Controller("v1")
@UseFilters(ApiErrorFilter)
export class HarvestsController {
  constructor(@Inject(dependenciesKey) private readonly dependencies: HarvestCreateDependencies) {}

  @Post("fields/:fieldId/harvests")
  async create(
    @Headers("authorization") authorization: string | undefined,
    @Param("fieldId") fieldId: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: { status: (statusCode: number) => unknown },
  ) {
    const identity: VerifiedSubject = await authenticateSeasonRequest(authorization, this.dependencies.verify);
    if (!uuid.test(fieldId)) throw invalidRequest();
    const outcome: HarvestCreateOutcome = await this.dependencies.create(identity, fieldId, parseCreateBody(body));
    reply.status(outcome.kind === "accepted" ? 201 : 200);
    const { id, fieldId: acceptedFieldId, seasonId, harvestDate, quantity, unit, recordedAt } = outcome.harvest;
    return { id, fieldId: acceptedFieldId, seasonId, harvestDate, quantity, unit, recordedAt };
  }
}
