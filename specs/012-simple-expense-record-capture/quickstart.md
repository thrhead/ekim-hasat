# SPEC-012 Validation Quickstart

This guide is for implementation-stage validation after the planned changes exist. No tests, builds, code generation, or database commands were run while preparing the plan.

## Prerequisites

- Activate/install the repository-pinned toolchain and dependencies using the repo's bootstrap instructions (`scripts/bootstrap-codex-cloud.sh` in a fresh Codex Cloud workspace).
- Configure API/mobile environment as documented by the repository.
- For integration tests, set `DATABASE_URL` to the disposable `ekim_hasat_test` PostgreSQL database with PostGIS. The existing integration harness rejects non-disposable database targets.
- Apply the Prisma migration and generate the API client only after implementation introduces those changes.

## Validation commands

```bash
pnpm --filter @ekim-hasat/api test:unit
pnpm --filter @ekim-hasat/api test:integration
pnpm --filter @ekim-hasat/api test:contract
pnpm --filter @ekim-hasat/api-client generate
pnpm --filter @ekim-hasat/api-client check:generated
pnpm --filter @ekim-hasat/mobile exec jest --runInBand --runTestsByPath test/finance/expense-create-screen.test.tsx test/observations/field-diary-screen.test.tsx
```

Run API contract and generation checks after both the SPEC-012 Finance contract and SPEC-006 Diary contract changes are in place. Run integration commands only against the disposable test database.

## Expected scenarios

1. **Owner creates a Field-only expense**: Submit amount as a decimal string, explicit ISO currency, fixed category, date-only occurrence date, and no Season. Receive 201 only after commit. A Field diary with `includeExpenses=true` shows one `EXPENSE` with `expenseDate`; no time-of-day appears.
2. **Owner creates a Season-linked expense**: Supply a Season from the same authorized Field/Business. Field history includes the fact; that Season-filtered history includes it. A Field-only expense is absent from every Season-filtered result.
3. **Invalid associations and permissions**: Missing/foreign Field or a Season from another Field/Business creates no row and does not expose protected resource details. Non-OWNER Diary access returns no Expense data; non-OWNER requests for the Expense projection are rejected generically. Revoked access is rechecked before a create or retry.
4. **Exact retry and concurrency**: Repeat the same online `expenseId` and payload after a lost response. Return the original Expense, with one row. Concurrent identical submissions converge to one 201 and one 200. Reuse with changed actor/payload/Field/Season returns 409 without disclosing the existing payload. The same UUID may be used independently in another Business.
5. **Money boundaries**: Positive decimal strings within 18 integer digits and 6 fractional digits round-trip exactly. Zero, negative, malformed, over-range, or over-scale inputs are rejected without rounding. JSON number inputs are rejected. Codes absent from the repository-pinned, versioned ISO 4217 set are rejected; no runtime currency service, default currency, TRY-specific behavior, or FX is applied.
6. **Date-only and Diary traversal**: Impossible calendar dates are rejected. The accepted `YYYY-MM-DD` is returned unchanged. Timestamped events retain exact time ordering; same-day Expense rows appear in their separate date-only group, ordered by stable ID, without a fabricated time or UI implication of intra-day timing. Traverse multiple pages and confirm strict-after cursor behavior and filter binding. A cursor cannot be reused across `includeExpenses=true` and `false`; omitting the parameter preserves the existing event set and legacy cursor behavior.
7. **Mobile recovery**: Required amount/currency/category/date and optional Season/note are accessible. A network error or uncertain response never displays success; retry retains the same ID and payload for the active form. A confirmed response returns to and refreshes the original Field/Season diary context. No offline queue or false accepted state is created.
