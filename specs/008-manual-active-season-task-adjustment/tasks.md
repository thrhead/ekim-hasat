---
description: "Dependency-ordered implementation tasks for SPEC-008"
---

# Tasks: Manual Active-Season Task Adjustment

**Input**: Design documents from `specs/008-manual-active-season-task-adjustment/`

**Prerequisites**: `spec.md`, `plan.md`; supporting `research.md`, `data-model.md`, `contracts/task-date-adjustments.openapi.yaml`, `quickstart.md`, and both checklists.

**Tests**: TDD is explicitly required for this implementation. Add focused tests first, observe the intended RED result, then implement the smallest GREEN change. Integration tests use only `ekim_hasat_test` through the existing disposable-database guard.

**Organization**: Tasks are grouped by the two P1 user stories. User Story 2 depends on the shared authorized adjustment API and task-detail flow from User Story 1.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Tasks can safely run in parallel because they touch different files and have no unmet dependencies.
- **[Story]**: User-story tasks use `[US1]` or `[US2]` from `spec.md`.
- Every task names its expected repository file or directory.

## Path Conventions

- Domain: `packages/domain/src/`, `packages/domain/test/`
- API and Prisma: `apps/api/src/`, `apps/api/test/`, `apps/api/prisma/`
- Generated REST client: `packages/api-client/src/`, `packages/api-client/test/`
- Mobile: `apps/mobile/src/`, `apps/mobile/test/`

## Phase 1: Setup

**Purpose**: Project/workspace initialization.

No setup tasks are needed: the repository already has the required workspace, API, database, test, OpenAPI-generation, and mobile infrastructure. Feature-specific shared prerequisites are in Phase 2.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Add the shared generated API contract and additive persistence foundation before either user story uses them.

- [x] T001 [P] Add a RED generated-client consumer type test for POST/GET task-date-adjustment operations, `If-Match`, and the typed `NO_DATE_CHANGE` error in `packages/api-client/test/task-date-adjustments-consumer.type-test.ts`. Trace: FR-008–FR-011, FR-016.
- [x] T002 [P] Add a RED guarded PostgreSQL schema integration test for the `TaskDateAdjustment` model, required audit/version fields, Business-scoped relations, and `(businessId, adjustmentId)` compound uniqueness; assert the public `adjustmentId` has no global unique constraint and the independent internal row key is not part of the public API in `apps/api/test/tasks/task-date-adjustment.schema.integration.spec.ts`. Assert the database name with `apps/api/test/support/disposable-database.ts` and allow only `ekim_hasat_test`. Trace: FR-005, FR-008, FR-010, Data Model §New entity.
- [x] T003 [P] Register `specs/008-manual-active-season-task-adjustment/contracts/task-date-adjustments.openapi.yaml` in `packages/api-client/openapi-generator.config.ts`, export generated operation types from `packages/api-client/src/index.ts` and `packages/api-client/package.json`, and run `pnpm --filter @ekim-hasat/api-client generate` to create `packages/api-client/src/generated/task-date-adjustments-api.ts` until T001 is GREEN. Trace: FR-008–FR-011, FR-016.
- [x] T004 [P] Add the `TaskDateAdjustment` Prisma model and composite/restrictive relations to `apps/api/prisma/schema.prisma`, create an additive migration under `apps/api/prisma/migrations/`, and run `pnpm --filter @ekim-hasat/api prisma:generate` for the checked-in client under `apps/api/src/generated/prisma/` until T002 is GREEN. Give the row a server-generated internal primary key and enforce uniqueness on `(businessId, adjustmentId)` only; do not make public `adjustmentId` globally unique and do not expose or require the internal key through the API. Preserve the data-model fields and constraints: client UUID `adjustmentId` identity; task/plan/Season/Field/Business scope; actor user and Membership; previous/new PostgreSQL `DATE`; base/accepted task versions; payload fingerprint; server UTC `adjustedAt`; no update/delete application path. Trace: FR-005, FR-007, FR-008, FR-010.
- [x] T005 Run `pnpm --filter @ekim-hasat/api-client check:generated`, `pnpm --filter @ekim-hasat/api-client test:contract`, and `pnpm test:integration` for `packages/api-client/test/task-date-adjustments-consumer.type-test.ts` and `apps/api/test/tasks/task-date-adjustment.schema.integration.spec.ts`; confirm migrations/test writes target only `ekim_hasat_test`. Trace: FR-005, FR-008, FR-016.

