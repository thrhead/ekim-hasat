import { ForbiddenException } from "@nestjs/common";
import { createExpense, type Expense } from "@ekim-hasat/domain/finance/expense";
import type { VerifiedSubject } from "@ekim-hasat/domain/identity/auth-provider";
import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import { MembershipScopeService } from "../authorization/membership-scope.service.js";
import { ApiError } from "../observability/api-error.filter.js";
import { businessLocalDate, resolveBusinessTimezone } from "../seasons/business-timezone.js";

export type ExpenseCreateRequest = Readonly<{
  expenseId: string;
  seasonId?: string;
  amount: string;
  currency: string;
  category: string;
  expenseDate: string;
  note?: string;
}>;

export type ExpenseCreateOutcome = Readonly<{
  kind: "accepted" | "replayed";
  expense: Expense & Readonly<{ recordedAt: string }>;
}>;

type ExpenseRow = {
  id: string;
  business_id: string;
  field_id: string;
  season_id: string | null;
  actor_user_id: string;
  actor_membership_id: string;
  amount: string;
  currency: string;
  category: string;
  expense_date: string;
  note: string | null;
  recorded_at: Date;
};

export class ExpensesRepository {
  private readonly membershipScope: MembershipScopeService;

  constructor(private readonly prisma: PrismaClient, private readonly now: () => Date = () => new Date()) {
    this.membershipScope = new MembershipScopeService(prisma);
  }

  async create(identity: VerifiedSubject, fieldId: string, input: ExpenseCreateRequest): Promise<ExpenseCreateOutcome> {
    let scope;
    try { scope = await this.membershipScope.resolveDefaultBusinessScope(identity); }
    catch (error) {
      if (error instanceof ForbiddenException) throw forbidden();
      throw error;
    }
    if (!scope || scope.role !== "OWNER") throw forbidden();

    try {
      return await this.prisma.$transaction(async (tx) => {
        const authorized = await tx.$queryRaw<Array<{ id: string }>>`SELECT m.id
          FROM memberships m JOIN application_users u ON u.id=m.user_id
          WHERE m.id=${scope.membershipId}::uuid AND m.business_id=${scope.businessId}::uuid
            AND m.user_id=${scope.userId}::uuid AND m.status='ACTIVE' AND m.role='OWNER'
            AND u.default_business_id=m.business_id
          FOR UPDATE OF m,u`;
        if (authorized.length !== 1) throw forbidden();

        const field = await tx.field.findFirst({
          where: { id: fieldId, businessId: scope.businessId },
          select: { id: true, businessId: true, business: { select: { timezone: true } } },
        });
        if (!field) throw notFound();

        let timezone: string;
        try { timezone = resolveBusinessTimezone(field.business.timezone); }
        catch { throw invalidRequest(); }

        const existing = await this.readRow(tx, scope.businessId, input.expenseId);
        if (existing) {
          const submitted = this.canonical(scope, fieldId, input, true);
          if (!this.matches(existing, submitted)) throw identityConflict();
          return { kind: "replayed" as const, expense: this.toPublic(existing) };
        }

        const recordedAt = this.now();
        const canonical = this.canonical(scope, fieldId, input, false);
        if (canonical.expenseDate > businessLocalDate(recordedAt, timezone)) throw invalidRequest();
        if (canonical.seasonId !== null && !await tx.season.findFirst({
          where: { id: canonical.seasonId, businessId: scope.businessId, fieldId },
          select: { id: true },
        })) throw notFound();

        const rows = await tx.$queryRaw<ExpenseRow[]>`INSERT INTO expenses
          (id, business_id, field_id, season_id, actor_user_id, actor_membership_id,
           amount, currency, category, expense_date, note, recorded_at)
          VALUES (${canonical.id}::uuid, ${canonical.businessId}::uuid, ${canonical.fieldId}::uuid,
            ${canonical.seasonId}::uuid, ${canonical.actorUserId}::uuid, ${canonical.actorMembershipId}::uuid,
            ${canonical.amount}::numeric, ${canonical.currency}, ${canonical.category},
            ${canonical.expenseDate}::date, ${canonical.note}, ${recordedAt})
          RETURNING id::text, business_id::text, field_id::text, season_id::text, actor_user_id::text,
            actor_membership_id::text, amount::text, currency, category,
            to_char(expense_date, 'YYYY-MM-DD') AS expense_date, note, recorded_at`;
        const row = rows[0];
        if (!row) throw new Error("Expense insert did not return its canonical row");
        return { kind: "accepted" as const, expense: this.toPublic(row) };
      }, { isolationLevel: "ReadCommitted" });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const current = await this.membershipScope.resolveDefaultBusinessScope(identity);
      if (!current || current.userId !== scope.userId || current.businessId !== scope.businessId
        || current.membershipId !== scope.membershipId || current.role !== "OWNER") throw forbidden();
      const winner = await this.readRow(this.prisma, scope.businessId, input.expenseId);
      if (!winner) throw error;
      return this.create(identity, fieldId, input);
    }
  }

