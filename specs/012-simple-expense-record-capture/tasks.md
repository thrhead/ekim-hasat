# Tasks: Simple Expense Record Capture

**Input**: Approved `spec.md`, reconciled `plan.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md`, and closed `checklists/finance.md`.

**Test policy**: Tests are explicitly required for this feature. For each behavior change, write the relevant failing tests first, confirm the failure, then implement only enough to pass them. All tasks remain unchecked until executed.

**Scope**: Implement only the approved immutable, online Finance Expense fact and its OWNER-only Field/Season Diary projection. Do not add profitability, totals, accounting, edits/deletes/corrections, custom categories, FX, or generic offline expense sync.

## Phase 1: Setup

The repository already has the required pnpm workspace, API/domain/mobile test runners, Prisma migration flow, and OpenAPI client generator. No new framework, package, or test infrastructure setup is needed.

## Phase 2: Foundational Domain and Persistence

**Purpose**: Establish the canonical Expense value rules and database constraints needed by both user stories.

- [x] T001 [P] Add failing domain tests in `packages/domain/test/finance/expense.spec.ts` for required UUID identity/Field/actor provenance, positive exact decimal amount with at most 18 integer digits and 6 fractional digits, rejection of zero/negative/malformed/over-range/over-scale values without rounding, repository-pinned versioned ISO 4217 validation, the seven fixed category codes, valid date-only `LocalDate`, and an optional note with no feature-specific cap or trim rule.
- [x] T002 [P] Add failing PostgreSQL integration tests in `apps/api/test/finance/expenses.persistence.integration.spec.ts` for composite `(businessId, id)` identity, same-Business Field/Season relations, required Field, nullable Season, exact `NUMERIC` checks (`amount > 0`, `amount < 10^18`, `scale(amount) <= 6`), exact PostgreSQL `DATE` round-trip, exact optional note persistence without trimming, actor provenance, and restrictive historical deletion behavior.
- [x] T003 Implement Expense domain values and validation in `packages/domain/src/finance/expense.ts`, `packages/domain/src/finance/expense-amount.ts`, `packages/domain/src/finance/currency-code.ts`, `packages/domain/src/finance/iso-4217-codes.ts`, and `packages/domain/src/finance/expense-category.ts`; preserve decimal strings without `Number`, reject rather than round, use the release-pinned ISO code set, and define only the seven approved category codes. Make T001 pass.
- [x] T004 Add the Expense Prisma model and additive migration in `apps/api/prisma/schema.prisma` and `apps/api/prisma/migrations/<timestamp>_expense_record/migration.sql`; persist positive unconstrained `NUMERIC` under the approved amount checks, occurrence as PostgreSQL `DATE`, note as nullable `TEXT` without a feature-specific cap, composite Business/Field/Season and actor relations, indexes for Field/Season diary source reads, uppercase three-character currency and fixed-category checks, and restrictive deletes. Make T002 pass.

## Phase 3: User Story 1 — Record a Field Expense (P1)

**Goal**: An OWNER records an online Field-only Expense and sees exactly one truthful date-only fact in the Field Diary.

**Independent test criteria**: Create one valid Field-only Expense; verify authorized creation and Field history; verify invalid/foreign scope is privacy-safe; retry the same logical submission and concurrently submit the same identity without creating duplicates; confirm no success is shown before server acceptance.

### Failing tests first

- [x] T005 [P] [US1] Add failing authorization and tenant-isolation integration tests in `apps/api/test/finance/expenses.authorization.integration.spec.ts` for current OWNER-only create/read access, active WORKER/ADVISOR exclusion, server-derived Business scope, inaccessible Field privacy, membership revocation before acceptance or replay, and rejection of an Expense date later than the authorized Business-local current date (not a UTC/device date).
- [x] T006 [P] [US1] Add failing retry and concurrency integration tests in `apps/api/test/finance/expenses.idempotency.integration.spec.ts` for exact same-actor/context/payload replay, changed payload or context conflict, simultaneous identical submissions converging on one row, current authorization revalidation, and the same UUID being independent across Businesses.
- [x] T007 [P] [US1] Add failing API contract tests in `apps/api/test/finance/expenses.contract.spec.ts` for `POST /v1/fields/{fieldId}/expenses`, required request fields, exact decimal-string constraints (positive; at most 18 integer and 6 fractional digits), required ISO code, fixed category enum, `YYYY-MM-DD` date, optional uncapped-by-product note, and 201-new/200-exact-replay/409-changed-retry outcomes.
- [x] T008 [P] [US1] Add failing Diary query and integration tests in `apps/api/test/observations/diary-query.spec.ts` and `apps/api/test/observations/field-diary.integration.spec.ts` for default `includeExpenses=false` V1 response/order/cursor compatibility; enabled Field Diary inclusion of accepted Field-only Expenses; OWNER-only `includeExpenses=true` with an active non-OWNER receiving generic `403 FORBIDDEN` and no Expense data; date-only Expense shape without `occurredAt`/`recordedAt`; deterministic same-date groups and keyset pagination; cursor binding to Field, Season, both include flags and timezone; and rejection of cursor reuse across expense projection modes.
- [x] T009 [P] [US1] Add failing transport type tests in `packages/api-client/test/expenses-consumer.type-test.ts` and `packages/api-client/test/observations-diary-consumer.type-test.ts` for the canonical create request/response and discriminated Diary Expense variant with `expenseDate` and no occurrence timestamp.
- [x] T010 [P] [US1] Add failing mobile tests in `apps/mobile/test/finance/expense-create-screen.test.tsx` and `apps/mobile/test/observations/field-diary-screen.test.tsx` for explicit currency selection with no default or remembered value, fixed Turkish category labels, date-only capture, accessible required/optional fields, loading/validation/connectivity/authorization/server-error states, exact active-form retry after uncertain outcome, and date-only Diary grouping without implied intra-day timing. Explicitly cover (1) OWNER Expense-enabled Diary success, (2) initial-page Expense `403` followed by one successful V1 first-page fallback, (3) later-page Expense `403` abandoning V2 and restarting V1 from its first page without reusing/translating the cursor, (4) while fallback is pending, previously loaded ordinary rows remain visible and all Expense rows are suppressed, (5) V1 success replaces/reconciles state without duplicates or gaps from mixing cursor modes and future pages use only the V1 cursor, (6) V1 `403` invokes full access denial after either initial- or later-page failure, and (7) stale Expense rows are never retained after the Expense-enabled request is denied.