**Checkpoint**: Shared contract types and additive audit persistence are available. No mutation behavior exists yet.

---

## Phase 3: User Story 1 — Reschedule unfinished work (Priority: P1) 🎯 MVP

**Goal**: An authorized farmer can reschedule an unfinished ACTIVE-season task from Bugün, with server-authoritative canonical state and accessible task-detail history.

**Independent Test**: For a Business-authorized ACTIVE Season and APPROVED plan, adjust an unfinished task online. Verify one canonical date/version transition and one immutable audit row; exercise exact retry, changed-key input, stale/new command ordering, no-date-change, completion race, isolation, and the Bugün task-detail flow.

### RED tests for User Story 1

- [x] T006 [P] [US1] Add RED domain tests for ACTIVE/unfinished eligibility, completed/inactive rejection, valid Business-local dates on/after planting, task-version checks, and same-date `NO_DATE_CHANGE` rules in `packages/domain/test/tasks/task-date-adjustment.spec.ts`. Trace: FR-001, FR-004, FR-007, FR-009, FR-016.
- [x] T007 [P] [US1] Add RED API contract tests that exercise the API route contract (not only static YAML) for POST/GET paths, required `If-Match`, success/replay statuses, typed HTTP 400 `NO_DATE_CHANGE`, stale/idempotency/eligibility errors, bounded history, and the existing `{ error: { code, message, requestId } }` envelope in `apps/api/test/tasks/task-date-adjustment.contract.spec.ts`. Trace: FR-008–FR-011, FR-016.
- [x] T008 [US1] Add RED PostgreSQL integration tests for first accepted adjustment, exact accepted replay after version advancement, same `adjustmentId` with changed input, new-ID stale conflict, same-date `NO_DATE_CHANGE` with no receipt/history/version increment, and a valid different-date mutation in `apps/api/test/tasks/task-date-adjustment.idempotency.integration.spec.ts`. Trace: FR-009, FR-010, FR-016.
- [x] T009 [US1] Add focused RED PostgreSQL integration tests in `apps/api/test/tasks/task-date-adjustment-concurrency.integration.spec.ts` for deterministic concurrency and atomicity, then make those assertions GREEN in T014/T015 and verify them here. Use controlled transaction/barrier coordination to exercise each serialization order rather than relying on a probabilistic race; if a particular order cannot be forced through the public API, prove its repository transaction outcome with a focused integration seam. For two genuinely new adjustment commands racing from the same valid base task version, assert that at most one transition is accepted; the winner creates exactly one adjustment row, advances `PlannedTask.version` exactly once, and leaves `plannedLocalDate` equal to its accepted date; the loser cannot overwrite it and receives the repository-defined stale/concurrency conflict; and no duplicate or partial history rows exist. Do not allow last-write-wins. For adjustment-versus-completion, derive the loser result from the current SPEC-003 completion repository/transaction behavior and prove the committed result matches a valid serialization: (1) if completion commits first, the later adjustment cannot mutate the completed task, creates no adjustment row, leaves task date/version/history internally consistent, and preserves canonical immutable completion history; (2) if adjustment commits first, verify the adjustment exists exactly once and the task has its new canonical date, then assert the competing completion follows existing SPEC-003 semantics—if its old version conflicts, assert that conflict and that a subsequent valid retry snapshots the adjusted canonical date; if completion is accepted after the adjustment, assert its snapshot uses that canonical date. In either case, no old date is treated as current and completion/adjustment histories remain mutually consistent. Force a failure between task update and adjustment-history persistence and assert rollback leaves no partial date change, orphan adjustment row, unintended version increment, or successful idempotency result. Trace: FR-007, FR-009, FR-010, SC-002–SC-004, Data Model §Command and state transition.
- [x] T010 [US1] Add focused RED PostgreSQL authorization/isolation tests in `apps/api/test/tasks/task-date-adjustment.authorization.integration.spec.ts` for current Membership validation, revocation, task/history access, and adjustment-ID probing, then make them GREEN in T014/T015 and verify them here. Assert cross-Business task/history reads and mutations use the existing privacy-safe authorization/not-found behavior without revealing task existence. Accept `adjustmentId = X` in Business A, then submit a valid new command with the same X in authorized Business B; prove it is accepted independently and does not collide with A's row. From Business B, compare probes for an ID that exists only in A and an ID unknown everywhere: both must follow the same existing privacy-safe observable behavior, with no uniqueness error, replay result, payload/history leak, or inference of A's task/adjustment state. Assert lookup and uniqueness are scoped to the currently authorized Business/task context; never globally look up X and inspect its owner. For a previously accepted adjustment, revoke the caller's Membership by the repository's status-change pattern (do not delete a retained audit-referenced Membership), then replay the exact accepted ID and original input; prove current authorization/access is revalidated before replay and the former member receives neither the accepted result nor its history. Preserve authorized exact-replay behavior after task-version advancement. Trace: FR-008, FR-010, SC-005, ADR-009.
- [x] T011 [US1] Add RED PostgreSQL history-read tests for current canonical task state, newest-first bounded pagination, previous/new dates, actor/time retention, and authorized task scope in `apps/api/test/tasks/task-date-adjustment-history.integration.spec.ts`. Trace: FR-005, FR-008.

