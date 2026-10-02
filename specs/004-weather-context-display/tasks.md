---
description: "Implementation tasks for SPEC-004 Weather Context and Display"
---

# Tasks: Weather Context and Display

**Input**: Design documents from `specs/004-weather-context-display/` (`spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/weather.openapi.yaml`, and `quickstart.md`).

**Prerequisites**: Completed and reviewed SPEC-004 plan and contracts.

**Execution rule**: Tests for domain rules, persistence, authorization, API contracts, provider handling, and mobile states are written first and shown failing before their implementation tasks begin. `[P]` means tasks touch independent files and have no incomplete dependencies; it does not imply delegation. PostgreSQL-backed weather tests may be authored independently but must use the disposable database guard and the repository's serialized API integration runner; never launch separate integration processes concurrently against the same database.

## Phase 1: Setup

**Purpose**: Reuse the existing pnpm/Turborepo, NestJS/Fastify API, Prisma/PostgreSQL, OpenAPI generator, authenticated mobile client, and test harnesses. No project initialization, new service, queue, worker, datastore, or framework is needed.

No standalone setup task is required; start with the shared foundation below.

## Phase 2: Foundational (Shared Contracts and Data Model)

**Purpose**: Define and test the shared domain, persistence, and transport seams before server and mobile implementation streams begin.

### Tests first

- [x] T001 [P] Add deterministic normalization unit cases in `apps/api/test/weather/weather-normalization.spec.ts` for valid provider-neutral fixtures, supported units, finite required values, precipitation 0–100%, non-negative wind, high >= low, valid non-future timestamps, complete distinct local dates, invalid coordinates, and unknown-condition mapping to `UNKNOWN`. Include at least two distinct test-only provider adapters/fixtures carrying semantically equivalent data and assert equivalent normalized WeatherSnapshot output; this requires no production vendor, network call, or ADR-012 resolution (Spec: FR-002/014; SC-006).
- [x] T002 [P] Add fixed-clock freshness unit cases in `apps/api/test/weather/weather-freshness.spec.ts` proving `WEATHER_SNAPSHOT_MAX_AGE_HOURS=6` is configurable, `age <= maxAge` includes exact six-hour equality, `age > maxAge` is stale, and timezone/date coverage/location/no-point/no-snapshot cases derive the specified states independently of refresh outcome (Spec: FR-001/006/008; SC-002).
- [x] T003 [P] Add OpenAPI contract assertions in `apps/api/test/weather/weather-contract.spec.ts` for both approved GET operations, bounded overview paging, minimum response projection, explicit states/null unavailable values, stable error envelope, and absence of client business ID/coordinates/timezone/local-date authority inputs (Spec: FR-009/010/011; SC-007/009).
- [x] T004 [P] Add real-PostgreSQL schema/integrity cases in `apps/api/test/weather/weather-persistence.integration.spec.ts` for tenant ownership, field relation, one `(businessId, fieldId)` snapshot, exactly three unique local-date rows per accepted snapshot, and rejection of destructive changes to existing SPEC-001/002/003 data. Reuse `apps/api/test/support/disposable-database.ts` so the test fails unless `DATABASE_URL` targets `ekim_hasat_test`; run through the API integration runner, which serializes integration files (Spec: FR-003/004/014/016).

### Shared implementation

