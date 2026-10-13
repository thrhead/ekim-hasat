# Feature Specification: Skip an Active-Season Task

**Feature Branch**: `009-skip-active-task`

**Created**: 2026-10-09

**Status**: Draft

**Input**: User-approved scope: allow an authorized farmer to intentionally close one eligible unfinished active-season task as skipped, preserve that decision as an auditable operational fact, and remove the task from actionable current-work surfaces. Skip is terminal, distinct from completion/deletion/cancellation/rescheduling, online-only, and visible in both Task History and Field Diary.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Skip work that will not be done (Priority: P1)

As an authorized farmer, I want to skip one unfinished task in an active season so that work I have decided not to do no longer remains in my actionable task list.

**Why this priority**: A task that will not be done should not continue to appear as work needing action. Skip completes a farmer-controlled task decision alongside completing or changing the date of planned work.

**Independent Test**: Give an authorized farmer an eligible unfinished task in an active season. From its task action experience, confirm Skip, then verify the task is recorded as skipped, is absent from actionable Bugün and Calendar results, and remains visible in Task History and the Field Diary as “Task skipped,” never as completed.

**Acceptance Scenarios**:

1. **Given** an authorized farmer has an eligible unfinished task in an active season, **When** they choose Skip and confirm, **Then** the task receives one accepted terminal skipped outcome and is no longer actionable unfinished work.
2. **Given** a task has been skipped, **When** the farmer views Task History, **Then** the task's skipped outcome and accepted event metadata are visible and distinct from completion.
3. **Given** a task has been skipped, **When** the farmer views its Field Diary, **Then** a distinct “Task skipped” event appears with sufficient task identity/context and accepted event metadata.
4. **Given** a task has been skipped, **When** Bugün or Calendar current-work results are refreshed, **Then** the task is absent from actionable unfinished work and completed-work/history behavior is not used to represent it.

### User Story 2 - Understand an unavailable or conflicting Skip (Priority: P2)

As a farmer, I want clear feedback when Skip cannot be accepted so that I know whether the task changed and what action I can take next.

**Why this priority**: Skip is terminal and must not appear successful unless the server accepted it. Clear recovery protects the farmer from losing track of a task when connectivity or another task action prevents acceptance.

**Independent Test**: Attempt Skip while offline, after the task has become ineligible, and with a stale task version or competing accepted action. Verify no false success is shown, current canonical task state remains authoritative, and the farmer receives a recoverable or conflict-specific message.

**Acceptance Scenarios**:

1. **Given** the device is offline, **When** the farmer attempts Skip, **Then** no local Skip is queued or shown as accepted and the farmer is told that connectivity is required, with a clear way to retry after reconnecting.
2. **Given** a task has changed or become ineligible since it was displayed, **When** the farmer attempts Skip, **Then** the action is rejected without overwriting the newer task state and the farmer is told the task must be refreshed.
3. **Given** the server accepted Skip but the response was not received, **When** the same logical request is retried, **Then** the farmer receives the original accepted result without creating a second Skip record.
4. **Given** Skip loses a race to completion or date adjustment, **When** the conflicting state is resolved, **Then** only the winning valid outcome is retained and the farmer receives an explicit conflict result.
5. **Given** the farmer lacks current authorization for the task's Business or scope, **When** Skip is submitted, **Then** it is denied without revealing whether a task outside the farmer's scope exists.

### Edge Cases

