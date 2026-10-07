# Feature Specification: Manual Active-Season Task Adjustment

**Feature Branch**: `008-manual-active-season-task-adjustment`

**Created**: 2026-10-07

**Status**: Clarified — ready for planning

**Input**: User-approved product direction: let a farmer change the planned date of an unfinished task in an ACTIVE Season, using Postpone / Reschedule behavior. Preserve an auditable record of each accepted change and show the current planned date in Bugün and Takvim. Do not add Skip behavior, broad active-plan editing, automatic changes, or generic offline synchronization in this feature.

## Clarifications

### Session 2026-10-07

- Q: Should Skip be included in SPEC-008, and what outcome should it create? → A: No. Skip is out of SPEC-008. Do not define or model Skip as completion, deletion, cancellation, or another task state; it may be a separate future capability.
- Q: Must active-task date adjustment work offline in the first release? → A: No. Adjustment is online-only and succeeds only after server acceptance. Do not add an offline task-mutation queue or generic synchronization, and do not generalize the task-completion-specific offline infrastructure.
- Q: Where should farmers review an accepted task-date adjustment, and what must its record retain? → A: The relevant task detail must provide access to adjustment history. The authoritative record retains the previous planned date, new planned date, actor, and adjustment timestamp. Diary integration and a generic event store are out of scope.
- Q: How should Bugün and Takvim treat an overdue task after its planned date changes? → A: The accepted new date becomes the single canonical planned date. If it is today, the task appears under existing Bugün rules; if future, it is no longer overdue; if past, it remains overdue. Calendar uses that new date under its existing grouping rules, while the prior date remains available in adjustment history.
- Q: What should happen when an adjustment is submitted against task state that has changed elsewhere? → A: Reject the stale adjustment without overwriting canonical state, refresh/reload the current task, clearly tell the farmer it changed, and require a new explicit farmer decision before retry. Never automatically reapply the stale requested date.
- Q: From which farmer workflows should an eligible ACTIVE-season task be adjustable? → A: Postpone / Reschedule is available from the task's existing detail/action experience in Bugün and from the task-detail experience for an eligible task opened in Takvim. This is a SPEC-008 exception to SPEC-007's read-only task-detail boundary; Calendar agenda and month behavior remain read-oriented, with no inline or bulk editing, drag-and-drop, completion, or arbitrary task editing. Both entry points use the same server-authoritative adjustment behavior.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Reschedule unfinished work (Priority: P1)

As a farmer, I can change the planned date of an unfinished task in an active season when the work needs to happen on a different day, so that my current plan reflects the decision I made.

**Why this priority**: An active plan must remain useful after the farmer has approved it and real conditions change. The farmer remains in control of the change.

**Independent Test**: Give an authorized farmer an ACTIVE Season with an unfinished task. Change its planned date and verify that the accepted task has the new date, the rest of the plan is unchanged, and a change record is retained.

**Acceptance Scenarios**:

1. **Given** an authorized farmer has an unfinished task in an ACTIVE Season, **When** they choose Postpone / Reschedule and save a valid new planned date, **Then** the task has that canonical planned date and the farmer is told the change was saved.
2. **Given** a task belongs to a DRAFT Season, **When** the farmer is in the active-season adjustment flow, **Then** this feature does not replace the existing draft-plan review and editing behavior.
3. **Given** a task is completed, **When** an adjustment is attempted, **Then** the completed task and its accepted completion history remain unchanged and the adjustment is rejected.
4. **Given** a requested date is invalid under the existing Business-local date rules, **When** the farmer saves it, **Then** the change is rejected and the existing task date remains canonical.
5. **Given** another authorized client changed the task after the farmer loaded it, **When** the farmer submits a date adjustment based on the old state, **Then** the change is rejected, the current task is reloaded, the farmer is told it changed, and the stale requested date is not automatically reapplied.
6. **Given** an eligible unfinished task belongs to an ACTIVE Season and is shown in Bugün, **When** the farmer opens its existing detail/action experience, **Then** Postpone / Reschedule is available there.
7. **Given** a new adjustment command requests the task's current canonical planned date, **When** authorization, eligibility, and the submitted task version are valid, **Then** the request is rejected with `NO_DATE_CHANGE`, no accepted adjustment is created, and the task remains unchanged.
8. **Given** an accepted adjustment is retried with its original `adjustmentId` and exact command input after the task version has advanced, **When** current authorization is valid, **Then** the original accepted result is replayed without a duplicate history record or stale-version rejection.

---

### User Story 2 — See the changed date in daily and calendar views (Priority: P1)

As a farmer, I can rely on Bugün and Takvim to reflect the current planned date after an adjustment is accepted, so that I do not act on an outdated schedule.