- [x] T005 Define the application-owned normalized weather types and provider-neutral `WeatherProvider` port in `apps/api/src/weather/weather.types.ts` and `apps/api/src/weather/weather-provider.port.ts`; keep vendor payloads, credentials, units, and provider errors out of core types (Spec: FR-002/003; Plan §Provider and normalization).
- [x] T006 [P] Implement provider-neutral validation and normalization in `apps/api/src/weather/weather-normalizer.ts` so persisted candidates contain finite Celsius values, precipitation chance within 0–100%, non-negative km/h wind, daily high >= low, valid non-future UTC timestamps, exactly the requested three distinct Business-local dates, and safe application condition codes/labels; reject unsupported units, missing values, malformed ranges, and invalid coordinates (tests: T001; Spec: FR-002/014).
- [x] T007 [P] Add `WEATHER_SNAPSHOT_MAX_AGE_HOURS` validation with a configurable positive numeric value and concrete default/test value of 6 in `apps/api/src/config/env.ts`, then implement the pure current/stale/unavailable decision in `apps/api/src/weather/weather-freshness.ts`; combine age with full three-date coverage, timezone, and point-fingerprint validity, keeping provider failure out of the classification inputs (tests: T002; Spec: FR-001/006/008).
- [x] T008 Add additive Prisma `WeatherSnapshot` and `WeatherDailyForecast` models plus a new migration in `apps/api/prisma/schema.prisma` and `apps/api/prisma/migrations/<timestamp>_weather_snapshot/migration.sql`. Preserve these data-model constraints: `businessId` is copied from the server-owned Field relation and never client-selected; `fieldId` is unique with `businessId` and FK-constrained; `representativePoint` is canonical longitude/latitude, SRID 4326; `locationFingerprint` identifies the fetched point; `coverageStart` is inclusive and `coverageEnd` exclusive; `forecastLocalDates` contains exactly three consecutive Business-local dates; `fetchedAt` is server UTC acquisition time; `refreshStartedAt` is the server UTC ordering fallback; `providerIssuedAt` is optional UTC ordering evidence; `qualityStatus` is accepted application-owned quality only; `observedAt` is UTC; current `temperatureC` is finite; daily `localDate` is unique with `snapshotId`; `temperatureHighC >= temperatureLowC`; precipitation is finite 0–100; wind is finite and non-negative. Persist only normalized typed fields, with indexes/FKs/uniqueness and no destructive rewrite (tests: T004; Spec: FR-003/004/014/016).
- [x] T009 Register `specs/004-weather-context-display/contracts/weather.openapi.yaml` in `packages/api-client/openapi-generator.config.ts`, generate `packages/api-client/src/generated/weather-api.ts`, and export the generated operations through `packages/api-client/src/index.ts`; preserve the existing reproducible `generate`/`check:generated` flow and do not hand-edit generated transport types (tests: T003; Spec: FR-011; SC-007).

**Foundation checkpoint**: T001–T009 complete before either implementation batch starts. No live provider, production adapter, scheduler, refresh command, worker/job platform, general field-list API, generic offline cache/sync layer, or authorization lease is added in this foundation.

## Phase 3: User Story 3 — See only weather for fields I can access (Priority: P1)

**Goal**: Provide authorized single-field weather reads and a weather-owned overview that discovers in-scope fields independently of Today task rows.

**Independent Test**: Against real PostgreSQL/PostGIS fixtures, an authorized member can read an in-scope field and paginated weather overview, including a field with zero Today tasks; cross-business, missing, revoked, and out-of-scope reads reveal no field/snapshot existence. Neither GET calls the provider.

### Tests first

- [x] T010 [P] [US3] Add API read integration cases in `apps/api/test/weather/weather-read.integration.spec.ts` for current Membership/business/field scope revalidation on both routes; authorized zero-task fields in the weather overview; only `fieldId`, `fieldName`, and weather projection; default 50/max 100 stable cursor order; unavailable entries for missing/unusable representative points or snapshots; no client-supplied business ID/location/timezone/date; point-only eligibility; privacy-safe cross-business/missing/revoked/out-of-scope denials; zero provider calls on GET; and read/API failure response and diagnostics coverage using the existing correlation/request ID, stable machine-readable error category/code, and privacy-safe correlated server logging (no tokens, secrets, raw provider payloads, or unnecessary personal data). Reuse the disposable database guard and serialized API integration runner (Spec: FR-001/005/009/010/013/019/020; SC-004/005/009).

### Implementation

- [x] T011 [US3] Implement tenant-scoped weather snapshot/overview reads in `apps/api/src/weather/weather.repository.ts` using the existing Membership/scope and Field/PostGIS boundaries; derive authorized Business timezone and server-local dates, use only the server-owned representative point, return no weather values for unusable/mismatched location, and page only minimum field identity plus weather context (tests: T010; Spec: FR-001/009/010/019/020).
- [x] T012 [US3] Implement authorized `GET /v1/fields/{fieldId}/weather` and `GET /v1/weather/fields` in `apps/api/src/weather/weather.controller.ts` and wire them through `apps/api/src/weather/weather.module.ts`; reuse existing auth, correlation, and error handling, map stable privacy-safe errors, preserve the OpenAPI response shape, and ensure read paths never invoke or await `WeatherProvider` (tests: T003/T010; Spec: FR-005/009/010/011/019; SC-004/005/009).

## Phase 4: User Story 2 — Understand stale or unavailable weather (Priority: P1)

