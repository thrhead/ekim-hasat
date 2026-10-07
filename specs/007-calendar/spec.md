# Feature Specification: Calendar / Takvim

**Feature Branch**: `007-calendar`

**Created**: 2026-10-06

**Status**: Clarified — ready for implementation

**Input**: User-approved frozen scope for Calendar / Takvim: make the existing mobile navigation destination functional as a read-oriented view of unfinished planned work from ACTIVE seasons, with an agenda for one Business-local selected date, a secondary month overview, an optional Field filter, read-only task details, and a bounded offline fallback for previously loaded Calendar data. Preserve SPEC-001..006 and all explicit exclusions and deferred boundaries.

## Clarifications

### Session 2026-10-06

- Q: When Calendar is offline, may a saved view be used after the farmer changes the selected date or Field filter if it contains all data needed for that selection? → A: Allow the selection only when saved Calendar data fully covers the requested date and Field scope. Show it read-only and identify it as saved and possibly out of date; if coverage is incomplete or cannot be established safely, show offline/unavailable. Do not present partial data as complete, infer missing tasks, speculatively merge incomplete snapshots, or add generic offline synchronization.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See work needing attention today (Priority: P1)

As a farmer, I want to open Calendar and see unfinished planned work for the current Business-local date, with overdue unfinished work called out separately, so that I can understand what still needs attention without confusing old dates with today's plan.

**Why this priority**: The agenda is the default Calendar view and its central purpose is to make approved current work easy to inspect.

**Independent Test**: Give an authorized farmer an ACTIVE season with unfinished tasks dated before, on, and after the current Business-local date, plus a completed task. Tap the existing Takvim destination and verify it opens a functional Calendar agenda; the server-resolved Business-local current date is selected, overdue work appears first with original dates, only unfinished work planned for that selected date appears in its group, later tasks are absent, completed work is absent, and essential loading/empty/retryable-error states are understandable.

**Acceptance Scenarios**:

1. **Given** an authorized farmer has unfinished planned tasks from ACTIVE seasons, **When** the farmer opens Calendar, **Then** the selected date defaults to the current Business-local date and the agenda shows its unfinished tasks.
2. **Given** unfinished tasks have planned dates earlier than the current Business-local date, **When** the farmer opens Calendar, **Then** those tasks appear in a dedicated overdue group above the selected-date agenda and retain their original planned dates.
3. **Given** a task is planned for a later date than the selected date, **When** the farmer views the selected-date agenda, **Then** the later task is not included in that date's work list.
4. **Given** a task has a canonically accepted completion, **When** the farmer opens or refreshes Calendar, **Then** the completed task is absent from Calendar and remains governed by the existing History/Diary behavior.

### User Story 2 - Browse a date and focus on a Field (Priority: P2)

As a farmer, I want to understand which dates contain unfinished planned work and optionally focus on one Field, so that I can inspect the right day's work without seeing tasks from unrelated dates or Fields.

**Why this priority**: A secondary month overview makes the approved plan easier to navigate, while a Field filter helps farmers with multiple Fields focus the same work set in either view.

**Independent Test**: Provide unfinished ACTIVE-season tasks across dates and authorized Fields. Verify month work indicators correspond to original planned dates, selecting a date updates the one-date agenda, and an optional Field filter narrows both views consistently.

**Acceptance Scenarios**:

1. **Given** the farmer opens the secondary month overview, **When** dates contain unfinished planned work, **Then** those dates are indicated without listing full task names in month cells.
2. **Given** the farmer selects a date in the month overview, **When** the agenda updates, **Then** it shows unfinished tasks planned for that selected date, with the overdue group remaining separate.
3. **Given** the farmer has multiple authorized Fields, **When** Calendar opens without a Field filter, **Then** relevant work across all those Fields is shown.
4. **Given** the farmer selects one authorized Field, **When** either Calendar view is shown, **Then** the month overview and agenda describe the same narrowed Field work set.
5. **Given** the selected Field has no relevant unfinished planned work, **When** Calendar is shown, **Then** a Field-specific informational empty state is displayed without offering plan or task creation actions.

### User Story 3 - Inspect a task and use Calendar with weak connectivity (Priority: P3)

As a farmer, I want to inspect task context and, when offline, review a previously loaded Calendar snapshot safely, so that I can understand planned work without being told stale information is current or being offered unsupported actions.

**Why this priority**: Read-only task context and bounded offline access support real field use while preserving the separation between Calendar, Today, and History/Diary.

**Independent Test**: Open a task from Calendar and verify its read-only details. Then test a retryable connectivity failure with a matching saved snapshot, no matching snapshot, and an explicit access denial; verify the appropriate saved or unavailable state and that authorization denial never reveals cached work.

**Acceptance Scenarios**:

