---
description: "Dependency-ordered implementation tasks for SPEC-005 Field Management and Region Resolution"
---

# Tasks: Field Management and Region Resolution

**Input**: Design documents from `specs/005-field-management-region-resolution/`

**Prerequisites**: `spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/fields.openapi.yaml`, `quickstart.md`, and `checklists/field-management.md`.

**Tests**: Tests are included because the feature requirements and user request require test-first coverage for domain behavior, API contracts, persistence/geometry, tenancy, concurrency, mobile conflicts, and accessibility.

**Organization**: Tasks are grouped by the four approved user stories. Completing a test task includes running the new test and confirming it fails for the intended missing behavior before downstream implementation starts. A test may be authored before its infrastructure exists; its RED run must occur once those actual prerequisites exist and before implementation. Any task that executes a writable PostgreSQL/PostGIS suite uses exactly `ekim_hasat_test` and runs exclusively: no other writable suite may use that database concurrently.

## Phase 1: Setup (Shared Contract Infrastructure)

**Purpose**: Make the approved Fields API contract part of the repository's generated transport workflow.

- [x] T001 Write a failing generated-client consumer type test in `packages/api-client/test/fields-consumer.type-test.ts` for list/detail, create/update, ETag, shared `ApiError` 409 codes `STALE_VERSION` and `IDEMPOTENCY_KEY_REUSED`, privacy-safe 403/404 responses, correlation IDs, region provenance, and unresolved schemas from the approved contract. Confirm it fails before T002.
- [x] T002 After T001 has failed against the not-yet-generated Fields client, register `specs/005-field-management-region-resolution/contracts/fields.openapi.yaml` as the Fields source in `packages/api-client/openapi-generator.config.ts`, generate `packages/api-client/src/generated/fields-api.ts`, and export it from `packages/api-client/src/index.ts`; do not hand-maintain transport types.

---

## Phase 2: Foundational (Shared Domain and Persistence)

**Purpose**: Define shared region state and persistence invariants required by all Field stories.

**Checkpoint**: Foundational schema/domain implementation must finish before dependent story implementation. Independent story tests and domain work may start as soon as their task-level prerequisites exist. Migration tests must verify the write target is exactly `ekim_hasat_test` before any fixture mutation.

- [x] T003 [P] Write failing domain tests for Field location keys and region-context states in `packages/domain/test/fields/field-region-context.spec.ts`, including independent administrative/agricultural `RESOLVED`/`UNRESOLVED` states, provenance with server `resolvedAt`, effective override precedence, and Polygon-only location-key changes independent of the weather fingerprint.
- [x] T004 Write failing disposable PostgreSQL/PostGIS integration tests in `apps/api/test/fields/field-schema.integration.spec.ts` for migration backfill of each existing Field's current boundary using the exact pre-SPEC-005 selector `version DESC, id ASC`, including duplicate `(fieldId, version)` ties; null pointers for Fields with no boundary; nullable legacy region pointers; same-Field pointer integrity; append-only boundary/region history; unchanged historical snapshot references; and preservation of all existing Season command-idempotency records/results during store generalization. Assert every legacy boundary row ID, version number, geometry, and snapshot reference is unchanged. Verify every fixture mutation targets exactly `ekim_hasat_test` through `apps/api/test/support/disposable-database.ts`.
- [x] T005 Implement the provider-neutral region-context types and location-key/effective-region rules in `packages/domain/src/fields/field-region-context.ts`; make `packages/domain/test/fields/field-region-context.spec.ts` pass without depending on provider payloads or Türkiye-specific identifiers.
- [x] T006 Extend Prisma relations in `apps/api/prisma/schema.prisma` with nullable same-Field current-boundary/current-region-context pointers and the new region-context history. Do not add uniqueness on existing `FieldBoundaryVersion(fieldId, version)` values; preserve duplicates and null legacy pointers. Generalize `SeasonCommandIdempotencyRecord` as `BusinessCommandIdempotencyRecord`, retaining the `(userId, businessId, command, key)` uniqueness and durable result while allowing exactly one optional Field or Season target; keep onboarding `IdempotencyRecord` unchanged. Regenerate the Prisma client through the repository's normal API package workflow.
- [x] T007 Add `apps/api/prisma/migrations/20261002010000_field_management_region_resolution/migration.sql` for the Field boundary/region persistence and generalized command-idempotency schema. Rename/adapt the Season command record table without losing its existing rows/results; add the Field target and an exactly-one-target constraint. Backfill only the new current-boundary pointer to the exact row selected by the old `version DESC, id ASC` query, including ties; leave Fields without boundaries null. Preserve every boundary row, legacy version number, and snapshot reference. Do not add `(fieldId, version)` uniqueness. Migration must make no resolver calls, infer or bulk-write region values, or require external-data backfill.
- [x] T008 Run T004's schema integration cases against verified `ekim_hasat_test` to confirm exact legacy current-boundary selection including ties, null no-boundary/legacy-region pointers, same-Field constraints, unchanged historical references/versions, and preserved Season command-idempotency records/results. Run exclusively against that database.

---

## Phase 3: User Story 1 - Find and inspect my fields (Priority: P1) 🎯 MVP

**Goal**: Provide authorized, stable Field list and detail reads on mobile, including explicit unresolved region state and a read-only ACTIVE season summary.

**Independent Test**: With Fields in multiple Businesses, verify the list returns only currently authorized records in `(name ASC, id ASC)` order with page sizes 50 by default and at most 100, and that detail returns current Field state, an explicit unresolved projection for null legacy region context, and only a read-only ACTIVE season summary.

