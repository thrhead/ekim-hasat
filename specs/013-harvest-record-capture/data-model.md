# Data Model: Harvest Record Capture

**Feature**: [spec.md](./spec.md)
**Date**: 2026-10-26

## Harvest

One accepted, canonical historical fact that a measured quantity was harvested on a farmer-entered calendar day. Harvest owns the write model; Diary entries are projections of this row.

| Attribute | Required | Meaning / validation |
|---|---:|---|
| `id` / `harvestId` | Yes | Client-generated stable UUID for one online submission and exact retry; composite identity with `businessId`. |
| `businessId` | Yes | Server-derived authorized Business; never accepted from the client as authority. |
| `fieldId` | Yes | Field path identity, checked within the authorized Business. |
| `seasonId` | Yes | Required Season, checked for the same Business and Field. It must be `ACTIVE` for first acceptance. |
| `harvestDate` | Yes | Valid `YYYY-MM-DD` LocalDate, persisted as PostgreSQL `DATE`. On first acceptance it must not be after the authorized Business-local current date and must be on/after the Season's `actualPlantingDate`. No time or timezone is attached. |
| `quantity` | Yes | Exact positive decimal string, at most 11 integer digits and 3 fractional digits. Persist as exact PostgreSQL `NUMERIC` / Prisma Decimal; reject invalid syntax, excess scale, nonpositive values, or values `>= 100000000000`. Never use binary floating point or round. |
| `unit` | Yes | Stable code `KG` or `METRIC_TONNE`, selected per record. Retain the selected code; never convert or rewrite another record. |
| `actorUserId` | Yes | Verified application User who submitted the accepted record. |
| `actorMembershipId` | Yes | Current authorized OWNER or WORKER Membership used at acceptance. |
| `recordedAt` | Yes | Server UTC acceptance time, separate from `harvestDate`; audit provenance, not the event date. |

### Identity, relations, and constraints

- Composite primary key: `(businessId, id)`. A UUID collision in another Business is independent.
- `(fieldId, businessId)` references the owning Field.
- `(seasonId, businessId, fieldId)` references a Season in the exact same context.
- `(actorMembershipId, businessId, actorUserId)` references the membership actor context; membership status and role are revalidated when creating or replaying.
- New records require `Season.status = ACTIVE` in the create transaction. The Season row is protected against a concurrent state transition through the existing transactional locking approach.
- Database checks enforce `quantity > 0`, `quantity < 100000000000`, and `scale(quantity) <= 3`. Use unconstrained `NUMERIC` with checks so the column does not coerce excess scale before rejecting it.
- PostgreSQL stores `harvestDate` as `DATE`. Reuse the parameterized DATE binding/read-as-text boundary from SPEC-012; do not construct a JavaScript Date or UTC-midnight timestamp for this value.
- Add history indexes for `(businessId, fieldId, harvestDate DESC, id DESC)` and `(businessId, fieldId, seasonId, harvestDate DESC, id DESC)`.
- Restrictive relations plus a database append-only guard reject updates and deletes to accepted Harvests. No correction, void, or delete command is introduced.

## Domain values and validation

- `LocalDate`: reuse `@ekim-hasat/domain/seasons/local-date` and `validateLocalDate`; compare canonical date strings after validation without Date parsing.
- Business-local `today`: use the authorized Business timezone resolver and established fallback (`Europe/Istanbul`) solely for future-date validation. The Business timezone is not a second meaning for `harvestDate` and is not saved as an occurrence instant.
- Season lower bound: compare `harvestDate >= Season.actualPlantingDate`; equality is valid.
- `HarvestQuantity`: validate a decimal string without converting through `Number`; allow at most 11 integer digits and 3 fractional digits and require a value greater than zero. No exponent syntax, whitespace, leading plus sign, or unit conversion. Rejections are explicit; no rounding.
- `HarvestUnit`: finite domain union `KG | METRIC_TONNE`; labels may be localized in the mobile UI, stable codes are persisted.

## Create and replay behavior

1. Resolve verified user, active Membership, and role from the server. Permit OWNER and WORKER; reject ADVISOR. Recheck authorization inside the write transaction before any identity lookup or replay response.
2. Resolve the path Field inside the authorized Business. Resolve the required Season inside that same Business and Field. Missing or foreign resources use privacy-safe outcomes.
3. For an existing `(businessId, harvestId)`, compare actor/membership, Field, Season, `harvestDate`, exact quantity content, and unit. An exact match returns the original record and original `recordedAt`; any changed actor, payload, or context returns `409 IDEMPOTENCY_KEY_REUSED`. Exact replays remain replays if the associated Season later leaves ACTIVE; the state gate applies to first acceptance.
4. For a new ID, require ACTIVE Season and validate local future and planting-date boundaries and quantity/unit before writing. Insert the canonical row and `recordedAt` atomically. First acceptance returns 201.
5. The transaction locks the Business row before the identity lookup, serializing same-Business requests. The composite `(businessId,id)` unique key also protects identity; the serialized lookup and comparison yield one canonical row and deterministic replay/conflict outcomes.

The server's committed record is the only accepted state. Mobile holds the same ID and payload only in the active online form while the response is uncertain; it does not persist a local Harvest or queue it for later delivery.

## Field Diary projection

Add an `includeHarvests` opt-in to the existing Diary request. `HARVEST` is a projection of the canonical record, not a second persisted event.

| Attribute | Meaning |
|---|---|
| `kind` | Constant `HARVEST`. |
| `id` | Canonical Harvest ID, used for stable ordering/pagination. |
| `fieldId`, `seasonId` | Original canonical associations. |
| `harvestDate` | DATE-only occurrence date; no `occurredAt` or `recordedAt` field. |
| `quantity` | Exact decimal string from the canonical record. |
| `unit` | Original `KG` or `METRIC_TONNE` code. |

Field scope includes the Field's eligible accepted Harvests. A Season filter includes only that exact Season and is validated against the authorized Field and Business. Diary reads retain ordinary existing authorization for all eligible roles; no finance OWNER gate is added.

The Diary defaults `includeHarvests=false` to preserve older clients' event set and V1 cursors. The new mobile client opts in. When `includeHarvests=true`, the existing DATE-only V2 cursor is used and bound to Field, Season, `includeIrrigation`, `includeExpenses`, `includeHarvests`, and resolved Business timezone. Existing V2 cursors missing the new flag mean `includeHarvests=false`. In a Business-local day, timed events retain the existing instant-descending order; DATE-only Harvest/Expense entries follow the timed group and order by kind ascending then source UUID descending. No time is inferred for a Harvest.

## Explicitly absent

No sales/revenue, disposition, inventory, quality/grading, notes, expense allocation, profitability, unit conversion, offline command/outbox, generic event table, or independent Diary endpoint is introduced.
