# Research: Weather Context and Display

**Feature**: SPEC-004
**Date**: 2026-10-01

## 1. Provider boundary and vendor choice

**Decision**: Define a provider-neutral `WeatherProvider` forecast port. Implement normalization and persistence against deterministic fixtures. Do not select or enable a production vendor in this feature.

**Rationale**: `docs/ARCHITECTURE.md` §17.1 requires an adapter and normalized application model. The architecture's ADR index references ADR-012 Weather Provider, but `docs/ADR/ADR-012-weather-provider.md` is absent. The clarified spec explicitly says not to couple implementation to a vendor to fill that gap.

**Alternatives considered**: Select a popular weather service now; reject because availability, licensing, geographic coverage, forecast horizon, rate limits, and refresh cadence are unapproved. Omit the provider port until a vendor is selected; reject because normalization, API, persistence, and tests can be delivered vendor-neutrally.

**Decision still required**: Before live production refresh is enabled, approve ADR-012 or equivalent covering vendor/terms, Türkiye coverage, metric mapping, update cadence/horizon, rate limits, credentials/secrets, timeouts, and provider outage behavior. This decision can remain a release/configuration gate; a separate ADR task is not necessary to implement this feature.

## 2. Maximum age and forecast coverage

**Decision**: Default and deterministic test value: `WEATHER_SNAPSHOT_MAX_AGE_HOURS=6`, configurable through server configuration and validated as a positive numeric duration. A snapshot is current only when (a) `now - fetchedAt <= maxAge`, (b) it contains the current authorized Business-local date and next two complete daily forecast summaries, (c) its timezone matches the current Business timezone, and (d) its representative-point fingerprint matches the current field. Exact age equality remains current. Provider failure is not an input to freshness.

**Rationale**: The spec requires a planned numeric limit and its exact boundary to be testable, but the production provider's cadence is unknown. Six hours is a concrete default/test configuration, not a product-contract constant. Provider coverage rollover or a timezone change can invalidate a snapshot earlier even when its age is small. Revisit the production value with provider selection and operational cadence.

**Alternatives considered**: Mark stale on any failed refresh; rejected by the clarified spec and the explicit product decision. Use only age; rejected because a fresh snapshot can lack the current three-day horizon. Use only coverage; rejected because provider data can be old while still spanning the dates. Choose a production-derived SLA now; unavailable until the provider decision.

**Conflict resolution**: Architecture §17.4 broadly says to mark the retained snapshot stale on refresh failure. The more specific, newly clarified SPEC-004 rule governs this slice: CURRENT requires age within the configured maximum (default/test six hours, equality included), valid coverage for requested Business-local dates, matching representative point, and valid timezone/date context. STALE is returned only when age/coverage/timezone policy says stale. Missing/unusable or mismatched location remains UNAVAILABLE. Refresh failure is recorded operationally but does not itself change CURRENT to STALE.

## 3. Field location authority

**Decision**: Resolve the representative point from the server-owned `Field` record on every refresh. Persist the point/fingerprint with the accepted snapshot. Verify it still matches before persisting and before serving. Missing or changed location makes that snapshot unavailable for the current field context until a successful refresh.

**Rationale**: SPEC-001 persists canonical point or polygon representative point in PostGIS; a point-only field is sufficient. This prevents stale weather from following a changed field location and keeps the client from selecting a location.

**Alternatives considered**: Accept coordinates from mobile; reject because it is not authoritative and permits cross-location substitution. Use device/business location or approximate region; reject explicitly by spec. Recalculate polygon centroid; reject because the existing representative point is the specified location source and centroid may not match it.

## 4. Persistence model

**Decision**: Keep one last-valid normalized snapshot per `(businessId, fieldId)`, updated atomically only after complete validation. Include normalized current conditions and three daily summaries, local date coverage/timezone, point fingerprint, quality, and acquisition/issue timestamps. Reject older or invalid responses without deleting/replacing the current row.

**Rationale**: This gives API/mobile a stable cached read during provider outages and supports exact display/freshness explanation with the existing Prisma/PostgreSQL boundary. One current row is sufficient for SPEC-004; a full provider history is not required.

**Alternatives considered**: Live-only provider call; rejected because screen opens may not synchronously query and outage behavior requires a retained snapshot. Persist raw vendor payload; rejected because it leaks provider shape and is unnecessary for the farmer-facing contract. Add immutable history of every refresh; deferred because no in-scope requirement needs a refresh audit ledger; structured outcome telemetry plus the last valid snapshot suffices.

