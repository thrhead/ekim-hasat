# Implementation Plan: Weather Context and Display

**Branch**: `main` (feature branch intended by the spec: `004-weather-context-display`)
**Date**: 2026-10-01
**Spec**: [spec.md](spec.md)

**Input**: Clarified feature specification at `/specs/004-weather-context-display/spec.md`.

## Summary

Add a provider-neutral weather port and a single normalized, persisted last-valid snapshot per field. A separately invoked refresh application use case uses only the field's current server-owned representative point. The API authenticates and scopes every weather read to the caller's current business membership and field permission. It provides both a single-field read and a weather-owned paginated overview so field weather remains discoverable when no task is due. Mobile consumes these reads through the generated OpenAPI client. Refresh is independent of screen opens; it does not modify tasks or plans.

No production vendor is selected. The port, normalization, persistence, read API, and display can be built and tested with deterministic fixtures. Live production refresh remains disabled until ADR-012 (or an equivalent explicitly approved decision) selects a provider and its operational terms.

## Technical Context

**Language/Version**: TypeScript 5.9, Node.js >=22, React 19 / React Native 0.81.
**Primary Dependencies**: Existing NestJS 11 + Fastify API, Prisma 7, generated `openapi-typescript` client, Expo 54 and React Native. No new framework or provider SDK until an approved provider decision.
**Storage**: PostgreSQL via Prisma for canonical snapshots; no new mobile weather store or sync mechanism.
**Testing**: Existing API unit/contract/integration suites, real PostgreSQL integration for persistence/tenant behavior, api-client contract generation checks, Jest/React Native component tests. Provider normalization and freshness use deterministic inputs; no live vendor dependency.
**Target Platform**: Existing API runtime and Expo iOS/Android application; no physical-device validation claim.
**Project Type**: TypeScript monorepo, modular monolith API and mobile client.
**Performance Goals**: Bugün and field reads must not call the provider. Single-field reads and weather overview pages are bounded (default 50, maximum 100 fields). No feature-specific latency SLA is defined. Refresh use-case invocations process bounded batches.
**Constraints**: Server owns field representative point, authorization, business timezone and freshness status. No client business ID authority, no provider calls during reads, no task/plan mutations, no generic worker/job platform or mobile offline framework. Preserve SPEC-001/002/003 contracts and behavior except additive weather context.
**Scale/Scope**: One current last-valid snapshot per field, current conditions plus exactly today and the next two authorized Business-local dates. The weather-owned authorized overview surfaced from Today is the complete mobile weather access surface; it distinguishes multiple fields with minimum identity and works when there are zero due tasks. No separate field-detail screen or general field list is introduced. Offline weather persistence is not added; when offline with no already-approved weather snapshot path (none exists in the current repository), show unavailable/access/retry while leaving cached Today/completion state untouched.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Gate | Plan evidence |
|---|---|---|
| Farmer simplicity / mobile completeness | PASS | Additive compact card in Bugün and relevant field context; explicit current, stale, unavailable, loading, denied, and retryable states; mobile remains the primary complete display. |
| Offline work and access | PASS | Read-only feature; no offline mutations, synchronization, authorization lease, or new local domain framework. Any existing permitted cached snapshot is age-checked and never treated current merely because it is cached. |
| Server authority / business isolation | PASS | Every GET resolves authenticated user, current membership and field scope server-side, then queries by authorized business and field. No business identifier in the request. Tenant tests cover cross-business and revoked access. |
| Historical integrity / explainability | PASS | Keep the latest validated snapshot and its location/coverage/acquisition metadata. Reject invalid, location-mismatched, or older responses; provider failures do not erase valid history. |
| Human control | PASS | Weather is read-only context. No task, plan, approval, notification, or recommendation behavior is added. |
| External providers behind adapters | PASS | `WeatherProvider` port isolates vendor request, payload, units, and errors. Application and transport models contain only normalized values. |
| Modular monolith | PASS | API/domain and existing mobile/API-client boundaries are extended; no new service, datastore, framework, queue, or worker deployment. |
| Test according to risk | PASS | Deterministic normalization/freshness tests; PostgreSQL persistence/authorization/tenant tests; API and generated-client checks; accessible mobile state tests. |
| Specification and vertical delivery | PASS | Implement only the defined weather read/refresh/display slice; SPEC-001/002/003 remain authoritative for field, timezone, Bugün, and task behavior. |

