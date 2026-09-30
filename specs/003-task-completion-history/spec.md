# Feature Specification: Task Completion and History

**Feature Branch**: `003-task-completion-history`

**Created**: 2026-09-29

**Status**: Draft

**Input**: User description: "Complete actionable planned tasks from an ACTIVE season quickly, preserve what was planned separately from what happened, and show completed work in season/field history."

## Clarifications

### Session 2026-09-29

- Q: Must task completion work offline in SPEC-003, and what is the minimum offline behavior? → A: Yes. A farmer may complete a locally available actionable task offline. Persist that completion across restart until synchronization, using a stable client-generated mutation/completion identifier, idempotent server handling, and the relevant base/entity version. Preserve pending, accepted, and conflicted states; do not silently overwrite server changes. Settle the local command only after the committed result is durably recorded locally. Keep this completion-specific queue/outbox limited to task completion; generic multi-entity queues, global cursors, offline field/season editing, attachment queues, and generalized two-device synchronization remain outside scope.
- Q: What time does the basic completion record as the actual occurrence, and how is it displayed? → A: Capture `occurredAt` as an absolute instant when the farmer presses Complete, including offline. Preserve it through delayed synchronization and display it using the authorized Business timezone. Record a separate server-side `recordedAt` (or equivalent) when completion is accepted/committed. Do not substitute receipt time for occurrence time, use device timezone to define Bugün, or require manual timestamp editing/correction in this feature.
- Q: Which completion timestamps and actor details belong in normal farmer-facing history? → A: Show the original planned date and actual occurrence (`occurredAt`), rendering occurrence in the authorized Business timezone. Persist `recordedAt` as server audit/synchronization metadata but do not require it in the normal history row. Persist actor user/membership context for historical integrity and authorization/audit, but do not expose an actor label in the normal history response or UI; team/worker attribution is outside this feature.
- Q: When is a repeated completion command an idempotent replay? → A: Only when stable mutation identity, command payload, authenticated actor, and currently authorized task/business context all represent the same logical command. A different actor cannot replay another actor's success. If another actor already completed the task, return the documented already-completed/competing-completion conflict without exposing that completion as the caller's replay and preserve tenant/privacy boundaries.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Complete today's work (Priority: P1)

A farmer opens Bugün, sees planned work due today in an ACTIVE season, and marks a task complete with a single basic action. The action records that the work actually happened while leaving the planned date and original plan context intact.

**Why this priority**: Recording completed work is the next essential action after seeing today's plan and should require minimal effort in the field.

**Independent Test**: Given an authorized farmer and an actionable task from an ACTIVE season, complete it and verify the completion is durable, appears as completed, and the planned date and plan provenance remain unchanged.

**Acceptance Scenarios**:

1. **Given** a task due today in an ACTIVE season is visible in Bugün, **When** an authorized farmer completes it, **Then** the task is marked complete and an actual completion occurrence is recorded separately from its planned date.
2. **Given** a task has been completed, **When** Bugün is refreshed or reopened, **Then** it is no longer presented among actionable work and the farmer can see that it was completed.
3. **Given** a task belongs to a DRAFT season, **When** a user attempts to complete it, **Then** the action is rejected and the task remains part of the non-executable draft plan.
4. **Given** a locally available actionable task is completed without connectivity, **When** the app is restarted before synchronization, **Then** the completion remains durably pending and is not offered as another actionable completion.
5. **Given** a pending completion is synchronized or retried after a delayed/lost response, **When** the server accepts the same mutation, **Then** exactly one completion is committed and its result is durably recorded locally before the pending command is settled.
6. **Given** the task changed on the server after the client captured its base version, **When** its offline completion is synchronized, **Then** it is marked conflicted, both local intent and server state are preserved, and neither is silently overwritten or presented as accepted.

### User Story 2 — Review completed work (Priority: P1)

A farmer opens the relevant season or field history and sees completed work with its actual occurrence and its original planned date, so the record explains both what was intended and what happened.

**Why this priority**: Farmers need a trustworthy record of their work after leaving Bugün, and later changes must not rewrite the original plan.

**Independent Test**: Complete a planned task, open its season/field history, and verify the completion is visible with planned and actual occurrence information while retaining season and plan provenance.

**Acceptance Scenarios**:

1. **Given** a task was completed in an ACTIVE season, **When** the farmer views that season's or field's history, **Then** the completed operation is visible with its actual occurrence and original planned date.
2. **Given** a task was completed after its planned date, **When** it appears in history, **Then** the planned date, actual occurrence, and server record/synchronization time remain distinct and the planned date is not changed to the completion date.
3. **Given** a task's plan or season is later unavailable for editing, **When** its completion is viewed, **Then** the historical record still identifies the original task and season context.

### Edge Cases

