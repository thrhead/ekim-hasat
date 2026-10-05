# Research: Field Observations and Basic Diary

## Repository findings

- SPEC-002 establishes Field-to-Season ownership and server-derived Business context. SPEC-005 reuses the current membership-scope authorization path and preserves existing season context.
- SPEC-003 `TaskCompletion` is append-only canonical history with `occurredAt`, server `recordedAt`, task/season/field/business provenance, and stable task/date snapshots. Its field history API filters optionally by Season and orders by `(occurredAt DESC, id DESC)` with a default 50 / maximum 100 keyset page.
- SPEC-003 mobile persistence and retry are explicitly completion-specific. SPEC-006 observation creation is online-only and must not touch that store or generalize it.
- The OpenAPI generator maps feature contracts into generated API-client paths and schemas. Mobile callers use the generated `openapi` client.
- API modules are composed in the existing Nest application. Membership-scoped reads use server-resolved active Business membership and privacy-safe 403/404 behavior.
- SPEC-005's approved navigation places Tarlalar in the primary navigation. The smallest fitting entry point is a diary action within the existing Field detail context, with a Season-filtered view reachable from that Field/Season context. Do not implement Quick Add itself or alter unrelated navigation destinations.

## Decisions

### Observation identity and idempotency

- **Decision**: The client generates one UUID for a create attempt and sends it as `observationId`. The UUID is the canonical primary key and retry identity, following SPEC-003's client-generated completion identity pattern. Persisted content includes `fieldId`, nullable `seasonId`, `businessId`, actor user and membership IDs, description, `occurredAt`, and server-assigned `acceptedAt`. Persist a canonical payload fingerprint or equivalent immutable request comparison so the same identity with changed content conflicts.
- **Rationale**: Connectivity is required, but a response can be lost after commit. Stable identity safely handles exact online retry without adding an offline queue. Persisting actor and membership context follows SPEC-003's audit practice; those fields are never client authorization claims.
- **Alternatives considered**: Server-only generated ID cannot resolve an uncertain create retry without a separate idempotency ledger. Adding a separate idempotency header or general framework would duplicate the stable observation identity for no gain. The observation's own stable ID and unique constraint are sufficient for this single command.

### Field and Season semantics

- **Decision**: Every observation belongs to exactly one Field. `seasonId` is nullable and immutable; a supplied Season must be owned by the same Field and Business at acceptance. Field diary reads include all observations for that Field, including those with no Season and those associated with any Season. A Season-filtered diary includes only observations with that Season and completions from that Season. A Field without a relevant Season still has a usable Field diary and can accept observations with `seasonId = null`.
- **Rationale**: This implements the spec's optional association without silently assigning the current/active Season or hiding unseasoned notes.
- **Alternatives considered**: Automatically choosing the active Season would make optionality misleading and could rewrite farmer intent. Requiring a Season contradicts FR-002.

### Occurrence and acceptance instants

- **Decision**: Store/transport `occurredAt` as RFC 3339 date-time with an explicit offset, normalized to an absolute UTC instant. The mobile default is the current instant; a chosen earlier date/time is converted to an instant before submission. The server rejects a value later than its current UTC time, validates it again at acceptance, and stamps `acceptedAt` from server UTC. Render occurrence time using the already resolved Business timezone and SPEC-003 convention. `acceptedAt` is audit metadata, not a normal diary-row field.
- **Rationale**: The spec defines occurrence as an absolute instant and delegates display zone to the existing Business-timezone convention. Input offset preserves an unambiguous instant regardless of device zone.
- **Alternatives considered**: Store a local date/time or use device-local text without an offset would be ambiguous across zones and DST. Use of server acceptance time as occurrence would corrupt historical meaning.

### Mutation lifecycle

- **Decision**: Accepted observations are append-only in SPEC-006. No edit/delete API or UI is added. A correction is a new observation. Referential/provenance constraints preserve the original Field/optional Season association and content; Field name/geometry or later Season context edits do not update observation snapshots or foreign keys.
- **Rationale**: Matches FR-013 and the constitution's historical-integrity rule. Current records are stable IDs; rendering should use persisted IDs and immutable observation values, not reconstruct season membership from current context.
- **Alternatives considered**: Editing/deletion would need audit and correction semantics not in the approved scope.

### Diary projection, ordering, and pagination

