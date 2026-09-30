---

description: "Actionable implementation tasks for SPEC-003 Task Completion and History"
---

# Tasks: Task Completion and History

**Input**: Design documents from `/specs/003-task-completion-history/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/task-completions.openapi.yaml`

**Tests**: Test-first is required for this feature. Write tests before the corresponding implementation and confirm the new tests fail for the intended reason.

**Organization**: Tasks are grouped by the two P1 user stories. Shared storage, API contract, and generated-client foundations precede both stories.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel with other marked tasks because files differ and prerequisites are complete.
- **[Story]**: User story served by a story-phase task; setup/foundational/polish tasks have no story label.
- Each task names concrete repository paths; test tasks are labeled with the story they cover.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Prepare the existing packages and contracts for this bounded feature without adding frameworks, stores, queues, or service boundaries.

- [x] T001 Review existing package scripts and test/database fixture conventions in `packages/domain/package.json`, `apps/api/package.json`, `apps/api/test/seasons/`, `packages/api-client/package.json`, and `apps/mobile/package.json` so later tasks reuse current workspace setup without refactoring unrelated modules.
- [x] T002 [P] Add `specs/003-task-completion-history/contracts/task-completions.openapi.yaml` to the independent generation inputs in `packages/api-client/openapi-generator.config.ts`, preserving the existing onboarding and season contract entries.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Establish domain, migration, and transport boundaries required by both user stories.

**⚠️ CRITICAL**: Complete this phase before story implementation.

### Tests first

- [x] T003 [P] Add domain unit tests in `packages/domain/test/tasks/completion.spec.ts` for valid command identity/version/timestamp, immutable planned intent, pending/accepted/conflicted transitions, and distinct `occurredAt`/`recordedAt` semantics.
- [x] T004 [P] Add Prisma schema/integration assertions in `apps/api/test/tasks/task-completion.schema.integration.spec.ts` for one completion per planned task, unique completion identity, tenant-consistent task/season/field/business relations, actor membership references, and append-only record fields.
- [x] T005 [P] Add OpenAPI contract tests in `apps/api/test/tasks/task-completion.contract.spec.ts` for strict command fields, required `If-Match` base version, 201 first acceptance, 200 exact replay, conflict/authorization responses, accepted-history shape, and omission of farmer-facing `recordedAt` and actor identity.

### Shared implementation

- [x] T006 [P] Implement completion command/record types and pure validation/state rules in `packages/domain/src/tasks/completion.ts`; preserve the planned task unchanged and define stable `PENDING`, `ACCEPTED`, and `CONFLICTED` local outcomes.
- [x] T007 Add an additive `TaskCompletion` model and migration in `apps/api/prisma/schema.prisma` and a new timestamped `apps/api/prisma/migrations/20260929120000_task_completion/migration.sql`; persist `occurredAt`, server `recordedAt`, actor user/membership, tenant/task context, base version, canonical payload fingerprint, title/planned-date snapshots, and plan provenance references, with unique completion ID and unique planned-task constraints.
- [x] T008 Generate the API transport from `specs/003-task-completion-history/contracts/task-completions.openapi.yaml` into `packages/api-client/src/generated/task-completions-api.ts` and compose exported paths/types in `packages/api-client/src/index.ts` (or the existing public entrypoint); do not hand-maintain generated payload types.
- [x] T009 Add `packages/api-client/test/task-completions-consumer.type-test.ts` and verify the existing `packages/api-client/package.json` `check:generated`/`test:contract` scripts cover the new generated surface while preserving onboarding/season operation types.

**Checkpoint**: Shared domain vocabulary, additive persistence, and generated contract surfaces are ready; no generic synchronization infrastructure has been introduced.

---

## Phase 3: User Story 1 — Complete today's work (Priority: P1) 🎯 MVP

**Goal**: Complete an actionable task in Bugün with one basic action, preserve the planned task/provenance, and safely retain/synchronize completion offline.