- The task or season is missing, belongs to another business, is no longer in scope, or the user's Membership was revoked before completion or history access.
- Two requests attempt to complete the same task concurrently, or a response is lost and the same command is retried.
- A task is already complete when the farmer opens Bugün or submits a completion request.
- A task is part of a DRAFT plan, or its season is not ACTIVE.
- The app closes or the process terminates while a completion is pending synchronization; the pending completion and its identifier, occurrence time, and base version must survive restart.
- The task changes on the server before an offline completion synchronizes; preserve the local completion intent and server state as conflicted, without silently overwriting either.
- A membership is revoked or task scope changes while completion is pending; synchronization must recheck authorization and must not falsely mark the completion as server-accepted.
- Connectivity is lost during synchronization or the server commits but its response is lost; retry the same mutation safely and settle it only after the committed result is durably stored locally.
- A device clock may differ from server time; retain the captured absolute `occurredAt` as the actual action instant and keep server `recordedAt` separate.
- A completion is recorded for a planned date different from its actual occurrence date; neither date may silently overwrite the other.
- Loading or history retrieval fails; the farmer must not be shown an unconfirmed completion as saved.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Bugün MUST expose an actionable completion action for planned tasks belonging to ACTIVE seasons and included in the authorized business-local day's task list.
- **FR-002**: Completing a task MUST be a single basic farmer action and MUST NOT require a note, photo, material/input, or amount.
- **FR-003**: A successful completion MUST persist a durable operational completion record linked to the original planned task, season, field, and authorized business.
- **FR-004**: The completion record MUST capture `occurredAt` as an absolute instant when the farmer presses Complete, including while offline. Delayed synchronization MUST NOT replace or change this occurrence instant. Farmer-facing occurrence time MUST be rendered using the authorized Business timezone; the device timezone MUST NOT redefine Bugün. The original planned date and plan provenance MUST remain unchanged.
- **FR-005**: Completion MUST be available only for tasks in ACTIVE seasons. DRAFT setup plans MUST remain non-executable through this feature.
- **FR-006**: As soon as a completion is durably saved locally, Bugün MUST stop presenting that task as actionable on that device. Until server acceptance, the completion MUST be visibly identified as pending synchronization and MUST NOT be presented as server-confirmed history. A conflicted completion MUST remain distinguishable from both pending and accepted work.
- **FR-007**: A completed operation MUST appear in relevant field or season history with enough information to identify the task, its original planned date, actual occurrence, and source season/plan context. Normal farmer-facing history MUST show the planned date and `occurredAt`, with occurrence rendered using the authorized Business timezone. `recordedAt` is persisted server audit/synchronization metadata and is not required in the normal history row. Actor user/membership context is persisted for historical integrity and authorization/audit, but actor attribution in the normal farmer-facing history response or UI is out of scope.
- **FR-008**: The farmer's basic completion MUST NOT be blocked by optional completion details. Notes, photos, materials/inputs, amounts, recurring-task behavior, and other operational records are outside this feature.
- **FR-009**: Each completion action MUST receive a stable client-generated mutation/completion identifier that is durably saved with the action before synchronization. An exact successful replay MUST match the stable identifier and command payload, the authenticated actor, and the currently authorized task/business context; it MUST return the original accepted result without creating a second record. A different authenticated actor MUST NOT receive another actor's accepted completion as an idempotent replay. If another actor has already completed the planned task, the attempt MUST follow the already-completed/competing-completion conflict semantics without disclosing the completion outside authorized scope. Concurrent retries of the same logical command MUST NOT create duplicate completion records.
- **FR-010**: Completion and history reads MUST authenticate the user, resolve active Membership and allowed task/field scope on the server, and access or mutate records only within the authorized business. A client-supplied business identifier MUST NOT authorize access.
- **FR-011**: Unauthorized, cross-business, missing-task, and out-of-scope outcomes MUST NOT reveal whether another business's records exist.
- **FR-012**: Completion MUST preserve historical integrity. The feature MUST NOT silently delete or rewrite the task's original planned intent, initial task/season provenance, or completion occurrence.
- **FR-013**: The mobile experience MUST support the complete supported completion and history workflow without requiring a desktop, and MUST use farmer-facing language.
- **FR-014**: Completion controls and status MUST expose accessible names and states to assistive technology, remain operable without color alone, support readable/scalable text, and provide touch-usable controls.
- **FR-015**: The interface MUST communicate saving, pending synchronization, accepted, and conflicted states accessibly. It MUST prevent accidental duplicate taps from creating separate outcomes. A pending completion MUST offer safe retry after connectivity returns. A conflicted completion MUST explain that it has not been accepted and provide a safe recovery path without discarding the farmer's intent or overwriting server changes. History loading failures MUST offer a retry without showing fabricated or unsaved server history.
- **FR-016**: The feature MUST NOT add overdue-management actions, postponement, skipping, broad task authoring, recurrence, weather-driven task changes, observations, costs, harvest, sales, team assignment, AI, or deferred photo upload.
- **FR-017**: Offline completion MUST use a completion-specific durable local queue/outbox. It MUST preserve the completion across app restart/process termination until synchronization, including its stable mutation identifier, captured `occurredAt`, and relevant base/entity version. The server MUST recheck current Membership, task scope, task/season state, and base/entity version when accepting the command. The client MUST retain enough state to distinguish pending, accepted, and conflicted outcomes; it MUST NOT silently overwrite server changes or lose a farmer-confirmed operation. A pending command MUST be settled only after the committed server result is durably recorded locally.
- **FR-018**: The completion-specific queue/outbox MUST NOT expand into generic multi-entity mutation queues, global change-log/cursor synchronization, offline field editing, season-plan synchronization, attachment/photo upload queues, generalized two-device synchronization infrastructure, or unrelated offline mutations. Only the minimum reusable boundary needed for task completion is in scope.
- **FR-019**: The server MUST persist a separate `recordedAt` (or equivalent) timestamp when a completion is accepted/committed for audit/synchronization integrity. `occurredAt`, the original planned date, and server record/synchronization time MUST remain distinct; farmer-facing history MUST preserve and show the actual occurrence through delayed synchronization. `recordedAt` is not required in normal farmer-facing history and MUST NOT replace `occurredAt`.

