# Tasks: Harvest Record Capture

**Input**: Approved design documents in `specs/013-harvest-record-capture/`

**Prerequisites**: Approved `spec.md`, `plan.md`, `research.md`, `data-model.md`, contracts, `quickstart.md`, and closed `checklists/requirements-quality.md`.

**Tests**: Tests are included because the approved plan requires domain, PostgreSQL integration, API contract, and mobile tests, and the request requires TDD-friendly task boundaries. For each story, write its failing tests first and confirm the expected failure before implementation.

**Organization**: Tasks are grouped by the three P1 user stories. The repository's existing monorepo, database, API, generated-client, and mobile foundations are reused; no new shared framework or infrastructure is needed.

## Phase 1: Setup

**Purpose**: Reuse the existing pnpm monorepo and test infrastructure.

No setup tasks are required; the approved plan identifies no new project initialization or infrastructure.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Avoid introducing generic infrastructure outside the approved feature boundary.

No standalone foundational tasks are required. Each foundation needed by the feature belongs to its first consuming story and is covered by that story's tests before implementation.

---

## Phase 3: User Story 1 — Record a Harvest (Priority: P1)

**Goal**: Let an authorized OWNER or WORKER record one canonical Harvest online for the same-Business, same-Field ACTIVE Season, with the server as the acceptance authority.

**Independent Test**: Submit a valid Harvest for an authorized Field and ACTIVE Season; receive a server-confirmed record with the exact date, quantity, unit, actor, and acceptance time. Invalid, unauthorized, or privacy-sensitive context creates no record. An exact authorized retry resolves to the original record.

### Tests for User Story 1 — write first

- [x] T001 [P] [US1] Add failing domain tests for LocalDate, positive quantity, unit, and input validation in `packages/domain/test/harvest/harvest-record.spec.ts`; cover `harvestDate` as `YYYY-MM-DD`, quantity as an exact positive decimal string with at most 11 integer digits and 3 fractional digits and `< 100000000000`, and units `KG | METRIC_TONNE`.
- [x] T002 [P] [US1] Add failing create-contract tests for request/response schemas, status codes, stable `harvestId`, error codes, and rejection of an unsupported `note` property in `apps/api/test/harvest/harvests.contract.spec.ts`, using `specs/013-harvest-record-capture/contracts/harvests.openapi.yaml` as the contract source.
- [x] T003 [P] [US1] Add failing PostgreSQL integration tests for OWNER/WORKER create authorization, ADVISOR denial, current membership/role revocation before first create and replay, current ACTIVE Season enforcement on both first create and replay, same-Business/same-Field checks, privacy-safe missing/foreign resources, Business-local future-date rejection, valid planting-date equality and earlier-date rejection, invalid calendar dates without timezone shifts, zero/negative quantities, more than 11 integer digits, more than 3 fractional digits rejected without rounding, per-record unit preservation, actor plus server `recordedAt` provenance separate from `harvestDate`, multiple distinct records in one Season, exact retry/conflict behavior, concurrent exact-request convergence, and a Season status transition racing first acceptance in `apps/api/test/harvest/harvests.integration.spec.ts`.
- [x] T004 [P] [US1] Add failing mobile create and navigation tests in `apps/mobile/test/harvest/harvest-create-screen.test.tsx` for active-Season Diary entry, fixed Field/Season context, OWNER/WORKER CTA visibility, ADVISOR and missing/unavailable `viewerRole` CTA absence, no role inference from provider/app metadata, and a stale UI role receiving and truthfully displaying the server's authorization denial; cover validation and server states, online-only submission, no local persistence/outbox, no success before server confirmation, same-ID/same-payload user retry after an uncertain response while the form remains active, success returning to Diary, accessible labels, usable touch targets, and scalable text.

### Implementation for User Story 1

