---
description: "SPEC-014 dependency-ordered implementation tasks"
---

# Tasks: Active-Season Manual Task Creation

**Input**: [spec](./spec.md), [plan](./plan.md), [research](./research.md), [data model](./data-model.md), [contracts](./contracts/), [quickstart](./quickstart.md), [approved UI shape](./ui-shape.md), and closed [readiness review](./checklists/implementation-readiness-review.md).

**Discipline**: For each behavior write the designated focused test, run it and record a meaningful RED, implement its paired change, then run it GREEN. Schema prerequisites may require guarded test migration before database-backed RED; do not treat missing database/setup failure as behavioral RED. Do not run full suites per task. `[P]` indicates only explicitly identified independent work after its dependencies; at most **two parallel agents** total during implementation. No concurrent edits to schema, shared interfaces, canonical contracts, generated clients or the same file.

**Database safety for every later migration, seed, integration test or other write**: Before **each** write, positively verify the actual connected database is exactly `ekim_hasat_test` and is the intended test instance. If not verified, stop. No destructive or writable operation against any other database. No database operation occurs during this tasks gate.

## Phase 1: Setup

- [ ] T001 Review approved boundaries, UI entry points and closed checklist in `specs/014-active-season-manual-task-creation/spec.md`, `specs/014-active-season-manual-task-creation/ui-shape.md` and `specs/014-active-season-manual-task-creation/checklists/implementation-readiness-review.md`; record baseline repository status and identify the pinned toolchain without modifying source.
- [ ] T002 Establish the test-only DB verification procedure in `specs/014-active-season-manual-task-creation/quickstart.md` and confirm it checks the actual connection before each future write; do not connect for writes or migrate in this task-generation gate.

## Phase 2: Foundational shared work (sequential; blocks all stories)

- [ ] T003 Add RED domain tests in `packages/domain/test/seasons/manual-active-task.spec.ts` for existing title trimming/1–200 and optional description ≤2000 validation, valid local dates, actual planting boundary, past/today/future, and task-origin legacy fallback including null template keys.
- [ ] T004 Implement shared validation/origin helpers in `packages/domain/src/seasons/plan-task-mutations.ts` and `packages/domain/src/seasons/` reusing `local-date.ts`; preserve draft behavior and run T003 GREEN. No UI-owned business rules.
- [ ] T005 Add migration-backed persistence tests in `apps/api/test/seasons/manual-task-schema.integration.spec.ts` for immutable post-activation origin, template-key constraint, legacy default, tenant-safe receipt associations, stable identities and uniqueness. Make the pre-migration RED an explicit read-only schema introspection assertion that the required capability is absent, rather than a missing-column SQL error; after T006 exercise constraints against the migrated database. Verify actual connected DB is `ekim_hasat_test` before every write.
- [ ] T006 Add backward-compatible origin and feature-specific durable creation receipt schema in `apps/api/prisma/schema.prisma` and a Prisma migration under `apps/api/prisma/migrations/`: task identity, mutation identity, Business/field/season, actor, immutable original payload or fingerprint, acceptance result/time; retain existing rows' plan-derived provenance and tenant-safe constraints. Verify actual DB is `ekim_hasat_test` before each test migration/write; run T005 GREEN.
- [ ] T007 Add RED contract tests in `apps/api/test/seasons/manual-active-task.contract.spec.ts` and `packages/api-client/` for `specs/014-active-season-manual-task-creation/contracts/manual-tasks.openapi.yaml` and additive read compatibility, including typed failures and 200 replay/201 acceptance.
- [ ] T008 Sequentially integrate the approved OpenAPI source and additive existing-read contract changes in `specs/014-active-season-manual-task-creation/contracts/`, affected `specs/002-first-season-setup/contracts/`, `specs/003-task-completion-history/contracts/`, `specs/006-field-observations-basic-diary/contracts/`, `specs/007-calendar/contracts/`, `specs/009-skip-active-task/contracts/` as needed, and `packages/api-client/openapi-generator.config.ts`; regenerate `packages/api-client/src/generated/` and exports, preserving old-client compatibility. Leave endpoint-dependent T007 cases RED until T013; run only generator/type-level cases that can pass now. No concurrent contract edits.

