---
description: "Implementation tasks for Field Observations and Basic Diary"
---

# Tasks: Field Observations and Basic Diary

**Input**: Design documents from `specs/006-field-observations-basic-diary/`

**Prerequisites**: `spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/observations-diary.openapi.yaml`, `quickstart.md`, `checklists/requirements.md`, and the reviewer-owned `checklists/implementation-readiness.md`.

**Tests**: Explicitly required by the approved feature design and implementation request. Write focused tests before the corresponding implementation and demonstrate RED → GREEN. PostgreSQL integration tests that write data MUST use only `ekim_hasat_test`, with the existing disposable-database guard; never use shared `ekim_hasat`.

**Organization**: Tasks are grouped by the three user stories. User Story 1 and User Story 2 are both P1; the observation-create slice is sequenced first, followed by the mixed diary. User Story 3 is P2 historical-integrity coverage.

## Phase 1: Setup

**Purpose**: Connect the approved OpenAPI source to the existing generated-client workflow.

- [ ] T001 Main-owned, map `specs/006-field-observations-basic-diary/contracts/observations-diary.openapi.yaml` in `packages/api-client/openapi-generator.config.ts`, generate the SPEC-006 create/diary paths and schemas/types in `packages/api-client/src/generated/observations-diary-api.ts`, export those generated schemas/types, and compose SPEC-006 `paths` / `operations` into the existing public client surface in `packages/api-client/src/index.ts`; preserve all existing generated API surfaces.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Prove the relational and historical constraints before story work depends on observation persistence.

- [ ] T002 Main-owned, write PostgreSQL integration tests first in `apps/api/test/observations/field-observation.schema.integration.spec.ts`; import `apps/api/test/support/disposable-database.ts` and require database name exactly `ekim_hasat_test`. Cover UUID uniqueness, composite Business/Field/optional-Season integrity, actor/membership references, diary indexes, update/delete rejection, and protected-history foreign-key behavior; confirm the tests fail before the migration exists.
- [ ] T003 Add the Prisma `FieldObservation` model and additive migration in `apps/api/prisma/schema.prisma` and `apps/api/prisma/migrations/20261005120000_field_observation/migration.sql`; implement the stable UUID primary key, canonical payload fingerprint storage, composite Business/Field/Season and actor/membership constraints, Field/Season keyset indexes, no-cascade history references, and database-level UPDATE/DELETE protection required for append-only observations. Generate the Prisma client and make T002 pass.

**Checkpoint**: The schema and migration integration tests pass against the disposable `ekim_hasat_test` database; no writable test points at shared `ekim_hasat`.

---

## Phase 3: User Story 1 — Record a field observation (Priority: P1)

**Goal**: Let an authorized farmer submit a canonical observation with an optional same-Field Season and an unambiguous occurrence instant, with safe exact retry behavior.

**Independent Test**: An authorized member can create a valid observation and receive its canonical representation; empty/over-limit canonical text, invalid local time, future instant, unauthorized context, and changed-identity reuse are rejected with the specified structured responses. Exact and simultaneous retries converge to one persisted row.

### Tests for User Story 1

> Write tests before implementation and confirm expected failures. Parallel markers identify independent files only; they do not require subagents.

