---
description: "Implementation tasks for Irrigation Record Capture"
---

# Tasks: Irrigation Record Capture

**Input**: Design documents from `specs/011-irrigation-record-capture/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/irrigation-records.openapi.yaml`

**Tests**: Included because the feature request explicitly requires domain, API, persistence, diary, authorization, timezone, idempotency, and mobile coverage. Write tests before the corresponding implementation.

**Organization**: Tasks are grouped by the two specification user stories. US2 extends the create flow introduced by US1.

## Phase 1: Setup

The existing pnpm monorepo, API, Prisma, OpenAPI client generator, and mobile app are reused. No new setup or infrastructure is required.

---

## Phase 2: Foundational Persistence

**Purpose**: Establish the tenant-safe append-only record table required by both user stories.

- [x] T001 Add PostgreSQL integration coverage for Business/Field/optional Season composite relationships, unique `(businessId, id)`, history indexes, and rejection of update/delete in `apps/api/test/operations/irrigation-records.persistence.integration.spec.ts`.
- [x] T002 Add the `IrrigationRecord` Prisma model in `apps/api/prisma/schema.prisma` with required Business, Field, actor, `occurredAt`, and `recordedAt`; nullable Season, method, `durationMinutes`, `waterVolumeCubicMetres`, and note; composite tenant relationships and unique `(businessId, id)`.
- [x] T003 Add the migration in `apps/api/prisma/migrations/<timestamp>_irrigation_record/migration.sql` with composite foreign keys, descending Field and Field/Season history indexes, and a database guard that rejects updates and deletes.
- [x] T004 Regenerate Prisma client artifacts under `apps/api/src/generated/prisma/` from `apps/api/prisma/schema.prisma` and the irrigation migration.

**Checkpoint**: The canonical record can only be stored within its Business/Field context and cannot be silently edited or deleted.

---

## Phase 3: User Story 1 — Record irrigation for a Field (Priority: P1) 🎯 MVP

**Goal**: Create an online irrigation record for an authorized Field and show it in chronological Field history. Season association is added in US2.

**Independent Test**: An authorized farmer submits a valid Field-only record online, sees acceptance only after the API succeeds, and finds one distinct `IRRIGATION` event in the Field Diary with its Business-local occurrence time.

### Tests for User Story 1

- [x] T005 [P] [US1] Add domain validation cases for required UUID/absolute `occurredAt`; optional free-text method up to 120 characters; `durationMinutes` as a positive whole number of minutes; `waterVolumeCubicMetres` as a positive decimal with at most one decimal place; and an optional trimmed note up to 2000 characters, in `packages/domain/test/operations/irrigation-record.spec.ts`.
- [x] T006 [P] [US1] Add API timezone cases for Business timezone interpretation, `Europe/Istanbul` fallback, local-time/instant mismatch, future time rejection, and ambiguous/nonexistent local-time rejection in `apps/api/test/operations/irrigation-records.timezone.spec.ts`.
- [x] T007 [P] [US1] Add API authorization/privacy cases for active Membership, Business scope, required Field scope, revoked access, and non-disclosure of cross-Business Field data in `apps/api/test/operations/irrigation-records.authorization.integration.spec.ts`.
- [x] T008 [P] [US1] Add exact-retry cases proving that the same actor and exact request replay the accepted record, while a changed payload, Field, or actor using the same identity conflicts, in `apps/api/test/operations/irrigation-records.idempotency.integration.spec.ts`.
- [x] T009 [P] [US1] Add diary ordering and pagination cases for the `IRRIGATION` kind, equal occurrence times, deterministic kind/ID tie-breaks, cursor continuation, and the `includeIrrigation` filter in `apps/api/test/observations/diary-query.spec.ts`.
- [x] T010 [P] [US1] Add API contract cases for create request fields, validation/error responses, and first-create versus exact-replay status behavior in `apps/api/test/operations/irrigation-records.contract.spec.ts`.
- [x] T011 [P] [US1] Extend diary OpenAPI contract cases to require an opt-in `includeIrrigation` query and a distinct `IRRIGATION` event shape in `apps/api/test/observations/observations-diary.contract.spec.ts`.
- [x] T012 [P] [US1] Add mobile create-flow cases for online submission, server-confirmed success, validation/authorization/connectivity errors, and absence of durable local commands or offline queueing in `apps/mobile/test/operations/irrigation-record-create-screen.test.tsx`.
- [x] T013 [P] [US1] Add mobile diary cases for loading, empty/error states, Business-timezone rendering, and rendering `IRRIGATION` separately from observation-local reconciliation in `apps/mobile/test/observations/field-diary-screen.test.tsx`.
- [x] T014 [P] [US1] Add app-composition coverage for opening irrigation capture from the Field Diary and returning to the diary in `apps/mobile/test/app-composition.test.ts`.