## Phase 3: User Story 1 — Add work to an active season (P1)

**Goal**: An authorized OWNER submits one manual task and receives authoritative acceptance without changing original approval.

**Independent test**: With an eligible OWNER/ACTIVE/APPROVED season, create a task and compare original plan/snapshot; deny other roles, invalid dates and foreign resources; exact retries create one task.

- [ ] T009 [US1] Add RED domain/repository validation and authorization tests, separating endpoint assertions for T013, in `packages/domain/test/seasons/manual-active-task.spec.ts` and `apps/api/test/seasons/manual-active-task.authorization.integration.spec.ts`: OWNER allowed; WORKER/ADVISOR, revoked membership, wrong Business/field, DRAFT or non-approved plan denied without disclosure; validate required title/date, optional description and planting boundary. Verify actual `ekim_hasat_test` before every DB write.
- [ ] T010 [US1] Add RED repository idempotency/history integration tests, separating endpoint assertions for T013, in `apps/api/test/seasons/manual-active-task.idempotency.integration.spec.ts` for concurrent exact retries, response loss, changed actor/payload/identity, task date changes, later season closure, role revocation and unchanged plan/activation snapshot; verify actual `ekim_hasat_test` before every DB write.
- [ ] T011 [US1] Implement feature-scoped create repository in `apps/api/src/seasons/` using existing membership and transactional locking patterns: current OWNER/business/field access first; exact authorized receipt replay before first-acceptance-only ACTIVE/APPROVED checks; atomic task+receipt, immutable input comparison and unique-race recovery. No WORKER assignment framework; run direct repository-level T009–T010 cases GREEN with DB guard before each write. Endpoint-dependent cases remain RED until T013.
- [ ] T012 [US1] Implement command/service and typed input/error mapping in `apps/api/src/seasons/`, using shared validators and DATE-only semantics; reject malformed, unauthorized, ineligible, invalid and identity-conflict cases as planned; no client Business authority.
- [ ] T013 [US1] Expose separate active-season create endpoint and module wiring in `apps/api/src/seasons/` and `apps/api/src/main.ts`, implement contract response/structured errors, retain draft endpoint semantics, and run focused T007/T009–T010 GREEN with DB guard before each write.
- [ ] T014 [US1] Add RED/ GREEN approved-plan projection regression in `apps/api/test/seasons/manual-active-task.plan.integration.spec.ts` and `apps/api/src/seasons/seasons-read.repository.ts`: exclude later manual additions from original approved plan membership, preserve draft behavior/current original task values and immutable activation snapshot. Verify actual `ekim_hasat_test` before each DB write.

## Phase 4: User Story 2 — Use accepted task in existing work flows (P1)

**Goal**: Accepted manual tasks use existing task flows with truthful task provenance and unchanged legacy behavior.

**Independent test**: Create accepted tasks under a validated plan; find them through Today/Calendar, complete or adjust or skip separate tasks, and inspect history/diary and legacy tasks.

- [ ] T015 [P] [US2] Add RED Today/Calendar projection tests in `apps/api/test/seasons/` and `apps/api/test/calendar/` for exact business-local Today, Calendar grouping/detail and snapshot projections, task MANUAL/null template versus truthful plan source, and legacy provenance. Verify actual `ekim_hasat_test` before every DB write.
- [ ] T016 [P] [US2] Add RED task-action and history tests in `apps/api/test/tasks/` and `apps/api/test/observations/` covering completion/replay, date adjustment, skip, history/diary, retained prior snapshots, no creation-only diary event and legacy source; verify actual `ekim_hasat_test` before every DB write.
- [ ] T017 [US2] Apply shared task-origin resolver to `apps/api/src/seasons/today.repository.ts`, `apps/api/src/calendar/calendar-read.repository.ts` and Calendar snapshot projection; retain existing visibility/grouping and approved-plan source separately; run T015 GREEN with DB guard before each write.
- [ ] T018 [US2] Apply the same resolver to `apps/api/src/tasks/task-completion.repository.ts`, `apps/api/src/tasks/task-skip.repository.ts` and applicable `apps/api/src/observations/` diary projections, including replay/history/snapshot paths; preserve adjustment/skip/completion rules and run T016 GREEN with DB guard before each write.
- [ ] T019 [US2] Add RED then GREEN mobile regression coverage for Calendar saved view, task detail and existing offline completion in `apps/mobile/test/calendar/`, `apps/mobile/test/tasks/`, `apps/mobile/src/features/calendar/calendar-task-detail.tsx` and relevant existing task surfaces: manual task label is truthful, accepted task uses existing actions, legacy behavior unchanged.

