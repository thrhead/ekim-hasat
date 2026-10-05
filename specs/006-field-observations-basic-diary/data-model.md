# Data Model: Field Observations and Diary

PostgreSQL is canonical and Prisma owns schema changes. An observation is a new operational record. A diary entry is a read projection over observations and existing accepted TaskCompletion records; it is not persisted as a separate entity.

## FieldObservation

One accepted farmer-authored account about one Field.

| Field | Meaning |
|---|---|
| `id` | Client-generated UUID; also the stable online create retry identity. |
| `businessId` | Server-derived owning Business. Never accepted from the request. |
| `fieldId` | Required owning Field. |
| `seasonId` | Nullable association to a Season of the same Business and Field. Null is valid when no relevant Season is selected/available. |
| `actorUserId` | Authenticated application user who submitted the accepted observation. |
| `actorMembershipId` | Active membership authorizing acceptance. |
| `description` | Required trimmed non-whitespace Unicode text, at most 2,000 characters. |
| `occurredAt` | Farmer-recorded absolute instant, stored in PostgreSQL timestamp-with-time-zone semantics and normalized to UTC. Must be no later than server acceptance/current time. |
| `acceptedAt` | Server-assigned UTC acceptance/audit instant, distinct from `occurredAt`. |
| `payloadFingerprint` | Canonical immutable request fingerprint used to distinguish an exact retry from identity reuse with changed content. |

### Integrity and lifecycle

- `id` is unique and stable; the exact same authorized actor/context and payload can replay the committed result after a lost response. Reusing the ID with changed payload conflicts and does not mutate the row.
- Business, Field, Season, actor, and membership references are persisted consistently. A supplied Season must match the row's Field and Business; use schema-supported composite constraints plus authorization-scoped validation.
- The row is append-only in SPEC-006. No update/delete command exists. A correction creates a new row.
- Field or Season display/context updates never change the observation's description, occurrence time, or association. Do not cascade-delete accepted observations with current Field/Season changes; follow existing protected-history FK policy.
- Index Field diary reads by `(businessId, fieldId, occurredAt DESC, id DESC)` and Season-filtered reads by `(businessId, seasonId, occurredAt DESC, id DESC)`. Add only constraints/indexes needed for scoped reads and idempotency.

## Existing TaskCompletion

SPEC-003 remains the canonical completed-work record. The diary reads accepted rows using existing `occurredAt`, stable task title/planned date snapshots, plan provenance, IDs, and Season/Field/Business relationships. Its server `recordedAt` remains audit metadata and is not substituted for occurrence time. No TaskCompletion rows are copied, transformed into storage, or mutated by this feature.

## DiaryEntry (projection only)

Returned API representation is discriminated by `kind` (`OBSERVATION` or `TASK_COMPLETION`) and includes the source record identity, Field/Season context, absolute `occurredAt`, and source-specific details. Observation entries expose description; completion entries retain the SPEC-003 task title, planned local date, and plan provenance. The response includes the resolved Business timezone for rendering. Observation `acceptedAt` and completion `recordedAt`/actor attribution are excluded from normal farmer-facing rows.

For a Field query, include every observation for that Field (including `seasonId = null`) and every accepted completion for that Field. For a Season-filtered query, include only rows with the requested Season ID. Validate that the Season belongs to the authorized requested Field and Business before returning a page.

## Ordering and pagination

Sort globally by `occurredAt DESC`, `kind ASC` (`OBSERVATION` before `TASK_COMPLETION` at equal instants), then source UUID DESC. The cursor is opaque/versioned and bound to Field, optional Season, and the last complete ordering tuple. The default limit is 50; maximum is 100. Read bounded keyset candidates from both sources, merge, and return at most `limit` items. The continuation predicate is strict, preventing repeats at an equal-time/source boundary. Offset pagination is not used.

## Relationships

```text
Business 1 ── * Field
Field 1 ── * Season
Field 1 ── * FieldObservation
Season 0..1 ── * FieldObservation
Business 1 ── * FieldObservation
ApplicationUser 1 ── * FieldObservation (actor)
Membership 1 ── * FieldObservation (accepting scope)
PlannedTask 1 ── 0..1 TaskCompletion (existing SPEC-003)
DiaryEntry ── projection of FieldObservation OR TaskCompletion
```
