import "reflect-metadata";
import { Body, Controller, Headers, Inject, Param, Post, Res, UseFilters } from "@nestjs/common";
import { createExpense } from "@ekim-hasat/domain/finance/expense";
import type { VerifiedSubject } from "@ekim-hasat/domain/identity/auth-provider";
import { ApiError, ApiErrorFilter } from "../observability/api-error.filter.js";
import { authenticateSeasonRequest } from "../seasons/seasons-read.controller.js";
import type { ExpenseCreateOutcome, ExpenseCreateRequest } from "./expenses.repository.js";
import type { ExpensesDependencies } from "./expenses.module.js";

const dependenciesKey = Symbol.for("EXPENSES_DEPENDENCIES");
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function invalidRequest(): ApiError {
  return new ApiError(400, "INVALID_REQUEST", "Check the expense information and try again");
}

function parseCreateBody(value: unknown): ExpenseCreateRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalidRequest();
  const body = value as Record<string, unknown>;
  const required = ["expenseId", "amount", "currency", "category", "expenseDate"];
  const allowed = [...required, "seasonId", "note"];
  if (required.some((key) => !(key in body)) || Object.keys(body).some((key) => !allowed.includes(key))) throw invalidRequest();
  if (typeof body.expenseId !== "string" || !uuid.test(body.expenseId)
    || typeof body.amount !== "string" || typeof body.currency !== "string"
    || typeof body.category !== "string" || typeof body.expenseDate !== "string") throw invalidRequest();
  if (body.seasonId !== undefined && (typeof body.seasonId !== "string" || !uuid.test(body.seasonId))) throw invalidRequest();
  if (body.note !== undefined && typeof body.note !== "string") throw invalidRequest();
  try {
    createExpense({
      id: body.expenseId, businessId: "00000000-0000-4000-8000-000000000000",
      fieldId: "00000000-0000-4000-8000-000000000000",
      actorUserId: "00000000-0000-4000-8000-000000000000",
      actorMembershipId: "00000000-0000-4000-8000-000000000000",
      seasonId: body.seasonId, amount: body.amount, currency: body.currency,
      category: body.category, expenseDate: body.expenseDate, note: body.note,
    });
  } catch { throw invalidRequest(); }
  return {
    expenseId: body.expenseId,
    ...(typeof body.seasonId === "string" ? { seasonId: body.seasonId } : {}),
    amount: body.amount,
    currency: body.currency,
    category: body.category,
    expenseDate: body.expenseDate,
    ...(typeof body.note === "string" ? { note: body.note } : {}),
  };
}

export type ExpenseCreateDependencies = ExpensesDependencies;

@Controller("v1")
@UseFilters(ApiErrorFilter)
export class ExpensesController {
  constructor(@Inject(dependenciesKey) private readonly dependencies: ExpenseCreateDependencies) {}

  @Post("fields/:fieldId/expenses")
  async create(
    @Headers("authorization") authorization: string | undefined,
    @Param("fieldId") fieldId: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: { status: (statusCode: number) => unknown },
  ): Promise<Omit<ExpenseCreateOutcome["expense"], "businessId" | "actorUserId" | "actorMembershipId" | "recordedAt">> {
    const identity: VerifiedSubject = await authenticateSeasonRequest(authorization, this.dependencies.verify);
    if (!uuid.test(fieldId)) throw invalidRequest();
    const outcome = await this.dependencies.create(identity, fieldId, parseCreateBody(body));
    reply.status(outcome.kind === "accepted" ? 201 : 200);
    const { id, fieldId: acceptedFieldId, seasonId, amount, currency, category, expenseDate, note } = outcome.expense;
    return { id, fieldId: acceptedFieldId, seasonId, amount, currency, category, expenseDate, note };
  }
}