**Pre-research gate**: PASS. The clarified spec resolves feature behavior. It explicitly overrides the broader Architecture §17.4 sentence that says a provider failure marks a snapshot stale: SPEC-004 freshness depends on max age and forecast coverage, and refresh failure alone does not alter freshness.

## Research and Design Decisions

Research alternatives and rationale are in [research.md](research.md). Design in brief:

- Persist one normalized `WeatherSnapshot` per field/business with the representative point used, location fingerprint, business timezone, local forecast dates, fetched time, optional provider issue time, quality, normalized current conditions, and three daily summaries.
- Compute status at read time: `CURRENT` only if age is at or below the configured limit and the snapshot covers the authorized Business-local today plus next two days; `STALE` if a stored snapshot fails either check; `UNAVAILABLE` if no usable snapshot exists or the current representative point no longer matches the one used to fetch it. A provider refresh error is telemetry only and never independently changes state.
- In `apps/api/src/config/env.ts`, define `WEATHER_SNAPSHOT_MAX_AGE_HOURS` with a configurable default and deterministic test value of **6 hours**; reject non-finite or non-positive values and inject it into freshness evaluation. CURRENT requires age at or below the maximum, valid coverage for requested Business-local dates, matching representative point, and valid timezone/date context. Exact equality remains CURRENT; older than six hours is STALE. Refresh failure alone does not change CURRENT to STALE; UNAVAILABLE remains distinct. This value is not embedded as a fixed API constant. Revisit production configuration when ADR-012 establishes provider cadence, limits, and horizon.
- Implement and directly test the refresh application use case with a fake `WeatherProvider`; it selects and refreshes eligible fields when invoked. Do not add a production provider, scheduled trigger, or production cadence in SPEC-004. Provider configuration, scheduler/trigger, and operational cadence are an explicit release/configuration gate after ADR-012 approval. Farmer reads only serve persisted last-valid snapshots.
- Preserve the last valid snapshot on provider, normalization, quality, and persistence failures. Persist only validated data. Compare provider issue times when both results provide them; otherwise compare server refresh-start times. Reject an older result and recheck the canonical field point immediately before persistence.
- The current representative point is read from `Field`/PostGIS by the server for each refresh. Store a canonical coordinate/fingerprint with the snapshot and re-check it when serving. Do not fall back to device location, business location, polygon centroid, or guessed region. A changed/missing point makes old data unavailable for that field until a valid refresh. A Business timezone change makes a location-matching snapshot stale until its local-date coverage matches the new timezone's three dates.
- The architecture references ADR-012, but that file is absent. No provider decision is needed to implement the vendor-neutral feature boundary and tests. A small ADR-012 decision is a **release/configuration gate** before live production refresh is enabled, not a prerequisite task in this feature. The ADR must settle vendor, coverage, metric mapping, update cadence, forecast horizon, rate/terms, secrets, and timeout/retry expectations.

## API and Domain Boundaries

### Provider and normalization

- Add `WeatherProvider` in the existing domain/server boundary with one forecast method accepting validated server-provided coordinates and a requested UTC/local-date range. Keep vendor-specific credentials, units, error translation, and raw payloads inside an adapter.
- Normalize to Celsius, precipitation probability percent, wind km/h, condition enum plus optional safe display label, UTC instants for current/coverage metadata, and Business-local ISO dates for daily records. Require finite temperatures and wind/precipitation values; precipitation must be within 0–100%, wind non-negative, daily high >= low, timestamps valid and not future-dated, and exactly one complete summary for each requested local date. Reject unsupported units, invalid coordinates, missing required values, duplicate/missing dates, or malformed ranges before persistence. Unknown provider conditions map to `UNKNOWN` with a safe application label.
- `fetchedAt` is server UTC acquisition time and drives maximum-age freshness; provider issue time does not replace it. For last-valid ordering, compare `providerIssuedAt` when both existing and incoming snapshots have one; otherwise compare server `refreshStartedAt`. Reject a result that is older by the applicable comparison.
- No production vendor adapter or secret is selected in this plan. Implement the port and fixture adapter only; application config without an approved live adapter leaves refresh disabled and reads unavailable/last-valid.

### Persistence and freshness

