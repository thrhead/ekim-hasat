# Tasks: Offline Field Observation Capture

**Input**: Finalized `specs/010-offline-field-observation-capture/` specification, clarifications, plan, research, data model, local command contract, quickstart, and completed requirements-quality checklists.

**Scope**: Observation-specific durable offline text capture only. No generic sync, authorization lease, broad Field/Season cache, photos, risk/AI, or other SPEC-010 exclusions.

**Tests**: RED/GREEN is required for offline durability, authorization, idempotency, time rules, and reconciliation. A RED task means author a meaningful failing test and record the expected failure before the dependent GREEN task. No task below has been run or completed.

## Phase 1: Setup

**Purpose**: Establish a safe baseline and identify the exact existing boundaries without creating new infrastructure.

- [ ] T001 Record the current Git state, repository-pinned Node/pnpm requirement, Graft availability, and test-database guard prerequisites in `specs/010-offline-field-observation-capture/quickstart.md`; do not claim exact pnpm 10.17.1 or Graft passed unless proven.
- [ ] T002 Inventory the SPEC-006 create/diary API, mobile observation flow, auth lifecycle, generated-client source, and SPEC-003 SQLite completion pattern against `specs/010-offline-field-observation-capture/plan.md`; record any actual contract or file-path drift before implementation (depends on T001).

---

## Phase 2: Foundational — Observation-Specific Boundaries

**Purpose**: Make account identity and local command persistence reliable before any story uses them. These tasks do not create a generic sync layer.