### Implementation

- [x] T011 [US1] Implement canonical creation, scope validation, durable `(businessId, expenseId)` identity, and exact replay/concurrency handling in `apps/api/src/finance/expenses.repository.ts`; return the original row only for an exact authorized retry and a generic conflict for changed actor/payload/Field/Season, without trusting client Business IDs.
- [x] T012 [US1] Implement the Finance create service, controller, and module in `apps/api/src/finance/expenses.service.ts`, `apps/api/src/finance/expenses.controller.ts`, and `apps/api/src/finance/expenses.module.ts`, then register the module in `apps/api/src/main.ts`; require current OWNER authorization and preserve privacy-safe Field/Season failures with 201 for first acceptance and 200 for exact replay.
- [x] T013 [US1] Reconcile the canonical Finance contract in `specs/012-simple-expense-record-capture/contracts/expenses.openapi.yaml` with the implemented route and response, preserving positive decimal-string validation, required ISO 4217 code, fixed seven-value category enum, date-only `expenseDate`, and optional note; make T007 pass.
- [x] T014 [US1] Extend the canonical Diary contract in `specs/006-field-observations-basic-diary/contracts/observations-diary.openapi.yaml` with default-off `includeExpenses` and the distinct `EXPENSE` response variant, documenting the date-only mixed-order cursor contract while leaving the existing V1 default projection unchanged; make T008's contract expectations pass.
- [x] T015 [US1] Implement the Finance-specific Diary reader in `apps/api/src/finance/expense-diary-reader.ts` and integrate it with `apps/api/src/observations/observation-diary.repository.ts`, `apps/api/src/observations/diary-query.ts`, and `apps/api/src/observations/observation.controller.ts`; preserve V1 behavior when disabled and use a V2 cursor bound to Field, Season, both include flags, timezone, and date-only ordering tuple when enabled, with no fabricated Expense timestamp.
- [x] T016 [US1] Add the canonical Expense contract source while retaining the existing SPEC-006 Diary contract source in `packages/api-client/openapi-generator.config.ts`, generate `packages/api-client/src/generated/expenses-api.ts` and `packages/api-client/src/generated/observations-diary-api.ts` through the repository generator, and export the generated clients from `packages/api-client/src/index.ts`; make T009 pass without hand-maintained duplicate types.
- [x] T017 [US1] Implement the online Expense client and create form in `apps/mobile/src/features/finance/expense-client.ts` and `apps/mobile/src/features/finance/expense-create-screen.tsx`; require Field, amount, explicit currency, category, and date, keep Season/note optional, retain the same ID and payload only in active form memory for uncertain retries, and show acceptance only after server confirmation.
- [x] T018 [US1] Integrate the Expense entry point, date-only Diary rendering, and projection fallback in `apps/mobile/src/features/observations/diary-client.ts`, `apps/mobile/src/features/observations/field-diary-screen.tsx`, `apps/mobile/src/app-composition.ts`, and `apps/mobile/App.tsx`; keep Expense visually separate from timestamped rows and never sort or label it as if its intra-day occurrence time were known. If any Expense-enabled page returns `403`, abandon Expense/V2 pagination, immediately suppress all visible Expense rows, preserve already visible ordinary rows while fallback is pending, and retry exactly once for the same Field/optional Season from ordinary V1's first page with no cursor and Expenses disabled. Never reuse/translate a V2 cursor. On V1 success reconcile/replace visible state from that first page without mixing modes and continue only with its returned cursor; on V1 `403`, invoke existing full access denial and clear inaccessible data. Make T010 pass.
- [x] T019 [US1] Run only the US1 gate using the Expense domain and persistence tests plus tests added by T005–T010: create authorization/idempotency/contract, Field Diary V1/V2, generated-client shape, and US1 mobile capture/Diary tests; use the disposable integration database for persistence checks and defer comprehensive cross-feature validation to T028.

