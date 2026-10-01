---
description: "Implementation tasks for first season setup and plan approval"
---

# Tasks: First Season Setup and Plan Approval

**Input**: Design documents from `specs/002-first-season-setup/`

**Prerequisites**: `spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/seasons.openapi.yaml`, and `quickstart.md`

**Tests**: Required by the specification, plan, and constitution. Add domain, API contract, PostgreSQL/PostGIS integration, and mobile automated tests with the behavior they verify.

**Organization**: Tasks are grouped by the three P1 user stories. Shared schema, domain contracts, and generated transport setup are foundational; story phases then build the create/review/activation journey in dependency order.

## Phase 1: Setup

**Purpose**: No new project or package setup is needed; SPEC-002 extends the existing monorepo packages.

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Establish the domain and persistence invariants required by every season-setup story.

- [x] T001 [P] Define season, season-plan, planned-task, crop-reference, immutable-template-provenance, activation-snapshot, and command-idempotency types in `packages/domain/src/seasons/`; preserve `DRAFT`/`ACTIVE` and `MANUAL`/`VALIDATED_TEMPLATE` as explicit discriminators.
- [x] T002 [P] Add Prisma models, relations, indexes, and a migration in `apps/api/prisma/schema.prisma` and `apps/api/prisma/migrations/` from the approved `data-model.md` for central/custom crops, seasons, plans, planned tasks, activation snapshots, and command-idempotency outcomes; enforce business/field relationships, source/template consistency, planned local `DATE`, and logical identity `(authorized business, field, stable crop identity, actual planting date)` across DRAFT and ACTIVE.
- [x] T003 Add database-constraint integration coverage in `apps/api/test/seasons/season-schema.integration.spec.ts` for PostgreSQL constraints, transaction rollback, point-only fields, and database-level uniqueness under concurrent inserts; use PostgreSQL/PostGIS semantics rather than mocked database behavior. Leave API-level different-key logical-season outcome coverage to T011.
- [x] T004 [P] Implement shared local-date validation in `packages/domain/src/seasons/local-date.ts` with unit coverage in `packages/domain/test/seasons/local-date.spec.ts`; accept actual planting dates that are today or any past local calendar date with no lookback limit, reject future actual dates, and require each planned date to be on/after actual planting date with equality allowed and no inter-task ordering rule.
- [x] T005 [P] Extend the `packages/api-client/` generator to include `specs/002-first-season-setup/contracts/seasons.openapi.yaml` while preserving all generated SPEC-001 onboarding paths and types; add a reproducibility check proving regeneration leaves no divergent handwritten transport types and type-checks consumers of both API surfaces.

**Checkpoint**: Domain invariants, database ownership, foundational constraints, and generated-client workflow are established before user-story API and mobile work.

## Phase 3: User Story 1 — Set up a first season (Priority: P1)

**Goal**: Continue from the SPEC-001 first field through crop/date selection and recoverably create a proposed DRAFT season and plan.

**Independent Test**: From an authorized first field, select a central or custom crop, enter an actual date, and confirm a DRAFT season is reviewable; verify unsupported crops and empty templates require an explicit MANUAL choice.

### Domain, persistence, and API

- [x] T006 [US1] Implement server-side central/custom crop selection and field-scoped template applicability in `packages/domain/src/seasons/`; treat a published applicable template with zero task definitions as unavailable, emit a content-quality diagnostic, and require an explicit MANUAL choice without creating an empty VALIDATED_TEMPLATE plan or placeholder tasks.
- [x] T007 [US1] Add domain tests in `packages/domain/test/seasons/crop-template-selection.spec.ts` for selectable central crops without a frozen pilot list, business-scoped custom crops, custom display-name surrounding-whitespace normalization without name-based identity merging, template-version pinning, immutable copied task provenance, unsupported crops, and explicit empty-template fallback.
- [x] T008 [US1] Implement field-scoped setup-options and scoped season-read recovery in `apps/api/src/seasons/`; resolve active membership and authorized business server-side, verify field/season ownership, never trust client `businessId`, and return privacy-safe authorization failures.
- [x] T009 [US1] Implement transactional DRAFT creation in `apps/api/src/seasons/`; consume the T002 schema, T004 date rules, and T006 crop/template rules, normalize custom crop display names for surrounding whitespace while retaining business-scoped ID identity, and atomically persist optional custom crop, season, plan, copied tasks, and idempotency outcome.
- [x] T010 [US1] Add API contract and tenant-isolation tests in `apps/api/test/seasons/season-create.contract.spec.ts` for field-scoped options, authorized draft read/create, privacy-safe cross-business failures, and no client-supplied business authority.
- [x] T011 [US1] Add PostgreSQL integration tests in `apps/api/test/seasons/season-create.integration.spec.ts` for exact same-key/same-request replay, same-key changed-payload conflict, different-key matching logical-season deduplication returning the existing season unchanged, concurrent different-key deduplication, atomic rollback, and retry after lost response.