- [ ] T004 [P] [US1] Add `packages/domain/test/observations/field-observation.spec.ts` unit tests for UUID identity, trim-leading/trailing Unicode whitespace before validation, canonical 1..2000 Unicode code-point length (including supplementary characters), whitespace-only rejection, unchanged internal content/no normalization, immutable values, and distinct farmer `occurredAt` versus server `acceptedAt`.
- [ ] T005 [P] [US1] Add `apps/api/test/observations/observation-timezone.spec.ts` focused resolver tests for a unique valid wall time, a spring-forward nonexistent time, a fall-back ambiguous time, Business timezone authority, `Europe/Istanbul` fallback, device-timezone independence, and exact mapping to the submitted offset-aware instant; gap/fold cases must resolve to validation failures without choosing an offset or shifting time.
- [ ] T006 [P] [US1] Add `apps/api/test/observations/observations-diary.contract.spec.ts` contract checks for both OpenAPI operations, request/response schemas, `occurredAtLocal` plus offset-aware `occurredAt`, POST `201`/`200`, and the shared structured `400/401/403/404/409/500` error envelope; assert safe generic `500`, privacy-safe missing/cross-Business wording, and absence of update/delete operations.
- [ ] T007 [P] [US1] Add `apps/api/test/observations/observations-api-errors.spec.ts` runtime presentation tests proving create and diary validation/auth/missing/conflict/unexpected failures use the shared `{ error: { code, message, requestId } }` convention; assert observation identity reuse returns the exact SPEC-006 `409` code `IDEMPOTENCY_KEY_REUSED` declared in the OpenAPI `ApiError` contract for changed canonical payload, actor, or authorized context, while exact replay and a concurrent identical losing request remain `200`; cross-Business/missing resources expose no existence details, and `500` exposes only generic `UNEXPECTED` text. Reuse the shared `ApiError` infrastructure; do not create a SPEC-006-only error envelope.
- [ ] T008 [P] [US1] Add `packages/api-client/test/observations-diary-consumer.type-test.ts` compile-time consumer coverage through the repository's normal public `ApiClient` imported from `packages/api-client/src/index.ts`, proving the generated create and diary operations are callable with canonical request fields and expose response types and structured errors; do not test only an isolated generated file or hand-maintain duplicate transport types.
- [ ] T009 [US1] Main-owned, add `apps/api/test/observations/observation-create-authorization.integration.spec.ts` PostgreSQL integration cases for unauthenticated `401`, no usable Business scope `403`, active membership revocation, missing/out-of-scope Field or Season privacy-safe `404`, no client Business authority, same-Field Season validation, and persisted server-derived Business/actor/membership context. Use only `ekim_hasat_test` and the disposable-database guard.
- [ ] T010 [US1] Main-owned, add `apps/api/test/observations/observation-create-idempotency.integration.spec.ts` PostgreSQL cases for first create `201`, exact replay `200` with identical canonical representation, concurrent identical requests producing exactly one row with winner `201` and loser `200`, and same UUID with changed canonical payload, actor, or authorized context returning structured `409`. Use only `ekim_hasat_test` and the disposable-database guard; demonstrate concurrency against PostgreSQL uniqueness/transaction behavior, not mocks.
- [ ] T011 [P] [US1] Add `apps/mobile/test/observations/observation-create-screen.test.tsx` coverage for Field/Season context, local date/time input, code-point note validation, `occurredAtLocal` plus offset-aware instant submission using the authorized Business timezone, DST `400` correction state retaining the attempted input, network-error retention, exact retry after uncertain response, online-only accepted state, and accessible labels/status announcements.
- [ ] T012 [P] [US1] Extend `apps/mobile/test/fields/fields-navigation.integration.test.tsx` to specify the approved Field-detail and existing Season-context entry points for observation creation, without adding a new top-level destination or Quick Add workflow.

### Implementation for User Story 1

