# Feature Specification: Active-Season Manual Task Creation

**Feature Branch**: None created (working on `main`)

**Created**: 2026-10-27

**Status**: Clarified — ready for implementation

**Input**: Approved SPEC-014 discovery and scope freeze: an authorized farmer adds a manually entered task to an eligible active season, including bounded offline capture.

## Clarifications

### Session 2026-10-27

- Q: Can a farmer create a new pending task after an offline restart when session refresh fails? → A: Yes, for the same locally active account and previously authorized field and eligible season context, with previously established OWNER role and field access. This permits local capture only; server acceptance requires a matching authenticated account and fresh authorization and eligibility checks.

- Q: What can the farmer do with a definitively rejected local task? → A: Keep it visible to the original account; the farmer may explicitly retry unchanged when conditions change, create a corrected new submission, or remove only the rejected local record. No accepted task is edited or deleted.

- Scope correction 2026-10-30: Manual task creation is OWNER-only. WORKER creation is deferred until repository-backed field/scope assignment and authorization exist; ADVISOR cannot create. This correction does not change existing authorization for other task actions.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Add work to an active season (Priority: P1)

As an authorized farmer, I can add work that was absent from the original plan to my active season so it appears in my normal work flow.

**Why this priority**: Farmers encounter necessary work after approving a plan.

**Independent Test**: Create a valid task in an eligible season, verify server acceptance and its appearance under existing daily and calendar rules, and compare the original approved plan and activation snapshot before and after.

**Acceptance Scenarios**:

1. **Given** an OWNER with access to an ACTIVE season with an approved plan, **When** they submit a valid title and planned local date, optionally with a description, **Then** the server accepts one manual task associated with that season and field.
2. **Given** a WORKER or ADVISOR, **When** they attempt manual task creation, **Then** the server rejects the request and no task is accepted. WORKER creation is deferred until explicit repository-backed field/scope assignment and authorization exist.
3. **Given** a date on or after the actual sowing/planting date, **When** the task is submitted, **Then** a past, today, or future date is permitted subject to existing validation.
4. **Given** a missing or invalid title, invalid date, or date before actual sowing/planting, **When** creation is attempted, **Then** it is rejected with an understandable correction and no accepted task is created.
5. **Given** a season is not ACTIVE or has no approved plan, **When** creation is attempted, **Then** no task is accepted.
6. **Given** a task is accepted, **When** its origin is inspected, **Then** it is recorded as manually entered by a user and does not claim template or validated provenance from the approved plan; the approved plan and activation snapshot remain unchanged.

### User Story 2 - Use the task in existing work flows (Priority: P1)

As a farmer, I can find and act on my accepted manual task like other eligible season tasks, so my daily work and its history remain coherent.

**Why this priority**: Creating a task is useful only if it participates in normal work management.

**Independent Test**: Create an accepted task, find it in applicable views, then separately complete, adjust, or skip eligible tasks and verify the established outcomes.

**Acceptance Scenarios**:

1. **Given** an accepted manual task, **When** Bugün or Calendar displays current data, **Then** it appears according to the existing authorization, date, status, and grouping rules; its details are available through the existing task experience.
2. **Given** an eligible accepted manual task, **When** an authorized user completes it, adjusts its date, or skips it, **Then** the existing action's eligibility, authorization, connectivity, confirmation, conflict, and history rules apply.
3. **Given** an accepted completion or skip, **When** the farmer views applicable task history and field diary, **Then** the outcome appears under existing rules, distinct from creation and from other outcomes.

### User Story 3 - Capture a task while disconnected (Priority: P1)

As a farmer, I can record a task for a previously available eligible season without connectivity and see whether it has been accepted after reconnecting.

**Why this priority**: Field work must survive unreliable connectivity without implying unauthorized or unconfirmed acceptance.

**Independent Test**: Capture a valid task offline, restart the app, reconnect and retry, and verify one accepted task with the same identity and an accurate status throughout.

**Acceptance Scenarios**:

1. **Given** sufficient previously established season and account context on the device, **When** a valid task is saved offline, **Then** it is durably retained, visibly pending and available to the original account after restart; local save failure is reported and is not called saved.
2. **Given** a pending task, **When** connectivity returns and an authenticated matching account submits it, **Then** the server checks current membership, role and scope, field access, season eligibility, and validation before acceptance.
3. **Given** a submission response is lost or the app restarts during delivery, **When** the same unchanged creation is retried, **Then** its stable identity is retained and at most one accepted task results; an unknown outcome is never presented as accepted.
4. **Given** membership, role, scope, field access, or season eligibility has changed before acceptance, **When** delivery is attempted, **Then** no new task is accepted, the local entry remains recoverable in its original account context, and the farmer sees an appropriate unresolved or not accepted state without disclosure of unauthorized information.
5. **Given** an earlier submission may have succeeded but its response was lost, **When** a later attempt is denied, **Then** the outcome remains unconfirmed rather than being asserted accepted or definitively rejected.
6. **Given** a different account is active or the user signs out, **When** pending work exists, **Then** it is neither displayed nor submitted under that account; it can be recovered in its original account context.

