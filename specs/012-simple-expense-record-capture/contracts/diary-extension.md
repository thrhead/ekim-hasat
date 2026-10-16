# SPEC-012 Diary Contract Extension

## Ownership

The canonical operation remains `GET /fields/{fieldId}/diary` in [SPEC-006 observations-diary.openapi.yaml](../../006-field-observations-basic-diary/contracts/observations-diary.openapi.yaml). This note specifies the additive contract change for implementation; it is not a second OpenAPI owner or a duplicate Diary endpoint.

## Request changes

Add optional query parameter `includeExpenses`, boolean, default `false`. Existing clients that omit it receive the existing projection and retain the current timestamp-only cursor v1 behavior. When `true`, the API includes `EXPENSE` entries only after current OWNER finance authorization; non-OWNER requests receive a generic `403 FORBIDDEN` and no Expense data. Existing `seasonId`, `includeIrrigation`, `limit` (default 50, maximum 100), and page structure remain.

## Response changes

Add `ExpenseDiaryEntry` to `DiaryPage.items.oneOf` and the `kind` discriminator mapping:

```yaml
ExpenseDiaryEntry:
  type: object
  required: [kind, id, fieldId, seasonId, expenseDate, amount, currency, category, note]
  properties:
    kind: { type: string, const: EXPENSE }
    id: { type: string, format: uuid }
    fieldId: { type: string, format: uuid }
    seasonId: { type: string, format: uuid, nullable: true }
    expenseDate: { type: string, format: date }
    amount: { type: string, pattern: '^(?=.*[1-9])(?:0|[1-9][0-9]{0,17})(?:\.[0-9]{1,6})?$' }
    currency: { type: string, pattern: '^[A-Z]{3}$', description: Must also be present in the repository-pinned, versioned ISO 4217 code set. }
    category: { type: string, enum: [SEED_SEEDLING, FERTILIZER, PESTICIDE, FUEL, LABOR, IRRIGATION, OTHER] }
    note: { type: string, nullable: true }
```

The Expense variant MUST NOT define `occurredAt` or `recordedAt`. `expenseDate` is the entire occurrence-date value. The API does not manufacture a timestamp to fit the existing variants.

## Ordering and continuation

- Keep default-off behavior and existing v1 cursor semantics unchanged.
- For `includeExpenses=true`, return an opaque v2 cursor capable of representing the date-only mixed ordering key and bound to Field, optional Season, `includeIrrigation`, `includeExpenses`, resolved Business timezone, and the final ordering tuple. Reject cursor reuse across expense projection modes (`true` versus `false`).
- Sort by Business-local calendar date descending. For one date, timestamp-bearing events form a group ordered by their actual instant descending, then kind ascending and UUID descending on an exact time tie. Date-only Expense rows form a separate final group for that date, ordered by UUID descending.
- The mobile UI and API contract present timestamped and date-only groups separately under the same date heading. Expense rows display the date only and expose no occurrence timestamp. Group placement and row order do not claim an Expense happened before or after a particular event within that date.
- Cursor tuple: `localDate`, precision group, `occurredAt` only when the group is timestamped, `kind`, and source UUID. A cursor whose filters or timezone no longer match is rejected and the client restarts from the first page.
- Keyset pagination is deterministic for unchanged records and immutable ordering keys. It is not a fixed snapshot: new rows before a consumed cursor appear after refresh; a new row after it may appear on a later page.
- Field view includes both Season-linked and Field-only Expenses. Season filter includes only the selected Season's Expenses; null `seasonId` never matches.

## Compatibility and generation

The default query and legacy cursor path preserve current clients. The shared client generator continues to use SPEC-006 as the Diary schema source; regenerated clients gain the discriminated `EXPENSE` variant and the optional query parameter. Mobile consumers must branch on `kind` and must not read `occurredAt` from an Expense entry.