## Phase 5: User Story 3 — Capture and recover offline (P1)

**Goal**: OWNER can durably create locally, see honest outcomes, and recover only definitive rejections.

**Independent test**: Capture offline, restart under retryable session failure, reconnect with matching account, simulate lost response and revocation, and exercise definitive rejection retry/correction/removal with one accepted task at most.

- [ ] T020 [P] [US3] Add RED tests for durable command/account context in `apps/mobile/test/tasks/manual-task-store.test.ts`: local save failure, stable IDs/immutable content, restart, prior OWNER+field/season/local-date context, retryable restoration vs no-session/sign-out/account switch, and cross-account isolation.
- [ ] T021 [P] [US3] Add RED lifecycle/delivery tests in `apps/mobile/test/tasks/manual-task-delivery.test.ts`: attempt marker and crash boundaries, transient failure, lost response then denial, exact retry, authoritative acceptance reconciliation after refresh failure, definitive reject, explicit unchanged retry, corrected new IDs and atomic rejected-only removal racing delivery.
- [ ] T022 [US3] Implement feature-specific account-scoped SQLite storage/context and durable state transitions in `apps/mobile/src/features/tasks/manual-task-store.ts` following observation patterns; no generic sync or authorization lease. Run T020 GREEN; preserve original account privacy and rejected-only removal guards.
- [ ] T023 [US3] Implement feature-specific delivery/coordinator in `apps/mobile/src/features/tasks/manual-task-delivery.ts` using generated client and T022: matching authenticated account, unchanged identities, pre-send uncertainty, typed errors, authoritative receipt persistence, deduplication and explicit recovery; run T021 GREEN.
- [ ] T024 [US3] Add RED mobile flow tests in `apps/mobile/test/tasks/manual-task-create-screen.test.tsx` and `apps/mobile/test/seasons/` for OWNER-only Field/ACTIVE Season entry, optional Today entry only with explicit field/season, no Calendar entry, fields/date validation and accessibility.
- [ ] T025 [US3] Add RED status/action tests in `apps/mobile/test/tasks/manual-task-create-screen.test.tsx` for pending after restart, unconfirmed vs rejected, acceptance, season ineligibility, retry/correct/remove confirmation, no accepted-task edit/delete and non-color-only feedback.
- [ ] T026 [US3] Implement contextual task entry and form in `apps/mobile/src/features/tasks/manual-task-create-screen.tsx`, `apps/mobile/src/app-composition.ts`, `apps/mobile/App.tsx` and the existing contextual `apps/mobile/src/features/observations/field-diary-screen.tsx` or another existing Field/Season surface; use server-derived `viewerRole` and independently established ACTIVE/approved-season context for fail-closed OWNER gating, not diary role alone; show OWNER-only primary entry, required title/date, optional description and sowing-date error, using `specs/014-active-season-manual-task-creation/ui-shape.md`. Implement optional Today entry only where context is already explicit; no Calendar creation entry or navigation redesign. Run T024 GREEN.
- [ ] T027 [US3] Implement account-scoped pending/unconfirmed/rejected/accepted display and explicit retry, corrected new submission and rejected-only local removal in `apps/mobile/src/features/tasks/manual-task-create-screen.tsx` and existing Field/Season context such as `apps/mobile/src/features/observations/field-diary-screen.tsx`, with accessible text/status announcements and no false acceptance; run T025 GREEN.
- [ ] T028 [US3] Wire account restoration/session continuity and delivery lifecycle in `apps/mobile/src/app-composition.ts` and `apps/mobile/src/auth/` using existing authenticated restoration outcomes; add regression coverage in `apps/mobile/test/` for offline restart, different account and revoked access without treating cached context as authorization.

