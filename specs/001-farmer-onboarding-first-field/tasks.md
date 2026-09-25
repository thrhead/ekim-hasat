# Tasks: Self-Service Farmer Onboarding + First Field

**Input**: Approved design documents in `specs/001-farmer-onboarding-first-field/`  
**Scope**: SPEC-001 only. This creates minimum pnpm/Turborepo, API, mobile, domain, contract, and persistence foundations because the repository has no application source tree. No future product modules are scaffolded.

**Tests**: Required by the feature specification, Constitution, and repository rules. Domain, real PostgreSQL/PostGIS integration, API contract, tenant-isolation, mobile accessibility, and E2E coverage are included.

## Phase 1: Setup — Minimum SPEC-001 Workspace

**Purpose**: Establish only the workspace and API/mobile/domain slices required for onboarding.

- [x] T001 Create the minimum pnpm/Turborepo workspace manifests and shared TypeScript configuration in `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, and `.nvmrc`.
- [x] T002 [P] Create the NestJS/Fastify API shell and health entrypoint in `apps/api/package.json`, `apps/api/tsconfig.json`, and `apps/api/src/main.ts`.
- [x] T003 [P] Create the Expo/React Native mobile shell in `apps/mobile/package.json`, `apps/mobile/app.json`, `apps/mobile/tsconfig.json`, and `apps/mobile/App.tsx`.
- [x] T004 [P] Create the focused domain package for identity, membership, fields, and onboarding in `packages/domain/package.json` and `packages/domain/tsconfig.json`.
- [x] T005 [P] Create package manifests and dependency boundaries only for the contract source package and generated API-client package in `packages/contracts/package.json` and `packages/api-client/package.json`; do not configure code generation here.
- [x] T006 Add SPEC-001-only local PostgreSQL/PostGIS development configuration and environment validation in `compose.yaml`, `apps/api/src/config/env.ts`, and `.env.example`.

---

## Phase 2: Foundational — Persistence, Auth, Tenant Scope, and Plumbing

**Purpose**: Build shared foundations that block story implementation. No story checkpoint may pass until its required implementations and tests pass.

- [x] T007 Define Prisma models and migration for ApplicationUser (including nullable server-owned `defaultBusinessId`), Business, Membership, Field, versioned boundary, durable OnboardingCompletion, and retained IdempotencyRecord in `apps/api/prisma/schema.prisma` and `apps/api/prisma/migrations/`.
- [x] T008 Add schema constraints/indexes for unique provider-subject-to-ApplicationUser mapping; Membership uniqueness/status lookup; default-business pointer relation; one OnboardingCompletion per `(user_id, default_business_id)` referencing one Field; per-user retained idempotency-key uniqueness; and required geometry/data constraints in `apps/api/prisma/migrations/`.
- [x] T009 Define the repository transaction boundary and PostgreSQL serialization/locking behavior in `apps/api/src/onboarding/onboarding.repository.ts`: pointer present requires active Membership; missing pointer creates new Business + OWNER Membership + pointer atomically without adopting existing memberships; invalid/unauthorized pointer fails without fallback; completion and Field uniqueness converge under concurrent requests.
- [x] T010 [P] Define provider-neutral verified-subject/authentication ports in `packages/domain/src/identity/auth-provider.ts`.
- [x] T011 [P] Implement Supabase Auth verification behind the auth port, containing provider token parsing and provider-specific types in `apps/api/src/auth/supabase-auth.adapter.ts`.
- [x] T012 [P] Implement server-side Membership authorization and scope resolution; treat `defaultBusinessId` as context only, never authority, and map invalid/unauthorized pointer failures without fallback in `apps/api/src/authorization/membership-scope.service.ts`.
- [x] T013 [P] Add shared correlation-ID propagation, request/error middleware, and privacy-safe structured logging primitives in `apps/api/src/observability/correlation-id.middleware.ts` and `apps/api/src/observability/request-logger.ts`; do not implement onboarding-specific event payloads here.
- [x] T014 [P] Configure OpenAPI-to-TypeScript-client generation from `specs/001-farmer-onboarding-first-field/contracts/onboarding.openapi.yaml` in `packages/api-client/openapi-generator.config.ts` and `packages/api-client/package.json`, then generate and check in the status/completion transport types under `packages/api-client/src/generated/`; generated types must be derived from OpenAPI, include `FirstFieldSummary.createdAt`, retain OpenAPI 3.1 `5XX`, and expose only the contracted operations. Start after T005; this is independent of the other foundational tasks and must finish before any API or mobile task consumes generated types.
- [x] T015 Configure focused lint, typecheck, unit, PostgreSQL/PostGIS integration, contract, and mobile E2E commands for these packages in root `package.json`, `turbo.json`, and relevant `apps/*/package.json` files.

**Checkpoint**: Workspace and migrations run; auth, Membership authorization, correlation infrastructure, and checked-in OpenAPI-derived status/completion types are available. No out-of-scope modules exist.

---

## Phase 3: User Story 1 — Sign In and Start Farming (P1)

**Goal**: Authenticate a farmer and guide new versus returning farmers using only minimal onboarding status.

**Independent test**: New authenticated farmer receives `firstFieldOnboardingNeeded: true`; returning farmer with completed onboarding receives `false`; UI routes accordingly without a business setup prompt and the status response never contains a field list.

### Tests

- [x] T016 [P] [US1] Add auth-adapter unit tests for verified-subject mapping and invalid/expired credentials in `apps/api/test/auth/supabase-auth.adapter.spec.ts`.
- [x] T017 [P] [US1] Add status API contract and authorization tests asserting authenticated requests return only `firstFieldOnboardingNeeded`, no field list is exposed, missing/invalid authentication returns 401, and an unusable default context returns HTTP 403 using the normal privacy-safe error schema without business-existence disclosure or membership fallback in `apps/api/test/onboarding/onboarding-status.contract.spec.ts`.
- [x] T018 [P] [US1] Add mobile navigation tests for new-farmer onboarding entry and returning-farmer routing/status using the generated status client, without business or role setup, in `apps/mobile/test/onboarding/onboarding-entry.test.tsx` (depends on T014).

### Implementation

- [x] T019 [P] [US1] Implement the minimal onboarding status read model using authenticated identity, defaultBusinessId context selection, active Membership authorization, and durable completion state in `packages/domain/src/onboarding/get-onboarding-status.ts`.
- [x] T020 [US1] Expose authenticated `GET /v1/onboarding/status` with only `firstFieldOnboardingNeeded`, generated OpenAPI transport types, HTTP 403 privacy-safe context errors, and correlation ID in `apps/api/src/onboarding/onboarding.controller.ts` (depends on T014 and T019).
- [x] T021 [US1] Implement mobile sign-in boundary integration and new/returning route selection through the generated status client from T014 in `apps/mobile/src/api/onboarding-client.ts` and `apps/mobile/src/features/onboarding/onboarding-entry.tsx` (depends on T014 and T020).
- [x] T022 [P] [US1] Add farmer-language loading, authentication failure, and retry states in `apps/mobile/src/features/onboarding/onboarding-entry-view.tsx`.
- [x] T050 [US1] Mount the authenticated onboarding flow in the production app composition in `apps/mobile/App.tsx`: use the authenticated generated API client from the approved auth boundary; resolve status through T021; show T022 loading/retry states; mount T033 `FirstFieldScreen` when `firstFieldOnboardingNeeded` is true; bypass onboarding to the existing home destination when false; and leave onboarding after successful completion using the authoritative response. Do not add a general field-list request or a navigation framework. Depends on T021, T022, T033, and T051; blocks T036 and T038.
- [x] T051 [US1] Implement mobile authenticated session and API-client bootstrap behind a provider-neutral auth port, with a Supabase Auth adapter in `apps/mobile/src/auth/`: restore an existing persisted session, observe auth/session changes, support refresh, expose loading/authenticated/signed-out states, create the generated authenticated API client with the current Bearer access token, and clear client/session state on sign-out. Ignore Supabase metadata/roles/business claims for authorization; all application data and Membership authorization remain behind the generated API and server. Do not add sign-in UI or choose a sign-in method. Depends on ADR-006 and T014; blocks T050.

**Checkpoint**: T016–T022 pass; a returning farmer is routed from completion status and no general field-list API is introduced. T014 must finish before T020/T021 consume generated transport types.

---

## Phase 4: User Story 2 — Add the First Field (P1, MVP)

**Goal**: Atomically create or resolve the farmer's authorized default context and first Field, with durable completion and domain-level duplicate prevention.

**Independent test**: Submit a valid point-only completion with omitted name, then with a whitespace-only name. Verify both produce one Field named exactly `Tarla 1`, and that a padded non-empty name is trimmed. Verify one ApplicationUser, new default Business + active OWNER Membership + defaultBusinessId when absent, representative point and `createdAt`, and one durable completion referencing that Field. Verify retained-key replay/conflict, post-expiry 200 with no mutation, and concurrent convergence using PostgreSQL/PostGIS.

### Tests first — required MVP gates

- [x] T023 [P] [US2] Add domain tests for Point coordinate bounds and required representative points; Polygon validity (coordinate bounds, self-intersection, and minimum geometry requirements); Polygon-only representative-point derivation; unverified versioned boundaries; omitted/whitespace-only name normalization to exactly `Tarla 1`, trimming of non-empty names; completion result identity; and `createdAt` in `packages/domain/test/onboarding/complete-onboarding.spec.ts`.
- [x] T024 [P] [US2] Add PostgreSQL/PostGIS integration tests calling `OnboardingRepository.persistFirstFieldOnboardingCompletion` directly for successful atomic new Business/OWNER Membership/defaultBusinessId/Field/optional boundary/completion/idempotency persistence; transaction rollback with no partial state using deterministic test-only database-side failure injection after persistence begins or at commit (no production failure hook); active-membership enforcement for an existing pointer; no fallback on invalid/unauthorized pointer; and untouched unrelated memberships in `apps/api/test/onboarding/onboarding-transaction.integration.spec.ts`. Tests must not write the completion rows themselves through `withAuthorizedDefaultContext`.
- [x] T025 [P] [US2] Add real PostgreSQL concurrency and idempotency integration tests proving one completion per `(user_id, default_business_id)`, one referenced Field, concurrent requests converge, lost-response retry returns original result, retained same-key/different-payload returns 409, and after configured key expiry completion returns the existing summary with 200 and no mutation in `apps/api/test/onboarding/onboarding-idempotency.integration.spec.ts`.
- [x] T026 [P] [US2] Add tenant-isolation/permission tests proving Membership is the sole authorization authority, defaultBusinessId cannot grant access, forged or invalid business context cannot select another business, and errors do not disclose unrelated business existence in `apps/api/test/onboarding/onboarding-tenant-isolation.integration.spec.ts`.
- [x] T027 [P] [US2] Add OpenAPI request/response contract tests for the only two operations (`GET /v1/onboarding/status`, `POST /v1/onboarding/complete`), including status authentication (401), unusable default-context denial (403 with the normal privacy-safe Error schema and no business-existence disclosure), FirstFieldSummary.createdAt, idempotency errors/status codes, geometry, and the retained OpenAPI 3.1 `5XX` range in `apps/api/test/onboarding/onboarding-contract.spec.ts`.

### Implementation — ordered after schema/repository contract and tests

- [x] T028 [US2] Implement provider-neutral point/polygon validation covered by T023, including GeoJSON coordinate bounds and the approved polygon validity rules, in `packages/domain/src/fields/field-location.ts` (depends on T023).
- [x] T029 [US2] Implement the single repository completion operation `OnboardingRepository.persistFirstFieldOnboardingCompletion` against T007–T009 models/constraints in `apps/api/src/onboarding/onboarding.repository.ts`, with the inputs, committed outcome, authorization, and atomic transaction boundary defined in `plan.md`: authenticate-resolved User lookup; active-Membership check for a present default pointer; safe failure with no fallback; atomic creation of Business + OWNER Membership + pointer when absent; PostgreSQL/PostGIS Field persistence; unique durable completion lookup/insert; and transaction serialization for concurrent completion. Check a retained key before domain completion: matching payload replays the original result, mismatching payload returns a conflict outcome for the upper layer to map to 409. After key expiry, return an existing completion without mutation. Keep validation and name normalization in T030; do not add separate public methods for individual writes.
- [x] T030 [US2] Implement the domain completion use case only after geometry validation and repository behavior are in place in `packages/domain/src/onboarding/complete-onboarding.ts`: validate auth/context; normalize optional name by trimming leading/trailing whitespace and assign exactly `Tarla 1` when omitted or empty after trimming; pass the idempotency key and payload fingerprint to T029 so its transactional retained-key check takes precedence, then map replay or conflict to the approved command response and return existing durable completion without mutation or the newly committed Field + optional Polygon boundary + completion + retained idempotency result (depends on T028 and T029).
- [x] T031 [US2] Expose authenticated `POST /v1/onboarding/complete` with required `Idempotency-Key`, generated contract types from T014, 201 for first commit, 200 for replay/already-complete after expiry, 409 for retained key payload mismatch, stable errors, and no client-selectable business/membership in `apps/api/src/onboarding/onboarding.controller.ts` (depends on T014 and T030).
- [x] T032 [P] [US2] Implement provider-neutral map adapter using `react-native-maps` for current location, map-point selection, polygon drawing, and permission-denial fallback in `apps/mobile/src/features/onboarding/map/map-adapter.tsx`.
- [x] T033 [US2] Build the mobile first-field form for optional name and supported location choices through the generated completion client from T014; use the returned `FirstFieldSummary` for post-save confirmation/current first-field state and show saved state only after the committed completion response in `apps/mobile/src/features/onboarding/first-field-screen.tsx` (depends on T014, T031, and T032).
- [x] T034 [P] [US2] Implement accessible onboarding controls with screen-reader accessible names and roles, system text scaling, platform-appropriate minimum touch targets, and sufficient text/control contrast in `apps/mobile/src/features/onboarding/first-field-controls.tsx`.
- [x] T035 [P] [US2] Add automated mobile accessibility assertions for accessible names/roles, scalable text, touch targets, and contrast where supported in `apps/mobile/test/onboarding/onboarding-accessibility.test.tsx`.
- [ ] T036 [US2] Perform and record manual VoiceOver (iOS) and TalkBack (Android) onboarding smoke checks in `apps/mobile/e2e/accessibility/onboarding-accessibility.md` (depends on T050 so the production flow is reachable).

**MVP Checkpoint**: Do not pass US2 until T014 and T023–T036 pass. In particular, both point and polygon validation tests in T023 must pass and their implementation in T028 must be complete before the completion command in T030 can pass. The gate also includes transaction atomicity, database concurrency/idempotency behavior and tests, authorization/business isolation, API contract behavior, generated-client consumption, and mobile accessibility evidence.

---

## Phase 5: User Story 3 — Recover from Interruption or Failure (P2)

**Goal**: Preserve only temporary form inputs on the same device/account, recover them after supported interruptions, and present clear retry/error states.

**Independent test**: Draft starts persisting after name or geometry entry, recovers after connectivity loss/restart/process termination, expires after 7 inactive days, and purges on each specified lifecycle event. Failed/uncertain saves never show false success; command retry uses idempotency already implemented and verified in US2.

### Tests

- [x] T037 [P] [US3] Add mobile durable-draft tests for persistence on name/geometry entry, same-account scope, recovery after connectivity loss, app restart, and process termination, seven-day inactivity/activity reset, save/cancel/sign-out/account-switch purge, and secret exclusion in `apps/mobile/test/onboarding/onboarding-draft.test.ts`.
- [ ] T038 [P] [US3] Add Maestro mobile E2E flow for new-farmer success and returning-farmer routing, permission denial with alternate location entry, weak connectivity, validation failure, no false save state, committed-response loss plus retry, and concurrent completion convergence in `apps/mobile/e2e/onboarding.e2e.yaml` (depends on T050 so flows exercise reachable production onboarding UI).
- [ ] T039 [P] [US3] Add Maestro mobile E2E flow for draft persistence and recovery after connectivity loss, app restart, and process termination, plus the 7-day expiry/purge lifecycle in `apps/mobile/e2e/onboarding-draft.e2e.yaml`.
- [ ] T040 [P] [US3] Add Maestro mobile E2E flow for authorization-denial and forged/invalid context scenarios, asserting no cross-business access or fallback in `apps/mobile/e2e/onboarding-authorization.e2e.yaml`.
- [x] T041 [P] [US3] Add tests that shared request correlation IDs flow through onboarding and feature-specific start/context-resolution/save/failure events exclude secrets, tokens, and unnecessary personal/location data in `apps/api/test/onboarding/onboarding-observability.spec.ts`.

### Implementation

- [x] T042 [P] [US3] Implement durable app-local temporary draft storage containing only optional field name and location geometry, scoped to authenticated account and excluded from the domain outbox in `apps/mobile/src/features/onboarding/onboarding-draft.store.ts`.
- [x] T043 [US3] Implement seven-consecutive-day inactivity expiry/activity reset and purge after successful save, explicit cancellation, sign-out, or account switch in `apps/mobile/src/features/onboarding/onboarding-draft.lifecycle.ts`.
- [x] T044 [US3] Restore drafts on the same device/account after connectivity loss, app restart, or process termination; retain values on validation/command failure and never imply save before commit in `apps/mobile/src/features/onboarding/first-field-screen.tsx`.
- [x] T045 [US3] Add farmer-language recovery states for connectivity, map unavailability, invalid geometry, authorization/session expiry, and uncertain-save retry in `apps/mobile/src/features/onboarding/onboarding-recovery.tsx`.
- [x] T046 [US3] Emit feature-specific onboarding-start, default-business-resolution, field-save, and recoverable-failure events using shared correlation/logging infrastructure in `apps/api/src/onboarding/onboarding.observability.ts`.

**Checkpoint**: T037–T046 pass; supported draft recovery and purge behavior is verified and all error/retry states avoid false success.

---

## Phase 6: Polish — SPEC-001 Convergence

**Purpose**: Verify the bounded slice and align implementation evidence with design artifacts.

- [ ] T047 Run the SPEC-001 quickstart scenarios against the implemented API/mobile flow and record remaining gaps in `specs/001-farmer-onboarding-first-field/quickstart.md`.
- [x] T048 [P] Verify generated API client output is reproducible from the checked-in OpenAPI source, including FirstFieldSummary.createdAt and the 5XX response range, in `packages/api-client/README.md`.
- [x] T049 [P] Confirm implementation and package manifests contain no general field listing/management or unrelated crop, season, weather, satellite, finance, AI, team, CMS, worker, or future platform modules in `specs/001-farmer-onboarding-first-field/tasks.md`.

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (Phase 1)**: T002–T006 depend on T001 root workspace conventions; T002, T003, T004, and T005 can proceed in parallel after T001. T006 needs the API shell.
- **Foundational (Phase 2)**: T007 defines schema/models; T008 adds database constraints; T009 defines repository serialization/transaction behavior and depends on T007–T008. T010–T013 are independent after package paths exist. T014 [P] starts after T005 and the checked-in OpenAPI contract is available; it is independent of the other foundational tasks and must finish before any consuming API/mobile task. T015 wires available commands after package manifests exist.
- **US1 (Phase 3)**: Depends on foundational auth, membership scope, status contract, generated types (T014), and API host. T016/T017 are API tests; T018 waits for generated status-client types (T014). T019 implements the read model; T020 follows T014/T019; T021 follows T014/T020. T022 uses a separate view component after the onboarding entry interface is established. T051 bootstraps an existing Supabase session and authenticated generated client after ADR-006/T014; it selects no sign-in method and blocks T050. T050 composes the production path after T021, T022, T033, and T051; it blocks T036/T038.
- **US2 (Phase 4)**: Test-first T023–T027 may be authored once T007–T009 and the contract are established; T023 includes point and polygon validation tests, and database tests run against real PostgreSQL/PostGIS. T028 implements that validation after T023. T029 implements repository behavior; T030 domain completion depends on both T028 geometry validation and T029 repository behavior; then T031 exposes the API and consumes generated types from T014. T032 map adapter and T034 accessible controls can proceed on separate surfaces; T033 consumes generated types from T014 and depends on T031/T032. T035 provides automated accessibility assertions; T036 manual accessibility checks wait for T050 production reachability. US2 cannot pass before T023–T036 pass.
- **US3 (Phase 5)**: Depends on the completed US2 command contract and mobile form. T037–T041 test tasks can be authored in parallel; T042–T046 implement draft lifecycle, recovery UX, and feature observability. API idempotency/concurrency correctness is already an US2 gate, not deferred to this phase.
- **Polish (Phase 6)**: Depends on all three story checkpoints.

### Story order

1. **US1 (P1)** authenticated entry and minimal status.
2. **US2 (P1)** first-field creation and the MVP atomic transaction/idempotency slice.
3. **US3 (P2)** temporary draft recovery and failure UX hardening.

### Parallelizable groups

- **Setup**: T002–T005 after T001; T006 after T002.
- **Foundation**: T010–T013 can proceed independently; T007 → T008 → T009 remain ordered. T014 [P] runs independently after T005 and contract stabilization, then blocks every generated-type consumer.
- **US1**: T016/T017 can be authored in parallel; T018 waits for T014. T019 and T022 use separate domain/view files; T020 waits for T014/T019, then T021 waits for T020.
- **US2**: T023–T027 tests can be authored in parallel after schema/repository contract. T028 geometry validation follows T023's point/polygon validation tests and must precede T030 completion-command implementation. T032 map adapter, T034 accessible controls, and T035 automated accessibility assertions are separate surfaces; T031/T033 consume T014 output.
- **US3**: T037–T041 tests can be authored in parallel; T046 feature event implementation is independent of mobile draft files after shared logging exists.
- **Polish**: T048 and T049 are independent after feature completion.

## Critical Path

T001 → T002/T005, then in parallel T014 [P] (generate checked-in OpenAPI transport types) and T007 → T008 → T009 (persistence and transaction foundation). The US1 status path then proceeds through T019 → T020 → T021, with T014 complete before API/mobile generated-type consumption. T051 follows ADR-006/T014 and provides session restoration plus the authenticated generated client; T050 follows T021, T022, T033, and T051, then unblocks T036 and T038. For US2, T023 validation tests → T028 geometry validation must complete before T030 domain completion; the repository path T007 → T008 → T009 → T029 also feeds T030. Then T030 → T031 → T033 → T050 → T036 → US2 MVP checkpoint, with T025 concurrency/idempotency tests and T027 contract tests also required at the checkpoint; T014 is complete before T031/T033. After US2, T042 → T043 → T044 (draft lifecycle/recovery) → T038/T039 E2E verification → T047.

## Parallel Example: User Story 2

```text
After schema/constraint and transaction contracts (T007–T009) are settled:
- T023 domain behavior tests
- T024 transaction/default-context integration tests
- T025 concurrency/idempotency integration tests
- T026 tenant-isolation tests
- T027 OpenAPI contract tests
- T032 map adapter
- T034 accessible controls
- T035 automated accessibility assertions
```

After T023 defines the point and polygon validation expectations, T028 implements them; T030 must wait for T028 as well as repository behavior from T029. The repository transaction, domain command, API exposure, generated-client consumption, and mobile form integration follow this explicit dependency order. A test may be written before its implementation, but the US2 checkpoint remains blocked until both tests and implementation pass.

## Implementation Strategy

### MVP First

Complete Setup and Foundational phases, then US1 and US2. The US2 MVP includes passing point and polygon validation tests and geometry validation, durable domain completion, transactional default-context creation/authorization, database concurrency and idempotency tests, API contract/client alignment, first-field mobile UX, and accessibility evidence. Do not claim MVP readiness until the US2 checkpoint passes.

### Incremental Delivery

1. Deliver US1 authenticated entry and minimal status.
2. Deliver US2 atomic first-field completion as the P1 vertical slice.
3. Deliver US3 durable local draft recovery and interruption UX.
4. Complete quickstart and generated-client reproducibility checks.

### Explicit Scope Exclusions

No general field listing or later field management; crop, season, planning, tasks; weather, satellite, finance, AI, team, CMS, worker infrastructure, or unrelated platform scaffolding.

## Independent Test Criteria by Story

- **US1**: New farmer receives `firstFieldOnboardingNeeded: true` and routes to first-field onboarding; returning farmer receives `false` and bypasses onboarding; API exposes no field list; unauthorized default context fails safely.
- **US2**: Point and Polygon validation tests pass, including coordinate bounds and approved Polygon validity rules. Point-only and Polygon submissions commit one authorized default context, first Field, durable completion record, and retained idempotency result atomically. Missing pointer creates Business + OWNER Membership + pointer; invalid pointer does not fall back. Omitted or whitespace-only name normalizes to exactly `Tarla 1`; non-empty names are trimmed. Representative point, optional versioned unverified Polygon, and `createdAt` are correct. Concurrent/lost-response retries converge; retained payload mismatch returns 409; after key expiry returns existing summary with 200 and no mutation.
- **US3**: Draft survives the specified same-device/account interruptions, including connectivity loss, app restart, and process termination; expires/purges on each specified trigger; excludes secrets; and recovery/error UX never presents an unsaved field as complete. E2E includes permission fallback, authorization failure, each recovery interruption, and expiry.

## Notes

- All task items use sequential IDs, checkboxes, exact paths, and story labels only in story phases. `[P]` marks independent files without incomplete prerequisites.
- Shared correlation-ID/logging setup (T013) is separate from feature event emission (T046).
- Contract package boundary (T005) precedes codegen and checked-in OpenAPI-derived types (T014 [P]); T014 is independent of other foundational work after T005, and US1 status and US2 completion API/mobile consumers use those types. Reproducibility verification is T048.
- OpenAPI 3.1 `5XX` remains in the contract; only status and completion endpoints are in scope.