### Implementation for User Story 1

- [x] T015 [P] [US1] Implement the `IrrigationRecord` domain type and validation in `packages/domain/src/operations/irrigation-record.ts`, enforcing the optional-field constraints covered in `packages/domain/test/operations/irrigation-record.spec.ts`.
- [x] T016 [P] [US1] Add the create operation and settled quantity schemas to `specs/011-irrigation-record-capture/contracts/irrigation-records.openapi.yaml`: `durationMinutes` is an optional positive integer; `waterVolumeCubicMetres` is an optional positive decimal string with at most one fractional digit.
- [x] T017 [US1] Implement the authorized transactional create repository in `apps/api/src/operations/irrigation-records.repository.ts`, re-resolving Business/Membership/Field and Business timezone on the server, resolving local occurrence time to exactly one absolute instant, rejecting future/mismatched/stale-timezone/ambiguous/nonexistent values, and returning exact same-actor retries while conflicting changed identities.
- [x] T018 [US1] Add the create service, controller, module, and API registration in `apps/api/src/operations/irrigation-records.service.ts`, `apps/api/src/operations/irrigation-records.controller.ts`, `apps/api/src/operations/irrigation-records.module.ts`, and `apps/api/src/main.ts`, preserving existing API error envelopes and server authorization.
- [x] T019 [US1] Register the irrigation OpenAPI source and regenerate the shared client in `packages/api-client/openapi-generator.config.ts`, `packages/api-client/src/generated/irrigation-records-api.ts`, and `packages/api-client/src/index.ts`.
- [x] T020 [US1] Extend the existing diary event union, deterministic sorting, cursor encoding/decoding, and `includeIrrigation` filter in `apps/api/src/observations/diary-query.ts` without introducing a generic diary abstraction.
- [x] T021 [US1] Extend `apps/api/src/observations/observation-diary.repository.ts` to read accepted IrrigationRecord rows only when requested and compose them as distinct `IRRIGATION` events sourced from their own records, not as FieldObservations.
- [x] T022 [US1] Extend `specs/006-field-observations-basic-diary/contracts/observations-diary.openapi.yaml` with the opt-in `includeIrrigation` query and additive `IRRIGATION` variant while preserving existing response behavior by default.
- [x] T023 [US1] Regenerate the diary API client from its canonical contract in `packages/api-client/src/generated/observations-diary-api.ts` and compose its types in `packages/api-client/src/index.ts`.
- [x] T024 [US1] Add the online create client and capture screen in `apps/mobile/src/features/operations/irrigation-record-client.ts` and `apps/mobile/src/features/operations/irrigation-record-create-screen.tsx`; submit only to the server and keep retry identity only in the active form flow.
- [x] T025 [US1] Update `apps/mobile/src/features/observations/diary-client.ts` and `apps/mobile/src/features/observations/field-diary-screen.tsx` to opt into irrigation history and render `IRRIGATION` with its own row branch, never passing it through FieldObservation identity or local-command reconciliation.
- [x] T026 [US1] Wire the create entry point and return-to-diary navigation in `apps/mobile/src/app-composition.ts` and `apps/mobile/App.tsx` without adding irrigation storage, outbox, background retry, or sync infrastructure.

**Checkpoint**: US1 supports online Field-only creation with optional details and distinct chronological history; no local irrigation command exists.

---

## Phase 4: User Story 2 — Associate irrigation with a Season (Priority: P2)

**Goal**: Allow an optional Season only when it belongs to the same authorized Business and Field, and retain that association in the Field Diary.

**Independent Test**: A same-Field, same-Business Season is accepted and retained; a Season from another Field or Business is rejected without disclosure or persistence. Field-only creation remains valid.

### Tests for User Story 2

- [x] T027 [P] [US2] Add integration cases for valid same-Field/Business Season association, absent Season, invalid cross-Field/cross-Business Season, and changed-Season identity conflict in `apps/api/test/operations/irrigation-records.season.integration.spec.ts`.
- [x] T028 [P] [US2] Add mobile cases proving a supplied active diary Season is sent with the online create and no Season remains valid in `apps/mobile/test/operations/irrigation-record-season-context.test.tsx`.
- [x] T029 [US2] Add Field Diary repository integration cases proving a same-Field/Business irrigation Season association is retained in the distinct diary event and the existing Season filter excludes Field-only and other-Season irrigation records in `apps/api/test/observations/field-diary.integration.spec.ts`.

