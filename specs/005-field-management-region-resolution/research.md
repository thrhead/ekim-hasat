# SPEC-005 Research and Decisions

## Summary

The repository already has server-owned Field geometry and representative-point rules, Business-scoped authorization, season activation snapshots, weather location fingerprints, and a provider-neutral mobile map adapter. It does not have generic Field management APIs or a region resolver. The decisions below fill the technical gaps without changing SPEC-001..004.

## R-1: Region source strategy and Türkiye coverage

**Decision**: Define independent provider-neutral ports for administrative-location resolution and agricultural-region resolution. Prefer authoritative, versioned Turkish geospatial data, imported or otherwise made available as immutable dataset versions behind server adapters. Do not make the product or domain model depend on a named vendor API. Do not call a live third-party provider as a required step in Field create/edit. Each resolver returns a valid result with provenance or an explicit unresolved outcome. Coverage target is all of Türkiye, as clarified in the product spec; unsupported, missing, stale, invalid, or inaccessible coverage remains unresolved.

**Rationale**: Official source material identifies plausible inputs, but public availability does not prove a production-ready nationwide point-query API, data license, complete administrative granularity, stable IDs, or data-version guarantees. TUCBS lists the Ministry of Interior's General Directorate of Provincial Administration as responsible for “Administrative Units”; the TUCBS responsibility matrix also governs access by data-sharing permissions. The Ministry's TGSKCBS description identifies agricultural ecological-region mapping based on climate, soil, topography, and vegetation. It does not establish an operational nationwide query interface or the complete provenance contract required here. TÜİK's IBBS/NUTS classification covers 81 provinces through 26 and 12 statistical regions, but is explicitly a statistical classification and is not an agricultural-region substitute.

**Alternatives considered**:
- Hard-code a public geocoding vendor: rejected because it would bind product behavior to a provider without an existing ADR, verified coverage, terms, or source-version contract.
- Use TÜİK IBBS regions as agricultural regions: rejected because statistical regions do not establish agronomic meaning.
- Resolve against live external APIs in the Field write transaction: rejected because outages/latency would couple core Field writes to an external service and conflict with the accepted unresolved-on-failure requirement.
- Claim all-Türkiye coverage based only on a public map page: rejected because map visibility does not establish legal or operational point-query coverage.

**Research conclusion / uncertainty**: The product coverage target is all Türkiye, but feasibility for a production agricultural-region resolver is not fully demonstrated by available public evidence. Before implementation enables automatic agricultural-region suggestions, qualify a dataset for nationwide coverage, license/terms, stable class identifiers, update/version policy, coordinate reference handling, and confidence/quality semantics. If no source passes, ship the Field workflows with agricultural-region suggestions explicitly unresolved; do not invent values. Administrative-location data must receive the same access/coverage/version qualification.