### Mobile journey and recovery

- [x] T012 [US1] Route successful SPEC-001 first-field completion into crop/date setup in `apps/mobile/src/app-composition.ts` and `apps/mobile/App.tsx` without repeating field onboarding.
- [x] T013 [US1] Implement crop options, custom/unsupported crop, actual planting-date input, explicit MANUAL fallback, and source-aware template-backed draft creation in `apps/mobile/src/features/seasons/` using the T005 generated client and T008/T009 API contracts; accept today/past dates, reject future dates, and keep optional agronomic details non-blocking.
- [x] T014 [US1] Persist the exact unresolved create request and original idempotency key in a narrow SQLite-backed store in `apps/mobile/src/features/seasons/season-create-command-store.ts` before submitting through T009; retry that exact command after response loss or app restart and clear it only after the successful season ID/result is durably recorded, without adding a general outbox/sync engine.
- [x] T015 [US1] Add mobile tests in `apps/mobile/test/seasons/season-create.test.ts` and `apps/mobile/test/app-composition.test.ts` for SPEC-001 routing, central/custom crop paths, template flow, explicit empty-template MANUAL choice, date validation, request persistence/retry/restart recovery, and draft recovery.
- [x] T016 [US1] Add accessible loading, empty, validation, network-error, retry, and create-conflict states in `apps/mobile/src/features/seasons/`; expose accessible names/roles, scalable text, sufficient contrast, touch targets, and source cues that do not rely on color alone.

**Checkpoint**: A farmer can reach and recover a proposed season from the first-field flow without false success or loss of the original create command.

## Phase 4: User Story 2 — Review and adjust the proposed plan (Priority: P1)

**Goal**: Review the DRAFT plan and add, edit, remove, or re-date plan-owned tasks before activation.

**Independent Test**: Load a DRAFT plan, add/edit/remove tasks and change dates, then verify only valid changes persist, source provenance remains visible, and ACTIVE seasons reject mutation.

### Domain, persistence, and API

- [x] T017 [US2] Implement DRAFT-only plan-task add/edit/remove rules in `packages/domain/src/seasons/`; validate required title and local planned date on/after the actual planting date, with equality allowed and no ordering constraint between tasks.
- [x] T018 [US2] Add unit tests in `packages/domain/test/seasons/plan-task-mutations.spec.ts` for task add/edit/remove, invalid earlier dates, equality, independent task-date ordering, and rejection of every mutation against ACTIVE seasons.
- [x] T019 [US2] Implement version-checked task persistence and DRAFT-only API mutations in `apps/api/src/seasons/` using the T017 domain rules; require expected plan/season version, preserve other plan-owned tasks, and return the contract's stable stale-version or invalid-state conflict without mutating ACTIVE history.
- [x] T020 [US2] Add contract and PostgreSQL integration tests in `apps/api/test/seasons/plan-task-mutations.contract.spec.ts` and `apps/api/test/seasons/plan-task-mutations.integration.spec.ts` for add/edit/remove, date validation, stale-version 409, tenant isolation, atomic persistence, and ACTIVE mutation rejection.

### Mobile plan review

- [x] T021 [US2] Implement source-labelled plan review and task add/edit/remove/date controls in `apps/mobile/src/features/seasons/` using the T005 generated client and T019 API behavior; restore the scoped DRAFT after leaving review, preserve task source, and expose no edit controls for ACTIVE plans.
- [x] T022 [US2] Add mobile review tests in `apps/mobile/test/seasons/season-plan-review.test.ts` for MANUAL and VALIDATED_TEMPLATE labels, task review/edit/remove/date, invalid-date feedback, draft restoration, stale-version conflict/re-read, retry states, and ACTIVE read-only presentation.

**Checkpoint**: The farmer can revise only a DRAFT plan; server version checks and the mobile view agree on the saved proposal and source.

## Phase 5: User Story 3 — Activate the season and continue to Bugün (Priority: P1)

**Goal**: Explicitly activate a valid reviewed plan, preserve its context, and show its planned work on the authorized business-local Bugün surface.

**Independent Test**: Activate a DRAFT with at least one valid task; confirm one atomic DRAFT-to-ACTIVE transition and context snapshot, then read matching planned work using the business timezone. Confirm zero-task plans remain editable and cannot activate.

### Domain, persistence, and API