- Add Prisma `WeatherSnapshot` and `WeatherDailyForecast` models in one migration. `WeatherSnapshot` has one current row per `(businessId, fieldId)` with business/field FK scope, point coordinates and fingerprint, timezone, forecast coverage, `fetchedAt`, optional `providerIssuedAt`, quality, and typed normalized current-condition columns. `WeatherDailyForecast` has exactly three typed rows per accepted snapshot, keyed by snapshot and Business-local date. Do not persist provider-shaped JSON or raw payloads.
- Upsert only after full normalization/quality validation and only when the incoming refresh is newer than the stored accepted result. Enforce tenant/field relation and uniqueness in the database in addition to application scoping. Refresh is server-owned and has no farmer-write route.
- Read-time status is a pure domain function with injected `now`, maximum age (default/test 6 hours), requested three local dates, current Business timezone, and current location fingerprint. `CURRENT` uses `age <= maxAge`, unchanged location, matching timezone/date context, and complete matching forecast coverage; exact six-hour equality is current and older is stale. An expired age, ended/incomplete period, local-date rollover, or timezone change yields `STALE` with retained values. Missing/unusable location or location fingerprint mismatch yields `UNAVAILABLE` with no weather values. Outage state is not an input to this function.

### Authorized API

- Add versioned `GET /v1/fields/{fieldId}/weather` and `GET /v1/weather/fields` operations. Both accept no business ID, coordinates, timezone, or local date. Resolve current authenticated user and membership/scope using the existing authorization service and tenant-scoped repository pattern. The overview returns a bounded cursor page of all in-scope fields (default 50, maximum 100), sorted by display name then ID, with only `fieldId`, `fieldName`, and weather context. It includes authorized fields without a valid snapshot or representative point as `UNAVAILABLE`. This is a weather-owned projection, not a reusable field-list API. Mobile uses it for Bugün and field weather discovery independently of Today task rows; the single-field operation supports a focused context view.
- Use the Business timezone and `Europe/Istanbul` fallback policy already established for SPEC-002 Bugün; derive today and the next two dates on the server. Return normalized current conditions, three daily summaries, `fetchedAt`, period coverage, timezone, and explicit status. Default/test max age is six hours: exact equality remains CURRENT if all validity checks pass, older is STALE; refresh failure alone does not affect status. For stale, retain values with stale status/update time. For unavailable, return no forecast values. Stable privacy-safe 403/404 behavior must not disclose a cross-business field/snapshot. Weather read failures use the existing request/correlation ID and error envelope, stable machine-readable category/code, and server-side correlated diagnostics with authorization/privacy-safe fields only; no new observability framework.
- Preserve existing auth middleware, correlation ID, request error filter, and error envelope. Add no new authorization mechanism. Provider errors are not part of GET because screen reads never call providers.

### Refresh application use case and release gate

- Add a server-side `WeatherRefreshService` (or equivalent application use case) that takes an injected `WeatherProvider`, selects eligible fields, resolves each server-owned representative point, validates and normalizes the provider result, and persists only a valid newer snapshot. It is directly callable by deterministic tests with a fake provider and is not wired to farmer GET routes.
- Refresh eligible fields in bounded batches so repeated invocations can continue; fields do not require an active season. Isolate a field's provider/normalization failure so other fields can still be processed. Preserve last-valid snapshots. Emit correlated structured outcomes for provider success/failure, normalization/quality rejection, persistence, and stale-write rejection without secrets or raw payloads.
- SPEC-004 does not create a scheduled command, scheduler configuration, worker application, queue, or fire-and-forget trigger. Before live production refresh is enabled, ADR-012 must approve a provider and release configuration must supply an operational trigger and cadence suited to that provider. Reads continue serving last-valid snapshots using freshness and coverage rules regardless of refresh availability.

### OpenAPI and generated client

- Add `specs/004-weather-context-display/contracts/weather.openapi.yaml`, using the existing OpenAPI 3.1/versioned `/v1` contract conventions, stable shared error shape, bearer authentication, privacy-safe errors, and named response DTOs for status, current, and daily data. Define both single-field and weather-owned paginated overview reads; overview items contain only minimum field identity (`fieldId`, `fieldName`) plus weather context.
- Add this contract to `packages/api-client/openapi-generator.config.ts`, generate `packages/api-client/src/generated/weather-api.ts`, and compose generated paths/operations into the exported API client (`packages/api-client/src/index.ts`). Never hand-edit generated transport types.
- Keep SPEC-001/002/003 schemas and generated outputs unchanged. Weather types are consumed in mobile only from the generated client.