**Goal**: Refresh snapshots through an independently testable application use case while retaining the last valid persisted snapshot through provider, normalization, and persistence failures.

**Independent Test**: Invoke the refresh use case directly with a fake provider. A valid result persists; provider failure or invalid/older output leaves the prior row untouched; a later valid recovery replaces it. Read-time status remains current after refresh failure alone while age, timezone, point, and coverage remain valid.

### Tests first

- [x] T013 [P] [US2] Add fake-provider refresh unit cases in `apps/api/test/weather/weather-refresh.spec.ts` for eligible-field selection, current server point only, successful normalization/persistence request, provider timeout/rate-limit failure isolation, malformed output rejection, old-result rejection using provider issue times when both exist or refresh-start time otherwise, recovery, correlated outcomes, and preservation of the previous valid snapshot (Spec: FR-001/004/005/008/013/014; SC-003/005/006).
- [x] T014 [P] [US2] Add real-PostgreSQL refresh integration cases in `apps/api/test/weather/weather-refresh.integration.spec.ts` for atomic replacement only after full validation, unchanged last-valid row on provider/normalization/persistence failure, newer recovery replacement, overlapping out-of-order refreshes, and point recheck before persistence. Reuse the disposable database guard and serialized API integration runner (Spec: FR-004/008/013/014; SC-003/006).

### Implementation

- [x] T015 [US2] Implement the independently invokable `WeatherRefreshService` application use case in `apps/api/src/weather/weather-refresh.service.ts` and persistence coordination in `apps/api/src/weather/weather.repository.ts`; inject `WeatherProvider`, use bounded eligible-field batches, read each point from the server-owned Field record, normalize before write, recheck point and ordering before atomic persistence, isolate per-field failures, preserve last-valid data, and emit correlated secret-safe outcomes (tests: T013/T014; Spec: FR-001/004/005/008/013/014; SC-003/005/006).

**Release gate**: Do not add a production vendor adapter, secret, scheduler, command, cadence, fire-and-forget trigger, queue, or complete worker/job platform. Keep live production refresh disabled until ADR-012 (or an explicitly approved equivalent) and release configuration decide provider, adapter, trigger, and cadence. The refresh use case is independently testable without claiming production scheduling.

## Phase 5: User Story 1 — Check weather for today's work (Priority: P1)

**Goal**: Show field-associated current conditions and exactly today plus the next two Business-local forecast days from Bugün and the existing field context.

**Independent Test**: With generated-client-shaped fixtures for an authorized field overview, including zero tasks due today, the mobile flow shows current conditions, all three daily summaries, coverage/update time, and freshness without changing task or plan state.

### Tests first

- [x] T016 [P] [US1] Add weather card tests in `apps/mobile/test/weather/weather-card.test.tsx` for loading, current, stale, unavailable without values, access denied, retryable error/retry, accessible status announcements/names, text scaling/readability, and non-color state cues; assert current temperature/condition and each of exactly three local days' condition, high/low, precipitation, and wind, and that no recommendation or plan-change UI appears (Spec: FR-007/012/015; SC-001/002).
- [x] T017 [P] [US1] Add Today integration tests in `apps/mobile/test/seasons/today-weather.test.tsx` proving the weather overview is the complete mobile weather access surface, authorized fields remain weather-discoverable when there are zero due tasks, Today may show the overview/card set with zero tasks, weather-request failure does not block Today tasks/completion, timezone display uses server Business-local dates, and network unavailable with no approved weather snapshot path shows unavailable/retry while cached Today/completion state remains untouched and no weather/cache/sync/authorization behavior is added (Spec: FR-005/007/008/016/017/019; SC-001/005/008/009).

### Implementation

- [x] T018 [P] [US1] Implement the generated-client-backed weather feature client and compact accessible weather card in `apps/mobile/src/features/weather/weather-client.ts` and `apps/mobile/src/features/weather/weather-card.tsx`; consume generated transport types, display current condition/temperature and today plus next two Business-local days with required metrics, field/date/update context, accessible current/stale/unavailable/loading/error states, and retry where appropriate (tests: T016; Spec: FR-007/011/012/015; SC-001/002/007).
- [x] T019 [US1] **Main-agent-only integration**: compose the weather overview/card within the existing authenticated Today flow in `apps/mobile/src/features/seasons/today-screen.tsx`, using the ApiClient already supplied by `apps/mobile/src/app-composition.ts`; keep weather discovery independent from task rows, isolate weather errors from task loading/completion, and preserve existing onboarding → season setup → Bugün → completion/history navigation and command-store semantics (tests: T017; Spec: FR-005/007/008/016/019; SC-001/003/005/009).

