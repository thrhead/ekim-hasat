# Canonical Diary Contract Extension: Harvest

The existing Diary operation remains owned by [SPEC-006's OpenAPI contract](../../006-field-observations-basic-diary/contracts/observations-diary.openapi.yaml). Apply this additive amendment there during implementation. This note is design guidance, not a second Diary API definition.

## Query parameter

Add to `GET /fields/{fieldId}/diary`:

```yaml
- name: includeHarvests
  in: query
  required: false
  description: Include accepted date-only HARVEST entries. Uses the existing V2 date-only cursor; no additional role gate is applied beyond ordinary Diary authorization.
  schema:
    type: boolean
    default: false
```

The default is false to preserve older clients' event sets and the existing V1 cursor path. The new mobile client requests `includeHarvests=true` on first and continuation pages. Field and optional Season filters apply to Harvests exactly as they apply to other Diary sources.

## Authorized viewer metadata

Add optional response-level `viewerRole` metadata to the existing authorized `GET /fields/{fieldId}/diary` response, using the existing enum values `OWNER`, `WORKER`, and `ADVISOR`. The API derives it from the current authorized Membership scope resolved by `MembershipScopeService`; do not read auth-provider or app metadata. This role signal is for the mobile Harvest-create CTA only: OWNER and WORKER may see `Hasat ekle` when the other active-Season Diary context is eligible, while ADVISOR and a client with missing/unavailable `viewerRole` must not see it. It is not authorization; first acceptance and replay revalidate current Membership, role, Business, Field, and same-context Season access server-side. Only first acceptance requires an ACTIVE Season.

This is additive response metadata. It does not alter ordinary Diary record visibility, become part of `DiaryPage.items` or canonical Harvest data, affect V1/V2 ordering, cursor payload/bindings, or pagination semantics, expose provider metadata, or add a capability/RBAC endpoint or framework.

## `DiaryPage.items` union

Add `HarvestDiaryEntry` to the existing `oneOf` list and map `HARVEST` to it:

```yaml
HarvestDiaryEntry:
  type: object
  description: Projection of a canonical accepted Harvest. harvestDate is a calendar date only; no time-of-day is known or implied.
  required: [kind, id, fieldId, seasonId, harvestDate, quantity, unit]
  properties:
    kind: { type: string, const: HARVEST }
    id: { type: string, format: uuid, description: Canonical Harvest ID used for ordering and pagination. }
    fieldId: { type: string, format: uuid }
    seasonId: { type: string, format: uuid }
    harvestDate: { type: string, format: date }
    quantity: { type: string, description: Exact positive decimal string; no binary floating point. }
    unit: { type: string, enum: [KG, METRIC_TONNE] }
```

Do not add `occurredAt`, `recordedAt`, a synthetic time, actor details, or a duplicate Diary record. The projection sources these values from the canonical Harvest and omits neither the original Field/Season identity nor selected unit.

## Pagination and compatibility

- Keep the existing projection and V1 cursor behavior unchanged when `includeExpenses=false` and `includeHarvests=false`.
- Use the existing date-only V2 cursor when either `includeExpenses=true` or `includeHarvests=true`. Bind it to Field, optional Season, `includeIrrigation`, both `includeExpenses` and `includeHarvests`, resolved Business timezone, precision group, and the final ordering tuple.
- Extend the cursor's include flags without invalidating SPEC-012 V2 cursors: if an older V2 cursor has no `includeHarvests` property, interpret it as `false`. Newly emitted cursors include both flags. Reject a cursor reused under different inclusion flags or other existing bindings.
- Within each Business-local day, timestamp events keep the existing instant-descending order, then kind ascending, then source UUID descending for equal instants. DATE-only entries follow timestamp events and order by kind ascending, then source UUID descending. With Expenses enabled and Harvests disabled, existing Expense-only ordering is unchanged.
- Continue each source query strictly after the full global ordering tuple and merge a bounded number of candidates using the existing keyset paginator. For date-only entries, the tuple is `(localDate, precision=DATE_ONLY, kind, source UUID)`; the cursor comparison must include both kind and UUID when Harvest and Expense are mixed. This is not snapshot isolation: records that existed before traversal starts are not repeated or permanently skipped; an insertion during traversal that sorts before the consumed cursor is not injected and appears after a fresh traversal/refresh, while one sorting after the cursor may appear on a later page. Immutable source ordering keys preserve strict continuation.
- Harvest is available under existing ordinary Diary read authorization. Do not impose the Expense OWNER gate on Harvest reads or add a capability/RBAC endpoint.

## Generated client

During implementation, regenerate `packages/api-client/src/generated/observations-diary-api.ts` from the amended SPEC-006 contract. The generated `HARVEST` discriminated union member, `includeHarvests` query type, and optional response-level `viewerRole` are the shared API surface for mobile and API consumers; do not hand-edit generated types.