- [ ] T003 Write RED adapter/controller and observation-coordination tests in `apps/mobile/test/auth/supabase-auth.adapter.test.ts` and `apps/mobile/test/observations/observation-account-context.test.ts` for three distinct restoration outcomes (authenticated, definitive no session, retryable/offline unavailable); classify provider retryable/unavailable errors instead of treating every throw alike; preserve `onAuthStateChange`; verify only an authenticated concrete `accountId` may establish/update a marker, only retryable/offline failure may consult it for local capture, and no marker supplies a token/API session (depends on T002).
- [ ] T004 [P] Write RED SQLite tests in `apps/mobile/test/observations/observation-command-store.test.ts` for observation-marker and account-scoped Field/optional Season context durability across restart, atomic marker/context lifecycle where required, definitive no-session/sign-out active-marker invalidation without destructive pending deletion, account switching/isolation and later matching-account recovery, stale command/context account-ID rejection, plus exact command/status/uncertain-send/accepted-result durability (depends on T002; independent of T003's adapter/coordination tests).
- [ ] T005 Make T003 GREEN in `apps/mobile/src/auth/supabase-auth.adapter.ts` and `apps/mobile/src/auth/auth-port.ts`: classify retryable/offline restoration failure separately from successful no-session and authenticated restoration; expose a narrow observation-consumable outcome and marker-transition coordination using a storage port/fake, without implementing durable marker storage or a second general auth state machine; preserve `onAuthStateChange` and `getAuthenticatedApiSession()` as the sole token-bearing delivery boundary (depends on T003).
- [ ] T006 Implement the observation-only SQLite marker/context/command storage foundation in `apps/mobile/src/features/observations/observation-command-store.ts`: own durable marker and account-scoped saved context, atomic lifecycle updates where required, restart recovery, active-use invalidation on definitive no-session/sign-out, namespace switch/isolation, and later matching-account recovery without deleting old pending data; require authenticated context acquisition and never infer marker authority from command/context rows; durably store exact commands and accepted results; make T004 GREEN and connect T005's narrow storage port (depends on T004, T005).
- [ ] T007 Add RED tests for one command per account + `observationId`, separate IDs for intentional new notes, Unicode-trimmed 1–2000-code-point text, uniquely mapped Business-local `occurredAtLocal`/absolute `occurredAt`, DST gap/fold rejection, and no future instant in `apps/mobile/test/observations/observation-command-builder.test.ts` (depends on T006).
- [ ] T008 Implement the exact observation command builder using existing SPEC-006 validation in `apps/mobile/src/features/observations/observation-client.ts`; retain original account/Field/optional Season, captured Business timezone, canonical text, local wall time, and absolute instant without silently rebasing; make T007 GREEN (depends on T007).

**Checkpoint**: Local identity and command data can survive restart and cannot be mistaken for server permission. US1 may begin after T008.

---

## Phase 3: User Story 1 — Capture an Observation Without Connectivity (P1, MVP)

**Goal**: Save a text-only note for previously authorized Field/optional Season context, including after offline restart without refreshed sign-in, and clearly label it pending.

**Independent Test**: Establish context while connected, disconnect, save a note, restart, recover it, create a second note under the same locally active account namespace, and prove neither was sent or shown as canonical before authentication and server acceptance.

### RED tests

- [ ] T009 [US1] Write RED mobile flow tests for authorized context establishment, offline capture, local-write failure, rapid duplicate confirmation, and context-unavailable state in `apps/mobile/test/observations/observation-offline-capture.test.tsx` (depends on T008).
- [ ] T010 [P] [US1] Write RED screen accessibility tests for pending-versus-accepted wording, local-save failure, focus/announcement behavior, readable text, and no color-only state in `apps/mobile/test/observations/observation-offline-accessibility.test.tsx` (depends on T008; different file and no dependency on T009).

### GREEN implementation

- [ ] T011 [US1] Persist Field ID, optional same-Field Season ID, Business timezone, and account namespace only after the existing authorized observation-context read in `apps/mobile/src/features/observations/observation-client.ts`; never create a general Field/Season offline directory (depends on T009).
- [ ] T012 [US1] Adapt `apps/mobile/src/features/observations/observation-create-screen.tsx` to use saved context and T006/T008's durable command before confirming local capture, including offline restart without refreshed sign-in, missing-context refusal, and distinct new IDs for distinct notes; make T009 and T010 GREEN (depends on T011, T010).
- [ ] T013 [US1] Have the observation flow in `apps/mobile/src/app-composition.ts` consume T005's narrow classified restoration outcome and T006's marker/context store; recover saved context only for authenticated matching account or marker-backed retryable/offline failure, without creating a second general auth state machine, changing `onAuthStateChange`, exposing signed-out context, or altering SPEC-003 completion/API authorization (depends on T005, T006, T012).
- [ ] T014 [US1] Run the focused T003–T010 mobile tests and record US1 local-only acceptance evidence and any device-runtime gap in `specs/010-offline-field-observation-capture/quickstart.md` (depends on T013).

**Checkpoint**: US1 is independently demonstrable as *saved locally/pending*; it makes no server-acceptance claim.

---

## Phase 4: User Story 2 — Synchronize and Find the Canonical Observation (P1)

**Goal**: Deliver the original command under a matching authenticated account, converge exact retries to one canonical observation, and reconcile accepted state with the diary by `observationId`.

**Independent Test**: Submit once with a lost 201 response, retry unchanged after restart, receive 200 exact replay, and show one canonical diary observation without leaving a durably accepted command pending when its row is beyond page one.

### RED tests

- [ ] T015 [US2] Write RED HTTP contract and generated-client type tests in `apps/api/test/observations/observations-diary.contract.spec.ts` and `packages/api-client/test/observations-diary-consumer.type-test.ts` for optional `capturedBusinessTimezone`, valid older bodies omitting it, one public `createFieldObservation` operation, unchanged SPEC-006 consumers, and stable 201/200/409 semantics (depends on T014).
- [ ] T016 [P] [US2] Write RED guarded real-PostgreSQL tests for current membership/Field/Season authorization on create and replay, exact same-ID replay after accepted Business timezone change, mismatch before first acceptance even when local/instant still maps, and original absolute time immutability in `apps/api/test/observations/observation-offline-timezone.integration.spec.ts` (depends on T014; separate file and independent of T015).
- [ ] T017 [P] [US2] Write RED coordinator tests for matching authenticated account, unchanged request and stable ID, lost response/restart retry, 201/200 durable settlement, and no delivery without usable sign-in in `apps/mobile/test/observations/observation-delivery.test.ts` (depends on T014; separate file and independent of T015–T016).
- [ ] T018 [P] [US2] Write RED diary presentation tests for accepted-result durability, failed refresh, page-one absence, and one logical row when a local accepted result and canonical entry share `observationId` in `apps/mobile/test/observations/observation-diary-reconciliation.test.tsx` (depends on T014; separate file and independent of T015–T017).

### GREEN implementation

- [ ] T019 [US2] Add only the optional `capturedBusinessTimezone` request member and its backward-compatible 201/200/409 documentation to the canonical `specs/006-field-observations-basic-diary/contracts/observations-diary.openapi.yaml`; preserve its existing route and `createFieldObservation` operationId as the sole OpenAPI owner (depends on T015).
- [ ] T020 [US2] Regenerate `packages/api-client/src/generated/observations-diary-api.ts` through the existing `packages/api-client/openapi-generator.config.ts` workflow, preserving the single public observation path/operation in `packages/api-client/src/index.ts`; make T015's type/contract tests GREEN for optional member, omitted-field older bodies, and existing SPEC-006 consumers without registering a second source (depends on T019).
- [ ] T021 [US2] Parse and validate the optional captured-timezone precondition while retaining older-client omission behavior in `apps/api/src/observations/observation.controller.ts`; use the generated request type and preserve privacy-safe errors (depends on T020).
- [ ] T022 [US2] Apply current-authorization-first replay lookup and first-acceptance captured-timezone comparison inside the existing transaction in `apps/api/src/observations/observation.repository.ts`; exact accepted replay must not require remapping old local time under a later timezone, while mismatched first delivery creates no row; make T016 GREEN (depends on T016, T021).
- [ ] T023 [US2] Implement observation-only delivery coordination in `apps/mobile/src/features/observations/observation-delivery.ts`: matching authenticated account, durable send-uncertainty marker, unchanged body/ID on eligible retry, 201/200 atomic accepted-result persistence, and 401/transport/5xx pending behavior; make T017 GREEN (depends on T017, T020, T022).
- [ ] T024 [US2] Add accepted-result/diary de-duplication by stable `observationId` in `apps/mobile/src/features/observations/field-diary-screen.tsx`; do not treat absence from the first page as rejection or return a durable acceptance to pending, and retire local accepted representation only after authorized canonical ID confirmation; make T018 GREEN (depends on T018, T023).
- [ ] T025 [US2] Wire the delivery coordinator into existing observation flow and authorized diary refresh in `apps/mobile/src/features/observations/observation-create-screen.tsx`; preserve existing online creation and other diary event kinds (depends on T023, T024).
- [ ] T026 [US2] Run focused generated-client, API contract, guarded serial PostgreSQL, and mobile US2 suites; record exact evidence and any Cloud toolchain/database limitations in `specs/010-offline-field-observation-capture/quickstart.md` (depends on T022, T025).

**Checkpoint**: US2 yields canonical acceptance/replay and one farmer-facing observation, while US1 local capture remains usable independently.

---

## Phase 5: User Story 3 — Keep Denied and Conflicted Notes Recoverable (P2)

**Goal**: Preserve original farmer text and uncertainty without unauthorized disclosure or false acceptance/rejection after revocation, conflict, or a crash during submission.

**Independent Test**: Queue a note, simulate crash after sending but before durable response, revoke membership, retry under the original account, and show **outcome unconfirmed** with no protected diary read or new canonical row from the denied attempt.

### RED tests

- [ ] T027 [US3] Write RED guarded real-PostgreSQL tests for revoked membership and foreign Business/Field/Season on first create and exact replay, no disclosure, and no new row on rejected attempt in `apps/api/test/observations/observation-offline-authorization.integration.spec.ts` (depends on T026).
- [ ] T028 [P] [US3] Write RED mobile tests in `apps/mobile/test/observations/observation-uncertain-outcome.test.ts` for crash/unknown send, later 403/404 unconfirmed state, first-attempt definitive rejection, and authoritative Business-timezone mismatch before first acceptance: stop automatic retry, retain note plus original wall time/timezone/absolute instant, and show needs attention only when no earlier attempt may have committed; if an earlier response was lost, preserve outcome unconfirmed rather than infer rejection from the later mismatch (depends on T026; independent file).
- [ ] T029 [P] [US3] Write RED mobile tests for validation/association/identity conflicts, no indefinite auto-retry, original-note recovery, explicit farmer decision plus new `observationId` for corrected text/time/Field/Season in `apps/mobile/test/observations/observation-needs-attention.test.tsx` (depends on T026; independent file).
- [ ] T030 [P] [US3] Write RED farmer-facing privacy/accessibility tests for signed-out and switched-account presentation, revoked-context messaging, and distinct accessible **outcome unconfirmed** announcement that never says accepted/rejected in `apps/mobile/test/observations/observation-access-boundary.test.tsx`; leave stale-ID and namespace enforcement to T003–T006 (depends on T026; independent file).

### GREEN implementation

- [ ] T031 [US3] Reconcile server create/replay authorization and privacy-safe response behavior in `apps/api/src/observations/observation.repository.ts` without granting replay to a revoked or different actor; make T027 GREEN and preserve SPEC-006 idempotency tests (depends on T027).
- [ ] T032 [US3] Classify first definitive denial versus prior possibly committed attempt in `apps/mobile/src/features/observations/observation-delivery.ts`; classify pre-acceptance authoritative Business-timezone mismatch as needs attention with no automatic retry only when acceptance is known not to have occurred, otherwise preserve outcome unconfirmed; retain original note/temporal inputs/command and make T028 GREEN (depends on T028, T031).
- [ ] T033 [US3] Present recoverable needs-attention/conflict and explicit farmer choice for corrected temporal context as a new logical observation/new `observationId` in `apps/mobile/src/features/observations/observation-create-screen.tsx`; never silently reinterpret or mutate original payload/ID, and make T029 GREEN (depends on T029, T032).
- [ ] T034 [US3] Verify farmer-facing sign-out/account-switch privacy, status text, and accessible unconfirmed/denied announcements in `apps/mobile/src/features/observations/field-diary-screen.tsx` and `apps/mobile/src/features/observations/observation-create-screen.tsx`; rely on T005/T006 for marker/namespace enforcement, make T030 GREEN, and show no protected canonical data (depends on T030, T033).
- [ ] T035 [US3] Run focused guarded authorization and mobile recovery/accessibility suites; record results and any unverified device/provider leg in `specs/010-offline-field-observation-capture/quickstart.md` (depends on T031–T034).

**Checkpoint**: All three SPEC-010 stories meet their independent tests; local uncertainty never becomes fabricated canonical history.

---

## Phase 6: Polish and Cross-Cutting Verification

**Purpose**: Reconcile the whole feature and preserve earlier SPEC boundaries.

- [ ] T036 Run the full SPEC-010 quickstart scenario matrix, including restart, lost response, timezone change, diary pagination, and account switch, then record exact pass/fail/unavailable evidence in `specs/010-offline-field-observation-capture/quickstart.md` (depends on T014, T026, T035).
- [ ] T037 Recheck the generated observation client and canonical additive SPEC-006 contract for older installed mobile compatibility in `packages/api-client/src/generated/observations-diary-api.ts` and `specs/006-field-observations-basic-diary/contracts/observations-diary.openapi.yaml`; verify one public `createFieldObservation` operation (depends on T036).
- [ ] T038 Run focused existing SPEC-003 completion, SPEC-006 observation/diary, SPEC-007 Calendar, and SPEC-009 Skip regressions and record unchanged semantics in `specs/010-offline-field-observation-capture/quickstart.md` (depends on T036).
- [ ] T039 Run applicable lint, typecheck, contract, mobile, guarded real-PostgreSQL, and diff checks with the exact repo-pinned toolchain if available; separately record Graft and pnpm 10.17.1 as unverified when unavailable in `specs/010-offline-field-observation-capture/quickstart.md` (depends on T037, T038; never claim an unavailable leg passed).
- [ ] T040 Review SPEC-010 FR-001–FR-015 and SC-001–SC-006 against the delivered behavior and frozen exclusions in `specs/010-offline-field-observation-capture/spec.md`, `plan.md`, and `quickstart.md`; do not add generic sync/lease, broad offline Field/Season access, attachments, risk/AI, notifications, or other excluded work (depends on T039).
- [ ] T041 Record physical-device/emulator and hosted-auth evidence only if actually run; otherwise mark that runtime evidence unavailable in `specs/010-offline-field-observation-capture/quickstart.md` (depends on T040).

---

## Dependencies and Execution Order

| Phase | Blocking dependency | Safe concurrency |
|---|---|---|
| Setup | T001 → T002 | None: both update the same planning evidence. |
| Foundation | T002 → T003/T004 → T005 → T006 → T007 → T008 | T003 adapter/coordination RED tests and T004 SQLite-store RED tests are independent; T006 supplies persistence after T005's port exists. |
| US1 | T008 → T009/T010 → T011 → T012 → T013 → T014 | T009 and T010 are independent RED tests in distinct files. |
| US2 | T014 → T015/T016/T017/T018 → T019 → T020 → T021 → T022 → T023 → T024 → T025 → T026 | T016–T018 are independent RED tests in distinct files after US1; T015 is also independent as a test design task. GREEN work is sequential at shared API/client/mobile boundaries. |
| US3 | T026 → T027/T028/T029/T030 → T031 → T032 → T033 → T034 → T035 | T028–T030 are independent RED tests in distinct files; T027 is independent guarded API test authoring. Shared implementation files are sequential. |
| Polish | T014, T026, T035 → T036 → T037/T038 → T039 → T040 → T041 | T037 and T038 may be run by separate owners after T036, but are not marked `[P]` because both can affect final validation evidence and reconciliation. |

**Critical path**: T001–T002 → T003/T004 → T005–T008 → US1 → US2 → US3 → final verification. US2 depends on the US1 command/context boundary; US3 builds on US2 delivery and canonical result. These stories are independently testable at their checkpoints, but their implementation is not falsely labelled fully parallel.

## Parallel Examples

- **Foundation**: Author T003 adapter/coordination RED tests and T004 SQLite marker/context/command RED tests in separate files after T002; integrate the classified auth port through T005 and the durable observation store through T006 afterward.
- **US1**: Author T009 capture-flow and T010 accessibility RED tests in separate files after T008; update the shared create screen only in T012.
- **US2**: After T014, author T016 PostgreSQL timezone, T017 mobile delivery, and T018 diary RED tests in separate files; keep API/client/mobile GREEN changes ordered T019–T025.
- **US3**: After T026, author T028 unknown-outcome, T029 needs-attention, and T030 privacy/accessibility RED tests separately; update shared coordinator/screens in T032–T034 in order.

## Implementation Strategy

1. Finish Setup/Foundation. Prove each RED test fails for the intended missing behavior before its GREEN task.
2. Deliver **US1 as the MVP**: valid text note is durable and honestly pending offline, including after same-account restart; no canonical acceptance is implied.
3. Add US2 canonical delivery and diary reconciliation; then US3 revoked-access and conflict recovery. Do not treat a local note as authorized server history.
4. At every checkpoint, run only the focused tests needed for that boundary and record evidence. Complete final cross-feature verification once, including platform-exception gaps.

## Notes

- `[P]` appears only on independent RED test authoring in separate files with no dependency on each other; later shared-file implementation is explicitly ordered.
- The optional `capturedBusinessTimezone` wire precondition is SPEC-010 scope for enforcing the approved first-delivery timezone rule. Keep older clients' omitted-field behavior and current replay authorization.
- Do not modify the reviewer-owned checklist markers as implementation task tracking. Existing 32/32 and 16/16 checklist states record requirements-quality review, not completed tasks.
- The account-continuity product decision is resolved: an observation-specific, non-authoritative persistent marker is established only by a concrete authenticated account; only retryable/offline restoration failure may reuse it for same-account local capture. Definitive no session/sign-out invalidates active use, another account switches namespaces, and delivery still requires a matching authenticated API session. T003/T005 verify and implement that decision against the existing auth lifecycle. No further product decision is identified.