**Independent Test**: For an authorized task in an ACTIVE season and APPROVED plan, complete online and offline; verify a separate accepted record, unchanged planned task and provenance, durable pending state across restart, exact replay after lost response, and deterministic conflicts without false acceptance.

### Tests for User Story 1 (write first)

- [x] T010 [P] [US1] Add real PostgreSQL command integration tests in `apps/api/test/tasks/task-completion.integration.spec.ts` for first acceptance and timestamps, ACTIVE/APPROVED gating versus DRAFT/non-ACTIVE rejection, unchanged task/provenance, and `recordedAt` server ownership; additive Today contract assertions are deferred to T022 because Today metadata is outside this server-command batch.
- [x] T011 [P] [US1] Add real PostgreSQL replay/concurrency tests in `apps/api/test/tasks/task-completion.idempotency.integration.spec.ts` for same ID/payload/actor/context replay, changed payload under same ID, different actor reusing ID, distinct-ID competing completion with exactly one accepted row, and two concurrent requests using the same completion ID against different planned tasks. Assert authorized re-read and deterministic conflict mapping without leaking completion details or raw database uniqueness errors.
- [x] T012 [P] [US1] Add tenant/permission integration tests in `apps/api/test/tasks/task-completion.authorization.integration.spec.ts` for Membership revalidation, revoked membership, client business ID non-authority, cross-business attempts, and privacy-safe errors/replays.
- [x] T013 [P] [US1] Add focused domain tests in `packages/domain/test/tasks/completion.spec.ts` for stale base version, retry identity/payload preservation, and no automatic rebase/overwrite.
- [x] T014 [P] [US1] Add mobile persistence tests in `apps/mobile/test/tasks/task-completion-command-store.test.ts` for persist-before-network, account partitioning, process restart, multiple task commands, accepted public result persisted atomically before settlement, and retained conflict intent; also verify writing the synchronized Today snapshot, reading it after restart, and determining whether its projection belongs to the current Business-local day from the server-provided timezone/date metadata. `recordedAt` remains server-side audit/commit metadata.
- [x] T015 [P] [US1] Add mobile coordinator tests in `apps/mobile/test/tasks/task-completion.test.ts` for offline creation, stable ID/base version/absolute `occurredAt`, exact retry, network ambiguity, lost response after server commit, retry after restart, conflict outcomes, and explicit review/new ID without changing original occurrence.

- [x] T016 [P] [US1] Add mobile Today behavior and accessibility tests in `apps/mobile/test/seasons/today-completion.test.tsx` for actionable versus locally pending/accepted/conflicted states, duplicate-tap prevention, accessible names/state announcements, scalable text, non-color communication, retry/error/loading/empty states, and Business-local date rather than device timezone.
- [x] T017 [US1] Add real PostgreSQL Today integration coverage in `apps/api/test/seasons/today-completion.integration.spec.ts` proving only server-accepted completions disappear from authorized Today results; pending local state remains a client projection and DRAFT tasks are never executable.
### Implementation for User Story 1