### GREEN implementation for User Story 1

- [x] T012 [US1] Implement pure task-date-adjustment domain input, eligibility, date, version, and `NO_DATE_CHANGE` rules in `packages/domain/src/tasks/task-date-adjustment.ts`, export the module through `packages/domain/package.json`, reuse `packages/domain/src/seasons/local-date.ts`, and keep SPEC-002 DRAFT plan editing unchanged. Trace: FR-001, FR-003, FR-004, FR-007, FR-016.
- [x] T013 [US1] Implement strict adjustment request/history query validation and stable feature error codes, including HTTP 400 `NO_DATE_CHANGE` and HTTP 409 stale/idempotency/eligibility outcomes, in `apps/api/src/tasks/task-date-adjustment.dto.ts` and `apps/api/src/tasks/task-date-adjustment.error.ts` using the existing API error envelope. Trace: FR-008–FR-011, FR-016.
- [x] T014 [US1] Implement the authorized Prisma command and bounded history query in `apps/api/src/tasks/task-date-adjustment.repository.ts`: revalidate current membership/task access; query accepted identity only by `(authorized businessId, adjustmentId)` before live eligibility/version checks; never perform a global lookup by public `adjustmentId` or inspect another Business's row. Replay only exact original input; reject changed input within the same Business as `IDEMPOTENCY_KEY_REUSED`; recover concurrent same-Business insert races using the same Business-scoped compound identity. For a new ID validate ACTIVE + APPROVED + unfinished, then `If-Match`, then same-date `NO_DATE_CHANGE`, then atomically update canonical date/version and append history for a different valid date. Trace: FR-001, FR-005–FR-010, FR-016.
- [x] T015 [US1] Add the task adjustment application service and POST/GET REST controller for `/v1/tasks/{taskId}/date-adjustments` in `apps/api/src/tasks/task-date-adjustment.service.ts` and `apps/api/src/tasks/task-date-adjustment.controller.ts`; preserve current Membership/Business authorization and wire the module into `apps/api/src/main.ts` without accepting client Business authority. Trace: FR-001, FR-005, FR-008–FR-011, FR-016.
- [x] T016 [US1] Run the focused domain, API contract, history, authorization, idempotency, transaction, and race tests for `packages/domain/test/tasks/task-date-adjustment.spec.ts` and `apps/api/test/tasks/task-date-adjustment*.spec.ts`; make all T006–T011 behavior tests GREEN without weakening their assertions.

### RED tests and GREEN implementation for Bugün and task history