### Tests for User Story 1 (write first; confirm failure before implementation)

- [x] T009 [P] [US1] Write failing list contract tests in `apps/api/test/fields/fields-read.contract.spec.ts` for default/maximum page sizes, `(name, id)` continuation, malformed cursors, privacy-safe authorization outcomes, and the approved `FieldPage` contract.
- [x] T010 [US1] Write failing API/PostGIS integration tests in `apps/api/test/fields/fields-read.integration.spec.ts` for authorized Business-scoped list/detail reads, cross-Business privacy-safe denial, membership revocation, duplicate-name cursor traversal, and null legacy region pointers projected as `UNRESOLVED` on detail. Verify correlated diagnostics and that logs omit credentials and unnecessary raw location details; use only verified `ekim_hasat_test` fixtures and execute exclusively.
- [x] T011 [P] [US1] Write failing mobile screen tests in `apps/mobile/test/fields/fields-screen.test.tsx` for loading, empty, retryable error, authorized list/detail navigation, visible unresolved text, and read-only active-season content.

### Implementation for User Story 1

- [x] T012 [US1] Implement authorized keyset list and detail queries, `(name ASC, id ASC)` ordering, 50 default/100 maximum limits, Field-scoped cursor validation, and unresolved legacy projection in `apps/api/src/fields/fields-read.repository.ts`.
- [x] T013 [US1] Implement the Fields read application service in `apps/api/src/fields/fields-read.service.ts`, resolving current membership/scope for each request and returning privacy-safe absent/out-of-Business outcomes.
- [x] T014 [US1] Implement `GET /fields` and `GET /fields/{fieldId}` contract handlers in `apps/api/src/fields/fields-read.controller.ts`, including the read-only ACTIVE season projection and request correlation context; use the shared structured `ApiError` presentation path established by Season commands, retaining privacy-safe 403/404 behavior.
- [x] T015 [US1] Define the Fields feature module's read controller and providers in `apps/api/src/fields/fields.module.ts`; leave root API module registration to T057. Do not change SPEC-001 onboarding or SPEC-002 season mutation contracts.
- [x] T016 [US1] Implement the typed Fields read client in `apps/mobile/src/features/fields/fields-client.ts` using `packages/api-client/src/generated/fields-api.ts`.
- [x] T017 [US1] Implement the Tarlalar list and Field detail screens in `apps/mobile/src/features/fields/fields-screen.tsx` with loading, empty, denied, and retryable error states; show current region/provenance or `UNRESOLVED` in Field detail, and include only the read-only ACTIVE season summary there.
- [x] T018 [US1] Run the User Story 1 contract, integration, and mobile tests in `apps/api/test/fields/fields-read.contract.spec.ts`, `apps/api/test/fields/fields-read.integration.spec.ts`, and `apps/mobile/test/fields/fields-screen.test.tsx`; verify tenant isolation and no duplicate/omitted rows for unchanged sort keys. Run the writable integration suite exclusively against `ekim_hasat_test`.

---

## Phase 4: User Story 2 - Add another field (Priority: P1)

**Goal**: Let an authorized farmer create a point or Polygon Field on mobile, with a concurrency-safe default name and required idempotent create semantics.

**Independent Test**: Create point-only and Polygon Fields through the supported mobile location choices; verify server-derived representative point, no fabricated point-only boundary, unverified Polygon, first-available `Tarla N`, concurrent allocator safety, exact idempotent retries, and recoverable failures.

### Tests for User Story 2 (write first; confirm failure before implementation)

- [x] T019 [P] [US2] Write failing create contract tests in `apps/api/test/fields/fields-create.contract.spec.ts` for required `Idempotency-Key`, server-derived authenticated/business/command scope, create payload validation, ETag response, exact canonical replay, changed payload/context conflict, privacy-safe `ApiError` responses and point/Polygon response shapes.
- [x] T020 [US2] Write failing API/PostGIS integration tests in `apps/api/test/fields/fields-create.integration.spec.ts` for authorized creation, cross-Business create denial, concurrent first-available `Tarla N` allocation within a Business, duplicate farmer-entered names, representative-point derivation, point-only null boundary pointer, unverified Polygon history, durable same-key/same-payload replay with no duplicate Field, changed payload conflict, changed authenticated/Business/command context conflict (never cross-context replay), and concurrent same-context key submissions producing one canonical Field/result in `BusinessCommandIdempotencyRecord`. Verify correlated diagnostics and that logs omit credentials and unnecessary raw location details; verify and target exactly `ekim_hasat_test`, executing exclusively.
- [x] T021 [P] [US2] Write failing mobile creation tests in `apps/mobile/test/fields/field-create-screen.test.tsx` for current-location, map-point and Polygon alternatives, optional location permission, validation/network failures, and success only after server acceptance.

### Implementation for User Story 2

