---
description: "Implementation tasks for Farmer-controlled Skip for an unfinished active-season task"
---

# Tasks: Skip an Active-Season Task

**Input**: Design documents from `specs/009-skip-active-task/`

**Prerequisites**: `spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/task-skips.openapi.yaml`, and `quickstart.md`

**Organization**: Tasks are grouped by the two prioritized user stories in `spec.md`. Tests are included because the feature specification requires verifiable authorization, concurrency, history, projection, and offline behavior; implementation should follow TDD.

## Phase 1: Setup

**Purpose**: Prepare the bounded feature contract and establish the repository's generated-state workflow.

- [ ] T001 [P] Add `specs/009-skip-active-task/contracts/task-skips.openapi.yaml` to the generator inputs in `packages/api-client/openapi-generator.config.ts` while preserving the existing SPEC-006 Diary contract input
- [ ] T002 [P] Add failing generated-client consumer type tests for `skipPlannedTask`, `getFieldTaskHistory`, and `TASK_SKIPPED` in `packages/api-client/test/task-skips-consumer.type-test.ts` and `packages/api-client/test/observations-diary-consumer.type-test.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Establish canonical append-only persistence and generated Prisma state required by both stories.

- [ ] T003 Add a failing PostgreSQL schema integration test in `apps/api/test/tasks/task-skip.schema.integration.spec.ts` before adding `TaskSkip`; assert required columns, uniqueness, composite ownership, delete restrictions, base version > 0, accepted version = base version + 1, non-empty fingerprint, and bounded-read indexes, and call `assertDisposableDatabaseUrl` before connecting to PostgreSQL
- [ ] T004 Add the `TaskSkip` Prisma model and one-to-one `PlannedTask.skip` in `apps/api/prisma/schema.prisma`; enforce `UNIQUE (businessId, skipId)` and `UNIQUE (plannedTaskId)`, task/plan/season/field/business/membership composite ownership, `ON DELETE RESTRICT`, and the data-model bounded-read indexes; retain the actor, UTC acceptance time, base/accepted versions, fingerprint, title/date snapshots, and append-only semantics
- [ ] T005 Create the migration for `TaskSkip` in `apps/api/prisma/migrations/20261009120000_task_skip/migration.sql`, including schema constraints and indexes from `specs/009-skip-active-task/data-model.md`, with `base_task_version > 0`, `accepted_task_version = base_task_version + 1`, and a non-empty payload fingerprint, without altering existing completion or adjustment rows
- [ ] T006 Generate Prisma output using the repository generator for `apps/api/src/generated/prisma/`, then review generated diffs and verify they correspond only to the `TaskSkip` schema change; do not hand-edit generated files

**Checkpoint**: The canonical schema and Prisma generated state are ready. Every integration test that connects to PostgreSQL must use the existing guarded test harness or call `assertDisposableDatabaseUrl` before connecting. Run writable integration suites serially against `ekim_hasat_test`; never reset or write against the canonical development database.

---

## Phase 3: User Story 1 - Skip work that will not be done (Priority: P1) 🎯 Core Workflow

**Goal**: An authorized farmer confirms one eligible task Skip; the accepted immutable outcome appears distinctly in history and diary, and the task leaves current actionable work.

**Independent Test**: Starting with an authorized active-season task, confirm Skip and verify one immutable `TaskSkip`, atomic task version increment, Task History and Field Diary entries marked skipped, and exclusion from fresh Bugün and Calendar results.

### Domain, persistence, and mutation tests (write first)

- [ ] T007 [P] [US1] Add domain unit cases for eligible active-season Skip, completion/Skip ineligibility, missing activation snapshot, approved-plan requirement, and terminal outcome semantics in `packages/domain/test/tasks/task-skip.spec.ts`, including stale expected-version rejection
- [ ] T008 [P] [US1] Add API contract cases for first accepted Skip (`201`), exact replay (`200`), stable response fields, required `If-Match`, and error response shapes in `apps/api/test/tasks/task-skip.contract.spec.ts`
- [ ] T009 [US1] Add PostgreSQL acceptance and exact-replay cases proving one append-only event, unchanged task date/completion/adjustment history, captured snapshots/actor/time/versions, no second version increment, stale-version rejection, already-completed/already-skipped rejection, current authorization and tenant isolation, changed-payload key conflict, revoked-membership denial, and concurrent same-task Skip requests with both exact and different command identities in `apps/api/test/tasks/task-skip.integration.spec.ts`; use the guarded integration harness or call `assertDisposableDatabaseUrl` before connecting

### Domain, persistence, and mutation implementation

- [ ] T010 [US1] Implement explicit Skip eligibility and terminal outcome rules in `packages/domain/src/tasks/task-skip.ts` to require an unfinished task in an ACTIVE Season with an APPROVED plan and activation snapshot; keep Skip distinct from completion and date adjustment (depends on T007)
- [ ] T011 [US1] Implement the TaskSkip persistence adapter and transactional acceptance in `apps/api/src/tasks/task-skip.repository.ts`, following existing task mutation lock order; reauthorize current membership, scope to the authorized Business, validate task version and eligibility, resolve Business-scoped exact retries before live version/eligibility checks only after reauthorization; reject changed identity/payload; recover uniqueness races safely; increment `PlannedTask.version`, and insert the immutable snapshot atomically (depends on T004-T006, T009-T010)
- [ ] T012 [US1] Add task-skip command errors and HTTP mapping in `apps/api/src/tasks/task-skip.error.ts` and `apps/api/src/tasks/task-skip.error.filter.ts`, including privacy-safe not-found, authorization, ineligible, and conflict codes (depends on T008, T011)
- [ ] T013 [US1] Implement the authenticated Skip controller, DTO validation, and application service in `apps/api/src/tasks/task-skip.controller.ts`, `apps/api/src/tasks/task-skip.dto.ts`, and `apps/api/src/tasks/task-skip.service.ts`; expose `POST /tasks/{taskId}/skips` using server-resolved Business identity and required version/skipId input (depends on T008, T011-T012)
- [ ] T014 [US1] Wire the task-skip controller and repository dependencies into `apps/api/src/main.ts` using existing task composition patterns (depends on T013)

### Task History and Field Diary tests (write first)

- [ ] T015 [US1] Add Task History contract and integration cases for distinct `TASK_COMPLETION`/`TASK_SKIPPED` entries, authorized Business/Field/optional Season scoping, stable `(eventAt DESC, kind ASC, eventId DESC)` ordering, pagination ties, historical planned-date snapshot and `skippedAt`, and unchanged legacy completion-only route in `apps/api/test/tasks/task-history.contract.spec.ts` and `apps/api/test/tasks/task-history.integration.spec.ts`; use the guarded integration harness before database access
- [ ] T016 [US1] Add Diary contract and integration cases for `TASK_SKIPPED`, task/field/season context, accepted event time, tenant scoping, strict-after pagination across same-time kinds, continued validity of existing cursors, and exactly one diary projection per accepted Skip in `apps/api/test/observations/observations-diary.contract.spec.ts` and `apps/api/test/observations/field-diary.integration.spec.ts`; use the guarded integration harness before database access

### Task History and Field Diary implementation

- [ ] T017 [P] [US1] Add bounded outcome-history query and discriminated completion/Skip projection in `apps/api/src/tasks/task-completion.repository.ts` and `apps/api/src/tasks/task-completion.controller.ts`, preserving the existing completion-only route and cursor semantics (depends on T004-T006, T015)
- [ ] T018 [P] [US1] Extend the canonical Diary contract with the `TASK_SKIPPED` event and distinct schema in `specs/006-field-observations-basic-diary/contracts/observations-diary.openapi.yaml` (depends on T016)
- [ ] T019 [US1] Extend Diary query parsing, source merge, tenant/field/season filtering, and strict-after cursor predicates for `TASK_SKIPPED` in `apps/api/src/observations/diary-query.ts` and `apps/api/src/observations/observation-diary.repository.ts`; source the event from `TaskSkip` without writing a duplicate diary row (depends on T004-T006, T016, T018)
- [ ] T020 [US1] Regenerate `packages/api-client/src/generated/task-skips-api.ts` and `packages/api-client/src/generated/observations-diary-api.ts` from the OpenAPI source contracts, update exports in `packages/api-client/src/index.ts`, and make the consumer type tests in `packages/api-client/test/task-skips-consumer.type-test.ts` and `packages/api-client/test/observations-diary-consumer.type-test.ts` pass; do not edit generated files by hand (depends on T001-T002, T013, T017-T019)

### Current-work projection tests and implementation

- [ ] T021 [US1] Add Today repository cases proving skipped tasks are excluded while other due tasks and Business-local date resolution remain unchanged in `apps/api/test/seasons/today.integration.spec.ts`
- [ ] T022 [US1] Add Calendar integration cases proving skipped tasks are excluded before coherent snapshot creation from overdue, selected-date, and month indicators while pre-Skip read IDs remain immutable in `apps/api/test/calendar/calendar-read.integration.spec.ts`; use the guarded integration harness before database access
- [ ] T023 [P] [US1] Exclude tasks with a related Skip from actionable Today reads in `apps/api/src/seasons/today.repository.ts` (depends on T004-T006, T021)
- [ ] T024 [P] [US1] Exclude tasks with a related Skip before Calendar coherent snapshot creation and all page/month projections in `apps/api/src/calendar/calendar-read.repository.ts` (depends on T004-T006, T022)

### Farmer flow and outcome presentation

- [ ] T025 [P] [US1] Add mobile Skip flow tests proving the confirmation explains that Skip closes the task and cannot be undone in this feature, requires explicit confirmation, then covers online submission, accepted/replayed result, accessible loading state, duplicate-tap protection, and refreshed current work in `apps/mobile/test/tasks/task-skip.test.tsx`
- [ ] T026 [P] [US1] Add mobile history and Diary rendering tests proving skipped outcomes use distinct labels, retain task/date/time context, and are never presented as completed work in `apps/mobile/test/tasks/task-completion-history.test.tsx` and `apps/mobile/test/observations/field-diary-screen.test.tsx`
- [ ] T027 [P] [US1] Implement the mobile online Skip command and confirmation/result view in `apps/mobile/src/features/tasks/task-skip.ts` and `apps/mobile/src/features/tasks/task-skip-view.tsx`; clearly explain that Skip closes the task and cannot be undone in this feature, require explicit confirmation, use generated client types and one stable `skipId` per open logical action, and add no durable Skip storage (depends on T020, T025)
- [ ] T028 [P] [US1] Adapt `apps/mobile/src/features/tasks/task-completion-history-screen.tsx` to render generated Task History discriminators while keeping pending/conflicted offline completion commands separate and unchanged (depends on T020, T026)
- [ ] T029 [P] [US1] Render `TASK_SKIPPED` as a distinct “Task skipped” event with task and event context in `apps/mobile/src/features/observations/field-diary-screen.tsx` (depends on T020, T026)
- [ ] T030 [US1] Connect the Skip action to existing task details in `apps/mobile/src/features/seasons/today-screen.tsx` and `apps/mobile/src/features/calendar/calendar-task-detail.tsx`, then refresh current results after accepted Skip without changing Calendar saved-view semantics (depends on T024, T027)
- [ ] T031 [US1] Add Today view/cache projection tests for Skip accepted from Bugün and Calendar, failed refresh, and offline app restart; assert no Skip outbox is written and pending completion commands remain unchanged in `apps/mobile/test/seasons/today-skip.test.tsx` (depends on T025, T030)
- [ ] T032 [US1] Add a bounded helper at the existing Today projection read/write boundary in `apps/mobile/src/features/tasks/task-completion-command-store.ts` to prune or invalidate the accepted task in the cached Today projection only; do not change completion command persistence, payload, or retry behavior (depends on T031)
- [ ] T033 [US1] Apply the accepted-Skip Today projection pruning/invalidation from both Bugün and Calendar success paths in `apps/mobile/src/features/seasons/today-screen.tsx` and `apps/mobile/src/features/calendar/calendar-task-detail.tsx`, suppressing stale actionable cache state if pruning fails (depends on T030, T032)

**Checkpoint**: The primary accepted flow is independently verifiable end to end. Do not release or declare SPEC-009 complete at this checkpoint: Phase 4's Skip/Complete and Skip/adjustment guards are required to enforce terminal integrity.

---

## Phase 4: User Story 2 - Understand an unavailable or conflicting Skip (Priority: P2)

**Goal**: When Skip cannot be accepted or its response is uncertain, the farmer receives clear recoverable feedback without a false success or local Skip queue.

**Independent Test**: Exercise offline submission, stale version, completed/already-skipped task, revoked authorization, Skip/Complete and Skip/adjustment races, plus response loss after commit; verify one authoritative outcome and safe retry behavior.

### Domain, authorization, idempotency, and concurrency tests (write first)

- [x] T034 [US2] Add Skip API regression cases for a revoked membership on exact retry, role/scope denial, foreign task privacy, and Business-scoped identity isolation in `apps/api/test/tasks/task-skip.authorization.integration.spec.ts`; use the guarded integration harness before database access
- [x] T035 [US2] Add real-PostgreSQL race cases for Skip vs Complete in both request orders and Skip vs date adjustment in both orders; assert one terminal outcome, `TASK_ALREADY_COMPLETED` when Skip loses to completion, existing `TASK_NOT_ACTIONABLE` when completion/adjustment loses to Skip, and `TASK_VERSION_CONFLICT` for a stale Skip after adjustment in `apps/api/test/tasks/task-skip-concurrency.integration.spec.ts`; use the guarded integration harness and run serially
- [x] T036 [US2] Add regression coverage proving completion checks accepted Skip under the shared task lock and rejects stale queued/offline completion without changing completion outbox behavior in `apps/api/test/tasks/task-completion.integration.spec.ts` and `apps/api/test/tasks/task-completion.authorization.integration.spec.ts`; preserve the existing guarded harness
- [x] T037 [US2] Add date-adjustment regression coverage proving accepted Skip makes adjustment ineligible and leaves prior adjustment history intact in `packages/domain/test/tasks/task-date-adjustment.spec.ts` and `apps/api/test/tasks/task-date-adjustment-concurrency.integration.spec.ts`; preserve the existing guarded harness and run PostgreSQL cases serially

### Competing terminal mutation guards

- [x] T038 [P] [US2] Add the shared-lock completion guard in `apps/api/src/tasks/task-completion.repository.ts` so completion rejects an existing Skip with the existing `TASK_NOT_ACTIONABLE` conflict code and does not write `TaskCompletion` (depends on T035-T036)
- [x] T039 [P] [US2] Add the skipped-task domain eligibility guard in `packages/domain/src/tasks/task-date-adjustment.ts` and the shared-lock adjustment guard in `apps/api/src/tasks/task-date-adjustment.repository.ts` so adjustment returns its existing `TASK_NOT_ACTIONABLE` conflict without changing task date/version or appending an adjustment (depends on T035, T037)

### Mobile conflict and connectivity recovery

- [ ] T040 [P] [US2] Add mobile tests for offline connectivity-required messaging, stale/terminal conflict refresh, authorization/not-found handling, transport uncertainty, and exact same-command retry in `apps/mobile/test/tasks/task-skip.test.tsx`
- [ ] T041 [US2] Implement explicit offline, authorization/not-found, ineligible, conflict, and uncertain-result states in `apps/mobile/src/features/tasks/task-skip.ts` and `apps/mobile/src/features/tasks/task-skip-view.tsx`; retain the same `skipId`, task ID, and base version only in the open flow for retry, never persist or queue Skip (depends on T038-T040)
- [ ] T042 [US2] Verify Skip from cached/read-only Calendar is unavailable without connectivity and saved Calendar views remain stale/read-only in `apps/mobile/src/features/calendar/calendar-task-detail.tsx` and `apps/mobile/test/calendar/calendar-screen.test.tsx` (depends on T024, T040)

**Checkpoint**: Every rejected or uncertain command has a deterministic server result and recoverable mobile state; no Skip is shown as accepted without server confirmation.

---

## Phase 5: Polish & Cross-Cutting Verification

**Purpose**: Verify generated state, database safety, compatibility, and feature-wide acceptance without expanding scope.

- [ ] T043 Review generated Prisma and API client diffs from `apps/api/src/generated/prisma/`, `packages/api-client/src/generated/`, and `packages/api-client/src/index.ts`; regenerate through repository tooling and remove unintended generated changes
- [ ] T044 Run the focused domain, API unit/contract, API client type-contract, and mobile tests from `specs/009-skip-active-task/quickstart.md`; run PostgreSQL integration suites serially through the existing `ekim_hasat_test` guard and record the database safety evidence
- [ ] T045 Verify SPEC-009 acceptance scenarios and scope boundaries against `specs/009-skip-active-task/spec.md`, including unchanged offline Task Completion behavior, both history surfaces, Bugün/Calendar exclusion, and absence of any Skip queue or OUT-of-scope capability

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: T001-T002 prepare source contract generation and type-level contract checks; they can proceed independently.
- **Foundational (Phase 2)**: T003 → T004 → T005 → T006. The Prisma model and migration precede generated Prisma state; this phase blocks API persistence and read-model implementation.
- **User Story 1 (Phase 3)**: Depends on Phase 2. Contract/domain/persistence/read/mobile tests lead their corresponding implementation tasks. History, Diary, Today, and Calendar work build on the canonical TaskSkip record.
- **User Story 2 (Phase 4)**: Depends on the US1 mutation and task read model. Concurrency tests establish behavior before adding the completion and adjustment guards. Mobile recovery builds on the accepted command flow.
- **Polish (Phase 5)**: Depends on all required US1 and US2 tasks.

### User Story Dependencies

- **US1 (P1)**: MVP; begins after foundational Prisma generation. It delivers accepted Skip plus history, diary, Today, Calendar, and mobile confirmation.
- **US2 (P2)**: Depends on the US1 command contract and persistence. It hardens rejected/replayed commands, competing mutations, and recovery UX.

### Parallel Opportunities

- T001 and T002 can be prepared in parallel. After the schema contract is understood, the separate domain unit and API contract tests (T007-T008) can be authored in parallel. PostgreSQL test tasks are not marked parallel because their suites share the disposable database and must be run serially.
- Within US1, after their respective tests pass, Task History and Diary contract work (T017-T018) and Today and Calendar query changes (T023-T024) can proceed in parallel on separate files. Mobile Skip, history, and Diary views (T027-T029) can be developed in parallel after generated types; task entry-point wiring (T030) follows T027. PostgreSQL integration suites still run serially.
- Within US2, PostgreSQL authorization/concurrency regression suites (T034-T037) run serially. The completion and adjustment guards (T038-T039) touch different repositories and can be implemented in parallel after their race tests exist; mobile recovery test T040 can be authored alongside those code changes.
- Do not parallelize tasks that edit the same source file or generated output. Run OpenAPI/Prisma generators after their source contracts/schema changes are complete, and review resulting generated diffs before proceeding.

### Critical Dependency Chain

`T003 → T004 → T005 → T006 → T007-T009 → T010 → T011 → T012-T014`

The read-surface and UI branches then follow their local test→implementation dependencies: `T015→T017`, `T016→T018→T019`, `T021→T023`, `T022→T024`, `T025→T027→T030`, `T026→T028/T029`, and `T031→T032→T033`. The terminal mutation extension is `T034-T037→T038/T039`, followed by mobile error recovery `T040→T041`; final verification is `T043-T045`.

History, Diary, Today, Calendar, and their mobile consumers branch from T006 and T011/T020 as indicated in their task dependencies.

## Parallel Example: User Story 1

```text
After T004-T006, author these test tracks independently:
- Task History: T015, then implementation T017
- Field Diary: T016, T018, then implementation T019
- Today: T021, then implementation T023
- Calendar: T022, then implementation T024
- Mobile acceptance and history rendering tests: T025-T026