- [x] T017 [P] [US1] Add RED shared mobile-flow tests for online-only submission, stable exact retry identity after uncertain responses, no success before server acceptance, unchanged-date prevention, defensive `NO_DATE_CHANGE` without success refresh, and stale-conflict reload with a new farmer decision in `apps/mobile/test/tasks/task-date-adjustment.test.tsx`. Trace: FR-009–FR-011, FR-013, FR-016–FR-017.
- [x] T018 [P] [US1] Add RED Bugün entry/refresh/accessibility tests for eligible task action, no adjustment from cached Today data, success-triggered fresh `/today` read, unchanged-date prevention, and labeled loading/conflict states in `apps/mobile/test/seasons/today-task-adjustment.test.tsx`. Trace: FR-006, FR-011, FR-014–FR-017.
- [x] T019 [P] [US1] Add RED task-detail history tests for loading, empty, bounded-page, and error states; previous/new date and timestamp presentation; and no invented/raw actor identifier display in `apps/mobile/test/tasks/task-date-adjustment-history.test.tsx`. Trace: FR-005, FR-014.
- [x] T020 [US1] Apply Impeccable shape/craft guidance to the mobile adjustment form, history, and Bugün entry states before implementation in `apps/mobile/src/features/tasks/task-date-adjustment-view.tsx`, `apps/mobile/src/features/tasks/task-date-adjustment-history.tsx`, and `apps/mobile/src/features/seasons/today-screen.tsx`; keep approved behavior unchanged. Trace: FR-002, FR-014–FR-017.
- [x] T021 [US1] Implement the shared online command/read client flow in `apps/mobile/src/features/tasks/task-date-adjustment.ts`: call generated API operations, retain one ephemeral exact-command identity for an accepted-unknown retry, reload current detail on stale conflict, require a new decision, and add no offline queue or durable mutation persistence. Trace: FR-009–FR-011, FR-013, FR-016.
- [x] T022 [US1] Implement the shared accessible date form and bounded task-history presentation in `apps/mobile/src/features/tasks/task-date-adjustment-view.tsx` and `apps/mobile/src/features/tasks/task-date-adjustment-history.tsx`; disable unchanged-date submission, show accepted state only after server response, present dates/time clearly, and never expose raw actor IDs or invent actor names. Trace: FR-005, FR-011, FR-014, FR-017.
- [x] T023 [US1] Integrate the shared action/history into the eligible Bugün task detail/action flow and refresh live `/today` data only after accepted adjustment in `apps/mobile/src/features/seasons/today-screen.tsx`. Trace: FR-005, FR-006, FR-011, FR-015.
- [x] T024 [US1] Run the shared adjustment, task-history, and Today tests in `apps/mobile/test/tasks/task-date-adjustment.test.tsx`, `apps/mobile/test/tasks/task-date-adjustment-history.test.tsx`, and `apps/mobile/test/seasons/today-task-adjustment.test.tsx`; make T017–T019 GREEN and retain accessible labels/state announcements.

**Checkpoint**: The P1 Bugün adjustment flow and task-detail history are independently usable online, while Calendar has not yet gained a mutation entry point.

---

## Phase 4: User Story 2 — See the changed date in daily and calendar views (Priority: P1)

**Goal**: An eligible task opened from Takvim offers the same task-detail adjustment behavior; Calendar’s agenda/month and existing saved snapshots remain read-oriented and coherent.

**Independent Test**: Open an eligible task from a live Calendar read and adjust its date. Verify the detail closes/updates according to the shared flow, a fresh `readId` reflects the new canonical date, the prior read and pages remain immutable, and a saved/offline view cannot submit.

### RED tests for User Story 2

- [x] T025 [P] [US2] Add RED Calendar detail tests that expose the shared adjustment/history action only for eligible tasks from a live view and hide it for saved/offline data, while keeping agenda/month rows read-oriented in `apps/mobile/test/calendar/calendar-task-adjustment.test.tsx`. Trace: FR-013, FR-014–FR-015.
- [x] T026 [P] [US2] Add RED Calendar screen tests that successful adjustment starts a fresh read for the same selected date/Field scope, preserves the prior `readId` and pages, updates date/month indicators only from the fresh read, and lets a moved task disappear from the prior date only in the fresh result in `apps/mobile/test/calendar/calendar-screen-task-adjustment.test.tsx`. Trace: FR-006, FR-015, SC-001.

### GREEN implementation for User Story 2

- [x] T027 [US2] Add the shared eligible-task adjustment/history entry to Calendar task detail in `apps/mobile/src/features/calendar/calendar-task-detail.tsx`; keep the saved-view state read-only and do not add inline, drag-and-drop, bulk, completion, or arbitrary task editing. Trace: FR-005, FR-013–FR-015.
- [x] T028 [US2] On accepted Calendar adjustment, close/update task detail and start a fresh Calendar read using the current date/Field request in `apps/mobile/src/features/calendar/calendar-screen.tsx`; replace active view only with the new coherent result and never rewrite saved snapshots or prior `readId` pages. Trace: FR-006, FR-015, SC-001.
- [x] T029 [US2] Run Calendar detail, screen, race, offline, and saved-view tests in `apps/mobile/test/calendar/calendar-task-adjustment.test.tsx`, `apps/mobile/test/calendar/calendar-screen-task-adjustment.test.tsx`, `apps/mobile/test/calendar/calendar-screen-races.test.tsx`, and `apps/mobile/test/calendar/calendar-screen-offline.test.tsx`; make T025–T026 GREEN.