- [x] T005 [US1] Implement Harvest domain types and validation in `packages/domain/src/harvest/harvest-record.ts`, reusing `packages/domain/src/seasons/local-date.ts`; preserve exact decimal-string semantics and reject invalid syntax, nonpositive values, excess scale, and values at or above `100000000000` without conversion or rounding.
- [x] T006 [US1] Add the canonical Harvest model, composite Business/Field/Season/actor relations, unique `(businessId, id)` identity, DATE and unconstrained exact NUMERIC fields, database checks, and Field/Season history indexes to `apps/api/prisma/schema.prisma`; do not use bounded NUMERIC precision/scale that could coerce excess scale before validation.
- [x] T007 [US1] Create a Prisma-generated `_harvest_record` migration under `apps/api/prisma/migrations/` for the schema in `apps/api/prisma/schema.prisma`; use unconstrained PostgreSQL `NUMERIC`, enforce `quantity > 0`, `quantity < 100000000000`, and `scale(quantity) <= 3`, and persist `harvestDate` as `DATE` without timestamp coercion.
- [x] T008 [US1] Implement authorized transactional create and replay behavior in `apps/api/src/harvest/harvests.repository.ts`: revalidate and lock current Membership before identity lookup, resolve Field and Season within authorized scope, lock the Season row and require current OWNER/WORKER role plus ACTIVE same-Business/same-Field Season for first acceptance, compare actor/context/payload for replay, return truthful authorization denial if access changed since the UI read, and serialize same-Business create requests on the Business row so concurrent identical requests replay and conflicting identities return conflict.
- [x] T009 [US1] Implement `POST /fields/{fieldId}/harvests` in `apps/api/src/harvest/harvests.controller.ts` and `apps/api/src/harvest/harvests.module.ts`, then register the module in `apps/api/src/main.ts`; return 201 for first acceptance, 200 for exact replay, and the contract's privacy-safe errors for denied or invalid requests.
- [x] T010 [US1] Add `specs/013-harvest-record-capture/contracts/harvests.openapi.yaml` to `packages/api-client/openapi-generator.config.ts`, regenerate `packages/api-client/src/generated/harvests-api.ts`, and export it through `packages/api-client/src/index.ts` without hand-editing generated types.
- [x] T011 [US1] Implement the typed create request in `apps/mobile/src/features/harvest/harvest-client.ts` using the generated client; retain one `harvestId` and unchanged payload for an uncertain response only while the active form remains open, with no local persistence or offline queue.
- [x] T012 [US1] Implement the accessible online capture form in `apps/mobile/src/features/harvest/harvest-create-screen.tsx` and connect its navigation from the active Season Diary in `apps/mobile/src/app-composition.ts` and `apps/mobile/App.tsx`; keep Field/Season fixed, show distinct validation/connectivity/authorization/conflict/server states, and return to Diary with clear feedback only after 201/200 server confirmation.

**Checkpoint**: A valid online Harvest is created and confirmed end-to-end; failed or offline attempts are never presented as accepted.

---

## Phase 4: User Story 2 — Find Harvest History (Priority: P1)

**Goal**: Show canonical Harvests as distinct date-only entries in existing Field and Season Diary reads, while preserving older client behavior and current Diary authorization.

**Independent Test**: Read Field and Season-filtered Diary pages containing timed events, Harvests, and Expenses; each Harvest appears once with its original date, exact quantity, and unit, in deterministic order, with existing V1 and Expense V2 traversals preserved.

### Tests for User Story 2 — write first

- [x] T013 [P] [US2] Add failing unit tests for mixed timed/date-only ordering, same-day Harvest/Expense kind-and-ID tie breaks, strict-after continuation, V1 defaults, and V2 cursor bindings for Field, Season, irrigation/expense/harvest inclusion flags, timezone, precision, and ordering tuple; verify legacy V2 cursors without `includeHarvests` mean false in `apps/api/test/observations/diary-query.spec.ts`.
- [x] T014 [P] [US2] Add failing Diary contract and PostgreSQL integration cases for default-off `includeHarvests`, exactly one projection per canonical Harvest, multiple distinct Harvest visibility, Field/Season filters, ordinary OWNER/WORKER/ADVISOR reads unchanged, server-derived `viewerRole` from `MembershipScopeService` for each existing role, tenant isolation, bounded candidate queries, and non-snapshot concurrent-insert behavior in `apps/api/test/observations/observations-diary.contract.spec.ts` and `apps/api/test/observations/field-diary.integration.spec.ts`. Verify the role metadata is outside items and does not affect V1/V2 cursor or ordering behavior.
- [x] T015 [P] [US2] Add failing mobile Diary tests for `HARVEST` rendering without a fabricated time, exact quantity and unit labels, OWNER/WORKER `Hasat ekle` visibility, ADVISOR and missing/unavailable `viewerRole` fail-closed absence, no provider/app metadata role inference, loading/empty/retryable-error/access-denied states, accessible labels, touch targets, and scalable text in `apps/mobile/test/observations/field-diary-screen.test.tsx`.

### Implementation for User Story 2