- [x] T022 [US2] Implement create command validation and first-available generated-name selection in `apps/api/src/fields/fields-create.service.ts`; serialize allocation per authorized Business and keep trimmed nonblank farmer names nonunique.
- [x] T023 [US2] Implement transactional Field creation and persist/replay the canonical response through `BusinessCommandIdempotencyRecord` using `(userId, businessId, CREATE_FIELD, key)` scope. Serialize Field-create lookup per authenticated user/key, conflict on any changed payload or context, and use the generalized store rather than onboarding's incompatible `IdempotencyRecord`. Include server-owned representative point derivation, nullable current-boundary pointer, and initial unresolved/resolved region context persistence in `apps/api/src/fields/fields-create.repository.ts`.
- [x] T024 [US2] Implement `POST /fields` in `apps/api/src/fields/fields-create.controller.ts` with mandatory `Idempotency-Key`, server membership authorization, correlated errors, and ETag response; use the shared structured `ApiError` presentation path established by Season commands, preserving privacy-safe 403/404 behavior and `IDEMPOTENCY_KEY_REUSED`. Keep create idempotency separate from update `If-Match` concurrency.
- [x] T025 [US2] Implement the additional-Field form in `apps/mobile/src/features/fields/field-create-screen.tsx`, reusing `apps/mobile/src/features/onboarding/map/map-adapter.tsx` without changing onboarding behavior and preserving correctable values on failure.
- [x] T026 [US2] Add create navigation from the Tarlalar screen in `apps/mobile/src/features/fields/fields-screen.tsx` and submit through `apps/mobile/src/features/fields/fields-client.ts` using one stable `Idempotency-Key` per create command.
- [x] T027 [US2] Run create contract, PostGIS integration, and mobile creation tests in `apps/api/test/fields/fields-create.contract.spec.ts`, `apps/api/test/fields/fields-create.integration.spec.ts`, and `apps/mobile/test/fields/field-create-screen.test.tsx`; verify duplicate retries do not allocate another Field or default name. Run the writable integration suite exclusively against `ekim_hasat_test`.

---

## Phase 5: User Story 3 - Correct current field information (Priority: P1)

**Goal**: Edit supported Field values with optimistic concurrency while retaining boundary and season history and preserving work during stale-version recovery.

**Dependencies**: User Story 1 provides canonical Field detail; User Story 2 establishes Field creation and current location state.

**Independent Test**: Edit name/location/representative point/Polygon/manual override, verify conditional updates through `Field.version` / `If-Match`, all point↔Polygon transitions, append-only boundary history, immutable snapshots, SPEC-004 weather semantics, and explicit recovery after HTTP 409 `STALE_VERSION`.

### Tests for User Story 3 (write first; confirm failure before implementation)

- [x] T028 [P] [US3] Write failing update contract tests in `apps/api/test/fields/fields-update.contract.spec.ts` for required `If-Match`, blank-name rejection, omitted-name preservation, successful ETag version increment, and existing HTTP 409 `STALE_VERSION` response semantics.
- [x] T029 [US3] Write failing persistence/concurrency integration tests in `apps/api/test/fields/fields-update.integration.spec.ts` for stale compare-and-swap rejection, cross-Business update denial without existence disclosure, concurrent edits, atomic boundary/override updates, Polygon→Polygon, Polygon→Point, Point→Polygon, append-only versions, and unchanged `SeasonContextSnapshot`. Verify correlated diagnostics and that logs omit credentials and unnecessary raw location details; target exactly `ekim_hasat_test` and execute exclusively.
- [x] T030 [P] [US3] Write failing mobile edit tests in `apps/mobile/test/fields/field-edit-screen.test.tsx` verifying attempted values remain in edit-session state after stale conflict, latest canonical Field is loaded and shown, no automatic retry/overwrite/merge/rebase occurs, and another mutation requires explicit farmer action.
- [x] T031 [US3] Write failing SPEC-004 regression tests in `apps/api/test/fields/fields-weather-location.integration.spec.ts` confirming a representative-point change invalidates old-point weather reads while a Polygon-only change with the same representative point preserves weather fingerprint behavior; target exactly `ekim_hasat_test` and execute exclusively.

### Implementation for User Story 3

- [x] T032 [US3] Implement the version-conditional Field update application service in `apps/api/src/fields/fields-update.service.ts`, validating only supported edits and mapping stale compare-and-swap outcomes to existing `409 STALE_VERSION` semantics.
- [x] T033 [US3] Implement atomic update persistence in `apps/api/src/fields/fields-update.repository.ts` so name, representative point, current boundary pointer/version, region-context pointer/override, and Field version participate in one authorized transaction; retain all earlier boundary/context versions and never mutate `SeasonContextSnapshot`.
- [x] T034 [US3] Implement `PATCH /fields/{fieldId}` in `apps/api/src/fields/fields-update.controller.ts` with mandatory `If-Match`, current membership/scope checks, ETag response, and no create-name allocation path; use the shared structured `ApiError` presentation path established by Season commands with machine-readable `STALE_VERSION`, privacy-safe 403/404 behavior, and correlation IDs.
- [x] T035 [US3] Implement the Field edit screen in `apps/mobile/src/features/fields/field-edit-screen.tsx`; on `STALE_VERSION`, preserve attempted values, fetch latest canonical state, expose both values and conflict text, and wait for an explicit farmer choice before submitting again. Depends on T030 and T036.
- [x] T036 [US3] Add Field update calls to `apps/mobile/src/features/fields/fields-client.ts` using generated request/response types and the current ETag; never send Field mutations offline or queue them for later synchronization. Complete before integrated edit-screen implementation T035.
- [x] T037 [US3] Run update contract, persistence/concurrency, mobile conflict, and SPEC-004 regression tests in `apps/api/test/fields/fields-update.contract.spec.ts`, `apps/api/test/fields/fields-update.integration.spec.ts`, `apps/mobile/test/fields/field-edit-screen.test.tsx`, and `apps/api/test/fields/fields-weather-location.integration.spec.ts`. Run both writable integration suites exclusively against `ekim_hasat_test`.

---

## Phase 6: User Story 4 - Understand location and agricultural region (Priority: P2)

**Goal**: Present administrative location and agricultural region separately, expose provenance and unresolved outcomes, preserve manual overrides, and support bounded idempotent resolution of existing Fields.

**Dependencies**: Foundational context persistence and User Stories 1–3 provide authorized Field reads, creates, and edits. Region resolution remains best-effort and does not block valid Field operations.