- [x] T018 [US1] Implement the server completion transaction in `apps/api/src/tasks/task-completion.repository.ts`; re-resolve current Membership/task scope, lock and validate ACTIVE/APPROVED task state and base version, enforce actor/context-bound replay, write the separate completion atomically, and return stable conflict outcomes without leaking cross-business existence. Recover completion-ID uniqueness races with an authorized re-read and deterministic replay/conflict mapping. Do not add serializable isolation or a generic idempotency subsystem.
- [x] T019 [US1] Implement command routing, validation, and privacy-safe stable error mapping in `apps/api/src/tasks/task-completion.controller.ts`, `apps/api/src/tasks/task-completion.error.ts`, and `apps/api/src/tasks/task-completion.error.filter.ts`; accept only `completionId`, absolute `occurredAt`, and required `If-Match` version, deriving all authority/context server-side. Register the repository/controller in `apps/api/src/main.ts` within the existing API process.
- [x] T020 [US1] Implement the focused completion-specific SQLite persistence boundary in `apps/mobile/src/features/tasks/task-completion-command-store.ts`; partition rows by authenticated account and durably save the stable ID, task context, base version, occurrence instant, and `PENDING` state before submission, then atomically persist the accepted public server result before settlement and keep conflicted intent durable. Separately implement write and read operations for the last successfully synchronized actionable Today projection, including task identity/base version, field and season context, planned date/title, server Business-local Today date, Business timezone, and fetch metadata. Provide a deterministic check that the cached projection belongs to the current Business-local day using its server timezone/date semantics, and do not delete unresolved commands when replacing the snapshot. Keep the command/outbox and cached Today projection conceptually distinct; leave `recordedAt` as server-side audit/commit metadata and do not build a generic outbox, entity cache, global offline read model, or sync engine.
- [x] T021 [US1] Implement completion command coordination and exact retry/recovery in `apps/mobile/src/features/tasks/task-completion.ts`; preserve the same ID/payload after network ambiguity, transition only on definitive authorized outcomes, and keep actor/account partitioning and current server authorization authoritative.
- [x] T022 [US1] Extend the existing Today contract source at `specs/002-first-season-setup/contracts/seasons.openapi.yaml` with additive task version and resolved Business timezone metadata, then regenerate the existing Today client and run generated-client/type validation before implementing the additive query in `apps/api/src/seasons/today.repository.ts`; exclude server-accepted completions while preserving current authorized ACTIVE/APPROVED/business-local-date behavior and existing required response fields. Never hand-code transport fields or let consumers use stale generated types.
- [x] T023 [US1] Add an accessible one-action completion control and saving/pending/accepted/conflicted/retry/access-unavailable status presentation in `apps/mobile/src/features/seasons/today-screen.tsx`; ensure local pending work stops being actionable without appearing as accepted server history. When the network is unavailable, read and render the last synchronized actionable Today projection only when it belongs to the current Business-local day; use the cached server timezone/date semantics rather than device timezone and clearly identify the cached state.

**Checkpoint**: US1 can complete authorized ACTIVE work online/offline; accepted rows are unique and immutable; local pending work survives restart and settles only after durable acknowledgement.

---

## Phase 4: User Story 2 — Review completed work (Priority: P1)

**Goal**: Show bounded accepted completion history in field context with an optional authorized season filter, distinguishing planned date from actual occurrence.

**Independent Test**: Read a field history page and its season-filtered view; verify accepted records only, stable occurrence ordering/pagination, planned date and `occurredAt` rendered with Business timezone, and no required `recordedAt` or actor label in normal farmer-facing history.

### Tests for User Story 2 (write first)

- [x] T024 [P] [US2] Add history API contract coverage in `apps/api/test/tasks/task-history.contract.spec.ts` for field scope, optional authorized season filter, cursor/limit, accepted-only item fields, required Business timezone metadata, and absence of actor identity and `recordedAt` from farmer-facing response schema.
- [x] T025 [P] [US2] Add real PostgreSQL history integration tests in `apps/api/test/tasks/task-history.integration.spec.ts` for tenant/field privacy, authorized season filter, accepted-only results, stable `occurredAt DESC` plus ID ordering, cursor pagination, task/season snapshots, and no actor or `recordedAt` response exposure.
- [x] T026 [P] [US2] Add mobile history and journey tests in `apps/mobile/test/tasks/task-completion-history.test.tsx` for field/season context, planned-date plus actual-occurrence display, Business timezone rendering, accepted-only server history, pending/conflicted separation, loading/empty/error/retry states, accessible status/readout, and the automated mobile journey from an authorized ACTIVE Bugün task through completion into history.

### Implementation for User Story 2