### Mobile presentation

- Add a small `apps/mobile/src/features/weather/` feature client/presentation component. Load the weather-owned authorized field overview as the complete SPEC-004 mobile weather access surface and surface its card set from Today even when there are zero due tasks. Weather availability does not depend on Today task rows. The projection contains only field ID/name plus weather context, enough to distinguish multiple fields. Do not add a separate field-detail screen/navigation architecture, generic field browser, or field-management route. Reuse the authenticated ApiClient and existing API loading/error conventions. Paginate the overview using its bounded cursor contract.
- Display current condition and temperature, then today + next two Business-local days with condition, high/low, precipitation chance, and wind. Label the field association, covered dates, last update time, and state. Status is conveyed with text/icon/accessibility semantics, never color alone.
- Implement loading skeleton/text, current, stale with age/update time, unavailable without values, privacy-safe denied, retryable request error, and retry action. A weather request failure must not fail Bugün task loading or completion.
- Do not add weather persistence or offline sync. The existing completion-specific SQLite command store and cached Today task projection are not weather stores and must remain unchanged. Since there is no approved existing weather snapshot path, network unavailable means weather unavailable/access/retry, while cached Today/completion state remains untouched. No physical-device validation claim.

## Testing Strategy

- **Domain unit tests**: provider-output normalization across equivalent fixtures; include at least two distinct test-only provider adapters/fixtures with semantically equivalent input and assert equivalent normalized WeatherSnapshot output; no production provider, network calls, or ADR-012 decision is required. Also reject non-finite required values, unsupported units/timestamps, duplicate/missing dates, precipitation outside 0–100, negative wind, and high below low; cover `UNKNOWN`, exact local-day horizon, `age == maxAge` current and `age > maxAge` stale, coverage/timezone/location changes, unavailable conditions, provider failure not affecting valid status, and older-result rejection.
- **API contract and read tests**: generated operation/request/response alignment; authentication; no business ID or client point/timezone parameters; bounded overview paging and minimal field projection; authorized fields without snapshots included as unavailable; stable machine-readable error category/code and correlation/request ID; current membership and field scope recheck; cross-business, missing, out-of-scope, and revoked membership privacy; no provider invocation during any GET. Verify server-side correlated diagnostics for weather read failures with authorization/privacy-safe logging and no tokens, secrets, raw provider payloads, or unnecessary personal data.
- **PostgreSQL integration tests**: Prisma migration and uniqueness/FK behavior; authorized single-tenant read; isolation across businesses; representative-point query and point-only field eligibility; location change/deletion during refresh; last-valid retention on provider/normalization failure; recovery replacement; conditional persistence under overlapping old/new refreshes. Every new weather integration file must use the existing `apps/api/test/support/disposable-database.ts` guard, requiring `DATABASE_URL` to name `ekim_hasat_test`, and run through `pnpm --filter @ekim-hasat/api test:integration`, whose Node test runner sets `--test-concurrency=1`. Do not run separate weather integration processes concurrently against the same database.
- **Refresh use-case tests**: directly invoke the application service with a fake provider; cover field selection, repeated invocation, per-field failure isolation, normalization/persistence, recovery, ordering, telemetry outcomes/correlation, and last-valid preservation. Do not claim or require a production scheduler or live provider call.
- **API-client tests**: generator `--check`, generated weather operation exports, consumer type test, existing onboarding/seasons/completion operation regression checks.
- **Mobile tests**: render all explicit loading/current/stale/unavailable/denied/retryable-error cases; all three local forecast days and required metrics; accessible status and action names, non-color distinction, error isolation from task list; with network unavailable and no existing approved weather snapshot path, show unavailable/access/retry and leave cached Today/completion state untouched. No local weather persistence is added and no physical-device evidence is claimed.

## Constitution Check (post-design)