**Why this priority**: Changing the date is useful only if the farmer's operating views agree with the accepted plan.

**Independent Test**: Change an unfinished task's date to a date represented by Bugün or Takvim, refresh those views, and verify that the task is included or grouped according to its canonical date and remains absent from dates that no longer apply.

**Acceptance Scenarios**:

1. **Given** a task's date adjustment was accepted, **When** Bugün or Takvim obtains current data, **Then** each view reflects the canonical planned date using the authorized Business timezone and existing local-date behavior.
2. **Given** a task's date adjustment was not accepted, **When** the farmer views Bugün or Takvim, **Then** those views continue to reflect the canonical saved task and do not imply the requested change succeeded.
3. **Given** a Calendar view is saved locally and may be older than the accepted adjustment, **When** it is shown during a connectivity failure, **Then** existing Calendar saved-data freshness messaging remains in effect and the old date is not represented as current canonical data.
4. **Given** an eligible unfinished ACTIVE-season task is opened from Takvim, **When** the farmer views its task details, **Then** the same Postpone / Reschedule action is available and submits the same canonical adjustment behavior as Bugün. Calendar agenda and month views remain read-oriented; they provide no inline edit, drag-and-drop, bulk reschedule, completion, or arbitrary task editing.

---

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: An authenticated farmer with current authorization MUST be able to change the planned date of an unfinished task belonging to an ACTIVE Season.
- **FR-002**: The farmer-facing action MUST communicate that the farmer is postponing or rescheduling the task. It MUST require an explicit farmer decision and MUST NOT change a task automatically.
- **FR-003**: This feature MUST be limited to changing the task's planned date. It MUST NOT add or remove ACTIVE-season tasks or edit task title, description, or other attributes.
- **FR-004**: A new planned date MUST use the existing authorized Business-local calendar-date rules and MUST remain on or after the Season's actual sowing/planting date. Device timezone or UTC conversion MUST NOT change the farmer-selected date.
- **FR-005**: Each accepted planned-date change MUST retain an auditable change record containing the previous planned date, new planned date, actor, and adjustment timestamp. The relevant task detail MUST provide access to that task's adjustment history. Repeated accepted changes MUST preserve the sequence of prior and new values rather than silently replacing the change history.
- **FR-006**: A successful adjustment MUST make the accepted new date the task's single canonical planned date. If the new date is today, Bugün MUST include the task under its existing rules; if it is in the future, the task MUST no longer be overdue; if it remains in the past, it MUST remain overdue. Takvim MUST use the new canonical date under its existing grouping rules. The prior date remains available in adjustment history.
- **FR-007**: A completed task MUST NOT be changed by this feature. Its completion record and the planned-date snapshot already preserved by SPEC-003 MUST remain unchanged.
- **FR-008**: Every adjustment MUST revalidate the current user's authorization and scope for the Business, Season, Field, and task. A client-supplied Business identifier MUST NOT grant access, and an out-of-scope request MUST NOT reveal whether another Business's task exists.
- **FR-009**: Concurrent changes MUST NOT silently overwrite a newer accepted task date. A stale adjustment MUST be rejected without changing the canonical value; the product MUST refresh/reload the current task and clearly tell the farmer it changed. The farmer MUST make a new explicit decision before another adjustment is submitted. The product MUST NOT automatically reapply the stale requested date.
- **FR-010**: Retrying the same logical adjustment MUST NOT create duplicate accepted changes or duplicate audit entries. Reusing an identity for a different adjustment MUST be rejected safely.
- **FR-016**: For a new `adjustmentId`, after current authorization, task eligibility, and `If-Match` version have been validated, a requested date equal to the current canonical planned date MUST return the typed `NO_DATE_CHANGE` validation outcome. It MUST NOT update task state, increment `PlannedTask.version`, create `TaskDateAdjustment` history, or be treated as an accepted adjustment. A stale version MUST be rejected before this comparison, even if the requested date equals the current server date. A previously accepted `adjustmentId` MUST first be handled as an exact replay or key-reuse conflict after current authorization is revalidated, without incorrectly failing because the task version later advanced.
- **FR-017**: Mobile MUST prevent normal submission when the selected date equals the current canonical planned date and MUST handle a defensive server `NO_DATE_CHANGE` response as an unsuccessful no-change outcome, not as an accepted adjustment or a reason to refresh data as after success.
- **FR-011**: A date adjustment MUST be submitted online and MUST NOT be considered successful until the server accepts it. A rejected or uncertain adjustment MUST NOT be presented as accepted; the farmer MUST receive a clear outcome and a safe recovery or retry path.
- **FR-012**: Skip is outside SPEC-008. This feature MUST NOT provide or model a Skip action or outcome.
- **FR-013**: This feature MUST NOT accept or queue date adjustments offline. It MUST NOT add weather-driven or automatic rescheduling, recommendations, notifications, recurrence, generic offline synchronization, or a generic task mutation queue.
- **FR-014**: The farmer MUST be able to complete the adjustment flow on mobile. Date-entry controls and saving, rejection, and conflict outcomes MUST expose accessible names and state; essential status MUST NOT rely on color alone.
- **FR-015**: The farmer MUST be able to start Postpone / Reschedule from the existing detail/action experience for an eligible task in Bugün and from the task-detail experience for an eligible task opened in Takvim. Both entry points MUST use the same server-authoritative adjustment behavior. This is a narrow exception to SPEC-007's read-only task-detail boundary; Calendar agenda and month behavior MUST remain read-oriented, with no inline editing, drag-and-drop, bulk rescheduling, task completion, or arbitrary ACTIVE-task editing.