- The task is already completed or skipped, its season is no longer active, or its plan is no longer approved.
- The task is removed or otherwise becomes ineligible between display and confirmation.
- Two requests attempt Skip for the same task, including a retry after the server committed but the response was lost.
- Skip races with task completion or a planned-date adjustment; a stale request must not overwrite an accepted outcome.
- Membership or task scope is revoked before the server accepts the action.
- The device loses connectivity before submission or while awaiting the result; the UI must not claim success without server acceptance.
- The task has prior date adjustments; Skip must preserve the original planned-date context and all adjustment history.
- The task is skipped after being overdue or after its planned date has changed; its prior dates remain historical context and the task must not reappear as actionable work.
- Repeated reads of Task History and Field Diary must not duplicate the same accepted Skip event.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The product MUST allow an authorized farmer to Skip one eligible unfinished task belonging to an active season with an approved plan.
- **FR-002**: Before submitting Skip, the mobile experience MUST clearly explain that Skip closes the task and cannot be undone in this feature, and MUST require the farmer to confirm the action.
- **FR-003**: The product MUST represent an accepted Skip as a terminal task outcome semantically distinct from completion, deletion, cancellation, and rescheduling. A skipped task MUST NOT be represented as completed work.
- **FR-004**: Once Skip is accepted, the task MUST no longer appear as actionable unfinished work in Bugün or Calendar current-work results.
- **FR-005**: The product MUST preserve the task's historical identity and context, including its season/plan context and planned-date history. Accepting Skip MUST NOT erase or rewrite prior planned dates or date-adjustment records.
- **FR-006**: Task History MUST show the skipped outcome with sufficient task identity/context and accepted Skip event metadata to explain the decision later.
- **FR-007**: The Field Diary MUST show the accepted Skip as a distinct event, such as “Task skipped,” with sufficient task identity/context and accepted event metadata. It MUST remain distinguishable from observations and completions.
- **FR-008**: Skip MUST be accepted only after the server validates the user's current authentication, Business membership, role/scope, task eligibility, and current task state. Client-supplied Business identity MUST NOT establish authority.
- **FR-009**: Skip MUST use appropriate task concurrency protection. A stale Skip request MUST NOT overwrite a newer accepted completion, Skip, or planned-date adjustment.
- **FR-010**: Repeating the same logical Skip request MUST return the same accepted outcome without creating another Skip event. Reusing its identity with a different task or payload MUST be rejected as a conflict.
- **FR-011**: Competing completion, Skip, and planned-date adjustment requests MUST resolve deterministically so that incompatible terminal outcomes cannot both be accepted for the same task instance. The losing request MUST receive an explicit conflict and MUST NOT be reported as successful.
- **FR-012**: Skip MUST require server connectivity. When offline or when acceptance cannot be confirmed, the product MUST NOT queue an offline Skip or show it as accepted; it MUST explain that connectivity is required and allow the farmer to retry safely.
- **FR-013**: The Skip experience MUST provide clear confirmation, accepted-result, connectivity, authorization, ineligibility, and conflict feedback. Uncertain submission MUST be described without falsely implying either acceptance or rejection, and the farmer MUST have a safe recovery path.
- **FR-014**: Existing offline Task Completion behavior MUST remain unchanged.
- **FR-015**: The feature MUST NOT include Skip undo/reopen, bulk Skip, automatic or weather-driven Skip, reasons or reason taxonomy, recurring-task Skip rules, task deletion, completion undo, notifications, assignment/reassignment, generic task editing, generic synchronization, or generic offline mutation infrastructure.

### Key Entities *(include if feature involves data)*

- **Planned task**: One planned work item in a season plan, with task identity, current state/version, current planned date, and preserved season/plan context.
- **Task Skip event**: The durable record of one accepted farmer decision to skip a task, including the task reference, actor, acceptance time, and task context needed for history and diary presentation.
- **Task History entry**: A historical presentation of task outcomes and relevant task changes, including the distinct Skip event.
- **Field Diary event**: A chronological field record that can present observations, completed tasks, and skipped tasks as distinct event kinds.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In acceptance scenarios, 100% of eligible Skip actions accepted by the server remove the task from actionable Bugün and Calendar current-work results.
- **SC-002**: Every accepted Skip produces exactly one durable Skip event, and retries of the same logical request produce no additional event.
- **SC-003**: 100% of accepted Skip events appear in both Task History and Field Diary as skipped, with no presentation as completed work.
- **SC-004**: No tested stale or unauthorized Skip request changes task state, creates a Skip event, or reveals a task outside the user's authorized Business/scope.
- **SC-005**: Across tested competing requests, at most one incompatible terminal outcome is accepted for a task instance; every losing request receives an explicit conflict outcome.
- **SC-006**: In offline and uncertain-submission scenarios, the farmer is never shown a false accepted Skip, and the same request can be retried safely after connectivity returns.
- **SC-007**: Existing offline task completion scenarios continue to behave as before, with no Skip-specific queue or generic synchronization behavior introduced.

## Assumptions

- The current task action/detail experience in Bugün and Calendar is the entry point; this feature does not add a separate task browser or global task-management surface.
- The accepted Skip event's server acceptance time is its historical event time for Task History and Field Diary ordering; the planned task date remains separately preserved as context.
- A single farmer-facing confirmation is appropriate because Skip is terminal and has no undo in this scope.
- Current task eligibility follows the existing active-season/approved-plan and authorization rules used by task mutations.
- Connectivity failures that occur after submission may leave acceptance uncertain; the product must rely on retry of the same logical request to resolve that uncertainty safely.