**Independent Test**: Exercise partial, valid, missing, stale, and unavailable resolver outcomes for new and existing Fields; verify location-key freshness, provenance, idempotent replay, override precedence, null-pointer legacy projection, and accessible status announcements.

### Tests for User Story 4 (write first; confirm failure before implementation)

- [x] T038 [P] [US4] Write failing resolver domain tests in `packages/domain/test/fields/field-region-resolution.spec.ts` for independent administrative/agricultural outcomes, normalized provenance and quality, server `resolvedAt`, current-location-key matching, unresolved behavior, and override precedence without provider payloads.
- [x] T039 [US4] Write failing existing-Field resolution integration tests in `apps/api/test/fields/field-region-resolution.integration.spec.ts` for bounded one-Field resolution using current representative point, idempotent replay by Field/location key/source versions, stale-result discard, tenant scope, legacy null-pointer handling, override preservation, and unavailable-source `UNRESOLVED`. Verify correlated resolver diagnostics use reason codes without raw provider payloads or unnecessary coordinates; target exactly `ekim_hasat_test` and execute exclusively.
- [x] T040 [P] [US4] Write failing mobile accessibility tests in `apps/mobile/test/fields/field-accessibility.test.tsx` for visible loading/result/error/conflict/unresolved text, screen/form-level announcements for asynchronous save and region transitions, deduplication across repeated renders/state updates, and meaning that does not depend on color.

### Implementation for User Story 4

- [x] T041 [US4] Implement provider-neutral administrative and agricultural resolver ports plus the explicit unavailable result in `apps/api/src/regions/region-resolver.port.ts` and `apps/api/src/regions/unavailable-region-resolver.ts`; keep provider payloads outside domain and client contracts.
- [x] T042 [US4] Implement qualified-source version selection and normalization in `apps/api/src/regions/region-resolution.service.ts`; return unresolved when no qualified dataset/source is configured, and retain source ID, source-data version, quality/confidence scale, and server `resolvedAt` for accepted results.
- [x] T043 [US4] Implement the bounded existing-Field resolution application operation in `apps/api/src/fields/resolve-existing-field-region.service.ts`; resolve one currently authorized Field from its current representative point/location key, discard stale results, deduplicate repeats for the same Field/key/source versions, and carry forward any manual override unchanged.
- [x] T044 [US4] Integrate create/edit region resolution with `apps/api/src/fields/fields-create.service.ts` and `apps/api/src/fields/fields-update.service.ts` so resolver absence, outage, invalid data, or missing coverage never blocks a valid Field write and results never replace manual overrides.
- [x] T045 [US4] Implement region context rendering and accessible async status announcements in `apps/mobile/src/features/fields/field-region-context.tsx` and `apps/mobile/src/features/fields/field-status-announcement.tsx`; keep status text available, announce only meaningful screen/form-level transitions once, and reuse repository React Native accessibility roles/live-region conventions.
- [x] T046 [US4] Run resolver domain, existing-Field PostGIS integration, mobile accessibility, and read-projection tests in `packages/domain/test/fields/field-region-resolution.spec.ts`, `apps/api/test/fields/field-region-resolution.integration.spec.ts`, and `apps/mobile/test/fields/field-accessibility.test.tsx`; verify no announcement storms and no writes for stale resolutions. Run the writable integration suite exclusively against `ekim_hasat_test`.

### Conditional production source task

- [ ] T047 [US4] Only after a source passes the provenance, license/terms, nationwide coverage, stable identifier, data-version, coordinate-reference, and quality qualification in `specs/005-field-management-region-resolution/research.md`, implement its adapter in `apps/api/src/regions/qualified-region-dataset.adapter.ts`; until then keep production resolution unavailable and Fields explicitly `UNRESOLVED` without substituting statistical regions or fabricated values.

---

## Phase 7: Polish and Cross-Cutting Verification

**Purpose**: Verify the complete SPEC-005 slice without expanding into excluded product behavior.

- [x] T048 [P] Verify generated transport output is reproducible from `specs/005-field-management-region-resolution/contracts/fields.openapi.yaml` through `packages/api-client/openapi-generator.config.ts` and rerun the consumer type checks in `packages/api-client/test/fields-consumer.type-test.ts`.
- [x] T049 Verify all new writable API integration suites use the shared guard in `apps/api/test/support/disposable-database.ts` and refuse any target other than exactly `ekim_hasat_test`. Run any remaining migration/PostGIS checks exclusively, after the story, generalized idempotency, and future-activation integration suites finish.
- [x] T050 Run every implementation validation scenario in `specs/005-field-management-region-resolution/quickstart.md` and reconcile `specs/005-field-management-region-resolution/checklists/field-management.md` with actual test evidence; run writable scenarios exclusively against verified `ekim_hasat_test`; do not claim physical VoiceOver/TalkBack validation unless performed.
- [x] T051 Review changed API/domain/mobile boundaries in `apps/api/src/fields/`, `apps/api/src/regions/`, `apps/api/src/seasons/`, `packages/domain/src/fields/`, `apps/mobile/src/features/fields/`, `apps/mobile/src/app-composition.ts`, and `apps/mobile/App.tsx` against SPEC-005 exclusions. Confirm no onboarding behavior, unrelated navigation semantics, task/plan mutation, weather-provider, generic offline-sync, scheduler, or bulk-backfill behavior was added.

## Phase 8: Activation and Production Composition

**Purpose**: Capture explicit current Field context only for future Season activations and make the approved Fields feature reachable and composed in production.