### Explicit Scope Boundaries

This feature covers online, farmer-controlled planned-date changes for unfinished tasks in ACTIVE Seasons, started from the existing task detail/action experience in Bugün or from an eligible task's detail in Takvim, the audit record for accepted changes, and current Bugün/Takvim behavior after an accepted change. It does not reopen or replace SPEC-002 draft-plan authoring or SPEC-003 completion/history semantics. For this feature only, eligible Calendar task details may expose the same Postpone / Reschedule action as Bugün; Calendar agenda and month behavior remain read-oriented. Calendar does not gain inline editing, drag-and-drop, bulk rescheduling, task completion, or arbitrary task editing. Skip is out of scope.

### Edge Cases

- The task is completed, removed, or its Season is no longer ACTIVE before the adjustment is accepted.
- The task date changes after the farmer loaded it but before the farmer saves a new date.
- Two authorized clients attempt different planned-date changes based on the same prior task state.
- The request commits but the response is lost, and the farmer retries.
- Membership or task scope is revoked before the request is accepted.
- The task is overdue when the farmer starts rescheduling it; after acceptance, its new canonical date determines whether it is due today, future-dated, or still overdue, while the prior date remains in adjustment history.
- The selected date is earlier than the actual sowing/planting date or is invalid as a Business-local calendar date.
- The farmer submits the current canonical date with a new adjustment identity; this is a no-change rejection, not an adjustment or idempotency receipt.
- An accepted adjustment is retried exactly after the task version advances; current authorization is revalidated, then the original result is replayed before live task eligibility/version checks.
- A new command has a stale version and requests a date equal to the latest canonical date; stale conflict takes precedence over no-date-change.
- An older saved Calendar view is available while the network is unavailable.

### Key Entities *(include if feature involves data)*

- **Planned task**: An unfinished work item belonging to a Season plan, with its current planned local date and existing task version.
- **Task adjustment record**: An authoritative record of an accepted planned-date change, including the previous date, new date, actor, and adjustment timestamp; it is accessible from the relevant task detail.
- **Task completion**: The accepted operational record governed by SPEC-003. Its occurrence details and planned-date snapshot are not rewritten by this feature.
- **Business authorization context**: The current authorized Business membership and scope used to validate access to the task and Season.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After an accepted adjustment, current Bugün and Takvim reads do not present the task under its previous date; wherever the task is included by the existing date and grouping rules, they show its new canonical planned date.
- **SC-002**: Every accepted planned-date change has exactly one corresponding auditable change record with previous value, new value, actor, and timestamp; retrying the same logical request does not add another record.
- **SC-003**: No completed task or accepted completion record is changed by an adjustment request.
- **SC-004**: A stale concurrent adjustment never overwrites the newer canonical task date and is reported as an unsuccessful conflict outcome.
- **SC-005**: Every tested request outside the user's current Business/task scope is denied without disclosing whether the task exists in another Business.
- **SC-006**: No unsuccessful or uncertain adjustment is shown as accepted or current in Bugün or Takvim.
- **SC-007**: A new command whose requested date equals the canonical date is rejected with `NO_DATE_CHANGE` after concurrency validation and creates no adjustment record, version increment, audit entry, or success-style data refresh; exact replay of an already accepted command remains replayable after current authorization is revalidated.

## Assumptions

- The farmer is authenticated and has the current membership/task scope required by existing authorization behavior.
- Existing Business-local date semantics, including the configured `Europe/Istanbul` fallback where applicable, remain authoritative.
- A planned-date change does not alter the task's Season, Field, source, title, description, or template provenance.
- Existing Calendar saved views may be shown only under SPEC-007's same-account/scope/coverage and stale-data messaging rules.
- Adjustments require connectivity and server acceptance; completion-specific offline behavior remains unchanged and is not generalized.