- [x] T016 [US2] Amend the canonical Diary operation in `specs/006-field-observations-basic-diary/contracts/observations-diary.openapi.yaml` with default-off `includeHarvests`, the `HARVEST` item schema, and additive response-level `viewerRole` from `specs/013-harvest-record-capture/contracts/diary-extension.md`; preserve ordinary Diary visibility, existing default projection, V1/V2 ordering, cursor semantics, and Expense-only ordering.
- [x] T017 [US2] Extend V2 cursor decoding, ordering, and strict-after comparison in `apps/api/src/observations/diary-query.ts` to use V2 whenever either `includeExpenses` or `includeHarvests` is true and preserve V1 when both are false; bind Field, Season, `includeIrrigation`, `includeExpenses`, `includeHarvests`, resolved Business timezone, precision, and the final ordering tuple; treat a missing legacy V2 `includeHarvests` flag as false and compare the full date-only `(localDate, precision, kind, source UUID)` tuple.
- [x] T018 [US2] Add a bounded, tenant-scoped Harvest source query to `apps/api/src/observations/observation-diary.repository.ts`, applying Field/Season filters and ordinary Diary authorization; add response-level `viewerRole` from current authorized scope resolved by `MembershipScopeService`. Project canonical Harvest values only, do not reuse the Expense OWNER-only reader, and do not add a second history endpoint or role gate.
- [x] T019 [US2] Regenerate `packages/api-client/src/generated/observations-diary-api.ts` from the amended SPEC-006 contract and export the `includeHarvests` query, `HARVEST` union, and `viewerRole` response metadata through `packages/api-client/src/index.ts`; do not hand-edit generated types.
- [x] T020 [US2] Update `apps/mobile/src/features/observations/diary-client.ts` to request `includeHarvests=true` on the first and every continuation page, preserve Field/Season filters, and expose generated `viewerRole` metadata without deriving role from provider/app metadata.
- [x] T021 [US2] Render canonical Harvest date, exact quantity, and selected unit in `apps/mobile/src/features/observations/field-diary-screen.tsx` with accessible labels, usable touch targets, scalable text, and no implied time-of-day; gate `Hasat ekle` to eligible OWNER/WORKER `viewerRole`, fail closed if absent/unavailable, hide it for ADVISOR, and retain existing loading, empty, retry, and access-denied states.

**Checkpoint**: Field and Season history include Harvests with stable keyset continuation; existing default and Expense-enabled Diary clients remain compatible.

---

## Phase 5: User Story 3 — Preserve a Trustworthy Harvest Fact (Priority: P1)

**Goal**: Ensure accepted Harvest history cannot be rewritten or erased and that original associations remain stable as current Field or Season details change.

**Independent Test**: After acceptance, later context changes do not alter the Harvest; direct update/delete attempts are rejected. Exact replay returns the original acceptance context, while changed identity content remains a conflict.

### Tests for User Story 3 — write first

- [ ] T022 [P] [US3] Add failing PostgreSQL integration tests for rejected Harvest update/delete operations and unchanged original Field, Season, date, quantity, unit, actor, and `recordedAt` after permitted current-context changes in `apps/api/test/harvest/harvests-immutability.integration.spec.ts`.

### Implementation for User Story 3

- [ ] T023 [US3] Add a Prisma-generated `_harvest_record_immutability` migration under `apps/api/prisma/migrations/`; reject UPDATE and DELETE of accepted Harvest rows while leaving the original associations restrictive and stable.

**Checkpoint**: Historical Harvest values and identity survive later context changes and cannot be silently edited or removed.

---

## Phase 6: Polish & Cross-Cutting Verification

**Purpose**: Verify the complete approved feature boundary and retain reviewable evidence.

- [ ] T024 Run the focused automated suites listed in `specs/013-harvest-record-capture/quickstart.md` for domain, API contract/integration, generated client, and mobile; review the resulting implementation files against frozen exclusions in `specs/013-harvest-record-capture/spec.md` and `specs/013-harvest-record-capture/data-model.md`, and resolve failures without changing approved behavior.
- [ ] T025 Exercise the PostgreSQL scenarios in `specs/013-harvest-record-capture/quickstart.md` for tenant isolation, role/revocation, DATE and NUMERIC boundaries, append-only constraints, exact/concurrent retry, and V1/V2 Diary cursor compatibility.
- [ ] T026 Exercise the mobile flow described in `specs/013-harvest-record-capture/quickstart.md`: open create from an active Season Diary, verify fixed Field/Season context and accessible controls, try online/offline and uncertain-response paths, and confirm truthful server-only success feedback and Diary rendering.

## Requirement Coverage