**Checkpoint**: Both approved entry points use the same server-authoritative adjustment command; old Calendar reads stay immutable.

---

## Phase 5: Polish and Cross-Cutting Verification

**Purpose**: Review UI craft, reconcile implementation documentation, and verify the full feature without expanding scope.

- [x] T030 Run Impeccable critique/audit/polish on the changed Bugün, shared task-detail/history, and Calendar UI in `apps/mobile/src/features/tasks/task-date-adjustment-view.tsx`, `apps/mobile/src/features/tasks/task-date-adjustment-history.tsx`, `apps/mobile/src/features/seasons/today-screen.tsx`, `apps/mobile/src/features/calendar/calendar-task-detail.tsx`, and `apps/mobile/src/features/calendar/calendar-screen.tsx`; address only issues consistent with the approved spec.
- [x] T031 Reconcile `specs/008-manual-active-season-task-adjustment/quickstart.md`, `specs/008-manual-active-season-task-adjustment/plan.md`, and `specs/008-manual-active-season-task-adjustment/data-model.md` with shipped names, commands, and behavior while preserving the frozen product boundary.
- [x] T032 Perform a whole-feature review against `specs/008-manual-active-season-task-adjustment/spec.md`, `specs/008-manual-active-season-task-adjustment/contracts/task-date-adjustments.openapi.yaml`, and all three feature test areas; confirm every FR/SC is covered, no excluded feature was added, and physical-device evidence remains unclaimed/deferred.
- [x] T033 Run `pnpm test` for domain and API unit coverage in `packages/domain/test/tasks/task-date-adjustment.spec.ts` and `apps/api/test/tasks/`. Result: domain 13/13; API 39/41 with only the two recorded pre-existing Calendar failures.
- [x] T034 Run `pnpm test:contract` and generated-client checks for `apps/api/test/tasks/task-date-adjustment.contract.spec.ts` and `packages/api-client/test/task-date-adjustments-consumer.type-test.ts`. Result: generated-client check passed; contract 19/21 with only the two recorded pre-existing Calendar failures; SPEC-008 contract test passed.
- [x] T035 Run `pnpm test:integration` for `apps/api/test/tasks/task-date-adjustment*.integration.spec.ts` with `DATABASE_URL` resolving exactly to `ekim_hasat_test` and the guard in `apps/api/test/support/disposable-database.ts`; never destructively reset or target `ekim_hasat`. Latest whole-feature review verification: 148/148 passed, including the completed-task and non-approved-plan guard regressions.
- [x] T036 Run `pnpm test:mobile` for `apps/mobile/test/tasks/task-date-adjustment.test.tsx`, `apps/mobile/test/tasks/task-date-adjustment-history.test.tsx`, `apps/mobile/test/seasons/today-task-adjustment.test.tsx`, and `apps/mobile/test/calendar/*task-adjustment*.test.tsx`. Result: 49 suites / 273 tests passed.
- [x] T037 Run `pnpm typecheck` and `pnpm lint` for the changed domain, API, generated-client, and mobile paths in `packages/domain/src/tasks/`, `apps/api/src/tasks/`, `packages/api-client/src/`, and `apps/mobile/src/features/`. Result: both monorepo checks passed.
- [x] T038 Run the normal repository `pnpm build` for the monorepo packages after generated clients and Prisma client are current in `packages/api-client/src/generated/` and `apps/api/src/generated/prisma/`. Result: passed.
- [x] T039 Run `pnpm check:diff` for the implementation worktree and confirm `git diff --check` reports no whitespace errors in `specs/008-manual-active-season-task-adjustment/` and changed source/test files. Result: passed.
- [x] T040 Run normal `graft build` followed by `graft check` after code/repository structure changes; do not run `graft build --deep` and verify the generated context graph at `graft/` remains Git-ignored. Result: graph check passed and `graft/` remains ignored.

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No tasks; the existing workspace needs no initialization.
- **Foundational (Phase 2)**: Must complete before story work. T001 precedes T003; T002 precedes T004; T005 follows both generation/migration tracks.
- **User Story 1 (Phase 3)**: Depends on Phase 2. Add all RED tests before the matching domain/API/mobile implementation; finish its P1 server-authoritative and Bugün slice before User Story 2.
- **User Story 2 (Phase 4)**: Depends on the shared API and mobile flow from User Story 1; Calendar tests precede Calendar implementation.
- **Polish (Phase 5)**: Depends on both user stories; complete Impeccable audit and documentation reconciliation before final verification.

