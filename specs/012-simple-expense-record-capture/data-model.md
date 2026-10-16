# SPEC-012 Data Model

## Expense

Canonical immutable Finance fact. One Expense belongs to one Business and required Field, with an optional explicit Season. Expense is never stored as an Observation or IrrigationRecord.

| Field | API/domain form | PostgreSQL form | Rule |
|---|---|---|---|
| `id` | UUID `expenseId` | UUID | Client creates one identity for the online submit/retry flow. Primary key is composite with `businessId`; exact identity is durable. |
| `businessId` | Server-derived UUID | UUID, FK | Never accepted as authorization input. Derived from current verified user and active membership. |
| `fieldId` | UUID path parameter | UUID, FK | Required; Field must belong to the authorized Business. |
| `seasonId` | Optional UUID | Nullable UUID, composite FK | If present, Season must match the same Business and Field. Null means Field-only, never allocated to a Season. |
| `actorUserId` | Server provenance | UUID, FK | Derived from verified identity. |
| `actorMembershipId` | Server provenance | UUID, FK | Current active OWNER membership used to accept the Expense. |
| `amount` | Decimal string | Unconstrained PostgreSQL `NUMERIC` / Prisma Decimal | Positive; no binary float; API and DB checks allow at most 18 integer digits and 6 fractional digits; reject rather than round. Maximum accepted decimal is `999999999999999999.999999`. |
| `currency` | Uppercase ISO 4217 code | `VARCHAR(3)` | Required. Repository-pinned, versioned ISO 4217 code set plus uppercase shape constraint; updated through normal application releases. No default/FX. |
| `category` | Stable enum code | Text with DB `CHECK` | Required one of `SEED_SEEDLING`, `FERTILIZER`, `PESTICIDE`, `FUEL`, `LABOR`, `IRRIGATION`, `OTHER`. No category table. |
| `expenseDate` | `LocalDate` / `YYYY-MM-DD` string | PostgreSQL `DATE` | Required occurrence calendar date. Not an instant; raw SQL date binding/read-as-text avoids UTC-midnight conversion. |
| `note` | Optional string | Nullable `TEXT` | No feature-specific length cap or trim rule. |
| `recordedAt` | Internal/server provenance | `TIMESTAMPTZ(6)` | Set by server in UTC when accepted. Not an Expense occurrence date and not used to order Diary occurrence. |

### Identity, relations, and constraints

- Composite primary key: `(businessId, id)`. The same client UUID may exist independently in different Businesses.
- `Field` relation: `(fieldId, businessId)` references the Field's composite Business identity.
- Optional `Season` relation: `(seasonId, businessId, fieldId)` references the Season composite identity. This enforces same-Field/same-Business association at the database boundary.
- Actor Membership relation: `(actorMembershipId, businessId, actorUserId)` references the membership identity; membership status/OWNER role are revalidated at command time.
- Restrictive deletion relations preserve accepted historical facts. No update/delete/correction command is added.
- Database checks: `amount > 0`; `amount < 1000000000000000000`; `scale(amount) <= 6`; uppercase three-character currency shape; category membership in the fixed V1 set.
- Indexes: `(businessId, fieldId, expenseDate DESC, id DESC)` for Field diary source reads and `(businessId, fieldId, seasonId, expenseDate DESC, id DESC)` for Season-filtered source reads. Confirm actual query plans during implementation; no index is justified for profitability aggregation because totals are out of scope.

## Domain value objects

- `LocalDate`: reuse `@ekim-hasat/domain/seasons/local-date` and its `validateLocalDate` to preserve date strings without `Date` parsing.
- `ExpenseAmount`: validated exact decimal string; a shared parser enforces the API integer/fraction bounds and positivity without `Number` conversion.
- `CurrencyCode`: uppercase string that must exist in the repository-pinned, versioned ISO 4217 code set. The set changes through normal application releases; no runtime service or currency-management subsystem is used.
- `ExpenseCategory`: finite union of the seven stable codes. Turkish labels are presentation data, not persisted enum values.

## Diary projection variant

`ExpenseDiaryEntry` is a read projection, not a separately persisted event.

```text
kind: "EXPENSE"
id: expense.id
fieldId: expense.fieldId
seasonId: expense.seasonId | null
expenseDate: YYYY-MM-DD
amount: exact decimal string
currency: ISO 4217 code
category: stable category code
note: string | null
```

It deliberately has no `occurredAt`, `recordedAt`, or synthetic time field. A Field query includes all Expenses for that Field. A Season-filtered query includes only rows with that exact `seasonId`; null associations are excluded.

## Explicitly absent

No revenue, harvest, sales, profitability totals, FX, ledger, correction/void state, attachment, category-management entity, offline outbox entity, or generalized event table is introduced.