| Requirement | Tasks |
|---|---|
| FR-001, FR-002; SC-004 | T003, T008, T009, T014, T025 |
| FR-003; SC-002 | T003, T014 |
| FR-004; SC-008 | T001, T003, T005, T007, T025 |
| FR-005; SC-001 | T001, T003, T005, T006, T007, T021 |
| FR-006; SC-001, SC-005 | T004, T009, T012, T026 |
| FR-007; SC-007 | T022, T023, T025 |
| FR-008; SC-007 | T003, T006, T008, T022 |
| FR-009; SC-003 | T003, T008, T011, T012, T026 |
| FR-010; SC-001, SC-006 | T014, T016, T018, T021, T026 |
| FR-011; SC-006 | T013, T014, T016, T017, T018, T019, T020, T021, T025 |
| FR-012 | T004, T012, T015, T021, T026 |
| FR-013; SC-005 | T004, T011, T012, T026 |
| FR-014 | T002, T010, T024 |
| FR-015 | T024 |
| FR-016; SC-009 | T003, T004, T014, T015, T016, T018, T019, T020, T021, T025, T026 |

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: Existing repository setup is reused; no work is required.
- **Foundational (Phase 2)**: No separate platform foundation is required; story-owned work provides its own tests and implementation.
- **User Story 1 (Phase 3)**: Start first; it creates the canonical record and authorized online create path.
- **User Stories 2 and 3 (Phases 4 and 5)**: Both depend on the Harvest model and create path from US1. They can proceed independently after US1; the Diary slice owns Diary files/contracts, while the immutability slice owns its migration and dedicated integration-test file.
- **Polish (Phase 6)**: Depends on the desired stories being complete.

### Within-Story Order

- Write each story's tests first and observe the expected failure before implementing that story.
- Within US1: domain validation → schema/migration → authorized repository → controller/module → generated create client → mobile client/form/navigation.
- Within US2: Diary unit/contract/integration/mobile tests → canonical Diary contract (including response-level role metadata) → cursor and source reader/authorized role metadata → generated Diary client → mobile Diary client and fail-closed CTA gating/rendering.
- Within US3: append-only/context integration tests → database guard migration.

### Parallel Opportunities

- **US1 test authoring**: T001–T004 can be authored in parallel because they touch separate domain, API, contract-test, and mobile-test files.
- **US2 test authoring**: T013–T015 can be authored in parallel after US1 because they touch Diary query, API contract/integration, and mobile test files.
- **US2 and US3 implementation**: After US1 is complete, Phases 4 and 5 can proceed in parallel; avoid editing the same migration or test files. Run PostgreSQL integration suites serially if they share the configured test database.
- **Verification**: T024–T026 follow implementation; mobile runtime checks can run independently when their environment is available, while database-backed suites should not run concurrently against a shared test database.

## Implementation Strategy

### MVP First — User Story 1

1. Complete T001–T004 and confirm the tests fail for the missing feature.
2. Complete T005–T012 in dependency order.
3. Validate an online create, privacy-safe authorization rejection, and exact retry before starting the history slice.

### Incremental Delivery

1. Deliver US1: authorized online create and accessible active-form recovery.
2. Deliver US2: canonical Diary projection and mobile history rendering.
3. Deliver US3: append-only persistence and historical context protection.
4. Complete T024–T026 for the full feature boundary.

## Notes

- `[P]` marks tasks that touch separate files and have no dependency on unfinished implementation work.
- All test tasks precede their story's implementation tasks; implementation work should follow TDD red/green/refactor discipline.
- `harvestDate` remains a PostgreSQL `DATE`; quantity remains an exact decimal string persisted as exact `NUMERIC`/Prisma Decimal.
- Harvest creation is online-only; no local Harvest persistence, outbox, generic sync, or restart reconciliation is added.
- Do not introduce Sales, revenue, inventory, disposition, quality/grading, notes, unit conversion, or generic frameworks/RBAC/capability infrastructure.

## Implementation Ledger

- **Initial state**: T001–T010 were complete at the user-provided starting point. The checked state for T002–T004 was inconsistent with that authoritative status and has been reconciled here.
- **Batch 1**: T011–T012 implemented and committed as `6de410a`; mobile create form/client scoped verification passed.
- **Batch 2**: T013–T016 tests and canonical Diary contract extension committed as `98bb9b1`; T013 unit and T016 API contract verification passed.
- **Batch 3**: T017 cursor/order behavior committed as `0d2b869`; T013 query suite passed 25/25.
- **Batch 4**: T019 generated Diary client committed as `9fa1d38`; generated client contract verification passed.
- **Batch 5 (current checkpoint)**: T018, T020, and T021 implemented; API, client, and screen work ran concurrently only across non-overlapping ownership. API integration used the shared PostgreSQL database serially. A focused red/green regression fixed Expense source pagination after a DATE_ONLY HARVEST cursor. Current scoped Diary integration passed 18/18; Diary query unit tests passed 25/25; mobile Diary tests passed 29/29; generated-client contract check, API and mobile typechecks, changed-file lint, and `git diff --check` passed. One consolidated review found no confirmed defects. The checkpoint is committed locally; no push or PR was opened.