Run PostgreSQL integration test files serially using the repository test runner and disposable database guard.
```

## Implementation Strategy

### Core Workflow First (User Story 1)

1. Complete Phase 1 and Phase 2.
2. Complete US1 domain and mutation tests/implementation.
3. Complete Task History, Field Diary, Today, and Calendar projections.
4. Complete the mobile accepted Skip flow and cached Today pruning.
5. Verify the US1 normal-flow acceptance criteria. Complete Phase 4 before release; the cross-mutation guards there are required for safe terminal behavior.

### Incremental Delivery

1. Build the accepted Skip flow with its canonical append-only record and projections (US1); this is not a release checkpoint.
2. Add deterministic rejection, race, and mobile recovery behavior (US2); release only after this phase passes.
3. Verify generated artifacts, PostgreSQL safety, unchanged offline completion, and all acceptance criteria.

## Notes

- Every task uses the required checkbox/ID format; `[P]` marks work that can be done in parallel without editing the same file or depending on incomplete work. `[US1]` and `[US2]` map to the stories in `spec.md`.
- All mutations remain server-authoritative and Business-scoped. Client Business identity is never used as authorization.
- Never point writable integration tests at a canonical development or production database. Use the existing `ekim_hasat_test` guard and run database-mutating integration work serially.
- `TaskSkip` is append-only. No task changes completion or adjustment history, and no generic task status is introduced.
- Do not create an offline Skip queue, modify the offline completion command protocol, or implement any feature listed as OUT in `spec.md`.