- [x] T052 Write failing PostgreSQL integration cases in `apps/api/test/seasons/season-activation.integration.spec.ts` for future activation snapshot behavior: read `Field.currentBoundaryVersionId` exactly (including null after Polygon-to-Point), snapshot current administrative and agricultural states/values, each resolved suggestion's source, confidence/quality, `dataVersion`, and `resolvedAt`, and the explicit override value/state when present; when the region pointer is null, snapshot both domains as `UNRESOLVED` with no override. Prove there is no version-order fallback and all pre-existing `SeasonContextSnapshot` rows remain byte-for-byte/value-for-value unchanged. Author early if useful, but run only after T008 and T058 and only against verified `ekim_hasat_test`, exclusively.
- [x] T053 Update future activation persistence in `apps/api/src/seasons/seasons-activation.repository.ts` and its activation snapshot mapping/types to read `Field.currentBoundaryVersionId` and the current region-context pointer in the activation transaction, then store the exact boundary ID and a normalized region-context snapshot in the new `SeasonContextSnapshot`; project a null region pointer as both domains `UNRESOLVED` with no override. Remove activation-time historical boundary lookup/fallback. Do not update, delete, backfill, or rebind any existing snapshot. Complete after T052's intended RED result.
- [x] T054 Write a failing production mobile route/navigation integration test in `apps/mobile/test/fields/fields-navigation.integration.test.tsx` (and `apps/mobile/test/app-composition.test.ts` where the route state is owned) proving the approved `Bugün | Takvim | Tarlalar | + | Daha Fazla` navigation exposes the Field list, Field detail, and add-field entry, while preserving unrelated route meanings and adding no Calendar workflow.
- [x] T055 Register the Tarlalar list/detail route and approved navigation position through `apps/mobile/src/app-composition.ts` and `apps/mobile/App.tsx`; list selection opens detail and the Tarlalar add action opens create. Do not repurpose unrelated routes or redesign navigation. Complete after T054's intended RED result and the list/detail/create screens exist.
- [x] T056 Write focused API module/DI tests in `apps/api/test/fields/fields-composition.spec.ts` proving Fields routes resolve with provider-neutral region ports, the bounded existing-Field resolution operation is available, and the unavailable resolver is selected when no qualified provider is registered. Verify provider payload types do not cross the resolver abstraction. Keep these tests non-database and scoped to module composition.
- [x] T057 Wire runtime composition in `apps/api/src/regions/regions.module.ts` and `apps/api/src/main.ts` by registering the Fields module defined in T015 and the Regions module; ensure Fields routes, resolver ports/providers, bounded resolution use case, and unresolved/no-qualified-provider implementation are available in the running API. Keep provider payloads behind the resolver abstraction. Main Agent owns this task and the shared root/module wiring.
- [x] T058 Update Season create, activation, and plan-task repositories plus their scoped idempotency tests to use the generalized `BusinessCommandIdempotencyRecord` while preserving the current `(userId, businessId, command, key)` scope, retained results, replay/conflict semantics, and authorization behavior. Own `apps/api/src/seasons/seasons-create.repository.ts`, `apps/api/src/seasons/seasons-activation.repository.ts`, `apps/api/src/seasons/seasons-plan-task.repository.ts`, and their existing Season integration tests. Run writable suites only against verified `ekim_hasat_test`, exclusively; Main Agent owns this compatibility work because it overlaps activation integration.
- [x] T059 Write failing focused presentation tests in `apps/api/test/observability/api-error-presentation.spec.ts` for the shared structured `ApiError` path: preserve machine-readable `STALE_VERSION` and `IDEMPOTENCY_KEY_REUSED`, the existing `{ error: { code, message, requestId } }` envelope, privacy-safe 403/404 responses, correlation IDs, and unchanged Season command presentation behavior. Keep tests non-database.
- [x] T060 Generalize the existing structured Season command error presentation into one reusable path in `apps/api/src/observability/api-error.filter.ts` (adapting `apps/api/src/seasons/seasons-error.filter.ts` to use it) so Field and Season command handlers share the same `ApiError` envelope, error-code handling, request context, and logging. Do not add a competing error framework or alter unrelated onboarding response behavior. Complete after T059's intended RED result; Main Agent owns this shared error path.

---

## Dependencies & Execution Order

Story phases organize delivery; they are not phase-wide barriers. Use these task-level dependencies so independent domain, contract, API, and mobile work can start when its actual prerequisite is complete.

### Task Dependencies