1. **Given** a task is listed in Calendar, **When** the farmer taps it, **Then** a read-only detail view preserves the selected task context and shows its name, original planned date, Field, relevant Season/plan context, and overdue status when applicable.
2. **Given** Calendar data has previously been loaded for the authenticated account and authorized Business context, **When** a genuine connectivity failure prevents a current read, **Then** matching saved Calendar data may be shown read-only with a clear indication that it was saved and may be out of date.
3. **Given** no matching saved Calendar data exists, **When** a genuine connectivity failure prevents a current read, **Then** Calendar shows an offline/unavailable state rather than implying that no planned work exists.
4. **Given** an explicit access denial, revoked membership, or known authorization loss occurs, **When** Calendar cannot load current data, **Then** saved Calendar data is not displayed as a fallback.
5. **Given** Calendar is showing saved offline data, **When** the farmer opens task details or changes Calendar view, **Then** no task completion, editing, postponing, skipping, rescheduling, or other offline mutation is offered.

### Edge Cases

- No ACTIVE season exists: explain that there is currently no active-season work to show; do not show DRAFT tasks or offer season setup actions.
- An ACTIVE season exists but has no unfinished planned work: explain that there is no remaining planned work to display.
- A Field filter is active and that Field has no relevant work: show the Field-specific empty state.
- An overdue task remains overdue regardless of the selected date; it stays in the separate overdue group and keeps its original planned date.
- Navigating to a past date does not move overdue tasks into that date's agenda; they remain in the overdue group.
- A task completed canonically while Calendar is open must leave Calendar after current data is successfully refreshed. A pending, unaccepted completion remains governed by SPEC-003 and is not a new Calendar completion behavior.
- A retryable connection failure with no matching saved Calendar data is an unavailable state, not an empty state.
- A saved Calendar view that does not fully cover the requested date and Field scope, or whose coverage cannot be established safely, is unavailable; partial saved data is never presented as a complete result.
- Authentication or authorization denial never activates saved-data fallback, even if a snapshot exists.
- Loading, unavailable, saved/offline, and empty states remain distinguishable; a failed load must not be presented as an empty Calendar.
- Month indicators for overdue work remain associated with the tasks' original planned dates; they do not imply rescheduling to today.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The existing farmer-facing mobile Takvim navigation destination MUST open Calendar.
- **FR-002**: Calendar MUST show unfinished planned tasks only from ACTIVE seasons within the authenticated farmer's currently authorized Business and Fields. DRAFT-season tasks MUST NOT appear.
- **FR-003**: Calendar MUST default to the current date in the authorized Business timezone, using the existing `Europe/Istanbul` fallback when no Business timezone is configured. The device timezone MUST NOT redefine the selected current date.
- **FR-004**: The default agenda MUST show a dedicated overdue group followed by unfinished planned work for one selected Business-local date. It MUST NOT show all future work as a backlog.
- **FR-005**: A task is overdue when its unchanged planned local date is earlier than the current Business-local date and it has no canonically accepted completion. Overdue status is presentation derived from the planned date; it MUST NOT change that date or imply that the task was rescheduled to today.
- **FR-006**: Overdue unfinished tasks MUST remain in the dedicated overdue group when the selected date changes. They MUST retain and display their original planned dates and MUST NOT be treated as tasks planned for the selected date.
- **FR-007**: The agenda MUST show unfinished planned tasks whose planned local date matches the selected date. It MUST NOT include tasks from other dates in that selected-date list.
- **FR-008**: Calendar MUST provide a secondary month overview. It MUST indicate dates with relevant unfinished planned work, MUST NOT list full task names in month cells, and MUST allow date selection that updates the agenda to that date.
- **FR-009**: Month work indicators MUST correspond to original planned dates, including for overdue unfinished tasks. They MUST NOT represent an overdue task as planned for today.
- **FR-010**: Calendar MUST default to relevant work across all currently authorized Fields. The farmer MAY narrow the view to one authorized Field; the selected Field scope MUST apply consistently to both agenda and month overview. A Field selection MUST NOT grant or establish access.
- **FR-011**: Calendar MUST exclude any task with a canonically accepted completion. Completion occurrence and original planned date MUST continue to be preserved and presented according to SPEC-003 and SPEC-006; Calendar MUST NOT duplicate completed work.
- **FR-012**: Tapping a Calendar task MUST open read-only task details that retain task/date context and show the task name, original planned date, Field, relevant Season/plan context, and overdue status when applicable.
- **FR-013**: Calendar and task details MUST NOT add task completion, editing, postponing, skipping, rescheduling, automatic date changes, weather-driven actions, or task creation.
- **FR-014**: Calendar MUST distinguish empty states for no ACTIVE season, no unfinished planned work, and no relevant work for the selected Field. These states MUST remain informational and MUST NOT offer actions to create or activate a season, edit a plan, or create tasks.
- **FR-015**: When online, Calendar MUST load current canonical Calendar data subject to current server-authoritative authorization.
- **FR-016**: When a genuine connectivity or retryable connectivity failure prevents a current read, Calendar MAY show previously loaded Calendar data only when it belongs to the same authenticated account and authorized Business context and fully covers the requested date and Field scope. The farmer MUST be told the data is saved and may be out of date. Date or Field selection while offline MUST be available only when the saved data fully covers that selection.
- **FR-017**: Saved Calendar data MUST be read-only. Calendar MUST NOT add offline mutations, task mutation queues, generic synchronization, authorization leases, or a background reconciliation framework.
- **FR-018**: An explicit authentication or authorization denial, revoked membership, or known authorization loss MUST NOT activate saved-data fallback. If no saved data fully covers the requested date and Field scope, or coverage cannot be established safely after a connectivity failure, Calendar MUST show an offline/unavailable state distinct from an empty state. Calendar MUST NOT present partial saved data as a complete result, infer missing tasks, or speculatively merge incomplete snapshots.
- **FR-019**: Loading, retryable error/unavailable, saved/offline, and empty states MUST be distinguishable and accessible. Calendar date selection, Field filtering, task rows, and month work indicators MUST expose understandable accessible names and status to assistive technology.
- **FR-020**: Calendar MUST preserve the product boundary that task execution/completion belongs to Today and completed execution history belongs to History/Diary. Opening Calendar or a task detail MUST NOT change either workflow.
- **FR-021**: The feature MUST preserve all SPEC-001..006 authorization, tenancy, local-date/timezone, season, task completion/history, weather, Field, observation, and diary contracts.
- **FR-022**: This feature MUST NOT include active-season plan/task mutation; weather proposals or approvals; notifications/reminders; generic offline synchronization; observation editing; finance; harvest/sales; team/advisor capabilities; or AI.