  private canonical(
    scope: { userId: string; businessId: string; membershipId: string },
    fieldId: string,
    input: ExpenseCreateRequest,
    conflictOnInvalid: boolean,
  ): Expense {
    try {
      return createExpense({
        id: input.expenseId,
        businessId: scope.businessId,
        fieldId,
        seasonId: input.seasonId,
        actorUserId: scope.userId,
        actorMembershipId: scope.membershipId,
        amount: input.amount,
        currency: input.currency,
        category: input.category,
        expenseDate: input.expenseDate,
        note: input.note,
      });
    } catch {
      if (conflictOnInvalid) throw identityConflict();
      throw invalidRequest();
    }
  }

  private async readRow(tx: Prisma.TransactionClient | PrismaClient, businessId: string, id: string): Promise<ExpenseRow | undefined> {
    const rows = await tx.$queryRaw<ExpenseRow[]>`SELECT id::text, business_id::text, field_id::text, season_id::text,
        actor_user_id::text, actor_membership_id::text, amount::text, currency, category,
        to_char(expense_date, 'YYYY-MM-DD') AS expense_date, note, recorded_at
        FROM expenses WHERE business_id=${businessId}::uuid AND id=${id}::uuid`;
    return rows[0];
  }

  private matches(row: ExpenseRow, expense: Expense): boolean {
    return row.id === expense.id && row.business_id === expense.businessId && row.field_id === expense.fieldId
      && row.season_id === expense.seasonId && row.actor_user_id === expense.actorUserId
      && row.actor_membership_id === expense.actorMembershipId && row.amount === expense.amount
      && row.currency === expense.currency && row.category === expense.category
      && row.expense_date === expense.expenseDate && row.note === expense.note;
  }

  private toPublic(row: ExpenseRow): Expense & Readonly<{ recordedAt: string }> {
    return Object.freeze({
      id: row.id,
      businessId: row.business_id,
      fieldId: row.field_id,
      seasonId: row.season_id,
      actorUserId: row.actor_user_id,
      actorMembershipId: row.actor_membership_id,
      amount: row.amount as Expense["amount"],
      currency: row.currency as Expense["currency"],
      category: row.category as Expense["category"],
      expenseDate: row.expense_date as Expense["expenseDate"],
      note: row.note,
      recordedAt: row.recorded_at.toISOString(),
    });
  }
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as { code?: unknown; meta?: { code?: unknown } };
  return value.code === "P2002" || value.code === "23505" || value.meta?.code === "23505";
}

function forbidden(): ApiError { return new ApiError(403, "FORBIDDEN", "This request is not available"); }
function notFound(): ApiError { return new ApiError(404, "NOT_FOUND", "The requested item is not available"); }
function invalidRequest(): ApiError { return new ApiError(400, "INVALID_REQUEST", "Check the expense information and try again"); }
function identityConflict(): ApiError { return new ApiError(409, "IDEMPOTENCY_KEY_REUSED", "This expense ID was already used for different information"); }