### Implementation for User Story 2

- [x] T030 [US2] Extend `apps/api/src/operations/irrigation-records.repository.ts` and `apps/api/src/operations/irrigation-records.service.ts` to validate optional Season within the authorized Business and path Field, persist its nullable association, reject invalid associations without revealing protected data, and add no Season active-state requirement.
- [x] T031 [US2] Pass the optional Season context from the current Field Diary navigation into `apps/mobile/src/features/operations/irrigation-record-create-screen.tsx` and `apps/mobile/src/features/operations/irrigation-record-client.ts`; do not add a separate Season catalog or local persistence.
- [x] T032 [US2] Apply the existing diary Season filter to irrigation rows in `apps/api/src/observations/observation-diary.repository.ts`, ensuring Field-only and matching-Season records appear in the appropriate chronological history.

**Checkpoint**: US1 and US2 work independently at their specified boundaries; optional Season associations are validated server-side and remain tenant-safe.

---

## Phase 5: Polish & Cross-Cutting Verification

**Purpose**: Validate the whole bounded feature against the current quickstart and preserve strict architecture boundaries.

- [x] T033 Run the domain, API, PostgreSQL integration, generated-client contract, and mobile commands documented in `specs/011-irrigation-record-capture/quickstart.md`; resolve failures and confirm all accepted records remain append-only and Business-scoped.
- [x] T034 Review `specs/011-irrigation-record-capture/plan.md`, `specs/011-irrigation-record-capture/data-model.md`, and `specs/011-irrigation-record-capture/contracts/` against implementation to confirm no durable local command store, offline queue/sync/reconciliation, FieldObservation identity reuse, or generic Operations/Diary abstraction was introduced. Confirmed the V1 volume contract is bounded to the existing PostgreSQL `numeric(12,1)` capacity, exact retries conflict on changed captured Business timezone after current authorization is revalidated, and diary cursors bind the irrigation projection while preserving legacy non-irrigation cursors.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No new project initialization is needed.
- **Foundational Persistence (Phase 2)**: Complete T001–T004 before implementation because both stories depend on the canonical tenant-safe, append-only record model.
- **User Story 1 (Phase 3)**: Depends on Phase 2. It delivers the MVP Field-only capture and diary view.
- **User Story 2 (Phase 4)**: Depends on US1's create flow and diary projection; it adds optional Season association and validation.
- **Polish (Phase 5)**: Depends on both stories being complete.

### Parallel Opportunities

- After the shared database test/design boundary is established, US1 test tasks T005–T014 target separate files and can be authored in parallel.
- T015 (domain model) and T016 (create contract) can proceed in parallel after the tests are defined.
- US2 test tasks T027 and T028 target separate files and can be authored in parallel after US1 is complete; T029 follows T009's diary query coverage and runs before T032's projection change.
- Do not parallelize tasks that edit the same API repository, shared OpenAPI client index, diary screen, or create screen.

### User Story Dependencies

- **US1 (P1)**: Starts after Phase 2; it requires no Season and provides the MVP capture/history flow.
- **US2 (P2)**: Starts after US1 because it extends the same create endpoint and Field Diary projection with optional Season behavior.

## Parallel Example: User Story 1

```text
After Phase 2, author T005–T014 in parallel because each targets a separate test file.
After those tests are in place, implement T015 and T016 in parallel; continue API, diary, client, and mobile tasks along their listed dependencies.
```

## Implementation Strategy

### MVP First (User Story 1)

1. Complete Phase 2 persistence prerequisites.
2. Complete US1 tests before implementation tasks.
3. Complete US1 to deliver online Field-only capture and chronological Field Diary history.
4. Validate US1 independently before adding Season association.

### Incremental Delivery

1. Complete Phase 2, then deliver US1 as the first vertical slice.
2. Add US2 optional Season validation and context propagation.
3. Complete Phase 5 cross-cutting verification after both stories.

## Notes

- `[P]` tasks use separate files and have no dependency on incomplete tasks.
- User-story labels map to the two stories in `specs/011-irrigation-record-capture/spec.md`.
- Tests are written before corresponding implementation tasks.
- No task adds durable local irrigation state, offline sync, FieldObservation identity reuse, or a generic abstraction.
