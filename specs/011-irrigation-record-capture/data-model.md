# Data Model: Irrigation Record Capture

**Feature**: [spec.md](./spec.md)
**Date**: 2026-10-15

## IrrigationRecord

One accepted irrigation operation. It is canonical historical data owned by a Business and linked to one Field and, optionally, one Season.

| Attribute | Required | Meaning / validation |
|---|---:|---|
| `id` | Yes | Stable UUID generated for one create attempt and reused for an exact retry by the same actor. Unique within `businessId`; reuse by another actor or with changed payload/context conflicts. |
| `businessId` | Yes | Authorized owning Business, resolved by the API; never trusted from the request. |
| `fieldId` | Yes | Field path identity, verified in the authorized Business. |
| `seasonId` | No | Optional Season. When present, it must have this `fieldId` and `businessId`. No active-state requirement is added. |
| `actorUserId` | Yes | Authenticated application User at acceptance. |
| `actorMembershipId` | Yes | Active Membership used for authorization at acceptance; must match the actor and Business. |
| `occurredAt` | Yes | Absolute UTC instant resolved from the farmer's local date/time using the current Business timezone (fallback `Europe/Istanbul`). The server rejects future, ambiguous, nonexistent, or mismatched instants. |
| `method` | No | Farmer-entered method text; no catalog or controlled taxonomy. |
| `durationMinutes` | No | Optional positive whole number of minutes. |
| `waterVolumeCubicMetres` | No | Optional positive decimal cubic metres, with no more than one decimal place; persist as a decimal-safe database value. |
| `note` | No | Optional trimmed farmer note, using the existing observation text limit. |
| `recordedAt` | Yes | Server UTC timestamp when the canonical record is accepted; distinct from `occurredAt`. |

### Persistence and Constraints

- PostgreSQL is canonical; the schema and migration are owned by Prisma.
- Use the established composite tenant relationship pattern: `(businessId, fieldId)` references the owning Field; `(seasonId, businessId, fieldId)` references the optional Season; actor membership references the same Business and User.
- Use a composite primary/unique identity `(businessId, id)` so stable request IDs cannot collide across Business boundaries.
- Add a descending Field history index on `(businessId, fieldId, occurredAt, id)` and an appropriate Field/Season history index for optional Season filtering.
- Reject updates and deletes to accepted records with a database-level append-only guard, matching historical operation integrity.
- No relation or write is created for optional irrigation method, volume, or duration catalogs.

## Field Diary Projection

`IrrigationRecord` remains the single source of record data. The existing diary read projection adds an `IRRIGATION` entry only when the caller requests `includeIrrigation=true`.

| Attribute | Meaning |
|---|---|
| `kind` | Discriminator with the value `IRRIGATION`. |
| `id` | Canonical irrigation record UUID. |
| `fieldId` | Owning Field. |
| `seasonId` | Optional same-context Season. |
| `occurredAt` | Original absolute instant. |
| `method`, `durationMinutes`, `waterVolumeCubicMetres`, `note` | The optional accepted details, when supplied. |

The diary provides `businessTimezone` for display. Entries are merged with existing observations, task completions, and task skips in descending occurrence-time order; equal timestamps use the existing deterministic kind/ID tie-break. The cursor is bound to the Field, optional Season, and `includeIrrigation` filter so pages cannot be resumed under a different event set.

## Time and Create Flow

1. Mobile loads the authorized Field Diary's `businessTimezone` and defaults a local date/time input to now in that zone.
2. The online request carries the stable record ID, optional Season and details, local wall time, corresponding absolute instant, and the Business timezone used to compose it. Duration uses whole minutes; water volume uses cubic metres to at most one decimal place.
3. The API resolves current active membership, Field, optional Season, and current Business timezone in the authoritative transaction. It accepts only a unique local-time mapping that matches the submitted absolute instant and is not in the future.
4. It writes the record and server `recordedAt` atomically. An exact HTTP retry under current authorization returns the existing row; reuse with changed payload or context conflicts. The client holds retry state only in the active online flow; no durable local command or later reconciliation exists.
5. Mobile reports success only after server acceptance, then reloads the Field Diary with `includeIrrigation=true`.

No irrigation record is stored locally, cached for offline viewing, or queued for later delivery. The `IRRIGATION` diary event uses its own `IrrigationRecord` identity and is not represented as a FieldObservation or passed through observation command reconciliation.