- [ ] T013 [US1] Implement `FieldObservation` domain types and pure invariant/canonicalization functions in `packages/domain/src/observations/field-observation.ts`; trim only leading/trailing Unicode whitespace before validation, require canonical text of 1..2000 Unicode code points, preserve internal content, and keep observation values immutable.
- [ ] T014 [US1] Extend the existing Business timezone utility in `apps/api/src/seasons/business-timezone.ts` with local-wall-time resolution that returns exactly one instant only for a unique valid time; use authorized Business timezone or existing `Europe/Istanbul` fallback, reject DST gaps/folds and local/instant mismatch with shared `400 INVALID_REQUEST`, and do not use device timezone or create a parallel timezone policy.
- [ ] T015 [US1] Implement authorized create command, repository, controller, and module in `apps/api/src/observations/`; resolve active membership server-side, constrain Field and optional Season to the authorized Business, persist actor/membership and UTC `acceptedAt`, persist canonical text and absolute `occurredAt`, compare UUID retries using canonical payload/actor/context, recover unique-key races by reading the winner, return `201` only for insert and `200` for exact replay (including a concurrent identical loser), and use an explicit coded application/domain error for changed reuse that presents the OpenAPI-declared `IDEMPOTENCY_KEY_REUSED` code in the shared `ApiError` envelope. Do not let this conflict fall through to the generic uncoded HTTP 409 mapping to `SEASON_STATE_CONFLICT`. Compose the module in `apps/api/src/main.ts` without accepting client Business authority or changing existing routes.
- [ ] T016 [US1] Implement the online-only mobile form and submission adapter in `apps/mobile/src/features/observations/observation-create-screen.tsx` and `apps/mobile/src/features/observations/observation-client.ts`; obtain the authorized `businessTimezone` from the diary/API context, convert a valid farmer-entered local value to offset-aware `occurredAt`, send both `occurredAtLocal` and `occurredAt`, retain attempted note/time on validation or network failure, retry the exact UUID/payload after uncertain response, and show accepted only after server confirmation. Do not add an offline observation outbox.
- [ ] T017 [US1] Main-owned, wire observation creation from the existing Field detail and applicable Season context through the existing route/rendering graph in `apps/mobile/App.tsx` and `apps/mobile/src/app-composition.ts`, using the existing Field detail/navigation context; make `apps/mobile/test/fields/fields-navigation.integration.test.tsx` assert that the create route and screen are reachable from those surfaces. Do not use the Season setup screen as an ongoing-context integration target, add a top-level navigation destination, or alter the approved Field/Season context.

**Checkpoint**: Create, validation, timezone, authorization, exact retry, and concurrent retry cases pass; the mobile form preserves failed input and reports acceptance only after the API confirms it.

---

## Phase 4: User Story 2 — Review a field or season diary (Priority: P1)

**Goal**: Present observations and existing accepted `TaskCompletion` records once in one deterministic, bounded Field/Season diary traversal.

**Independent Test**: An authorized farmer can page through a Field diary and a Season-filtered diary containing both canonical source types, with correct scope, stable ordering, and the documented concurrent-insert behavior.

### Tests for User Story 2

- [ ] T018 [P] [US2] Add `apps/api/test/observations/diary-query.spec.ts` unit tests for global `occurredAt DESC, kind ASC, source UUID DESC` order with `OBSERVATION` first on equal times, default limit 50, maximum 100, strict-after tuple continuation, opaque cursor Field/optional-Season binding, malformed/scope-mismatched cursor rejection, and before/after-cursor concurrent insert semantics without snapshot-isolation claims.
- [ ] T019 [US2] Main-owned, add `apps/api/test/observations/field-diary.integration.spec.ts` PostgreSQL coverage for one Field projection over observations and existing accepted `TaskCompletion` rows, null/non-null Season behavior, authorized Season-only filtering, tenant isolation, deterministic cross-source ties, 50/100 limits, no repeated or permanently skipped pre-existing rows, before-cursor inserts appearing only on refresh, and after-cursor inserts possibly appearing later. Use only `ekim_hasat_test` and the disposable-database guard; never copy completions into another table.
- [ ] T020 [P] [US2] Add `apps/mobile/test/observations/field-diary-screen.test.tsx` coverage for mixed observation/completion rows, occurrence rendering in `businessTimezone`, initial loading, empty state, bounded continuation, retryable errors, accessible state announcements, and stale-response protection when Field/Season context changes.

### Implementation for User Story 2