**Sources**:
- [TUCBS National Geographic Data Responsibility Matrix](https://tucbs.gov.tr/ulusal-cografi-veri-sorumluluk-matrisi/) — identifies the responsible agency and data-sharing matrix.
- [TUCBS portal](https://tucbs.gov.tr/) — national geospatial-data access and sharing context.
- [Ministry of Agriculture TGSKCBS coverage and data briefing](https://arastirma.tarimorman.gov.tr/toprakgubre/Haber/422/Tgskcbs-Uygulama-Kapsami-Ve-Veri-Bilgilendirmesi) — describes agricultural ecological-region mapping inputs.
- [TÜİK regional classification data browser](https://veriportali.tuik.gov.tr/tr/databrowser/tuik/categories/11/11_1/11_1_1/TR,DF_ADNKS_T22,1.1) — describes statistical region classification, not agricultural zoning.

## R-2: Resolver abstraction and provenance

**Decision**: Keep two independently callable domain ports, `AdministrativeLocationResolver` and `AgriculturalRegionResolver`. Inputs are the relevant current location geometry, a stable location key, and an active dataset reference. Outputs are typed `resolved` or `unresolved`; a resolved value includes canonical code, farmer display label, source identifier, source-data version, confidence/quality value with its defined scale, and `resolvedAt`, a server UTC timestamp set when the resolver result is obtained and accepted. `resolvedAt` is not the source dataset publication date. Administrative and agricultural results carry separate provenance and may resolve independently. Adapter payloads are normalized before reaching application/domain code.

When a Field edit changes location/boundary, the current context becomes unresolved for the new location key immediately, while preserving the manual agricultural-region override. A subsequent lookup against an installed qualified dataset can append a resolved context version. A source/version mismatch or invalid geometry cannot masquerade as a current result. Resolver failure is recorded as unresolved with an operational reason code suitable for logs; avoid storing raw provider responses or unnecessary raw coordinates.

**Rationale**: The spec requires distinct values, source/confidence/data version, and failure isolation. A local/versioned dataset lookup can be deterministic and available without a live provider. Separate ports allow administrative and agronomic datasets to evolve independently.

**Alternatives considered**: One combined provider response was rejected because the two values have different sources and can resolve independently. Persisting vendor JSON was rejected because it leaks external schemas into the domain and complicates provenance/versioning.

## R-3: Persisting current region and override history

**Decision**: Add append-only `FieldRegionContextVersion` records and a nullable current-context pointer on `Field`. Each version is keyed to a `resolutionLocationKey` and stores independent administrative and agricultural suggestion state/provenance plus the farmer's explicit agricultural override as of that version. Keep override identity separate from suggestion identity. An override set/clear appends a new current context version under Field optimistic concurrency. A location/boundary change appends an unresolved context for its new location key and carries forward the current explicit override unchanged. Resolver output appends a later context version for the same location key; it never modifies an older row. Constrain pointers and references to the same Field.

**Rationale**: This gives current Field state and later resolution updates an auditable version boundary, supports partial results, and provides a stable region payload for a season activation snapshot. It ensures that a location change cannot display a previous location's suggestion as current while the manual override remains active.

**Alternatives considered**: Mutable suggestion columns on `Field` were rejected because they lose prior provenance and create races with concurrent edits/resolution. A single unversioned JSON blob was rejected because independent suggestion states and same-Field integrity would be harder to enforce.

## R-4: Boundary currentness and history

**Decision**: Add nullable `Field.currentBoundaryVersionId`, constrained to a boundary row belonging to that Field. It identifies the current Polygon regardless of `verificationStatus`; an `UNVERIFIED` current Polygon remains current and the pointer does not claim verification. Do not add uniqueness on `(fieldId, version)`: the existing repository permits duplicate values and the old activation selector explicitly resolves ties by `id ASC`. `NULL` means the Field is currently point-only and has no current Polygon boundary. Polygon creation/edit appends a new immutable `FieldBoundaryVersion` and points the Field at it in the same transaction. Polygon-to-point transition clears only the current pointer and updates the representative point; it does not delete or rewrite any boundary version. A later Polygon gets `max(historical version) + 1`. Polygon-to-Polygon creates a new version and updates the pointer.

**Existing-Field migration and future activation**: Before SPEC-005, season activation selects the effective boundary with `orderBy: [{ version: "desc" }, { id: "asc" }]` in `apps/api/src/seasons/seasons-activation.repository.ts`. Migration MUST backfill `currentBoundaryVersionId` for each Field with boundary history to the exact row selected by that same ordering, including tied version values. Fields with no boundary rows remain `NULL`. Do not add uniqueness on `(fieldId, version)`, rewrite version numbers, or otherwise alter a legacy boundary row. This is only a pointer backfill: it creates no Polygon, changes no geometry or history row, and leaves all `SeasonContextSnapshot` references untouched. After SPEC-005 is active, every new Season activation reads only `Field.currentBoundaryVersionId` and snapshots that exact pointer value; it must not query or fall back to version ordering. Migration and activation integration tests verify these rules against the writable `ekim_hasat_test` database.

Season activation must select the Field's explicit current-boundary pointer, not the highest historical version. For a point-only Field it snapshots no boundary version, even if older Polygon versions remain. Existing snapshot foreign keys continue to reference their historical version.

**Rationale**: Currentness cannot be inferred from maximum version once a Polygon is removed from the current location state. Explicit current identity models Polygon-to-point transitions without destroying history.

**Alternatives considered**: A mutable `isCurrent` flag on version rows was rejected due to two-current-row and no-current-row races; selecting the highest version is incorrect after Polygon-to-point transition.

## R-5: `Tarla N` allocation

**Decision**: Allocate the first currently available positive integer suffix only for Field creation with an omitted or blank/whitespace-only name, inside the authorized Business's Field-create transaction while serializing allocators on the Business row (or an equivalent per-Business counter row if later evidence justifies it). Scan exact generated labels `Tarla 1`, `Tarla 2`, … and choose the smallest label not currently assigned to a Field, then insert before releasing the lock. An exact idempotent retry returns the original create result and does not allocate again. On update, omitted `name` leaves the current name unchanged; a supplied blank/whitespace-only name is rejected; no ordinary update allocates a generated name. Do not impose uniqueness on nonblank farmer-entered names. Continue persisting a non-null normalized name.

**Rationale**: A per-Business lock plus existence check provides concurrency safety and selects the first available suffix even when labels have gaps. A max-plus-one or count-based allocator is race-prone and does not meet “first available.”

**Edge behavior**: If a farmer-entered display name happens to equal an available generated label, that label is occupied at allocation time. Existing duplicate names remain valid. A nonblank rename can make an exact generated label unavailable to later creates; deletes remain out of scope.

## R-6: Stable cursor ordering

**Decision**: Use the tuple `(name, id)` as the opaque cursor. Query only the server-authorized Business and apply `name > cursor.name OR (name = cursor.name AND id > cursor.id)`, ordered `name ASC, id ASC`, with `limit + 1` to determine continuation. Default to 50 and cap at 100. Validate cursor shape and reject malformed cursors. Do not add search/filter predicates or a query fingerprint. A rename can move a row across page boundaries; as the spec says, the farmer restarts to see the new order.

**Rationale**: This matches the existing weather repository's deterministic keyset pattern while providing a generic Field projection. ID provides a unique tie-breaker for duplicate farmer-entered names.

## R-7: Field optimistic concurrency

**Decision**: Use the existing `Field.version` as a compare-and-swap token for every Field edit. Expose it as an ETag and require `If-Match` on `PATCH`. Within one transaction, scope by Field ID and authorized Business and perform conditional update where `version = expectedVersion`, incrementing version atomically. If no row matches, return the existing API conflict shape with HTTP 409 `STALE_VERSION`; do not read-then-unconditionally-write. Boundary pointer/version and region override updates participate in the same optimistic concurrency boundary.

**Rationale**: Season activation already uses `If-Match` and version comparison; this prevents lost updates and fits existing REST behavior. A client cannot overwrite a newer name, location, boundary, or override state from stale detail.

**Mobile recovery**: A stale `If-Match` response uses the existing HTTP 409 `STALE_VERSION` semantics. The client makes no automatic retry or overwrite. It reads the latest canonical Field, preserves attempted edit values in the active edit-session state, and presents the conflict and newly loaded state. The farmer must explicitly choose an action before another mutation. There is no automatic merge or rebase of concurrent Field, location, boundary, or region changes.

## R-7a: Existing-Field region resolution

**Decision**: The server application boundary exposes a bounded operation for resolving one existing authorized Field against its current representative point and current region-resolution location key. The operation is idempotent for the same Field, location key, and qualified source-data versions: repeating it does not append duplicate context versions, and a result for a no-longer-current location key is discarded. Resolution records use the same source, quality, data-version, and server `resolvedAt` provenance as create/edit resolution. Existing explicit agricultural-region overrides are carried forward and never replaced. If a qualified source is unavailable, the operation leaves the Field unresolved. This is an application operation, not a new public endpoint or recurring job.

**Existing data and migration**: A database/schema migration never calls an external resolver, infers a region, or bulk-writes guessed or resolved administrative/agricultural values. Existing Fields with a null region-context pointer remain valid; reads project both suggestions as `UNRESOLVED` and the override as absent. No external-data backfill is required in migration. Once qualified data is configured, the bounded operation may be invoked operationally for selected existing Fields; there is no scheduler, cadence, or guaranteed database-wide backfill in SPEC-005. Same-Field pointer constraints apply whenever a context pointer is present.

**Rationale**: Keeps schema deployment independent of external data availability, preserves existing records without fabricated certainty, and provides an operational path that applies the same provenance and override contract to pre-existing Fields.

## R-7b: Accessible asynchronous status changes

**Decision**: Keep status/result/error/conflict/unresolved text visibly available. Meaningful asynchronous changes on a screen that remains open use a screen/form-level announcement path when focus alone does not communicate the change. This includes save success/failure/conflict and asynchronous region-resolution result/unavailable transitions. Deduplicate announcements by meaningful transition identity; repeated renders, polling-like updates, and child components do not announce independently. Use the repository's React Native accessibility roles/live regions and corresponding web semantic live-region conventions where applicable. Never rely on color alone. These are specification requirements, not claims of physical VoiceOver or TalkBack validation.

## R-8: Historical seasons and active summary

**Decision**: Field mutations and region resolution never update, delete, or rebind any existing `SeasonContextSnapshot`. Change only the writer for future activations. Every future activation snapshots the exact `Field.currentBoundaryVersionId` (including null), the current administrative and agricultural region values/states, and each resolved suggestion's source, confidence/quality, `dataVersion`, and `resolvedAt`, plus agricultural manual-override value/state when present. If the current region-context pointer is null, serialize both domains as explicit `UNRESOLVED` with no override. It does not use the old version-order selector after migration. Keep existing database immutability triggers and same-Field boundary FK; add/adjust constraints only as required to store the activation-time region JSON without weakening immutability. Field detail may query a small read-only projection of the `ACTIVE` Season (status and farmer-facing crop/season dates already exposed by the Season contract); it does not reuse setup/activation payloads or expose mutation routes.

**Rationale**: Preserves SPEC-002 history and avoids expanding season lifecycle scope. Current Field state can change independently of what the farmer's active season was based on.

## R-9: SPEC-004 weather validity

**Decision**: Field updates change the canonical representative point only through existing Field geometry rules. Do not rewrite weather snapshots, cache keys, saved season context, or SPEC-004 fingerprints. Existing weather reads compare the stored weather fingerprint to the current representative point and return unavailable for data tied to an old point. Existing refresh lock/recheck behavior remains in place. Keep weather representative-point semantics separate from the agricultural-region resolution location key; the latter must account for Polygon geometry/version as well as the Point so a changed agricultural boundary triggers region resolution even if the representative point is unchanged.

**Rationale**: Weather is point-based per SPEC-004, while region suggestions can depend on the Polygon. Reusing the weather fingerprint for polygon resolution would miss boundary-only edits.

## R-10: API, client, map, authorization reuse

**Decision**: Add a dedicated API Fields module and versioned REST endpoints documented in a new SPEC-005 OpenAPI source contract. Use current membership scope on every request; no client Business ID. Generate transport types/client into the existing API-client package. Main Agent owns runtime composition in `apps/api/src/main.ts` and shared module wiring: provide Fields routes, provider-neutral resolver ports, bounded existing-Field resolution, and an unavailable resolver whenever no qualified provider is configured. Provider payloads remain behind the resolver abstraction. Mobile calls only the API and reuses the existing provider-neutral Point/Polygon map adapter. Keep first-Field onboarding endpoints and semantics unchanged. For Field create, generalize the existing Season command idempotency store into `BusinessCommandIdempotencyRecord` with `(userId, businessId, command, key)` scope, a canonical durable result, and Field/Season target support; retain Season replay behavior and do not reuse the onboarding `(userId, key)` / required-`fieldId` store. Serialize Field create key lookup per authenticated user/key; any changed payload or authentication/Business/command context conflicts rather than replaying another result. Do not add a global `(userId, key)` uniqueness constraint that could invalidate retained Season records. Update uses `Field.version` / `If-Match` for optimistic concurrency; the update precondition is separate from create idempotency. No offline outbox or local Field mutation is added.

**Rationale**: Keeps authorization and geometry authoritative on the server, avoids duplicate transport types, and minimizes divergence from onboarding and Season API contracts.

## R-11: Production mobile navigation

**Decision**: Register Tarlalar in the existing production app composition at the approved navigation position `Bugün | Takvim | Tarlalar | + | Daha Fazla`. Its entry opens the Field list, list selection opens detail, and add-field starts from Tarlalar. Preserve all unrelated route meanings; this task adds no Calendar workflow and does not redesign navigation. Main Agent owns route/composition integration because the production composition is shared state.

## ADR assessment

No ADR change is required to define the provider-neutral boundary, versioned context, and unresolved fallback in this feature plan. **Do not change ADR-012**; weather-provider selection remains deferred. If implementation research later selects a source with durable licensing, operational, or data-governance implications, record the source decision in a separate ADR before wiring it into production. The research did not establish a provider that can safely be selected now.
