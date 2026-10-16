# Implementation Plan: Simple Expense Record Capture

**Branch**: `012-simple-expense-record-capture` | **Date**: 2026-10-16 | **Spec**: [spec.md](./spec.md)

**Input**: Clarified SPEC-012. Product requirements in `spec.md` are authoritative; this plan makes technical choices only.

## Summary

Add an immutable Expense fact owned by a dedicated Finance API/domain boundary. Owners create it online for a required Field and optional same-Field Season. The Expense persists an exact decimal amount, required ISO 4217 currency code, fixed category, date-only occurrence date, optional note, actor provenance, and UTC recording timestamp. The existing Field Diary remains the read projection. Its opt-in Expense entry uses a calendar date without an occurrence timestamp, with a new date-aware cursor/order path; existing clients retain the current default projection and v1 cursor behavior.

## Technical Context

**Language/Version**: TypeScript 5.9, Node.js workspace runtime.

**Primary Dependencies**: NestJS 11 with Fastify, `@ekim-hasat/domain`, Prisma 7, PostgreSQL, Expo/React Native, and the generated `@ekim-hasat/api-client`.

**Storage**: PostgreSQL is canonical. Expense uses a `DATE` occurrence column, unconstrained exact `NUMERIC` plus database checks, and UTC `TIMESTAMPTZ` only for server recording time. Prisma owns the migration.

**Testing**: Domain unit, PostgreSQL integration and tenant-isolation, API contract, and mobile component coverage. This planning stage runs no tests or builds.

**Target Platform**: NestJS API and Expo/React Native mobile; no web surface is required for this core farmer workflow.

**Project Type**: TypeScript monorepo, modular monolith.

**Performance Goals**: No new latency or throughput target is specified. Preserve the Diary's existing bounded page defaults (50, maximum 100) and query indexed source candidates.

**Constraints**: OWNER-only finance access; server-authoritative authorization; online submission only; no offline queue; exact decimal transport; date-only semantics; existing versioned REST/OpenAPI and shared generated client; no finance totals or accounting ledger.

**Scale/Scope**: One canonical Expense per accepted create identity, attached to one Business and Field and optionally one Season. No high-volume ledger or reporting workload is in scope.

## Constitution Check

| Principle | Gate | Design response |
|---|---|---|
| Farmer simplicity and mobile completeness | PASS | Entry starts in Field Diary and asks only for required Field context, amount, currency, category, and occurrence date; Season and note remain optional. |
| Offline work must survive | PASS | This bounded mutation is explicitly online-only and never claims success before server acceptance; it creates no offline-capable command or queue. |
| Server-side business/security authority | PASS | The API derives active Business and Membership from the verified identity, enforces OWNER, and validates Field/Season relations within that scope. |
| Tenant isolation | PASS | Composite Business-scoped identity and foreign keys; integration tests must cover cross-Business and wrong-Field probes. |
| Historical integrity | PASS | The accepted row is immutable through this API; restrictive relationships preserve its Field/Season/actor context. No edit/delete/correction endpoint. |
| Exact money and API boundary | PASS | Decimal string over REST, exact domain value, exact PostgreSQL NUMERIC; no binary float, FX, or silent rounding. |
| Modular monolith | PASS | Finance owns Expense validation and writes; the existing Diary owns projection and consumes a Finance-specific read port. No service boundary or generic event abstraction. |
| API contract and mobile compatibility | PASS | Finance contract is owned by SPEC-012; the existing SPEC-006 Diary OpenAPI source is extended additively, with expenses opt-in by default-off query parameter. |

**Pre-design gate**: PASS. No constitution conflict or unresolved product decision is identified.

**Post-design gate**: PASS. The design keeps domain ownership, tenant enforcement, historical integrity, exact money, date-only meaning, and mobile scope aligned with the approved requirements.

## Design Decisions

### Finance ownership and Diary projection

- Add a Finance domain value/validator and API module under `packages/domain/src/finance/` and `apps/api/src/finance/`.
- Finance owns Expense creation, canonical persistence, OWNER checks, and a Finance-specific `ExpenseDiaryReader` query port.
- `ObservationDiaryRepository` remains the owner of the cross-domain Diary page and ordering. It composes source candidates through the Finance-specific read port; Expense is never represented as an observation or irrigation record.
- Keep a separate Expense table and do not introduce a generic operational-event table, ledger, category table, or CMS taxonomy.

### API and contract ownership