- **Decision**: Add a focused diary query/application service that reads bounded candidate rows from the observation table and existing TaskCompletion source, then merges them in memory. Do not copy completions or write a generic diary/event table. Canonical global order is `occurredAt DESC`, then `sourceKind ASC` (`OBSERVATION` before `TASK_COMPLETION`), then source UUID DESC. Use a versioned opaque keyset cursor containing scope (`fieldId`, nullable `seasonId`) and the last tuple `(occurredAt, sourceKind, id)`; reject malformed or scope-mismatched cursors. Default page size 50, maximum 100; fetch up to `limit + 1` candidates from each source, merge/sort, return the first `limit`, and emit a cursor from the final returned item only when another item exists. Apply the same strict tuple-after predicate to each source on the next request.
- **Rationale**: The existing completion endpoint has a completion-only cursor, which cannot represent a cross-source page boundary. A shared projection cursor is necessary for no-gap/no-duplicate pagination. Per-source indexed keyset reads bound database work while preserving each canonical source.
- **Alternatives considered**: Concatenating two independently paged endpoints can skip/duplicate records at mixed-source boundaries. Offset pagination is unstable under concurrent inserts. Copying to an event store duplicates history and is explicitly rejected.
- **Boundary behavior**: New entries with tuples ahead of the cursor may appear on a later refresh from page one; they do not shift already paged older entries. Stable tie-breakers guarantee deterministic repeated reads for a fixed dataset.

### Authorization and privacy

- **Decision**: Authenticate first; resolve the current default Business scope via the established `MembershipScopeService`; require an active membership; then query Field and optional Season constrained by the resolved Business and Field. Every observation and diary query includes Business/Field scope and revalidates membership. Use the existing safe 403 for no usable Business membership and 404 for missing/out-of-scope Field, Season, or observation; never distinguish another Business's resource from a missing resource.
- **Rationale**: Follows ADR-009 and accepted SPEC-001/003/005 practice. No client-supplied business ID or stale mobile context grants authorization.
- **Alternatives considered**: Trusting a client Business ID or exposing resource-specific errors would violate tenant isolation/privacy rules.

### Migration and module boundaries

- **Decision**: Add one additive Prisma migration for `FieldObservation`, constraints, and indexes for Field/Season keyset reads. Follow existing `Season` and `TaskCompletion` composite relations so Business/Field/Season consistency is enforced by database foreign keys as well as authorization queries. Do not alter existing `TaskCompletion` rows, indexes, migration ownership, or offline tables. Implement create and diary query in a focused API observations module, composed in existing Nest bootstrap. The projection service will get bounded completion candidates through a new read method on the existing TaskCompletion repository and observation candidates through the new observation repository. No new domain package or change to SPEC-003's completion-only history is needed.
- **Rationale**: Smallest architecture consistent with PostgreSQL canonical state and Prisma migration ownership. The diary projection coordinates reads but does not own task completion persistence.
- **Alternatives considered**: Modifying TaskCompletion to make it polymorphic, introducing an event store, or creating a separate service violates scope/boundaries.

### API and generated client

- **Decision**: Add a SPEC-006 OpenAPI source contract and map it in the existing API-client generator. Define an online `POST /fields/{fieldId}/observations` create and `GET /fields/{fieldId}/diary` read with optional `seasonId`, `cursor`, and bounded `limit`. Request fields are stable `observationId`, required description, absolute `occurredAt`, and optional `seasonId`; no Business ID. Diary entries are a discriminated union of Observation and TaskCompletion projection items with a common order tuple, source-specific presentation fields, Business timezone, and next cursor. Do not change SPEC-003 completion/history contract. Generate and commit client artifacts during implementation.
- **Rationale**: Field-scoped paths align with authorization and the existing API. A single mixed-source read contract supports correct pagination and avoids mobile-side merging of differently paginated endpoints.
- **Alternatives considered**: Separate API calls cannot provide one deterministic paginated timeline. Handwritten transport types would diverge from OpenAPI.

### Mobile integration

- **Decision**: Add a text-first observation form and Field diary screen/section under existing Field detail navigation; provide Season filter/context through the existing Season association. Keep optional Season selection contextual and do not require it where no Season exists. Use generated API-client operations. Add explicit loading, empty, validation, save-in-progress, retryable error, and accepted states with accessible labels/announcements and scalable text. On uncertain create response, retry the exact `observationId`, key, and payload; never show it as accepted until server confirmation. No durable local outbox.
- **Rationale**: Uses the approved Tarlalar/Field context, respects farmer-first defaults and mobile completeness, and satisfies online-only creation.
- **Alternatives considered**: A new top-level navigation destination or implementing a broad Quick Add flow exceeds SPEC-006.

## Deferred decisions and out of scope

- Observation category/taxonomy, photos/attachments, AI/risk/diagnosis, notifications, sharing/advisors, weather/task changes, finance/harvest/sales, Calendar, and active-season task mutation are excluded by SPEC-006.
- Offline observation creation and any generalized sync/outbox are deferred to a later bounded feature; SPEC-003's completion-specific behavior remains unchanged.
- Edit/delete, soft-delete, undo, and correction-link semantics are deferred; SPEC-006 corrections are separate append-only observations.
- No cross-field, global, or business-wide diary is added.
- No generic event store, audit service, worker, or event bus is required absent an in-scope consumer.
- Any future display of actor identity, acceptance timestamp, categories, or historical Field/Season labels requires a separate product decision; these are not normal diary-row additions here.

## Architectural uncertainty

None remains for this SPEC-006 planning boundary. The existing Prisma schema already uses composite Business/Field/Season relations for Season and TaskCompletion; implement FieldObservation constraints using that established pattern.