## 5. Refresh application use case and production trigger

**Decision**: Implement a provider-neutral refresh application use case that accepts an injected `WeatherProvider`, selects eligible fields, validates/normalizes responses, persists last-valid snapshots, and emits correlated outcomes. Test it directly with a fake provider. Do not implement a production provider, scheduler, command, or production cadence in SPEC-004. Provider wiring and an operational schedule are a release/configuration gate after ADR-012 approval. Farmer reads never trigger refresh.

**Rationale**: The repository currently contains `apps/api` and mobile packages, but no `apps/worker`; architecture worker/job references describe the broader platform. The user-approved feature boundary calls for a testable refresh use case but explicitly defers provider and scheduling decisions until ADR-012. A future approved trigger can call this use case without coupling it to API reads.

**Alternatives considered**: Synchronously refresh in GET; rejected by FR-005. Fire-and-forget from API reads; rejected because it couples refresh to screen opens and does not provide reliable required follow-up. Build a worker/queue/scheduler now; rejected as premature and inconsistent with the release gate. No refresh application use case; rejected because normalization, persistence, outage, and recovery behavior need an independently testable acquisition path.

## 6. API, authorization, and time semantics

**Decision**: Add both `GET /v1/fields/{fieldId}/weather` and weather-owned `GET /v1/weather/fields` to an independent SPEC-004 OpenAPI file. The overview has bounded cursor pagination and returns only field ID/name plus weather state/data for fields in the current authorized Business and field scope, including unavailable entries. It is not a general field-list API. The server resolves current membership/scope, timezone, local date, and representative point; clients cannot supply business ID, point, timezone, or local date. Mobile consumes generated API client types.

The weather-owned overview is the complete mobile weather access surface for SPEC-004 and is surfaced from Today even with zero due tasks. Minimum field identity distinguishes multiple field weather entries. The field-specific read remains available in the server contract for bounded/reusable consumption; a separate mobile field-detail screen or navigation architecture is not required.

**Rationale**: Matches SPEC-001 membership/tenant handling and SPEC-002 Bugün's Business-local date contract and timezone fallback (`Europe/Istanbul`). A weather-owned overview lets Bugün discover field weather when there is no task row and avoids building a general field-list feature. Dedicated weather operations keep transport changes additive without changing SPEC-001/002/003 contracts.

**Alternatives considered**: Client-supplied `businessId`, point, date, or timezone; rejected because these values do not establish authority and can create inconsistencies. Discover fields only from `/today` task rows; rejected because a field with no task due would become unreachable. Add a general `/fields` listing; rejected because SPEC-004 needs only the weather-owned projection. Add weather to `/today`; rejected because it would change Today semantics and still would not provide field discovery independently of task rows.

## 7. Offline boundary

**Decision**: Do not add any durable local weather persistence, weather-specific SQLite table, background sync, or authorization lease. The current mobile implementation has a completion-specific SQLite command store and cached Today task projection, but no approved weather cache. Do not use or extend either existing store for weather. With network unavailable and no existing approved weather snapshot path, show unavailable/access/retry and leave Today/completion cached state untouched. The general product allowance for displaying an already-stored snapshot where existing app behavior permits remains applicable if such an approved path exists later.

**Rationale**: The clarification specifically limits offline scope. Existing SPEC-003 SQLite rows are completion/task-specific and the Today projection is task-specific; neither authorizes a generic weather cache.

**Alternatives considered**: Add a generic cached-data policy or new snapshot synchronization; rejected as explicit scope expansion. Always expose any local weather cache offline; rejected because local presence is not current authorization and existing access behavior may not permit it.

## 8. ADR-012 timing

**Decision**: No vendor or scheduler decision is required within SPEC-004 implementation. Record a release/configuration gate: live production refresh cannot be enabled until ADR-012 approves a provider and release configuration supplies its adapter and operational trigger/cadence.

**Rationale**: This lets the provider-neutral port, refresh use case, contract generation, deterministic fake-provider tests, and unavailable-state UX complete now without fabricating provider or scheduling decisions. It makes the remaining release dependency explicit before production data is fetched.

**Alternatives considered**: Create an empty ADR as part of this feature; rejected because it would not decide anything. Choose a vendor or scheduler while planning; rejected by user instruction and architecture decision requirements. Ignore the missing ADR and scheduling decision; rejected because live-refresh enablement dependencies must remain visible.
