# SPEC-005 Data Model

This is a planning model. Names below describe the intended migration and domain concepts; exact Prisma relation syntax and migration details are implementation work. Existing `FieldBoundaryVersion` and `SeasonContextSnapshot` records remain authoritative historical records.

## Field (existing, extended)

Business-owned current field state.

| Field | Type / rule | Notes |
|---|---|---|
| `id` | Existing stable ID | Used as final ordering tie-breaker. |
| `businessId` | Existing required FK | Always derived from authenticated membership scope. |
| `name` | Existing required string | Create input is optional; omitted or blank/whitespace-only input is trimmed and assigned a concurrency-safe `Tarla N`. On update, omission preserves the current value and explicit blank/whitespace-only input is invalid; no update-time generated-name allocation/reset. Nonblank input is trimmed; no uniqueness constraint on farmer names. |
| `representativePoint` | Existing PostGIS Point (4326) | Preserve SPEC-001 server-owned point semantics; for Polygon, use existing representative-point calculation. |
| `version` | Existing integer, incremented atomically | Field edit compare-and-swap token; exposed as ETag. |
| `currentBoundaryVersionId` | New nullable same-Field reference | Null means point-only current state; non-null identifies the current Polygon version. Migration backfills existing Fields with boundary rows using the pre-SPEC-005 selector `version DESC, id ASC`; Fields without boundary rows remain null. This pointer-only backfill preserves every boundary row and snapshot reference. |
| `currentRegionContextVersionId` | Nullable same-Field current-context pointer | Identifies current suggestions/override context when present. It may remain null for legacy Fields; null reads as explicit `UNRESOLVED` for both suggestions and no override. Migrations do not resolve, infer, or bulk-write region values. |

Current edits are limited to name, location/representative point, Polygon boundary, and agricultural-region override. Boundary and region pointers change in the same transaction as the Field version increment. No Field deletion/archive behavior is added.

Every additional Field create command requires `Idempotency-Key`. Persist its result in the generalized business-command idempotency store adapted from the existing Season command store, with uniqueness scoped to `(userId, businessId, command, key)` and a durable canonical result. Compute the payload fingerprint from the normalized create command and its server-derived authenticated/business/command context. An exact retry in the same context replays the stored result; reuse in that context with changed payload conflicts. A retry in another business or command context must never replay the first result. Concurrent same-key requests converge on one canonical Field and one result. Do not use the onboarding `IdempotencyRecord`: its `(userId, key)` uniqueness and required `fieldId` are incompatible. Keep onboarding's existing durable first-field completion/idempotency path unchanged. Field updates use the `Field.version` compare-and-swap through `If-Match`; this is independent of create idempotency.

## FieldBoundaryVersion (existing, constrained)

Immutable Polygon history for one Field.

| Field | Rule |
|---|---|
| `id`, `fieldId`, `version` | Existing identity. Preserve duplicate `(fieldId, version)` values already permitted by the repository; do not add a uniqueness constraint or rewrite legacy version numbers. |
| `geometry` | Existing Polygon geometry in the canonical SRID and validation rules. |
| `verificationStatus` | Existing status; creation remains unverified absent a real verification workflow. |
| `createdAt` | Existing server timestamp. |

Require current-pointer same-Field integrity. Polygon edits append the next version (`max(version) + 1`) while preserving legacy rows. Point-only transition clears the current pointer but preserves every prior boundary row. At migration, select the current boundary using the pre-SPEC-005 ordering `version DESC, id ASC`, including tied versions. After SPEC-005 is active, Season activation reads only `Field.currentBoundaryVersionId`; it does not query historical versions or fall back to version ordering.

## FieldRegionContextVersion (new, append-only)

One immutable snapshot of current automatic suggestions and the explicit farmer override for a Field location key.

| Field | Type / rule |
|---|---|
| `id`, `fieldId`, `version` | Stable ID, owning Field and monotonically increasing per-Field version; unique `(fieldId, version)`. |
| `resolutionLocationKey` | Hash/version identity for geometry inputs used by region resolvers. Includes canonical current Point and current Polygon boundary identity/geometry when present; does not reuse SPEC-004 weather fingerprint. |
| `administrativeState` | `RESOLVED` or `UNRESOLVED`; independent from agricultural result. |
| `administrativeCode`, `administrativeLabel` | Nullable normalized value; populated only when resolved. |
| `administrativeSourceId`, `administrativeDataVersion` | Required with resolved value; identify qualified dataset/source and immutable data version. |
| `administrativeConfidence` | Nullable normalized quality/confidence with documented scale; populated when resolved. |
| `administrativeResolvedAt` | Server UTC timestamp set when this resolver result is obtained and accepted; null while unresolved. It is not the dataset publication date. |
| `agriculturalState` | `RESOLVED` or `UNRESOLVED`; independent from administrative result. |
| `agriculturalCode`, `agriculturalLabel` | Nullable normalized suggestion, not the override. |
| `agriculturalSourceId`, `agriculturalDataVersion` | Required with resolved suggestion; separate provenance. |
| `agriculturalConfidence` | Nullable normalized quality/confidence with documented scale. |
| `agriculturalResolvedAt` | Server UTC timestamp set when this resolver result is obtained and accepted; null while unresolved. It is not the dataset publication date. |
| `overrideCode`, `overrideLabel` | Nullable explicit farmer choice. Null means no current manual override; clear is an explicit Field edit that appends a new version. |
| `createdAt` | Server UTC timestamp. |