### Key Entities *(include if feature involves data)*

- **Calendar task**: An unfinished planned task from an ACTIVE season, associated with an authorized Field and Business-local planned date, retaining existing plan provenance.
- **Selected date**: The Business-local calendar date whose unfinished planned tasks are shown in the agenda.
- **Field filter**: An optional narrowing of Calendar work to one Field the farmer is already authorized to access.
- **Saved Calendar view**: Previously loaded Calendar data associated with the authenticated account and authorized Business context. It can serve a requested date and Field scope only when its coverage is established as complete; qualifying offline display is read-only and identified as potentially outdated.
- **Overdue status**: A presentation state derived when an unfinished task's original planned local date precedes the current Business-local date; it does not change task data.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In all acceptance cases, the agenda shows every unfinished ACTIVE-season task planned for the selected Business-local date and no unfinished task planned for a different date, excluding the separately displayed overdue group.
- **SC-002**: In all acceptance cases, overdue unfinished tasks appear in the dedicated group with their original planned dates, and no task date is changed by viewing Calendar or navigating dates.
- **SC-003**: In all acceptance cases, month indicators correspond to dates containing relevant unfinished planned work, and selecting a date shows that date's work in the agenda.
- **SC-004**: In all tested Field-filter cases, both Calendar views show the same authorized Field scope, and no unauthorized Field data is exposed.
- **SC-005**: In all offline acceptance cases, saved Calendar data is shown only for the matching account and Business context after a qualifying connectivity failure, only when it fully covers the requested date and Field scope, and is clearly identified as potentially outdated. Partial or uncertain coverage and explicit authorization denial never result in saved data being shown as a complete Calendar result.
- **SC-006**: Farmers can distinguish no ACTIVE season, no unfinished work, no work for a selected Field, loading, unavailable, and saved/offline states without mistaking an error for an empty Calendar.
- **SC-007**: Calendar exposes no task execution or mutation action; completed tasks remain available through the existing History/Diary behavior and not through Calendar.

## Assumptions

- The server remains authoritative for current task state, membership, and Field access; saved Calendar data is a limited read-only fallback and does not establish authorization.
- “Current date,” overdue status, selected-date labels, and planned-date display use the authorized Business timezone and existing local-date semantics.
- A canonically accepted completion removes a task from current Calendar results; completion pending acceptance remains subject to SPEC-003 behavior.
- Exact month-cell visual indicators, wording, layout, and accessibility presentation are design decisions for the approved Impeccable pass, provided they preserve these requirements.
- Physical-device or emulator behavior will be reported only if validated with evidence; no runtime/device validation is implied by this specification.

## Scope Boundaries

Calendar provides a date-oriented view of unfinished planned work from ACTIVE seasons, a secondary month overview, optional Field narrowing, read-only task details, and a bounded saved-data fallback for qualifying connectivity failure. It does not become a planning editor, task execution surface, completed-work history, draft-plan review surface, weather decision flow, or generic offline synchronization capability. It preserves SPEC-001..006 unchanged.

### Deliberately Deferred

- Calendar access to DRAFT-season tasks or pre-activation planning.
- Any all-season or multi-date upcoming-work backlog.
- Active-season task/plan editing, completion, postponement, skipping, rescheduling, or automatic schedule changes.
- Weather-driven task proposals, farmer approval flows, alerts, or reminders.
- Offline Calendar mutations, generic synchronization, authorization leases, or background reconciliation.
- Completed-work browsing inside Calendar; History/Diary remains authoritative for completed execution.
- Additional filters, notifications, observations, finance, harvest/sales, team/advisor functions, and AI.