## Phase 4: User Story 2 — Associate an Expense with a Season (P2)

**Goal**: A supplied Season must belong to the same authorized Business and Field; Season history includes only explicitly associated Expenses.

**Independent test criteria**: Submit a same-Field Season-linked Expense and a Field-only Expense; both appear in Field history, only the linked one appears in its Season-filtered history, and a foreign/mismatched Season is rejected without revealing protected information.

### Failing tests first

- [x] T020 [P] [US2] Add failing Season association integration tests in `apps/api/test/finance/expenses-season.integration.spec.ts` for valid same-Business/same-Field Season, omitted Season, wrong-Field and cross-Business Season privacy, and changed-Season reuse of an existing Expense ID.
- [x] T021 [P] [US2] Add failing Diary integration tests in `apps/api/test/observations/field-diary.integration.spec.ts` proving that an Expense-enabled Field Diary includes both Season-linked and Field-only Expenses, while a Season-filtered Diary includes only Expenses explicitly linked to that exact Season and excludes Field-only and other-Season Expenses across pages.
- [x] T022 [P] [US2] Add failing optional Season-context tests in `apps/mobile/test/finance/expense-season-context.test.tsx` for capture from Field and Season Diary contexts, omission of Season, and keeping the Field fixed while choosing only a Season belonging to it.

### Implementation

- [x] T023 [US2] Implement optional Season validation and persistence in `apps/api/src/finance/expenses.repository.ts` and `apps/api/src/finance/expenses.service.ts`, requiring the composite `(seasonId, businessId, fieldId)` match, preserving null for Field-only facts, and making changed-Season retries conflict; make T020 pass.
- [x] T024 [US2] Extend `apps/api/src/finance/expense-diary-reader.ts` and `apps/api/src/observations/observation-diary.repository.ts` so Field history includes linked and Field-only Expenses while Season-filtered history includes only the exact explicit Season association; preserve cursor filter binding and make T021 pass.
- [x] T025 [US2] Pass optional Season context through `apps/mobile/src/features/finance/expense-create-screen.tsx`, `apps/mobile/src/features/finance/expense-client.ts`, `apps/mobile/src/app-composition.ts`, and `apps/mobile/App.tsx` without requiring a Season or adding category/Season management; make T022 pass.
- [x] T026 [US2] Run the focused Season association, tenant-isolation, Diary pagination, retry-context, and mobile Season validations documented in `specs/012-simple-expense-record-capture/quickstart.md` against the disposable integration database where needed.

## Phase 5: Cross-Cutting Verification

- [x] T027 Perform a separate implementation-conformance review against `specs/012-simple-expense-record-capture/spec.md`, `plan.md`, `data-model.md`, and both canonical OpenAPI contracts using implementation tests and code-review evidence; record findings in `specs/012-simple-expense-record-capture/implementation-review.md`, and leave `checklists/finance.md` closed solely as a requirements-quality artifact without reinterpreting its markers as implementation status.
- [x] T028 Run the comprehensive cross-feature validation commands from `specs/012-simple-expense-record-capture/quickstart.md` plus `pnpm --filter @ekim-hasat/domain test`: full focused API unit/integration/contract coverage, disposable PostgreSQL checks, generated-client consistency, and mobile tests after both user stories are integrated.

## Dependencies

- Foundation T001–T002 are failing tests; T003 follows T001 and T004 follows T002. T003 and T004 can proceed in parallel after their respective test tasks.
- User Story 1 begins after foundation. Its independent failing test tasks T005–T010 can be prepared in parallel; implementation then follows repository → API surface/contracts → Diary projection → generated clients → mobile integration. T019 is the US1 validation gate.
- User Story 2 depends on the canonical create and Diary projection from US1. Its failing tests T020–T022 can be prepared in parallel after US1; server association/filtering and mobile context follow their respective tests. T026 is the US2 validation gate.
- T027–T028 follow both stories. There is no dependency on implementation-time profitability, generic offline sync, or accounting work because those are out of scope.

## Parallel Opportunities

- Foundation: T001 and T002; then T003 and T004.
- US1 test preparation: T005–T010 touch separate test surfaces and may be authored in parallel. Shared implementation files are sequenced to avoid conflicts.
- US2 test preparation: T020–T022 touch API, Diary, and mobile test surfaces and may be authored in parallel after US1.

## Implementation Strategy

Deliver the MVP as User Story 1: OWNER-only online Field expense capture, canonical immutable persistence, truthful exact retry, and a date-only Field Diary entry. Then add User Story 2's explicit same-Field Season association and filtered history. Preserve strict test-first sequencing, stop at each story's focused validation gate, then run the final cross-cutting checks. Do not mark tasks complete until executed and verified.