## Phase 6: Cross-cutting review and verification

- [ ] T029 Reconcile create and provenance transport integration and older-client compatibility in `packages/api-client/` and `specs/014-active-season-manual-task-creation/contracts/`; run focused generated-client and contract checks once after all contract-affecting edits.
- [ ] T030 After T031 and any resulting fixes, execute one bounded whole-feature validation checkpoint from `specs/014-active-season-manual-task-creation/quickstart.md`: focused domain/API/mobile, tenant/isolation, idempotency, offline, action integration and smoke tests; verify actual connected DB is `ekim_hasat_test` before every migration or DB write. The broad `apps/api/scripts/run-integration.mjs` also runs `apps/api/test/persistence/t008-schema-invariants.sql` with writes and does not itself enforce a connected-database guard; do not run it or any unguarded suite unless every write path, including its separate SQL connection, is positively guarded against a database other than `ekim_hasat_test` before each write. Otherwise run only individually guarded suites and report the broad suite unverified. Record outputs and any unverified cases in `specs/014-active-season-manual-task-creation/`.
- [ ] T031 Before the final T030 verification checkpoint, perform Impeccable critique/audit/polish of the implemented mobile surfaces in `apps/mobile/src/features/tasks/` against `specs/014-active-season-manual-task-creation/ui-shape.md`, including native accessibility, weak connectivity and honest state language; address confirmed issues with appropriate focused tests.
- [ ] T032 Review whole feature against `specs/014-active-season-manual-task-creation/spec.md`, `plan.md` and implementation-readiness checklist; verify origin/snapshot/permissions/history/offline/contract parity and report remaining limitations. Run `pnpm exec graft build` and `pnpm exec graft check` after material changes; never run `--deep`.

## Dependencies and Execution Order

- Strict sequential shared foundation: T001 → T002 → T003 → T004 → T005 → T006 → T007 → T008. T005 uses a meaningful read-only missing-capability assertion before T006 and requires safe test setup, not a production write. T007 may remain RED until T013; T008 establishes interfaces before consumers.
- US1 requires T003–T008. T009 and T010 precede T011; T011 → T012 → T013; T014 follows origin schema and create behavior. US1 checkpoint requires T009–T014 and T007 GREEN.
- US2 requires accepted task/origin and T013. T015 precedes T017; T016 precedes T018; T019 follows relevant task/read integrations. T015 and T016 are independent test-file work, not parallel DB writes to the same fixture/database.
- US3 requires T008/T013 contract and create behavior. T020 precedes T022; T021 precedes T023; T022 → T023 → T024/T025 → T026 → T027 → T028. T020 and T021 are independent test-file work; do not parallelize shared-store implementation or app composition edits.
- T029 follows all story work; T031 follows story work and precedes the final T030 verification checkpoint; T032 follows T030. If T031 changes code, its focused tests run before T030. US2 and US3 may only overlap where file ownership and completed interfaces make them truly independent; coordinate shared mobile files and test fixtures sequentially.

## Parallel Examples (maximum two agents)

- After T013: one agent writes T015 read-projection tests while one writes T016 action/history tests, in separate files and isolated verified test environments; otherwise run sequentially.
- After T013: one agent writes T020 storage tests while one writes T021 delivery tests, in separate files. T022/T023 and shared interfaces remain ordered.

## Implementation Strategy and Completion Criteria

Complete foundation and US1 as the smallest independently verifiable online increment, then integrate US2 and bounded offline US3; this MVP checkpoint does **not** constitute complete SPEC-014 because offline creation is required. Finish all stories, passing scoped RED→GREEN tests, followed by T029–T032. Preserve approved scope, OWNER-only creation, unchanged historical snapshots, truthful provenance and all existing action semantics. A task is not done merely because it compiles; no commits or integration actions are authorized by this task list alone.