- [x] T027 [US2] Implement the bounded history query in `apps/api/src/tasks/task-completion.repository.ts` and `apps/api/src/tasks/task-completion.service.ts`; scope by current authorized field/business, validate optional season belongs to that field, return accepted records only, and page by `occurredAt DESC, completionId DESC` with default 50/max 100.
- [x] T028 [US2] Implement `GET /fields/{fieldId}/task-completions` in `apps/api/src/tasks/task-completion.controller.ts`; return task/field/season context, planned date, actual `occurredAt`, plan provenance, and resolved Business timezone, omitting `recordedAt` and actor attribution from the farmer-facing representation.
- [x] T029 [US2] Implement the bounded mobile history view in `apps/mobile/src/features/tasks/task-completion-history-screen.tsx`; show only accepted server records with planned date and actual occurrence in Business timezone, keep local pending/conflicted commands visibly separate, and do not add diary/reporting/team attribution features.
- [x] T030 [US2] Integrate history entry from `apps/mobile/src/features/seasons/today-screen.tsx` and wire completion/history dependencies through `apps/mobile/src/app-composition.ts`; preserve existing SPEC-002 Today behavior and avoid a parallel Today model.

**Checkpoint**: US2 provides field history and an optional season-filtered view that retains plan/occurrence distinctions without becoming a generic activity feed.

---

## Phase 5: Polish & Cross-Cutting Verification

**Purpose**: Reconcile generated contracts, coverage, docs, and compatibility across the complete vertical slice.

- [x] T031 [P] Regenerate and verify `packages/api-client/src/generated/task-completions-api.ts` and additive Today client types from `packages/api-client/openapi-generator.config.ts`; confirm generated-client reproducibility and that old onboarding/season operations and required response fields remain intact.
- [x] T032 Run the automated scenarios in `specs/003-task-completion-history/quickstart.md` for unit/domain, API contract, real PostgreSQL, tenant isolation, concurrency/idempotency, mobile store/component, Bugün, history, and generated-client checks; fix only SPEC-003 findings in their owning files.
- [x] T033 Reconcile `specs/003-task-completion-history/spec.md`, `specs/003-task-completion-history/plan.md`, `specs/003-task-completion-history/data-model.md`, `specs/003-task-completion-history/contracts/task-completions.openapi.yaml`, and `specs/003-task-completion-history/quickstart.md` with delivered behavior, preserving replay actor/context semantics, append-only history, timestamp distinctions, and bounded offline scope.
- [ ] T034 Record physical-device/emulator validation as deferred manual evidence in `specs/003-task-completion-history/quickstart.md`; perform it only when that runtime becomes available and never report it as completed without evidence. This deferred item does not block automated implementation batches.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: T001 first; T002 can proceed after contract paths are confirmed.
- **Foundational (Phase 2)**: Depends on setup; tests T003–T005 precede T006–T009 implementation. T006, T007, and T008 operate in distinct files and can proceed in parallel once their tests/contracts are agreed. T009 follows generation setup.
- **User Story 1 (Phase 3)**: Depends on foundational domain, migration, and contract generation. Tests T010–T017 are written before T018–T023. T022 performs the Today contract/schema extension, then Today generated-client regeneration and generated-client/type validation, then the Today repository/query change, in that order. Mobile consumers must use those generated types; T023 depends on T020 and T022 so cached projection and metadata are available before the offline-capable Today UI.
- **User Story 2 (Phase 4)**: Depends on T007/T008 and accepted completion representation from US1. Tests T024–T026 precede T027–T030. History repository/service may follow the US1 transaction foundations; UI integration uses the shared completion/history client.
- **Polish (Phase 5)**: Depends on both stories; T031–T033 are automated generation, verification, and artifact reconciliation. T034 is explicitly deferred and is not an automated-batch blocker.

### User Story Dependencies

- **User Story 1 (P1)**: Depends on Phase 2. Delivers the MVP completion action and durable synchronization behavior.
- **User Story 2 (P1)**: Depends on the accepted completion record and client foundation from US1; it is not independently useful without accepted completion data.

### Within Each User Story