Constraints: status/value/provenance must be coherent (resolved requires normalized value, source, data version, confidence/quality, and `resolvedAt`; unresolved has no active suggestion value or `resolvedAt`). Both suggestion streams may independently be resolved/unresolved. The effective agricultural region is the override when present, otherwise the current automatic suggestion if resolved, otherwise unresolved. A location edit creates an unresolved context for the new key while carrying the override forward. A later resolver result appends a new context version and never mutates the previous row. Enforce current-pointer same-Field integrity.

For a Field whose pointer is null, the API/read model projects a region context with both suggestions `UNRESOLVED` and no override; it does not create a synthetic persisted context row. The bounded server application operation can resolve one existing Field using its current representative point and `resolutionLocationKey`. It is idempotent for the same Field, location key, and source-data versions (no duplicate version on replay); it discards a result if the key is no longer current. It appends a same-Field context version when a valid result changes current state and carries any manual override forward unchanged. With no qualified source it leaves the Field unresolved. This applies equally to legacy Fields. Schema migration performs no resolver calls, guessed-region inference, bulk region writes, or required external-data backfill. SPEC-005 defines no scheduler, recurring cadence, or guaranteed whole-database backfill.

Operational lookup failures may be emitted as structured reason codes in logs/metrics; do not persist raw provider payloads or unnecessary raw coordinates. Do not claim `UNRESOLVED` means a real world region does not exist; it means no valid current result is available.

## SeasonContextSnapshot (existing, preserved)

Immutable activation-time context. Preserve existing snapshot values and immutability guarantees. Update the activation writer only for future activations; do not update, delete, rebind, or backfill any existing `SeasonContextSnapshot`. Never update snapshots from Field edit/resolution code. At every future activation capture:

- current `FieldBoundaryVersion` pointer, if present;
- a JSON/value snapshot of the current `FieldRegionContextVersion`, including independent administrative and agricultural suggestion states and values, each resolved suggestion's source, confidence/quality, `dataVersion`, and `resolvedAt`, plus the agricultural manual-override value and state when present. If the current region-context pointer is null, snapshot both domains as explicit `UNRESOLVED` with no override rather than storing an ambiguous absent context;
- existing SPEC-002 crop/template/context values.

The boundary ID in the snapshot is exactly the ID read through `Field.currentBoundaryVersionId`; null remains null, including when historical boundaries exist after a Polygon-to-Point transition. There is no activation-time fallback to `version DESC, id ASC` after SPEC-005. The snapshot refers to historical boundary versions that remain present even after the current Field becomes point-only. Existing same-Field checks and immutability guarantees continue.

## BusinessCommandIdempotencyRecord (existing Season command pattern, generalized)

Generalize `SeasonCommandIdempotencyRecord` rather than adding a third command-idempotency table. Rename its Prisma model/table and relations to `BusinessCommandIdempotencyRecord`, retain its `(userId, businessId, command, key)` uniqueness and durable JSON result, and support either a Season target or a Field target with an exactly-one-target constraint. The migration must preserve all existing Season command records and their replay results. Field create uses command `CREATE_FIELD`; Season create/activation keep their existing command identities and replay behavior. The onboarding `IdempotencyRecord` remains dedicated to SPEC-001 onboarding and is not used by Field create.

For Field create, acquire a transaction-scoped lock per authenticated user/key before lookup so concurrent attempts cannot pass context checking in parallel. Query retained command records for that user/key, then compare the authenticated user + server-resolved Business + command + key context before replay. The fingerprint covers normalized payload and context. An exact context/payload replays; any changed payload or context returns `IDEMPOTENCY_KEY_REUSED`, never another command's result. Do not add a global `(userId, key)` unique constraint that could invalidate retained Season records. Persist the canonical response atomically with Field creation and default-label allocation. Existing Season callers retain their established scoped behavior during the store generalization.

## ActiveSeasonSummary (read projection)

Not a new persisted entity. A small read-only projection from the existing `Season` with status `ACTIVE`, limited to approved farmer-facing season/crop/date values already available through the Season API contract. It is returned only in Field detail and has no mutation affordances.

## Core state transitions

| Operation | Current boundary | Region context | History |
|---|---|---|---|
| Create Point Field | Null | New context; resolvers independently resolve or remain unresolved | No boundary row. |
| Create Polygon Field | New version 1 pointer | Resolve using point plus Polygon geometry key; otherwise unresolved | Append boundary v1. |
| Polygon to Polygon edit | Append next historical version and point to it | Append unresolved context for new location key; carry override; later resolver appends result | Old boundary/context rows remain. |
| Polygon to Point edit | Clear pointer | Append unresolved context for new point key; carry override | Polygon rows remain. |
| Point to Polygon edit | Append `max(version)+1`, point to new row | Append unresolved context for new key; carry override | All prior rows remain. |
| Override set/clear | Unchanged | Append a version carrying current suggestions and updated explicit override | Prior region versions and Season snapshots remain. |
| Resolver result | Unchanged | Append a version only if result location key still matches current Field key; otherwise discard as stale | Prior versions remain. |
| Season activation | Read explicit current pointer (possibly null) | Snapshot current context | Snapshot is immutable. |

### Existing Fields and migration behavior

Existing Fields predating region-context persistence may keep `currentRegionContextVersionId = null` indefinitely. They remain valid for list, detail, edits, and all other normal Field behavior. Field detail represents the missing context as `UNRESOLVED`; the generic list does not require a region projection. This is a read-model state, not a fabricated database row. For the separate current-boundary pointer, migration backfills existing Fields with boundary history to the exact version selected by the pre-SPEC-005 season activation query (`version DESC, id ASC`); Fields with no boundary remain `NULL`. This does not create or rewrite a boundary and preserves all history and snapshot references. The additive schema migration does not call external sources or populate inferred region data. Once a qualified source is configured, an operator/application caller may invoke the bounded per-Field resolution operation. No scheduled or whole-database region backfill is part of this feature.