| Gate | Result | Evidence |
|---|---|---|
| Provider isolation | PASS | Port and normalized model contain no vendor payload; live adapter waits for approved ADR-012. |
| Tenant authorization | PASS | Every read uses current server-side membership/scope and tenant-filtered query; privacy-safe denial tests are required. |
| Freshness / trust | PASS | Six-hour configurable max age combined with exact three-local-day coverage; provider failure does not stale a still-valid snapshot; stale and unavailable never appear current. |
| Server-owned location | PASS | Refresh resolves existing representative point; persisted fingerprint is checked on serving and persistence; no client/device fallback. |
| API compatibility | PASS | New versioned OpenAPI file and generated client; no hand-maintained transport types or modifications to existing contract semantics. |
| Offline behavior | PASS | No local weather persistence, sync, or lease; with no approved weather snapshot path, offline weather is unavailable/retryable and Today/completion cached state is untouched. |
| Mobile completeness | PASS | The weather-owned overview is the complete mobile weather access surface, available from Today independent of task rows; states are accessible and automated component rendering is planned. |
| Scope / modular monolith | PASS | One bounded refresh application use case; no production scheduler/worker/job platform, recommendations, task changes, notifications, risk, satellite, observations, finance, teams, or AI. |

**Post-design gate**: PASS. ADR-012 is absent and remains an explicit live-provider and scheduling release/configuration gate. There is no justification for choosing a vendor or introducing a full worker/queue platform in this feature.

## Project Structure

### Documentation (this feature)

```text
specs/004-weather-context-display/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── weather.openapi.yaml
└── tasks.md                         # Created by speckit-tasks; not part of this planning phase
```

### Source Code (repository root)

```text
apps/api/prisma/
├── schema.prisma                    # WeatherSnapshot and migration
└── migrations/<timestamp>_weather_snapshot/
apps/api/src/config/
└── env.ts                           # WEATHER_SNAPSHOT_MAX_AGE_HOURS validation
apps/api/src/weather/
├── weather.types.ts                 # Normalized application-owned types
├── weather-provider.port.ts         # Provider-neutral forecast port
├── weather-normalizer.ts            # Provider-independent validation/model mapping
├── weather-freshness.ts             # Current/stale/unavailable decision
├── weather.repository.ts            # Tenant-scoped persistence/read model
├── weather-refresh.service.ts       # Independently invoked use case and fake-provider test seam
├── weather.controller.ts            # Authorized single-field and weather overview GETs
└── weather.module.ts                # Existing API composition
apps/api/src/
└── main.ts                            # Existing root bootstrap; main agent registers the weather read module
apps/api/test/weather/
├── weather-normalization.spec.ts
├── weather-freshness.spec.ts
├── weather-contract.spec.ts
├── weather-persistence.integration.spec.ts
├── weather-read.integration.spec.ts
├── weather-refresh.integration.spec.ts
└── weather-refresh.spec.ts
apps/api/test/support/
└── disposable-database.ts            # Existing guard for disposable ekim_hasat_test database
packages/api-client/
├── openapi-generator.config.ts
├── src/generated/weather-api.ts     # Generated; never hand-edited
└── test/weather-consumer.type-test.ts
apps/mobile/src/
├── app-composition.ts                # Existing authenticated ApiClient composition consumed by Today integration
├── features/weather/
│   ├── weather-client.ts             # Uses generated API operation
│   └── weather-card.tsx              # Compact accessible card/state presentation
└── features/seasons/
    └── today-screen.tsx              # Additive weather card composition
apps/mobile/test/weather/
├── weather-card.test.tsx
└── weather-offline-boundary.test.tsx # Verifies unavailable/retry with no weather persistence path
apps/mobile/test/seasons/
└── today-weather.test.tsx           # Today overview independence and task/completion isolation
```

**Structure Decision**: Reuse the existing Nest API, Prisma persistence, generated API client, authenticated mobile client, membership scope service, and SPEC-002 business-timezone policy. The API root bootstrap explicitly composes feature modules in `apps/api/src/main.ts`; Batch A owns the weather module, and the main agent owns registering that module in the root bootstrap as a shared integration fix before final verification. Add a weather-owned authorized field overview that returns only field ID/name and weather context, so weather discovery works even without Today task rows. A focused internal weather area is required for provider/persistence/read responsibilities; it is not a new deployable boundary. No general field-list, field-management route, production scheduler, or separate worker service is introduced.

## Complexity Tracking

No constitution violations. Refresh is a bounded application use case with a fake-provider test seam. Production provider wiring and scheduling remain an explicit release/configuration gate, so this feature does not create a generic queue, worker application, sync framework, or authorization lease.