## Phase 6: User Story 4 — Keep weather dependable across the mobile and API experience (Priority: P2)

**Goal**: Keep client/API types reproducible and backward compatible, and constrain offline display to existing app permissions and behavior.

**Independent Test**: Generated weather operations type-check from the OpenAPI source; existing onboarding, season, Today, and completion/history clients retain their existing generated contracts; no weather cache is treated as authority or current solely because it exists locally.

- [x] T020 [P] [US4] Add a generated-client consumer type test in `packages/api-client/test/weather-consumer.type-test.ts` covering both weather read operations and the overview item/page fields; assert weather transport types are imported from generated exports rather than hand-maintained mobile/web declarations (Spec: FR-011; SC-007).
- [x] T021 [P] [US4] Add offline-boundary cases in `apps/mobile/test/weather/weather-offline-boundary.test.tsx` showing that network unavailable plus no existing approved weather snapshot path renders unavailable/access/retry with no forecast values, while cached Today task projection and completion-specific SQLite command state remain untouched; assert no weather persistence, generic cache, sync engine, or authorization lease is created (Spec: FR-017; SC-008).

## Phase 7: Polish and Cross-Cutting Verification

**Purpose**: Protect SPEC-001/002/003 behavior, verify generated artifacts and existing flows, and refresh repository context after material implementation changes.

- [x] T022 As a main-agent shared integration fix, register the Batch A weather read module in the existing root API bootstrap `apps/api/src/main.ts` and pass the configured freshness maximum; before invoking the PostgreSQL integration runner, confirm `DATABASE_URL` names the disposable `ekim_hasat_test` database. Then run feature verification from `specs/004-weather-context-display/quickstart.md` and applicable focused SPEC-001/002/003 regression coverage. Verify provider-neutral normalization equivalence across the two test-only adapters/fixtures, read failure correlation IDs/stable codes/privacy-safe server diagnostics, offline unavailable/retry with Today/completion cached state untouched, Today Business-local dates, auth, production-bootstrap route registration, and app composition. Run contract/generated-client, targeted API/PostgreSQL, and targeted mobile verification as appropriate; do not repeat broad/full suites unnecessarily or claim physical-device/emulator evidence without it (Spec: FR-013/014/016; SC-002/004/005/006/007/008).
- [x] T023 Run repository lint/typecheck and whitespace validation with `pnpm lint`, `pnpm typecheck`, and `pnpm check:diff`, resolving feature regressions before completion (`specs/004-weather-context-display/quickstart.md`; Spec: FR-014/016).
- [x] T024 Refresh and validate the context graph after material source/structure changes with `graft build` then `graft check`, and confirm `git diff --check`; do not run `graft build --deep` and do not claim physical-device/emulator validation without evidence (`AGENTS.md` §23; Spec: Assumptions; Quickstart).

## Dependencies & Execution Order

### Phase dependencies

- **Setup (Phase 1)**: Existing repository toolchain is reused; no new setup infrastructure.
- **Foundation (Phase 2, T001–T009)**: T001–T004 are independent test-first tasks. T005 establishes shared types/port; T006 and T007 follow T005 and their tests; T008 follows the data-model test and shared types; T009 follows the approved OpenAPI contract test. All T001–T009 must finish before either parallel implementation stream begins because the contract, generated client, domain boundary, and migration are shared foundations.
- **US3 reads (Phase 3, T010–T012)**: T010 read/authorization tests precede T011 repository and T012 controller implementation. Depends on the domain/config/migration and generated client foundation.
- **US2 refresh (Phase 4, T013–T015)**: T013/T014 tests precede the independently invoked refresh implementation T015. Depends on normalized types, config/freshness, persistence, and repository foundations.
- **US1 mobile (Phase 5, T016–T019)**: T016/T017 tests precede T018 component/client and T019 main-agent integration. T018 can proceed in parallel with Phase 3/4 server work after T009; T019 waits for the read contract and T018.
- **US4 reliability (Phase 6, T020–T021)**: T020 is main-agent-owned and waits for T009 generated exports. T021 is Batch B-owned and waits for T018 and its prerequisites; it verifies no local weather persistence is added.
- **Polish (Phase 7, T022–T024)**: Run after integration. Broad suite and graft work are main-agent-owned; graft commands stay `build` and `check`, never `build --deep`.