### Authorization and historical behavior

- Membership is the authorization authority. A worker may complete a task only when current membership and task/field scope permit it; an owner may complete work in the owner's authorized scope. No role or scope is inferred from the client.
- A completion is an operational fact, not an ordinary editable task field. This feature does not provide a completion delete, undo, correction, or void workflow; any such behavior requires an explicit future product rule and MUST NOT silently erase the recorded fact.
- Completion records retain their original ACTIVE-season context even if field details or later plans change.

### Key Entities *(include if feature involves data)*

- **Planned task**: The original work item belonging to a season plan, including its intended local date and plan provenance.
- **Task completion**: The canonical server record of accepted historical work, linked to the planned task and its season/field/business context, with an absolute `occurredAt` instant distinct from the planned local date and a separate server `recordedAt`. It carries the stable mutation/completion identifier and relevant base/entity version. The device-local completion command/outbox entry has lifecycle state (`pending`, `accepted`, or `conflicted`); those synchronization states are not carried by the canonical server record.
- **Season/field history**: A farmer-facing chronological view of completed operational facts associated with a field or season.
- **Membership and task scope**: The authorized user's current business relationship and permitted field/task visibility used to govern completion and history access.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A farmer can complete an actionable task from Bugün with one basic action and without entering optional details.
- **SC-002**: Every confirmed task completion is visible in the relevant season or field history with both planned intent and actual occurrence distinguishable.
- **SC-003**: Repeating, restarting, or concurrently retrying the same logical completion action with the same mutation identity, payload, authenticated actor, and authorized task/business context, including after its server commit response is lost, produces exactly one completion outcome and one corresponding accepted history item. A different actor cannot receive that outcome as an idempotent replay.
- **SC-004**: A locally saved completion removes the task from actionable Bugün work on that device immediately, and server-accepted completion removes it from actionable work across synchronized views, without changing the original planned date or provenance.
- **SC-005**: Every tested cross-business completion or history access attempt is denied without disclosing whether the target record exists.
- **SC-006**: Mobile users can complete the supported workflow and inspect history without using the web application.
- **SC-007**: An offline completion survives app restart with its original occurrence instant and remains visibly pending until the committed server outcome is durably recorded locally.
- **SC-008**: A stale base/entity version or revoked authorization never silently overwrites newer server state or appears as an accepted completion; the farmer can distinguish the conflicted outcome.

## Assumptions

- SPEC-002 supplies ACTIVE seasons, planned tasks, read-only Bugün, business-local day selection, and immutable activation provenance.
- Bugün continues to use the authorized Business timezone, with the existing `Europe/Istanbul` fallback, and mobile does not derive today's date from device timezone.
- For the basic path, the farmer need not enter completion details; pressing Complete captures the actual occurrence instant automatically.
- SPEC-003 includes only the completion-specific durable offline queue/outbox and conflict state required to preserve this action; the general offline synchronization engine remains a later feature.
- Initial history is limited to completions produced by this feature; this is not a general diary or historical data migration.
- The feature does not make DRAFT plans executable and does not include task modification after activation.
- Physical-device and emulator runtime validation is deferred evidence while that environment is unavailable; specification acceptance does not depend on fabricating such evidence.

## Scope Boundary

This feature covers actionable planned tasks from ACTIVE seasons, the basic completion action, durable online and offline completion/retry behavior, conflict visibility for that completion action, and season/field history visibility. It does not add a full agenda or monthly calendar, general overdue management, postponement, skipping, advanced recurrence, weather-driven changes, task policy expansion, broad task creation or management, field observations, risks, costs, harvest, sales, team assignment, AI, generic multi-entity mutation queues, global change-log/cursor synchronization, offline field or season-plan editing, generalized two-device synchronization infrastructure, unrelated offline domain mutations, or attachment/photo upload queues.