- Create: `POST /v1/fields/{fieldId}/expenses` (OpenAPI path is `/fields/{fieldId}/expenses` under the existing `/v1` server base).
- Read Expense facts only through the existing `GET /v1/fields/{fieldId}/diary` projection with `includeExpenses=true`; no separate list or detail endpoint is needed for the approved flow.
- `includeExpenses` is optional and defaults to `false`. Existing clients and existing cursor v1 requests therefore keep their current response/order. Requesting Expense entries requires current OWNER finance visibility; non-OWNER callers receive a generic forbidden response and no expense data.
- If any page in an Expense-enabled Diary/V2 traversal returns `403`, abandon that traversal and cursor mode completely. Immediately suppress/remove all previously visible Expense rows while preserving already visible ordinary Diary rows during fallback. Never reuse or translate a V2 cursor into V1. Retry exactly once for the same authorized Field and optional Season using the ordinary V1 projection from its first page, with no cursor and Expenses disabled. On V1 success, reconcile/replace visible ordinary Diary state from that first-page result; do not merge it with pages from the abandoned V2 traversal. Continue pagination only from the V1 response's cursor. If V1 also returns `403`, use the existing full Diary access-denied behavior and clear inaccessible data. Do not add an OWNER-role/capability endpoint or broaden scope to avoid this fallback. Authorization remains server-enforced; a non-OWNER must never receive Expense data.
- The canonical create contract is `specs/012-simple-expense-record-capture/contracts/expenses.openapi.yaml`. The Diary operation remains owned by `specs/006-field-observations-basic-diary/contracts/observations-diary.openapi.yaml`; `contracts/diary-extension.md` records the required additive amendment and does not duplicate the operation/schema as a second source of truth.
- The implementation adds the SPEC-012 OpenAPI file to `packages/api-client/openapi-generator.config.ts`, extends the SPEC-006 Diary union, and regenerates the generated API client through the existing workflow. No generated files are changed during planning.

### Amount, currency, category, and note

- REST transports `amount` as a decimal string, never a JSON number. The API/domain reject non-decimal syntax, nonpositive values, more than 18 integer digits, or more than 6 fractional digits; no rounding occurs.
- PostgreSQL stores amount as unconstrained `NUMERIC` (Prisma `Decimal @db.Decimal`) with checks `amount > 0`, `amount < 10^18`, and `scale(amount) <= 6`. Avoid `NUMERIC(24,6)`: PostgreSQL typmod coercion can round excess fractional digits before a check sees them. Pre-validation plus an unconstrained column and checks preserves rejection semantics and makes the accepted API range a subset of database capacity.
- The technical range is far above ordinary farm expense values and permits up to six decimal places without binary floating point. It is an API/storage safety boundary, not a product maximum or a currency-specific rounding rule. Values outside it are rejected, never rounded.
- Currency is an uppercase three-letter code checked against a repository-pinned, versioned ISO 4217 code set in the shared domain. The set is updated through normal application releases; no runtime currency service or currency-management subsystem is introduced. The REST pattern is only a shape check. No default, TRY-specific behavior, FX, or cross-currency arithmetic is added.
- Persist the seven fixed categories as stable codes: `SEED_SEEDLING`, `FERTILIZER`, `PESTICIDE`, `FUEL`, `LABOR`, `IRRIGATION`, `OTHER`. Domain/API/DB validation share that set; Turkish display labels live in the mobile presentation map. No category management is introduced.
- Note is PostgreSQL `TEXT`; no feature-specific character cap or trim/normalization rule is added. The existing API request-body limit remains the outer transport safeguard.

### Date-only storage and transport

- REST and domain use a validated `YYYY-MM-DD` string (`LocalDate` from `@ekim-hasat/domain/seasons/local-date`). Reuse `validateLocalDate`, which validates Gregorian calendar dates without parsing them through `Date`.
- Store the occurrence value in PostgreSQL `DATE`, never `TIMESTAMPTZ`; do not construct UTC midnight or a placeholder time. Because Prisma's PostgreSQL `DATE` mapping is exposed as JavaScript `Date`, the Expense repository reads/writes this field with parameterized SQL casts and `to_char(expense_date, 'YYYY-MM-DD')` so the domain/API preserve the original calendar string without an instant conversion.
- Enforce the spec's no-future-date rule against the current authorized Business-local calendar date using the existing Business timezone resolver (including its established fallback when unset). The resolver is used only to determine “today” and Diary grouping; it never turns `expenseDate` into an instant or changes the submitted date.
- `recordedAt` is a distinct server UTC timestamp for provenance only. It is not returned as or used in place of the expense occurrence date.

### Expense identity, retry, and concurrency

- The client creates one UUID `expenseId` when an online form submission begins; it is the public Expense ID and remains attached to the active form while the outcome is uncertain. No durable outbox or restart reconciliation is introduced.
- Persist identity as composite `(businessId, id)` (matching current canonical observation/irrigation identity), so a collision in another Business is independent and cannot expose that Business's record. The row itself is the durable idempotency receipt; do not use the expiring generic `BusinessCommandIdempotencyRecord` for a permanent historical fact.
- Resolve current authenticated scope, enforce active OWNER membership, lock/revalidate current membership/user context, and validate the authorized Field before looking up or replaying an ID. Validate optional Season against `(seasonId, businessId, fieldId)`. Missing/foreign Field or Season uses privacy-safe not-found behavior.
- For an existing `(businessId, expenseId)`, compare actor/membership, Field, Season, and every canonical request field. Exact match returns the original immutable Expense as a replay (HTTP 200); changed payload/actor/context returns generic `IDEMPOTENCY_KEY_REUSED` (HTTP 409) without returning the existing payload. First acceptance is HTTP 201.
- A database unique constraint serializes same-ID concurrent requests. On unique conflict, re-resolve current authorization, read only within the authorized Business, then apply the same exact-replay/conflict comparison. Identical racing calls converge to one row and accepted/replayed outcomes; different requests sharing one ID yield one winner and a deterministic conflict for the other.