- [x] T023 [P] [US3] Implement activation validation and one-time lifecycle rules in `packages/domain/src/seasons/`; both MANUAL and VALIDATED_TEMPLATE require at least one valid planned task, and zero-task activation returns a stable validation error without inserting a placeholder or changing DRAFT state.
- [x] T024 [US3] Add activation unit tests in `packages/domain/test/seasons/season-activation.spec.ts` for both-source zero-task rejection, invalid-task rejection, and successful approval eligibility with one valid task.
- [x] T025 [US3] Implement atomic activation, immutable context snapshot, and strict idempotency replay in `apps/api/src/seasons/` using the T023 activation rules; recheck membership/scope and expected DRAFT version, snapshot field/region/crop/template/timezone context, and enforce same-key exact replay plus specified 409 outcomes for all other stale, changed, active, or losing activation requests.
- [x] T026 [US3] Implement the read-only Bugün planned-work query in `apps/api/src/seasons/`; use the authorized business timezone with `Europe/Istanbul` fallback, include tasks whose planned local date equals the business-local date across all fields in that business, and ignore device timezone/server UTC.
- [x] T027 [P] [US3] Add API contract tests in `apps/api/test/seasons/season-activation.contract.spec.ts` and `apps/api/test/seasons/today.contract.spec.ts` for activation and planned-work response/error shapes, including validation and 409 outcomes.
- [x] T028 [US3] Add PostgreSQL integration tests in `apps/api/test/seasons/season-activation.integration.spec.ts` for atomic snapshot/state/idempotency writes, rollback, exact same-key/same-command replay, changed payload/version 409, stale DRAFT 409, exactly one concurrent activation winner, different-key loser and already-ACTIVE 409, cross-business/out-of-scope and revoked-membership authorization failures without existence leakage, no ACTIVE mutation after conflict, and later template publication not rewriting copied tasks or snapshots.
- [x] T029 [US3] Add tenant and timezone integration tests in `apps/api/test/seasons/today.integration.spec.ts` for cross-business denial without existence leakage and business-local day boundaries across fields, using `Europe/Istanbul` only when no business timezone is configured and proving device timezone/server UTC do not define the date.

### Generated client, mobile activation, and Bugün

- [x] T030 [US3] Implement explicit activation, zero-task guidance, activation retry/conflict re-read, success transition, and read-only planned-work presentation in `apps/mobile/src/features/seasons/` and `apps/mobile/src/app-composition.ts` using the T005 generated client and T025/T026 API behavior; keep ACTIVE plan edits unavailable and do not add task completion controls.
- [x] T031 [US3] Add mobile activation/Bugün tests in `apps/mobile/test/seasons/season-activation.test.ts` and `apps/mobile/test/app-composition.test.ts` for zero-task errors for both sources, activation success/failure, strict 409 re-read, read-only planned tasks, business-local day input, and clear no-task-due-today state.

## Phase 6: Polish and Cross-Cutting Convergence

**Purpose**: Verify all SPEC-002 requirements trace to implementation tasks and documented automated evidence, without expanding the approved feature boundary.

- [x] T032 Reconcile completed implementation and automated evidence against `specs/002-first-season-setup/spec.md`, `plan.md`, `data-model.md`, `contracts/seasons.openapi.yaml`, and `quickstart.md`; update `specs/002-first-season-setup/tasks.md` with any remaining SPEC-002 work without changing SPEC-001 or resolving CHK012 through name-based custom-crop merging.
- [x] T033 Run the documented Cloud Shell verification commands from `specs/002-first-season-setup/quickstart.md` (`pnpm test`, `pnpm test:integration`, `pnpm test:contract`, `pnpm test:mobile`, `pnpm typecheck`, `pnpm lint`, `pnpm check:diff`) and record results; do not run Android builds, emulator, or device-runtime work.

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No package initialization is required.
- **Foundational (Phase 2)**: Complete domain shape, Prisma migration, PostgreSQL constraints, shared local-date validation, and client generation/reproducibility before story implementation.
- **User Story 1 (Phase 3)**: Depends on Phase 2; creates and recovers a proposed season.
- **User Story 2 (Phase 4)**: Depends on User Story 1's DRAFT, persisted plan/task model, and generated API-client contract.
- **User Story 3 (Phase 5)**: Depends on User Story 1 and User Story 2; activation consumes the reviewed versioned plan and Bugün reads activated planned work.
- **Convergence (Phase 6)**: Depends on all three user stories.

### User Story Dependencies

- **US1 (P1)**: Requires foundational domain/persistence/client support; establishes the season draft.
- **US2 (P1)**: Requires US1's DRAFT season and plan; cannot be implemented as an independent plan-only workflow.
- **US3 (P1)**: Requires the DRAFT plan and task mutation/version behavior from US1/US2.