- [ ] T021 [US2] Add a bounded candidate-read method to `apps/api/src/tasks/task-completion.repository.ts` for authorized Field/optional Season diary queries using immutable TaskCompletion ordering keys; preserve the existing completion command, completion-only History endpoint, and completion-specific offline storage/queue behavior.
- [ ] T022 [US2] Implement the diary query service, observation candidate read, scope-bound keyset cursor, merge, and `GET /fields/{fieldId}/diary` handler in `apps/api/src/observations/`; query strictly after `(occurredAt, kind, source UUID)`, default to 50/max 100, return the resolved Business timezone, reuse canonical accepted `TaskCompletion` rows, and return shared structured privacy-safe errors. Do not claim snapshot isolation.
- [ ] T023 [US2] Implement the mobile Field/Season diary screen and row presentation in `apps/mobile/src/features/observations/field-diary-screen.tsx` and `apps/mobile/src/features/observations/diary-client.ts`; use generated API types, preserve observation/completion distinctions and provenance, render absolute occurrence instants in Business timezone, support empty/loading/error/retry/pagination/accessibility states, and make T020 pass. Main-owned, wire diary access into the existing Field detail and applicable Season route/rendering context through `apps/mobile/App.tsx` and `apps/mobile/src/app-composition.ts`, without adding a top-level navigation destination; extend the focused navigation/rendering integration assertion to prove the diary route and screen are reachable from existing Field/Season context.

**Checkpoint**: Field and Season reads include only authorized canonical rows; order and cursor semantics hold across source ties and concurrent inserts; no `TaskCompletion` duplication or mutation occurs.

---

## Phase 5: User Story 3 — Keep observations trustworthy over time (Priority: P2)

**Goal**: Preserve accepted content and original Field/Season association as immutable history; corrections create another observation.

**Independent Test**: After changing current Field/Season context, the original observation remains unchanged and visible in its original diary scope; no update/delete operation can mutate or erase it.

- [ ] T024 [US3] Main-owned, add `apps/api/test/observations/observation-history.integration.spec.ts` PostgreSQL coverage for accepted text/time/Field/Season stability after later Field and Season changes, database UPDATE/DELETE rejection and protected references, absence of edit/delete routes, and correction as a second observation with a new UUID. Use only `ekim_hasat_test` and the disposable-database guard.

---

## Phase 6: Polish & Cross-Cutting Regression

**Purpose**: Protect adjacent accepted contracts and run focused end-to-end verification without duplicating broad suites.

- [ ] T025 Main-owned, preserve SPEC-003 behavior with focused regression coverage in `apps/api/test/tasks/task-completion.integration.spec.ts`, `apps/api/test/tasks/task-completion.idempotency.integration.spec.ts`, `apps/mobile/test/tasks/task-completion.test.ts`, `apps/mobile/test/tasks/task-completion-command-store.test.ts`, and `apps/mobile/test/tasks/task-completion-history.test.tsx`; verify append-only completions, existing History behavior, and completion-specific offline retry remain unchanged. Writable PostgreSQL cases use only `ekim_hasat_test`.
- [ ] T026 Main-owned, run focused SPEC-001/002/005 regressions in `apps/api/test/fields/fields-create.integration.spec.ts`, `apps/api/test/seasons/season-create.integration.spec.ts`, `apps/mobile/test/fields/fields-navigation.integration.test.tsx`, and `apps/api/test/observability/api-error-presentation.spec.ts`; preserve membership authorization, Business timezone authority/fallback, Field behavior, and existing navigation. Writable PostgreSQL cases use only `ekim_hasat_test`.
- [ ] T027 Main-owned, follow `specs/006-field-observations-basic-diary/quickstart.md` for one authorized create → diary readback → exact retry → mixed-source pagination smoke journey using the focused API and mobile tests; confirm generated output in `packages/api-client/src/generated/observations-diary-api.ts` is reproducible and existing generated API consumers still type-check. Do not run unrelated full suites.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: T001 maps the already approved OpenAPI source and produces the generated client surface.
- **Foundational (Phase 2)**: T002 must be written first and run against `ekim_hasat_test`; T003 implements its failing schema/migration assertions. This blocks API persistence work.
- **User Story 1 (Phase 3)**: Depends on T001 and T003. Domain, timezone, OpenAPI/client, and mobile behavior tests are written before their corresponding implementation. PostgreSQL authorization and concurrency suites T009/T010 must fail before T015.
- **User Story 2 (Phase 4)**: Depends on T001/T003 and the authorized Field/Season context. T018/T019/T020 are written before T021/T022/T023. Diary query and mobile read slices may be developed separately; final integration follows T025/T027.
- **User Story 3 (Phase 5)**: Depends on the persisted observation model and create path (T003/T015); T024 validates the no-mutation history behavior.
- **Polish (Phase 6)**: T025–T027 follow desired story checkpoints and precede implementation completion.