- **Shared client contract**: T001 must fail before T002 generates the client. T016 and T036 require T002.
- **Shared error presentation**: T059 may be authored early; T060 follows its confirmed RED result. Field read/create/update controller tasks T014, T024, and T034 require T060 so they use the single structured `ApiError` path.
- **Foundation**: T005 follows T003's confirmed RED run. T006 follows T004's confirmed RED run. T007 follows T006 and T004's confirmed RED run. T008 follows T007. Domain tests and schema tests do not depend on T001/T002 and may start immediately.
- **US1 reads**: T012 follows T007 and the confirmed RED runs of T009/T010. T010 can be authored early, but its database RED run requires T008. T013 follows T012; T014 follows T013; T015 follows T014. T016 follows T002. T017 follows T011's confirmed RED run, T015, and T016. T018 follows T012–T017.
- **US2 create**: T022 follows T007 and T019/T020's confirmed RED runs. T020 can be authored early, but its database RED run requires T008. T023 follows T022; T024 follows T023. T025 follows T021's confirmed RED run and T016. T026 follows T017, T024, and T025. T027 follows T022–T026.
- **US3 edit**: T032 follows T007 and the confirmed RED runs of T028/T031. T031 can be authored early, but its database RED run requires T008. T033 follows T032 and T029's confirmed RED run; T029's database RED run also requires T008. T034 follows T033. T036 follows T002 and T034. Integrated screen task T035 follows T030's confirmed RED run, T036, and T017. T037 follows T032–T036 and T031's regression coverage.
- **US4 regions**: T038 follows T003; T041 follows T005 and T038's confirmed RED run; T042 follows T041. Author T039 at any time after the approved contract, but run its RED case after T008 and T013. T043 follows T039's confirmed RED run, T042, and T013; T044 follows T023, T033, and T043; T045 follows T040's confirmed RED run and the screens it updates (T017, T025, T035); T046 follows T038–T045. T047 is conditional on source qualification and is not a dependency of T041–T046 or any other story.
- **Future activation snapshot**: Author T052 early if useful; its PostgreSQL RED run follows T008 and T058 and is exclusive on `ekim_hasat_test`. T053 follows T052's confirmed RED run and T008. It changes only future activation writes; it never backfills or mutates existing snapshots.
- **Generalized command idempotency**: T004/T008 verify the migration preserves every existing Season command record/result. T058 follows T006/T007/T008 and updates all Season command callers before T052's activation integration RED run; run its Season persistence checks exclusively on `ekim_hasat_test`. T020 then verifies Field create behavior through the same generalized store.
- **Production navigation**: T054 can be authored early; run its RED check after T017, T025, and T026 provide the route's screen/client prerequisites. T055 follows T054's confirmed RED run and T015–T017, T025–T026; Main Agent owns app composition/navigation.
- **API composition**: T056 can be authored early and remains non-database; run its RED check after T015 and T041–T044 provide the feature modules/services to compose. T057 follows T056's confirmed RED run and T015, T041–T044; Main Agent owns the one root registration in `main.ts` and shared module wiring.
- **Final verification**: T048 follows T001/T002 and generated-client consumers. T049 follows writable-suite implementation/verification tasks T008, T018, T027, T037, T046, T052, and T058. T050 and T051 follow all required story, activation, navigation, composition, idempotency, and shared error-presentation tasks T001–T046 and T052–T060; conditional T047 is not a dependency when no source qualifies. T050 also follows T048/T049.

Writable database execution has a shared exclusive resource: T004, T008, T010, T018, T020, T027, T029, T031, T037, T039, T046, T049, T052, T058, and any database-backed scenarios within T050 must never run concurrently with one another. Every run verifies `current_database() = 'ekim_hasat_test'` before mutation. Authoring those task files is not permission to execute their database fixtures in parallel.

### Within Each User Story

- Write the story's tests first and confirm they fail for the missing behavior.
- Implement domain rules and persistence/application services before controller/mobile integration where the task dependencies require it.
- Use real PostgreSQL/PostGIS for migration, geometry, concurrency, same-Field pointer, and snapshot-reference semantics; mocks do not replace those integration checks.
- Keep each API contract test and mobile journey independently runnable through repository scripts.

### Parallel Opportunities

- Safe parallel work includes T003 with T009/T011; T009 with T011; T019 with T021; T028 with T030; T038 with T040; and T048 with non-overlapping work, once their task-level prerequisites are met. These pairs use distinct files and do not execute shared-database fixtures concurrently.
- T001/T002, T035/T036, T052/T053, T054/T055, T056/T057, T058 with activation tasks, all writable `ekim_hasat_test` executions, and any implementation pair with explicit dependencies above are not parallel opportunities.

`[P]` marks only safe concurrent task execution after stated prerequisites. It is not a demand to use subagents.

### Future agent ownership (maximum four total agents)

- **Main Agent** owns T001–T002, T004, T006–T008, T015–T016, T026–T027, T028–T037, T044, T048–T060, all writable database tasks (including T010, T018, T020, T039, T046, T052, T058, T050), runtime/app composition, and integration/conflict resolution. Shared paths include Prisma/schema/migrations, `apps/api/src/main.ts`, Regions/root API module wiring, Season activation and command-idempotency callers, shared error presentation, `apps/mobile/App.tsx`, `apps/mobile/src/app-composition.ts`, and `apps/mobile/src/features/fields/fields-client.ts`.
- **Subagent A — authorized reads/list-detail UI** owns T009, T011–T014, T017. Paths: `apps/api/test/fields/fields-read.contract.spec.ts`, `apps/mobile/test/fields/fields-screen.test.tsx`, `apps/api/src/fields/fields-read.repository.ts`, `apps/api/src/fields/fields-read.service.ts`, `apps/api/src/fields/fields-read.controller.ts`, `apps/mobile/src/features/fields/fields-screen.tsx`. T015 registration and database tests remain Main-owned.
- **Subagent B — Field creation** owns T019, T021–T025. Paths: `apps/api/test/fields/fields-create.contract.spec.ts`, `apps/mobile/test/fields/field-create-screen.test.tsx`, `apps/api/src/fields/fields-create.service.ts`, `apps/api/src/fields/fields-create.repository.ts`, `apps/api/src/fields/fields-create.controller.ts`, and `apps/mobile/src/features/fields/field-create-screen.tsx`. Shared client, T026 navigation, schema, and database execution remain Main-owned.
- **Subagent C — region domain/resolver** owns T003, T005, T038, T040–T043, T045. Paths: `packages/domain/src/fields/field-region-context.ts`, `packages/domain/test/fields/field-region-context.spec.ts`, `packages/domain/test/fields/field-region-resolution.spec.ts`, `apps/api/src/regions/region-resolver.port.ts`, `apps/api/src/regions/unavailable-region-resolver.ts`, `apps/api/src/regions/region-resolution.service.ts`, `apps/api/src/fields/resolve-existing-field-region.service.ts`, `apps/mobile/test/fields/field-accessibility.test.tsx`, `apps/mobile/src/features/fields/field-region-context.tsx`, and `apps/mobile/src/features/fields/field-status-announcement.tsx`. T044 service integration, DI tests, module composition, and database execution remain Main-owned.