### Date-only Diary order and pagination

- Extend the existing Diary union with `EXPENSE`; its shape contains `expenseDate` and has no `occurredAt`, `recordedAt`, or synthetic time field.
- A Field query includes all Expense rows for that Field. A Season-filtered query includes only rows whose explicit `seasonId` matches; `seasonId IS NULL` never passes the Season filter.
- Keep default Diary behavior and v1 cursor semantics unchanged when `includeExpenses=false`. The opted-in path uses cursor v2, capable of representing the date-only mixed ordering key and bound to Field, Season, includeIrrigation/includeExpenses filters, resolved Business timezone, and the last total-order tuple. Reject cursor reuse when its expense projection mode differs from the request; in particular, a cursor issued with `includeExpenses=true` cannot be used with false, or vice versa. Never encode an Expense as a timestamp.
- Total order is by Business-local calendar day descending. Within a day, timestamp-bearing events form a timed group ordered by actual instant descending, then `kind` ascending and source UUID descending for equal instants. Date-only Expense entries form a separate date-only group after the timed group and are ordered by Expense UUID descending. The mobile Diary renders these as separate same-day subsections; an Expense has a date label only, so neither vertical position nor content claims an intra-day occurrence time.
- The v2 cursor stores `localDate`, a precision group, an actual instant only for timed entries, then kind and ID. Continuations query strictly after that tuple. Timestamp sources derive their Business-local date using the current resolved timezone; if the timezone changes between pages, reject the stale v2 cursor and require a fresh first page. This avoids reinterpreting a cursor under different day boundaries.
- Query at most `limit + 1` ordered candidates per source, merge with the same comparator, and return the existing `nextCursor` page format. Keep default `limit=50`, maximum 100. Keyset pagination is deterministic for immutable source ordering keys; it is not a fixed database snapshot. New entries before a consumed cursor appear on refresh, not by reshuffling an in-progress traversal.

### Mobile flow

- From an authorized Field Diary, OWNER chooses “Gider ekle”; Field is already fixed by context. Season is selectable only from that Field's available Seasons and remains optional.
- Form requires positive amount, explicit currency selection with no preselected value, one of the fixed categories, and the occurred-on date. Note and Season are optional. Currency/category labels are Turkish; amount rendering must not pass through JavaScript `Number`.
- The currency picker uses the validated code list and can be searched; it does not select TRY or remember a prior value.
- Submission is online only. Keep the same `expenseId` and exact payload in active form memory during retry; show pending/uncertain state until server confirms. On replay, show accepted result once and refresh the same Diary context. On conflict, validation error, connectivity loss, or authorization loss, show truthful recovery guidance and do not show acceptance.
- Existing Diary loading/empty/error/accessibility patterns are reused. Non-OWNER Diary viewing does not expose Expense entries or the create action.
- If any page of the Expense-enabled Diary returns `403`, abandon all Expense/V2 pages and immediately suppress every visible Expense row while retaining already visible ordinary Diary rows during fallback. Retry exactly once for the same Field and optional Season from the first page of ordinary V1, with Expenses disabled and no cursor; never reuse or translate a V2 cursor. On V1 success reconcile/replace the visible Diary with that V1 first page, without duplicates or gaps caused by mixing cursor modes, and use only its returned cursor for subsequent pages. If V1 returns `403`, invoke the existing full Diary access-denied behavior and clear inaccessible data. This applies to both initial- and later-page failures. No role/capability endpoint is added, and server privacy rules continue to prevent non-OWNER Expense delivery.

## Project Structure

### Documentation

```text
specs/012-simple-expense-record-capture/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
└── contracts/
    ├── expenses.openapi.yaml
    └── diary-extension.md
```

### Source locations planned for implementation (not created in this stage)

```text
packages/domain/src/finance/                  # Expense value, category/currency validation
apps/api/src/finance/                         # Finance create and Diary candidate reader
apps/api/prisma/schema.prisma                 # Expense model and relations
apps/api/prisma/migrations/                   # Additive Expense migration/check constraints
apps/api/src/observations/                    # Date-aware opt-in Diary projection/cursor
apps/mobile/src/features/finance/             # Expense client and create form
apps/mobile/src/features/observations/        # Diary entry rendering/order integration
specs/006-field-observations-basic-diary/contracts/observations-diary.openapi.yaml
packages/api-client/openapi-generator.config.ts
packages/api-client/src/generated/            # Generated only during implementation
```

**Structure Decision**: Finance owns the canonical Expense model and mutation. The existing Diary projection composes a Finance-specific read port while retaining its current API surface and default behavior. The monorepo's existing OpenAPI generator remains the only generated-client path.

## Complexity Tracking

No constitution violations or new runtime boundaries are introduced.