### Requirement and user-story traceability

- **US1**: FR-005/007/008/016/019; SC-001/003/005/009 — T016–T019.
- **US2**: FR-001/002/003/004/006/008/013/014/020; SC-002/003/006 — T001/T002/T005–T008/T013–T015.
- **US3**: FR-001/005/009/010/011/019/020; SC-004/005/007/009 — T003/T009–T012.
- **US4**: FR-011/012/016/017; SC-007/008 — T003/T009/T016–T021/T022–T024.

### Parallel execution

- Before server/mobile implementation begins, finish the shared-contract, generated-client, domain, and schema foundation T001–T009. T001–T004 may be authored concurrently because each owns a distinct test file; T005–T009 follow the dependencies above.
- After foundation: **Server/API stream** owns T010–T015 and all files under `apps/api/src/weather/`, `apps/api/test/weather/`, plus the planned Prisma migration/config changes already made in Phase 2.
- After foundation: **Mobile stream** owns T016–T018 and, after T018 and its prerequisites, T021. It owns the weather client/card and component/accessibility/offline-boundary tests; it consumes the generated contract and may use test fixtures while server work proceeds.
- The two streams must not edit each other's files. Shared OpenAPI, Prisma schema/migrations, generator config/generated entrypoints, Today screen/app composition, and broad integration fixes remain main-agent-only. Do not delegate a task that overlaps those files.
- T019 Today/app-composition integration and T022–T024 cross-stream/regression verification are main-agent-only and wait for both streams. T021 belongs only to Batch B and must not appear in the main-agent batch.

## Suggested Implementation Batches

### 1. Mandatory sequential foundation

- **Tasks**: T001–T009.
- **Prerequisites**: None beyond the reviewed SPEC-004 artifacts and existing repository toolchain.
- **Owned files/subsystems**: API weather tests and normalized model/types/port/normalizer/freshness, `apps/api/src/config/env.ts`, Prisma schema plus additive migration, and generated-client configuration/entrypoints.
- **Concurrency**: T001–T004 can be authored in parallel in distinct test files. Complete all remaining foundation tasks and stabilize shared contracts/schema before starting either implementation stream.
- **Main-agent-only**: OpenAPI source contract, Prisma schema/migration coordination, generator config, generated-client index/output.

### 2. Parallel Batch A — Server/API

- **Tasks**: T010–T015.
- **Prerequisites**: Complete T001–T009.
- **Token-efficient context**: Batch A needs only SPEC-004 US2/US3 requirements; plan sections on provider normalization, persistence/freshness, refresh, and authorized reads; relevant data-model/OpenAPI sections; refresh and authorization quickstart scenarios; and Graft queries for Membership, Field/PostGIS, and API patterns. It should not need the full PRD, full architecture, prior specs, or whole repository.
- **Owned files/subsystems**: Authorized read tests/repository/controller, weather refresh tests/application service, tenant-scoped Prisma persistence, provider-neutral test doubles, and correlated failure outcomes.
- **Order**: T010 before T011/T012; T013 and T014 before T015.
- **Main-agent-only files**: OpenAPI, Prisma schema/migration, generator entrypoints, API root bootstrap `apps/api/src/main.ts`, Today screen/app composition; Batch A must not change those shared files.

### 3. Parallel Batch B — Mobile weather component

- **Tasks**: T016–T018, then T021 when the weather feature is available.
- **Prerequisites**: Complete T001–T009; T018 follows its component tests; T021 follows T018 and its mobile offline-boundary test setup prerequisites. Generated weather operations are the transport boundary; mock responses may support component tests while Batch A is in progress.
- **Token-efficient context**: Batch B needs only SPEC-004 US1/US4 requirements; plan sections on mobile, API client, and offline boundaries; the FieldWeather/overview contract; mobile/offline quickstart scenarios; and Graft queries for TodayScreen, app composition, and completion-store boundaries. It should not need the full PRD, full architecture, prior specs, or whole repository.
- **Owned files/subsystems**: `apps/mobile/src/features/weather/` and component/accessibility/offline-boundary tests under `apps/mobile/test/weather/`, plus Today/offline isolation coverage at `apps/mobile/test/seasons/today-weather.test.tsx`. Use only generated client types and existing mobile presentation conventions.
- **Main-agent-only files**: `apps/mobile/src/features/seasons/today-screen.tsx`, `apps/mobile/src/app-composition.ts`, shared navigation, and generated-client entrypoints.