7. **Given** an offline restart and a retryable session restoration failure, **When** the same locally active account has previously established eligible field and season context with previously established OWNER role and field access, **Then** the farmer can save a new task locally as pending, with no delivery until an authenticated matching session is available.
8. **Given** explicit sign-out, a definitive no-session result, another account, or absent previously established context, **When** new offline capture is attempted, **Then** it is unavailable; a stale account identifier alone does not restore the account context.

9. **Given** a definitively rejected local task, **When** the farmer returns to it in the original account, **Then** it remains visible as not accepted, with options to retry unchanged, create a corrected new submission, or explicitly remove that rejected local record.
10. **Given** the farmer retries a definitively rejected task after conditions change, **When** the matching authenticated account submits it, **Then** the original unchanged creation is rechecked against current authorization, eligibility and validation; it remains unaccepted unless the server accepts it.
11. **Given** a definitively rejected task, **When** the farmer chooses to correct its input and submit, **Then** an explicit new logical creation with a new identity is made without silently changing the original record; the new submission is subject to current server checks.
12. **Given** a definitively rejected task, **When** the farmer explicitly removes its local record, **Then** only that local rejected record is removed; no server-accepted task or history is changed. An unconfirmed outcome is not represented as a definitive rejection and cannot use this removal action.

### Edge Cases

- Two attempts for the same logical creation, including a lost response and restart, must not create duplicate tasks; reuse of the same identity for different content is a conflict.
- The season becomes ineligible, access is revoked, or the actual sowing/planting date changes before first acceptance; current server rules decide acceptance without silently changing the farmer's entry or moving it to another season or field.
- A definitive validation or identity conflict needs attention and does not retry indefinitely; transient failures retain the unchanged entry for retry. If a prior submission may have succeeded, the result remains unconfirmed until authoritative evidence resolves it.
- An explicit retry after a definitive rejection preserves the original creation identity and content; a corrected submission has a new identity. Both require fresh server checks.
- Local removal applies only to a definitively rejected record, not to a pending or unconfirmed submission that may already have been accepted.
- The device date or timezone differs from the authorized business local-date context; the selected calendar date is not silently shifted.
- Pending and accepted representations of the same task may briefly coexist during reconciliation; they must not appear as two tasks or imply acceptance before confirmation.
- Saved context is unavailable or cannot be associated with the original account: offline creation is unavailable rather than granting access from stale context.
- A task dated before today is subject to existing overdue rules; a task dated today or in the future follows existing view rules.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The product MUST allow only an authorized OWNER to create a manual task, and only in an ACTIVE season with an approved plan. WORKER and ADVISOR cannot create manual tasks under SPEC-014. WORKER creation is deferred until explicit repository-backed WORKER field/scope assignment and authorization exist. Business membership alone MUST NOT be treated as WORKER permission to access every field.
- **FR-002**: A task MUST have a title and planned local date and MAY have a description. Existing task validation and business-local date semantics MUST apply both before local capture where possible and at server acceptance. The date MUST be on or after actual sowing/planting; past, today, and future dates are otherwise allowed.
- **FR-003**: The server MUST authenticate the actor and revalidate current membership, role and scope, field access, season eligibility and input before accepting a creation. Client-provided business identity or cached context MUST NOT establish authorization. Rejected out-of-scope requests MUST NOT disclose protected cross-business information.
- **FR-004**: Accepted tasks MUST retain truthful manual/user-entered provenance and actor attribution; they MUST NOT inherit template or validated provenance from the approved plan. Creation MUST NOT change the originally approved plan or activation snapshot.
- **FR-005**: Accepted tasks MUST participate in Bugün, Calendar and task detail according to their existing visibility, date, status and authorization rules. Completion, date adjustment and skip MUST use existing action semantics, including their eligibility, authorization, connectivity, concurrency, audit and history behavior. Applicable task history and diary behavior MUST remain consistent with existing accepted outcomes.
- **FR-006**: Mobile MUST support bounded offline creation after a retryable offline session-restoration failure, including after restart, for the same locally active account. Previously authenticated, account-associated context MUST identify the field and season, their last established eligible ACTIVE/approved-plan state, actual sowing/planting date and local-date context, and the prior OWNER role and field access needed to limit capture to previously authorized fields. A definitive no-session result, explicit sign-out, account switch, or a stale account identifier alone MUST NOT establish that context. Cached context permits local capture only and does not prove current eligibility or authorization. This feature does not promise arbitrary offline browsing or season editing.
- **FR-007**: A locally saved task MUST be durably retained across restart with its original content, intended field and season, stable task identity and logical mutation identity. The product MUST clearly distinguish local pending, retrying, unconfirmed, not accepted/needs attention, and server-accepted outcomes in farmer language. Local save failure MUST be visible and MUST NOT be reported as saved.
- **FR-008**: An offline task MUST NOT be represented as accepted or as an authoritative task before server acceptance is confirmed and recorded locally. Pending entries shown alongside work MUST be clearly distinguished, and reconciliation MUST avoid duplicate presentation of the same task. Existing task actions apply after acceptance; pending capture MUST NOT imply that those actions have succeeded.
- **FR-009**: Retry of the unchanged logical creation MUST retain its identities and converge to at most one accepted task, including after an uncertain response or restart. Reusing an identity with different content MUST be rejected as a conflict. A temporary or uncertain failure MUST preserve the original entry for safe retry without asserting success or rejection.
- **FR-010**: A definitive authorization, eligibility, validation, or identity conflict MUST NOT create a new accepted task; the original local entry remains recoverable and visibly needs attention or is not accepted. If an earlier attempt may have committed, a later denial cannot establish that earlier outcome: it remains unconfirmed until authoritative evidence resolves it. Definitive conflicts MUST NOT be retried indefinitely or silently alter the original entry. The original account MUST be able to see the rejected local record and explicitly retry the unchanged creation when conditions change, create a corrected new logical submission with a new identity, or remove only that rejected local record. A retry or corrected submission requires current server authorization, eligibility and validation; neither implies acceptance. Local removal MUST NOT edit or delete an accepted task or its history and MUST NOT be offered as removal of a definitively rejected record while the outcome remains unconfirmed.
- **FR-011**: Pending entries MUST be isolated by account: sign-out or account switching MUST prevent display or submission under another account. Delivery requires an authenticated matching account and current server authorization; local account continuity is not authorization.
- **FR-012**: The mobile flow MUST provide accessible, understandable validation, saving, pending, acceptance and failure states, without relying on color alone. No external weather, satellite or AI service is required for creation.
- **FR-013**: This feature MUST NOT introduce WORKER manual-task creation, title or description editing after accepted creation, deletion of accepted tasks, recurrence, bulk management, automatic or weather-driven creation, reminders, generalized task-management redesign, generic offline sync, broad offline season editing, a new authorization framework, changes to the approved initial plan, or sales/revenue/post-harvest work. Existing date adjustment and skip remain available under their existing semantics.