### User Story Dependencies

- **US1 (P1)**: Begins after Setup and Foundational. Delivers canonical creation, safe retry, timezone validation, and mobile entry.
- **US2 (P1)**: Begins after Setup and Foundational; it can use canonical fixtures independently, then integrates with US1-created observations in T027. T023 follows T017 and T020 because it extends the Main-owned mobile route/rendering composition established for observation creation and adds diary-screen reachability coverage. For sequential MVP delivery, complete US1 first.
- **US3 (P2)**: Requires persisted observations from US1 and migration protections from Foundational.

### Parallel Opportunities

- After T001/T003, T004, T005, T006, T007, and T008 touch separate test files and can be authored in parallel; do not run multiple writable PostgreSQL suites concurrently.
- After API contract generation, the isolated domain slice T004/T013 and mobile form slice T011/T016 can be delegated independently if desired. Main Agent owns OpenAPI generation, timezone/API work, migration, navigation composition, `TaskCompletionRepository`, all writable PostgreSQL suites, and final integration. Use at most two implementation subagents, no nested agents; scoped workers run only their isolated non-database tests. `[P]` denotes file/dependency independence and does not require delegation.
- In US2, T018 query unit tests and T020 mobile screen tests are independent files; T019 writable PostgreSQL tests remain Main-owned.

## Parallel Execution Examples

### User Story 1

```text
Task: T004 domain invariant tests in packages/domain/test/observations/field-observation.spec.ts
Task: T005 timezone resolver tests in apps/api/test/observations/observation-timezone.spec.ts
Task: T006 OpenAPI contract tests in apps/api/test/observations/observations-diary.contract.spec.ts
Task: T011 mobile form tests in apps/mobile/test/observations/observation-create-screen.test.tsx
```

### User Story 2

```text
Task: T018 diary query unit tests in apps/api/test/observations/diary-query.spec.ts
Task: T020 mobile diary screen tests in apps/mobile/test/observations/field-diary-screen.test.tsx
```

## Implementation Strategy

### MVP First

Complete Setup and Foundational, then US1 creation and US2 diary projection. Although US1 is the first P1 slice, its spec-level save-and-find acceptance is fully demonstrated after US2 supplies diary readback. Validate that end-to-end journey in T027 before treating the MVP as complete. Add US3 history-integrity verification next.

### TDD and Ownership

- For each domain, time, API, database, and mobile behavior, write the focused test task first and confirm RED before its implementation task; confirm GREEN after implementation.
- Main Agent integrates shared API/module composition and generated artifacts, owns every writable PostgreSQL suite, and runs broad verification. Optional workers are limited to the isolated domain and mobile component slices described above; no nested agents are used.
- Use only the disposable database `ekim_hasat_test` for writable PostgreSQL integration tests. Never run these tests against shared `ekim_hasat`.

### Scope Guard

No tasks add taxonomy, attachments, generic event storage, generic/offline observation sync, AI/risk/diagnosis, notifications, Calendar, active-season task mutation, advisor/team sharing, or observation edit/delete.

## Notes

- Every task has a sequential ID, exact target path, and a story label only in user-story phases.
- `[P]` means tasks touch separate files and have no dependency on each other's incomplete work.
- The two checklists are requirements-quality inputs; their checked state does not indicate implementation completion.