Subagents receive only their task IDs, owned paths, prerequisites, and relevant spec excerpts. No nested agents, broad Graft runs, or full-suite runs; each subagent runs only scoped tests. Main Agent serializes every writable `ekim_hasat_test` run and performs broad verification.

## Implementation Strategy

### MVP First

1. Complete Setup and Foundational phases, including the compatible generalized command-idempotency migration and legacy tie-preserving boundary backfill.
2. Complete User Story 1 and verify authorized list/detail independently.
3. Complete User Story 2 and verify additional Field creation; these two P1 stories form the initial management slice.
4. Complete User Story 3 to deliver safe Field editing and history preservation.
5. Complete User Story 4 with explicit unresolved behavior; enable source-specific suggestions only if T047's qualification gate passes.
6. Complete T052–T053 future activation snapshot behavior, then T054–T055 production navigation and T056–T057 API composition before calling the vertical slice reachable and integrated.

### Incremental Delivery

Use the order above as the integration and delivery checkpoints. Task execution follows the explicit dependencies in `tasks.md`, so independent tests, domain rules, and server/mobile work can progress as soon as their actual prerequisites exist. A missing qualified production region dataset leaves suggestions unavailable and unresolved; it does not block Field listing, creation, editing, or manual region overrides.

## Test-First / TDD Sequencing

For each story, execute its listed test tasks before the associated implementation tasks and confirm the tests fail for the intended missing behavior. Follow the task-level edges above rather than waiting for unrelated work in a story phase. Keep domain unit tests, API contract tests, real PostgreSQL/PostGIS integration tests, tenant-isolation tests, mobile screen tests, concurrency tests, history tests, weather regression tests, and accessibility tests as distinct evidence. Writable PostgreSQL fixtures must verify `current_database() = 'ekim_hasat_test'` before mutation, and all such suites run serially/exclusively.

## Notes

- Tasks remain strictly bounded to SPEC-005; existing SPEC-001–004 contracts and behavior are dependencies and regression references, not implementation targets.
- No generic offline Field mutation or sync queue, production region scheduler, guaranteed bulk backfill, Field delete/archive, season mutation, task/calendar behavior, weather provider, satellite/AI, or web prerequisite is included.
- T047 is the only task that requires a qualified production region dataset; if none qualifies, keep it deferred and retain the unavailable/`UNRESOLVED` behavior.

## Implementation Verification — 2026-10-04

- Completed: 59/60 tasks. T047 remains conditional and deferred because no production region source passed the qualification gate; runtime resolution remains unavailable and Fields remain explicitly `UNRESOLVED`.
- Serialized PostgreSQL/PostGIS integration checkpoint: 110/110 passed against verified `ekim_hasat_test` with PostGIS enabled.
- Domain/API unit tests: domain 78/78; API 106/106. API contract tests: 53/53. OpenAPI generated-client consistency and consumer type checks passed.
- Mobile tests: 31 suites, 175/175 passed. Physical location-permission prompts, VoiceOver, and TalkBack were not exercised on devices.
- Repository lint, typecheck, build, `git diff --check`, normal `graft build`, and `graft check` passed.

## Phase 9: Whole-Feature Review Remediation (F1–F9)

**Purpose**: Close the bounded findings from the SPEC-005 whole-feature review with test-first evidence. T047 remains conditional and non-blocking; no remediation task depends on qualifying a production region source.

### F1 — Field-list continuation

- [x] T061 Write and run RED mobile coverage in `apps/mobile/test/fields/` showing authorized Fields on a second page are reachable, duplicate rows are prevented, and loading/error/retry states are understandable while `nextCursor` is retained.
- [x] T062 Repair the production Field list in `apps/mobile/src/features/fields/` to request bounded cursor pages through the approved API client, preserve server order, deduplicate rows, and expose explicit more/loading/error/retry behavior without fetching all rows eagerly.
- [x] T063 Run scoped Field-list mobile tests GREEN, including multi-page continuation, duplicate prevention, and existing list behavior.

### F2 — stale edit canonical and attempted values

- [x] T064 Write and run RED mobile conflict tests in `apps/mobile/test/fields/` for stale name, representative location, boundary/current Polygon state, and agricultural-region override edits; assert canonical current values and attempted values remain distinguishable.
- [x] T065 Repair the Field edit conflict presentation/session in `apps/mobile/src/features/fields/` to show latest canonical values for every editable dimension while retaining attempted values and requiring explicit farmer action before any subsequent mutation.
- [x] T066 Run scoped Field edit/conflict mobile tests GREEN for each editable dimension; verify no automatic overwrite, retry, merge, or rebase occurs.

### F3 — Field PATCH geometry envelope consistency

- [x] T067 Write and run RED API/domain validation tests for mismatched outer `POINT`/embedded Polygon and outer `POLYGON`/embedded Point payloads, alongside valid matching pairs.
- [x] T068 Repair Field PATCH validation in the relevant `apps/api/src/fields/` boundary so the outer location discriminant agrees with embedded geometry type without redesigning the geometry model.
- [x] T069 Run scoped Field PATCH validation/contract tests GREEN for both rejected mismatches and accepted POINT+Point and POLYGON+Polygon inputs.