- Write tests before implementation and confirm the intended failure first.
- Keep database transaction and authorization logic server-side; never infer authority from queued client context.
- Complete API contract/client generation before mobile API consumption.
- Persist the local command before network submission; persist the accepted server result locally before settling pending state.
- Do not mark a locally pending result as accepted history.

### Parallel Opportunities

- After Phase 1, domain tests, persistence assertions, and OpenAPI contract tests (T003–T005) can be authored in parallel.
- After those tests/contracts are stable, domain model, schema/migration, and generation work (T006–T008) can proceed in parallel across packages; T009 follows client generation.
- Within US1, command/idempotency/tenant tests (T010–T012), domain tests (T013), mobile store/coordinator tests (T014–T015), and Today UI/PostgreSQL tests (T016–T017) can be authored concurrently. Implementation tasks touching the same API/service or Today screen files remain sequential.
- Within US2, API contract, PostgreSQL history, and mobile history tests (T024–T026) can be authored in parallel. History UI work can proceed after its response schema is fixed while the query implementation is developed.
- T031 generation/reproducibility verification may be run alongside cross-cutting documentation reconciliation only after feature contracts stop changing.

## Parallel Example: User Story 1

```text
After foundational contracts/schema are agreed:
- T010–T012: API acceptance, idempotency/concurrency, and authorization integration tests (separate files)
- T013: domain conflict and state-transition tests
- T014–T015: SQLite store and mobile coordinator offline/retry tests
- T016–T017: Today UI and PostgreSQL contract/integration tests

After the tests define outcomes:
- T018 then T019: server command transaction, then route/error mapping
- T020 then T021: durable mobile store, then retry coordinator
- T022: update the Today contract, regenerate and validate generated Today client types, then extend the existing repository/query after accepted-completion persistence is available
- T023: accessible online/offline Today UI after T020 provides the cached projection and T022 provides validated server metadata
```

## Implementation Strategy

### MVP First (User Story 1)

1. Complete setup and shared domain/schema/contract foundations.
2. Complete US1 test-first API transaction, authorization, concurrency, and mobile offline work.
3. Deliver one-tap completion in Bugün with pending/accepted/conflicted states and stable retry.
4. Independently validate US1 against its acceptance scenarios and PostgreSQL/offline requirements.

### Incremental Delivery

1. Shared foundation → verified migration and generated command contract.
2. US1 → authorized online/offline completion and accepted-completion exclusion from Bugün.
3. US2 → bounded field/season completion history.
4. Cross-cutting generation, compatibility, tenant, accessibility, and quickstart verification.

## Traceability

- **US1 / FR-001–006, FR-009–015, FR-017–018**: T003, T006–T023; covers ACTIVE/APPROVED action, one-tap behavior, append-only completion, occurrence/recorded timestamps, Today projection, replay/concurrency, authorization/privacy, durable completion-specific offline state, accessible recovery, and explicit non-generic queue boundary.
- **US2 / FR-007, FR-010–015, FR-019**: T024–T030; covers accepted-only bounded history, field/season authorization, planned date plus Business-timezone occurrence, actor/recordedAt omission from normal history, and accessible loading/error states.
- **Cross-cutting / FR-008, FR-016–018; SC-001–SC-008**: T001–T009 and T031–T034; scope exclusions are enforced in story descriptions, transaction/client boundaries, compatibility verification, and quickstart reconciliation. T034 is deferred manual evidence only.

## Notes

- `[P]` means files differ and prerequisites are complete; coordinate any shared contract or service files before parallel edits.
- `[US1]` and `[US2]` map to the two stories in `specs/003-task-completion-history/spec.md`.
- No task authorizes changes to SPEC-001 or SPEC-002 behavior beyond additive Today metadata in its owning SPEC-002 contract source.
- No generic sync engine, calendar, postponement/skip, recurrence, weather adjustment, upload, cost, observation, harvest/sales, team attribution, or AI work is included.
- Physical-device/emulator validation remains deferred; automated mobile validation is required and must not be represented as device evidence.