### Parallel Opportunities

- Phase 2 tasks T001, T002, T004, and T005 may proceed in parallel from the already-approved data model and contracts because they own separate domain types, Prisma schema, local-date rules, and client generation. T003 depends on migration T002. Phase 3 does not begin until the Phase 2 checkpoint is complete.
- In US1, T006 follows Phase 2; T007 follows T006; setup-options/read API work T008 follows Phase 2, and create API work T009 follows T002, T004, and T006. Mobile integration waits for T005 and both relevant API behaviors.
- In US2, work follows the contract dependency chain: T017 precedes T018/T019; T019 precedes T020/T021; T021 precedes mobile review tests T022.
- In US3, T023 and T027 can proceed in parallel after US1/US2 and the OpenAPI contract are available; T024 follows T023, activation implementation T025 and Bugün query implementation T026 precede their PostgreSQL tests T028–T029, and T005/T025/T026 precede mobile API integration T030–T031.
- Do not parallelize schema-dependent persistence/tests before T002, mobile transport against an ungenerated client, activation before DRAFT plan mutations, or Bugün integration before authorized timezone behavior exists.

## Parallel Execution Examples

```text
After the approved design artifacts are available:
- Phase 2 domain types: T001
- Prisma model/migration: T002
- Local-date rules/tests: T004
- Generated client/reproducibility: T005
- Complete Phase 2, then implement crop/template rules T006 and tests T007

After the relevant story contract is stable and T005 has generated the client:
- US1: domain applicability implementation/tests (T006–T007) alongside first-field routing (T012); API behavior T008/T009 then gates mobile integration T013–T015.
- US2: domain task rules/tests T017–T018 precede API work/tests T019–T020; API behavior T019 gates plan-review UI/tests T021–T022.
- US3: activation domain rules T023 can proceed alongside API contract tests T027; API activation/query implementation T025–T026 gates integration tests T028–T029 and mobile activation/Bugün T030–T031.
```

## Implementation Strategy

### MVP First

Complete the foundational model and the complete User Story 1 slice first: first-field routing, crop/date selection, explicit MANUAL fallback, DRAFT creation, exact unresolved-command recovery, and independent domain/API/PostgreSQL/mobile tests. Then add DRAFT review/editing (US2), followed by activation and Bugün (US3).

### Incremental Delivery

1. Establish shared domain and migration invariants.
2. Deliver and verify recoverable DRAFT creation (US1).
3. Deliver and verify versioned plan review/editing (US2).
4. Deliver and verify activation, snapshot, and business-local Bugün (US3).
5. Reconcile against the SPEC-002 artifacts (T032), then run only the documented Cloud Shell verification (T033).

## Task-Level Dependencies

- T001, T002, T004, and T005 use the approved design artifacts and can be authored independently in parallel; T003 requires T002's migration.
- T006–T016 require the Phase 2 checkpoint. T007 follows T006; T008 implements scoped options/read; T009 consumes T002, T004, and T006; T010 verifies T008/T009 contract behavior; T011 verifies T009 persistence/idempotency; T013 consumes T005/T008/T009; T014 consumes T005/T009's create contract; T015 verifies T012–T014; T016 completes the US1 mobile states.
- T017–T022 require US1's DRAFT and contract. T018 follows T017; T019 consumes T017 and T002; T020 verifies T019; T021 consumes T005/T019; T022 verifies T021 and API conflicts.
- T023–T031 require the reviewed DRAFT from US1/US2. T024 follows T023; T025 consumes T023/T002 for activation; T026 implements the Bugün query; T027 verifies activation/Bugün contracts; T028 verifies T025 transaction/replay behavior; T029 verifies T026 timezone/authorization behavior; T030 consumes T005/T025/T026; T031 verifies T030.
- T032 follows T001–T031. T033 follows T032 and all implementation/test tasks.

## Notes

- All implementation work remains within SPEC-002's approved scope. Do not add task completion/execution, recurrence, weather rescheduling, AI, satellite, advisor, costs, harvest/sales, a general offline-sync engine, pre-sowing planned seasons, an exact pilot crop list, or custom-crop display-name alias/merge behavior.
- Both MANUAL and VALIDATED_TEMPLATE plans need at least one valid task to activate; an empty published template requires an explicit MANUAL choice.
- A create retry retains the exact request and original key; a different-key matching logical-season create returns the existing season unchanged.
- Activation same-key exact replay succeeds; different-key, stale-version, changed-payload, and concurrent losing activation outcomes are 409; conflict clients re-read authoritative state.
- Runtime/device evidence is not a task because the plan explicitly excludes Android, emulator, and device-runtime evaluation. Do not mark any future runtime evidence complete here.