### Key Entities

- **Manual task**: User-entered work associated with one field and active season, with title, optional description, planned local date, manual provenance and existing task lifecycle.
- **Pending creation**: Account-associated local intent with stable identity and delivery state; it is not an accepted task until authoritative acceptance is confirmed.
- **Approved plan and activation snapshot**: Historical records of the original approved plan and season activation, preserved unchanged by later manual task creation.
- **Authorization context**: Current authenticated membership, role and field/scope access assessed by the server at acceptance.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In all tested eligible OWNER cases, a valid creation results in one accepted manual task with the entered local date and truthful provenance; the original plan and activation snapshot remain unchanged.
- **SC-002**: In all tested WORKER, ADVISOR, out-of-scope, revoked-access and ineligible-season attempts, no new task is accepted and protected cross-business information is not disclosed.
- **SC-003**: In all tested offline captures reported saved, the original entry and stable identity survive restart; no pending or unconfirmed entry is shown as accepted without authoritative confirmation.
- **SC-004**: In tested repeated delivery, lost-response and restart scenarios, one logical creation produces at most one accepted task and one farmer-visible representation after reconciliation.
- **SC-005**: In tested accepted tasks, Bugün, Calendar, detail, completion, date adjustment, skip, history and diary follow the same applicable rules as existing tasks, including date and status boundaries.
- **SC-007**: In all tested definitive rejection cases, the original account can see the rejected local entry and explicitly retry it, create a corrected new submission, or remove that local record; these actions never edit or delete an accepted task. Unconfirmed outcomes are not presented as definite rejections.
- **SC-006**: All tested invalid dates before sowing and invalid required fields are rejected without an accepted task, while valid past, current and future local dates on or after sowing are accepted when all other conditions hold.

## Assumptions

- The existing task validation, business-local calendar dates and authorization scopes are authoritative; this feature does not redefine their limits.
- A farmer establishes the account, role/scope, field and season context while authenticated and connected before bounded offline capture. An offline restoration failure can preserve the locally active account context; a definitive no-session result cannot. Saved context is not a grant of access.
- Existing completion, date adjustment, skip, task history and diary specifications govern their respective actions and records, including existing online/offline restrictions. Creation alone does not invent a new diary event.
- The approved SPEC-014 scope in the current product decision supersedes the older PRD roadmap label assigning SPEC-014 to Advisor Sharing; it does not approve that separate feature.

## Dependencies

- Existing authentication and business/field authorization, active-season and approved-plan lifecycle, task validation and local dates.
- Existing Bugün, Calendar, task completion, adjustment, skip, task history and field diary behavior.