### 4. Main-agent integration and verification

- **Tasks**: T019–T020 and T022–T024. T021 belongs only to Parallel Batch B after T018 and its prerequisites.
- **Prerequisites**: T012, T015, and T018 complete; T020 waits for T009. T019 integrates the existing Today composition and cannot make weather dependent on task rows. Then run regression, quickstart, static checks, `graft build`, `graft check`, and `git diff --check`.
- **Owned files/subsystems**: T019 Today/app-composition integration; T020 shared generated-client boundary review; API root bootstrap module registration in `apps/api/src/main.ts`; migration/generated-entrypoint coordination; cross-stream fixes; T022–T024 regression and broad verification, including Graft build/check.
- **Release/configuration gate**: ADR-012 remains required before live production provider refresh is enabled. No production vendor, provider secret, operational scheduler/cadence, or full worker/job platform is a SPEC-004 implementation task. No new offline sync/cache/lease infrastructure or out-of-scope weather features are introduced.

## Implementation Strategy

### MVP first

Deliver the smallest complete mobile slice with the shared foundation, authorized weather-owned overview/single-field reads, normalized persisted snapshot and independently tested refresh use case, and the accessible Bugün weather card (T001–T019). Validate the slice with non-production deterministic fixtures and an authorized field that has no Today task. Do not ship fixtures as production weather or enable live refresh before the ADR-012 release/configuration gate.

### Incremental delivery

1. Finish and stabilize T001–T009 shared domain, schema, OpenAPI, and generated-client foundation.
2. Run the server/API stream (T010–T015) alongside mobile component work (T016–T018).
3. Main agent integrates Today/app composition (T019), coordinates shared generated-client and migration boundaries, handles cross-stream fixes, and owns T020 plus final verification (T022–T024). Batch B owns T021 after T018 and its prerequisites.
4. Keep live provider wiring and operational scheduling outside this feature until ADR-012 and release configuration are approved.

## Notes

- Each task is a checkbox with a sequential ID, applicable `[P]`/`[US#]` labels, an explicit file path, and spec traceability.
- Tests listed before their implementation tasks must be run and shown failing first; use real PostgreSQL/PostGIS for persistence and tenant/geospatial semantics.
- Offline scope is display-only under existing application access behavior. Do not create weather persistence on mobile or treat client cache as authorization.
- Scope remains limited to SPEC-004 read-only weather context: no weather recommendations, task/plan adjustments, calendar or overdue behavior, notifications, risk, observations, satellite, AI, finance, harvest, team features, generic field listing/management, production provider selection, or new navigation architecture.
- Physical-device/emulator validation is deferred and must not be claimed without evidence.

## Phase 8: Whole-Feature Review Remediation

- [x] T025 Add a focused multi-batch refresh regression test, then persist attempt ordering and select only due fields so successful/current targets and repeated provider failures cannot starve later eligible fields (Review finding 1; FR-004/005; Plan §Refresh and persistence).
- [x] T026 Add a bounded query-count regression test, then batch representative-point and snapshot/forecast reads for each authorized overview page without changing its scope or ordering (Review finding 2; FR-019; Plan §Authorized weather reads).
- [x] T027 Add live-region semantics and component assertions for asynchronous weather states, including retry results (Review finding 3; FR-012).
- [x] T028 Add a PostgreSQL commit-time mismatch regression test and extend the existing deferred snapshot integrity trigger to require child forecast dates to equal parent coverage dates (Review finding 4; FR-003; data-model.md).
- [x] T029 Add focused cross-platform weather status announcement and deduplication tests, then centralize meaningful overview state announcements so iOS uses the supported AccessibilityInfo API while Android retains live-region semantics; cover retry resolution and suppress duplicate/decorative announcements (Review finding 5; FR-012).
- [x] T030 Add deterministic deferred-promise Today weather request race tests, then guard state commits with a monotonically increasing request generation and prevent post-unmount commits where needed (Review finding 6; FR-008/FR-012).

## Phase 9: Convergence

- [x] T031 Document the persisted `WeatherRefreshState` entity, `(businessId, fieldId)` field/business relationship, `lastAttemptedAt`, sequenced `lastAttemptOrder`, and ordering index in `specs/004-weather-context-display/data-model.md` per T025 and the bounded refresh progress plan (partial).