### F4 — resolved-region database provenance constraint

- [x] T070 Write and run RED PostgreSQL integration evidence in `apps/api/test/fields/` that a resolved context missing required confidence/quality is rejected, while valid resolved and valid unresolved contexts are accepted; Main verifies and exclusively targets `ekim_hasat_test`.
- [x] T071 Repair the Prisma/migration CHECK constraint so resolved rows explicitly require every mandated provenance value to be non-null, preserve unresolved rows, and retain source/dataVersion/resolvedAt invariants.
- [x] T072 Run the scoped PostgreSQL region-context constraint suite GREEN against verified `ekim_hasat_test`; retain the three required acceptance/rejection cases.

### F5 — standard domain test discovery

- [x] T073 Write/run RED script evidence showing the repository-standard domain test command does not discover SPEC-005 Field region tests under `packages/domain/test/fields/`, while existing discovery targets remain identifiable.
- [x] T074 Repair `scripts/run-node-tests.mjs` with stable directory discovery for the Field tests rather than filename-specific entries.
- [x] T075 Run the standard domain command GREEN and confirm SPEC-005 Field region tests execute without regressing existing discovery.

### F6 — Field detail location and boundary information

- [x] T076 Write and run RED mobile detail tests in `apps/mobile/test/fields/` for a representative point, a current Polygon boundary, and a point-only Field with no current boundary.
- [x] T077 Repair `apps/mobile/src/features/fields/` detail presentation to expose bounded, understandable representative-point and current-boundary information, including the point-only state, without adding GIS analysis.
- [x] T078 Run scoped Field detail mobile tests GREEN for Polygon and point-only presentations.

### F7 — Field status announcement lifecycle

- [x] T079 Write and run RED accessibility tests in `apps/mobile/test/fields/` proving same-transition renders deduplicate, an explicit retry after stale/error starts a new announced attempt, and cleared/inactive state removes the prior accessible status.
- [x] T080 Repair Field save-status identity in `apps/mobile/src/features/fields/field-edit-screen.tsx` so each explicit save/retry attempt announces independently while meaningful repeats within an attempt deduplicate and stale status clears.
- [x] T081 Run scoped Field accessibility/edit tests GREEN for retry attempts, deduplication, clearing, and existing status behavior.

### F8 — asynchronous region result announcements

- [x] T082 Write and run RED Field accessibility tests in `apps/mobile/test/fields/` for asynchronous resolved and unavailable/unresolved region transitions, visible text, deduplicated focus-independent announcements, and exactly one live announcement for errors.
- [x] T083 Repair Field-detail region-resolution accessibility wiring in `apps/mobile/src/features/fields/` to announce meaningful asynchronous results at the screen/form level while retaining visible status text with one announcement path.
- [x] T084 Run scoped Field region/accessibility tests GREEN for resolved, unavailable/unresolved, repeated-render deduplication, exactly-one error announcement, and visible text; do not claim device VoiceOver/TalkBack evidence.

### F9 — uninterrupted append-only Field/Season history protection

- [x] T085 Write and run RED targeted migration/PostgreSQL evidence demonstrating the migration sequence must not permit Field or Season context history mutation at any deploy step; Main verifies and exclusively targets `ekim_hasat_test`.
- [x] T086 Correct the unpublished SPEC-005 migration chain by removing migration behavior that drops append-only history guards, without relying on a later restore migration; preserve historical rows and separate fixture cleanup mechanics from production migration semantics.
- [x] T087 Run the complete targeted migration/DB sequence GREEN against verified `ekim_hasat_test`, proving Field and Season context append-only guards remain effective and existing history is preserved throughout the deploy sequence.

### Remediation integration checkpoint

- [x] T088 Integrate F1–F9 changes, update only remediation checkboxes backed by actual RED/GREEN evidence, run affected-system broad verification, perform `git diff --check`, and run normal `graft build` plus `graft check`; keep T047 conditional and uncompleted.

### Post-review verification rerun — 2026-10-04

- F7 retry identity and F8 duplicate-live-region repairs: focused edit/accessibility tests passed (2 suites, 8 tests); both reviewer regressions were first observed RED.
- Final affected-system rerun: `pnpm test`, `pnpm test:contract`, full mobile tests (31 suites, 180 tests), `pnpm lint`, `pnpm typecheck`, `pnpm build`, generated-client check, and `git diff --check` passed.
- Serialized API PostgreSQL/PostGIS integration: 112/112 passed after confirming `current_database() = 'ekim_hasat_test'` and PostGIS is enabled; includes resolved provenance acceptance/rejection and append-only guard/migration-chain checks.
- Normal `graft build` and `graft check` passed; `graft build --deep` was not run.

## Phase 10: SC-010 Save Error Announcement Remediation

**Purpose**: Close the final whole-feature review finding while keeping save/conflict text visible and exposing one deduplicated screen-level announcement path.

- [x] T089 Add and run RED mobile edit-screen regression coverage proving ordinary save errors and `STALE_VERSION` conflicts each retain visible error text while exposing exactly one announcement path.
- [x] T090 Repair `apps/mobile/src/features/fields/field-edit-screen.tsx` so visible save/conflict error text remains available without adding a second announcement path beside `FieldStatusAnnouncement`; preserve per-attempt identity and explicit-retry behavior.
- [x] T091 Run scoped mobile edit/accessibility tests GREEN for one announcement on ordinary and stale errors, visible text, fresh explicit retry announcements, repeated-render deduplication, clearing, success behavior, and unchanged region announcements; run relevant lint/typecheck and `git diff --check` as needed, then complete a scoped read-only review.
