import { MembershipScopeService } from "../authorization/membership-scope.service.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import type { VerifiedSubject } from "@ekim-hasat/domain/identity/auth-provider";
import { ApiError } from "../observability/api-error.filter.js";
import type { DiaryV2Cursor } from "../observations/diary-query.js";

export type ExpenseDiaryCandidate = Readonly<{
  kind: "EXPENSE"; id: string; fieldId: string; seasonId: string | null; expenseDate: string;
  amount: string; currency: string;
  category: "SEED_SEEDLING" | "FERTILIZER" | "PESTICIDE" | "FUEL" | "LABOR" | "IRRIGATION" | "OTHER";
  note: string | null;
}>;

type ExpenseDiaryRow = Readonly<{ id: string; field_id: string; season_id: string | null; expense_date: string;
  amount: string; currency: string; category: ExpenseDiaryCandidate["category"]; note: string | null }>;

export class ExpenseDiaryReader {
  private readonly membershipScope: MembershipScopeService;
  constructor(private readonly prisma: PrismaClient) { this.membershipScope = new MembershipScopeService(prisma); }

  async readDiaryCandidates(identity: VerifiedSubject, fieldId: string, seasonId: string | undefined,
    after: DiaryV2Cursor | null, take: number): Promise<readonly ExpenseDiaryCandidate[]> {
    if (!Number.isSafeInteger(take) || take < 1 || take > 101) throw invalidRequest();
    const scope = await this.membershipScope.resolveDefaultBusinessScope(identity);
    if (!scope) throw forbidden();
    if (scope.role !== "OWNER") throw forbidden();
    const rows = after === null
      ? await this.prisma.$queryRaw<ExpenseDiaryRow[]>`SELECT id::text, field_id::text, season_id::text,
          to_char(expense_date, 'YYYY-MM-DD') AS expense_date, amount::text, currency, category, note
        FROM expenses WHERE business_id=${scope.businessId}::uuid AND field_id=${fieldId}::uuid
          AND (${seasonId ?? null}::uuid IS NULL OR season_id=${seasonId ?? null}::uuid)
        ORDER BY expense_date DESC, id DESC LIMIT ${take}`
      : after.precision === "TIMED"
        ? await this.prisma.$queryRaw<ExpenseDiaryRow[]>`SELECT id::text, field_id::text, season_id::text,
            to_char(expense_date, 'YYYY-MM-DD') AS expense_date, amount::text, currency, category, note
          FROM expenses WHERE business_id=${scope.businessId}::uuid AND field_id=${fieldId}::uuid
            AND (${seasonId ?? null}::uuid IS NULL OR season_id=${seasonId ?? null}::uuid)
            AND expense_date <= ${after.localDate}::date
          ORDER BY expense_date DESC, id DESC LIMIT ${take}`
        : await this.prisma.$queryRaw<ExpenseDiaryRow[]>`SELECT id::text, field_id::text, season_id::text,
            to_char(expense_date, 'YYYY-MM-DD') AS expense_date, amount::text, currency, category, note
          FROM expenses WHERE business_id=${scope.businessId}::uuid AND field_id=${fieldId}::uuid
            AND (${seasonId ?? null}::uuid IS NULL OR season_id=${seasonId ?? null}::uuid)
            AND (expense_date < ${after.localDate}::date OR (expense_date = ${after.localDate}::date AND id < ${after.id}::uuid))
          ORDER BY expense_date DESC, id DESC LIMIT ${take}`;
    return rows.map((row) => ({ kind: "EXPENSE", id: row.id, fieldId: row.field_id, seasonId: row.season_id,
      expenseDate: row.expense_date, amount: row.amount, currency: row.currency, category: row.category, note: row.note }));
  }
}

function forbidden(): ApiError { return new ApiError(403, "FORBIDDEN", "This request is not available"); }
function invalidRequest(): ApiError { return new ApiError(400, "INVALID_REQUEST", "Check the diary request and try again"); }