### User Story Dependencies

- **User Story 1 (P1)**: Starts after Phase 2. Delivers adjustment command, audit/history, Bugün action, and current Today refresh.
- **User Story 2 (P1)**: Depends on User Story 1’s shared command and task-detail/history UX. It adds only the approved Calendar task-detail entry and fresh-read behavior.

### Within Each User Story

- Write focused tests first and observe RED before implementation.
- Domain rules precede persistence-backed API behavior; schema/migration and generated clients precede repository/controller work.
- Shared mobile command and history presentation precede the two surface integrations.
- Never automatically retry a stale command; an exact accepted retry keeps the original `adjustmentId` and original input.
- A new command validates eligibility then `If-Match`; stale conflict precedes same-date comparison; only a matching-version same-date request returns `NO_DATE_CHANGE`.

### Safe Parallel Opportunities

- **T001 and T002** can be prepared independently in different packages/test paths.
- **T003 and T004** can be implemented independently after their respective RED tests; one touches OpenAPI client generation, the other Prisma schema/migration.
- **T006 and T007** are independent RED tests in domain and API contract files.
- **T017, T018, and T019** are separate mobile test files; at most two can be authored/reviewed concurrently.
- **T025 and T026** are independent Calendar detail and Calendar read-state RED tests.
- No parallel work is proposed across the Bugün/shared flow and Calendar integration because they intentionally share components and state semantics. Keep implementation at zero subagents by default; use at most two only for the independent Phase 2 tracks if later explicitly useful.

## Parallel Example: Foundational Tracks

```text
Track A: T001 (client contract RED) → T003 (client generation GREEN)
Track B: T002 (Prisma schema RED) → T004 (additive migration/client GREEN)
Join: T005 (verify both foundation tracks)
```

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 2 foundations.
2. Complete User Story 1 RED tests, domain/API implementation, and Bugün/history mobile flow.
3. Validate the P1 adjustment and history journey independently before starting Calendar integration.

### Incremental Delivery

1. Deliver shared contract/persistence foundations.
2. Complete User Story 1 as the first end-to-end slice.
3. Add User Story 2 using the same command and history flow, preserving immutable Calendar reads.
4. Complete Impeccable review, documentation reconciliation, and full verification.

## Notes

- Planning/task artifact generation used **0 subagents**. Implementation defaults to **0 subagents**; if later staffed, use no more than two at once and only for the explicitly independent test/client/persistence tracks above.
- Every new test task is explicitly RED-first; corresponding implementation tasks and focused GREEN checks follow.
- All writable/destructive integration tests are restricted to `ekim_hasat_test`; never reset `ekim_hasat`.
- No task upgrades Expo SDK or claims physical iPhone validation; physical runtime checks remain separately deferred.
- T020 and T030 were completed in the Impeccable UI/UX gate. Whole-feature review found that the database guard also needed to reject completed tasks and non-approved plans; the migration guard and two regression tests were fixed and verified GREEN (148/148 guarded API integration suite).
- The Minor `readHistory` read-consistency finding is deferred and documented in `plan.md` Risks and Known Limits; no product requirement or generic consistency mechanism is added.
- Earlier broad API unit and contract runs recorded Calendar worker failures (`calendar-http.contract.spec.ts` and `calendar.openapi.contract.spec.ts`; 39/41 and 19/21 respectively). They did not reproduce in final verification: the uncached broad test run passed domain 100/100 and API 160/160, `pnpm test:contract` passed 65/65, and the Calendar files passed together 5/5. Preserve the earlier counts as historical runner evidence, not current failures.
- Out of scope: Skip, general ACTIVE-plan editing, task title/description editing, add/remove ACTIVE tasks, recurrence, weather-driven changes, notifications, generic offline sync/queues, Diary ownership, finance, harvest/sales, and team/advisor features.
- Do not run `$speckit-analyze` as part of task generation; await user review before that phase.
