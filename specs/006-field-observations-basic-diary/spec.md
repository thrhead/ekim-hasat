# Feature Specification: Field Observations and Basic Diary

**Feature Branch**: `006-field-observations-basic-diary`

**Created**: 2026-10-04

**Status**: Draft

**Input**: User description: "Allow a farmer to record text-first observations for an authorized Field and optional Season, and review them in a basic Field or Season diary alongside canonical accepted task completions. Preserve historical occurrence time and server acceptance audit time, tenant isolation, mobile-first create/read flows, accessible loading, empty, error and retry states. Exclude attachments, AI, risk actions, notifications, weather-driven changes, finance, harvest/sales, team/advisor sharing, generic offline sync, broad task management and Calendar."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Record a field observation (Priority: P1)

As a farmer, I can write down what I noticed in one of my fields, associate it with a season when appropriate, and record when I observed it so I can refer to what happened later.

**Why this priority**: Capturing the farmer's own field knowledge is the core value of this feature and the source for the new diary entries.

**Independent Test**: An authorized farmer records an observation for a field, reopens that field's history, and sees the saved description and occurrence time.

**Acceptance Scenarios**:

1. **Given** an authenticated farmer with current access to a field, **When** they enter a non-empty observation and save it, **Then** the observation is accepted for that field and its occurrence time is preserved separately from its server acceptance time.
2. **Given** the farmer is recording an observation for a season, **When** they select that season, **Then** the saved observation is associated with that season only if the season belongs to the same authorized business and field.
3. **Given** the description is empty or contains only whitespace, **When** the farmer tries to save, **Then** the observation is not accepted and the farmer is told what to correct.
4. **Given** the farmer chooses an occurrence time earlier than the current time, **When** they save the observation, **Then** the chosen occurrence time is retained and shown using the existing task-history Business-timezone convention.
5. **Given** the selected field or season is outside the farmer's current authorized scope, **When** a save is attempted, **Then** no record is created and the response does not disclose private data outside that scope.
6. **Given** the description is trimmed of leading and trailing Unicode whitespace, **When** the canonical text contains 1..2000 Unicode code points, **Then** it is accepted; otherwise it is rejected with a clear correction message. Count Unicode code points, not UTF-8 bytes or UTF-16 code units.

### User Story 2 - Review a field or season diary (Priority: P1)

As a farmer, I can review observations and completed work for a field or season in occurrence order, so I can understand what actually happened without searching separate records.

**Why this priority**: A saved observation is useful only if it can be found again; placing it beside existing completed work provides immediate operational context.

**Independent Test**: An authorized farmer opens a field diary and a season-filtered diary containing at least one observation and one accepted task completion, and sees both canonical records in chronological order with their distinct details.

**Acceptance Scenarios**:

1. **Given** a field has observations and accepted task completions, **When** the farmer opens its diary, **Then** both kinds of records appear in newest-occurrence-first order with their appropriate descriptions and occurrence times.
2. **Given** a farmer opens a season diary, **When** the season belongs to the requested field and authorized business, **Then** only observations associated with that season and task completions from that season appear.
3. **Given** a field or season has no diary entries, **When** the farmer opens its diary, **Then** the product shows a clear empty state and a way to add an observation where permitted.
4. **Given** the diary contains more entries than one page, **When** the farmer requests more, **Then** older entries load without repeating or skipping entries.
5. **Given** diary retrieval fails, **When** the error is shown, **Then** the farmer can retry and no unsaved or fabricated record is presented as accepted history.
6. **Given** two diary entries have the same occurrence time, **When** they are displayed, **Then** their order is stable across repeated reads.

### User Story 3 - Keep observations trustworthy over time (Priority: P2)

As a farmer, I can rely on an accepted observation remaining a stable record of what I entered, even if the field or season later changes.

**Why this priority**: Observations describe realized field conditions and must not silently change when current field or season details change.

**Independent Test**: Save an observation, change later field context, and verify the original observation, its occurrence time, and its original field/season association remain unchanged in history.

**Acceptance Scenarios**:

1. **Given** an observation was accepted, **When** the field name, geometry, region, or current season context later changes, **Then** the accepted observation and its original association remain stable.
2. **Given** an observation was accepted, **When** a farmer needs to correct the account, **Then** the original record is not silently overwritten or erased; a correction can be recorded as a separate observation.

### Edge Cases

- The authenticated user's membership is revoked before a create or read request is processed.
- A supplied season does not exist, belongs to another field, or belongs to another business.
- The field is no longer available in the farmer's authorized scope.
- The farmer enters whitespace-only text, a description at the allowed length boundary, or text containing Turkish and other Unicode characters.
- The farmer selects a future occurrence time; the observation is rejected with a clear correction message. A local time in a Business timezone DST gap or fold is rejected without shifting or choosing an offset; the attempted input remains visible and the farmer is asked to choose another valid, unambiguous time. No first/second occurrence selector is provided.
- The farmer saves successfully but loses the response; retry behavior must not create duplicate accepted observations.
- Multiple entries share an occurrence time or a page boundary.
- Diary loading, saving, or retry fails; no pending or failed observation is represented as accepted server history.
- A field or season has no observations, no completions, or no entries of either kind.
- A field or season changes after an observation is accepted; history continues to show the original observation context.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The product MUST let an authenticated farmer create a text observation for a Field the farmer is currently authorized to access through an active Business membership.
- **FR-002**: Every observation MUST belong to exactly one Field. A farmer MAY associate it with a Season; when supplied, that Season MUST belong to the same Field and authorized Business.
- **FR-003**: Before domain validation and persistence, the server MUST trim leading and trailing Unicode whitespace from the description. The resulting canonical text MUST contain 1..2000 Unicode code points, counting code points rather than UTF-8 bytes or UTF-16 code units. The server is authoritative; mobile MAY mirror this validation for user experience. Do not apply unrelated Unicode normalization or alter internal whitespace/content.
- **FR-004**: An observation MUST preserve the farmer-recorded occurrence date and time as an absolute occurrence instant. The create flow MUST default this value to the current time and allow the farmer to choose an earlier local date/time interpreted in the authorized Business timezone, or `Europe/Istanbul` when Business timezone is not configured. Device timezone MUST NOT redefine the instant. The client MUST submit both the entered local date/time and its offset-aware absolute instant. The server MUST resolve the local value using the authorized Business timezone and verify it maps uniquely to the submitted instant; it MUST reject nonexistent or ambiguous local values with structured `400 INVALID_REQUEST`, without shifting or selecting an offset. Mobile MUST retain the attempted input and ask the farmer to choose another valid, unambiguous time; no first/second DST-occurrence selector is added. The server MUST reject future instants. Persisted `occurredAt` is an absolute instant and display MUST follow the Business-timezone convention used by SPEC-003 task history. Reuse the existing Business timezone resolution utilities/conventions; do not create a parallel timezone policy. A nonexistent or ambiguous local wall time MUST be rejected as described above; do not silently guess, shift, or choose an offset.
- **FR-005**: The server MUST record a separate acceptance/audit time for each accepted observation. This server time MUST NOT replace the farmer-recorded occurrence time and MUST NOT be required in the normal farmer-facing diary row.
- **FR-006**: The product MUST provide a Field diary and a Season-filtered diary that can present accepted observations together with accepted completed-work records. Existing completed-work records MUST be reused without creating duplicate records or changing the SPEC-003 completion/history behavior.
- **FR-007**: A season-filtered diary MUST validate that the season belongs to the requested field and authorized Business. The server MUST resolve Business scope from authenticated identity and current membership; client-supplied Business identifiers MUST NOT grant access.
- **FR-008**: The diary MUST use deterministic keyset pagination, ordered by `occurredAt DESC, kind ASC, source UUID DESC`. The opaque cursor MUST bind to the authorized Field, optional Season filter, and last returned ordering tuple. Each continuation MUST query strictly after that tuple in the global ordering. Records already returned MUST NOT repeat, and insertion of new records MUST NOT cause pre-existing eligible rows to be skipped permanently. A new record sorting before the consumed cursor is not injected into that traversal and appears after a fresh traversal/refresh; one sorting after the cursor may appear on a subsequent page. This is not snapshot-isolated pagination and makes no fixed-snapshot guarantee. Ordering keys for supported diary sources MUST remain immutable.
- **FR-009**: The diary MUST distinguish observations from completed-task records and show each record's relevant farmer-facing details, including its occurrence time. Completed tasks MUST retain their existing planned-date and plan/season provenance presentation.
- **FR-010**: Creating and reading observations and diary entries MUST be available in the mobile application without requiring a desktop.
- **FR-011**: Create and read screens MUST provide loading, empty, error, and retry states where applicable. A failed or unresolved save MUST NOT be presented as server-accepted history.
- **FR-012**: Create and read flows MUST expose accessible names, roles, focus behavior, and state announcements; information MUST NOT rely on color alone, and text MUST remain readable at supported text scaling.
- **FR-013**: An accepted observation MUST remain historically stable when current Field details or Season context later changes. This feature MUST NOT silently rewrite or erase an accepted observation; a correction MUST be represented as a separate observation.
- **FR-014**: The client MUST generate a stable observation UUID for a logical create. The same UUID with the same canonical payload, actor, and currently authorized Field/Season context MUST converge to exactly one canonical FieldObservation. Database uniqueness and transaction handling MUST prevent duplicate canonical rows. The first successful creator MUST receive `201`; an exact replay, including a concurrent losing request after the canonical row exists, MUST receive `200` with the same canonical representation. Reuse of an existing UUID with changed canonical payload, actor, or authorized context MUST return structured `409`. Concurrent identical requests MUST NOT produce a false conflict.
- **FR-015**: Observation create and diary reads MUST revalidate current authorization. Requests outside scope MUST not reveal whether another Business's Field, Season, or observation exists.
- **FR-016**: Observation creation in SPEC-006 MUST require connectivity and a committed server acceptance. This feature MUST NOT add an observation outbox, durable offline observation queue, authorization lease, or generic offline synchronization. Offline observation mutation may be added by a later dedicated offline capability. Existing SPEC-003 completion-specific offline behavior MUST remain unchanged.
- **FR-017**: This feature MUST NOT include photo or file attachments, attachment storage/upload, AI or image analysis, disease diagnosis, risk follow-up/actions, advisor or team sharing, notifications, weather-driven recommendations or task changes, finance, harvest or sales, generic offline sync, broad active-season task management, or Calendar implementation.
- **FR-018**: SPEC-006 MUST NOT introduce an observation category or fixed taxonomy. The initial observation is structured by its Field and optional Season context, occurrence time, text, and audit/provenance information. A category/taxonomy may be added only by a later bounded product requirement defining its meaning. The feature MUST NOT infer a diagnosis or risk from observation text.

### Key Entities *(include if feature involves data)*

- **Field Observation**: A farmer-authored, text-first account of something noticed in one Field, with an optional same-field Season association, occurrence time, and server acceptance/audit time. Once accepted, its historical content and association remain stable.
- **Diary Entry**: A farmer-facing view of an existing accepted Field Observation or completed-work record. It is a presentation of source records and does not create a duplicate operational record.
- **Field and Season**: Existing authorized context. A Season belongs to one Field and Business; an observation's optional Season association must match its Field and Business.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In acceptance testing, an authorized farmer can save a valid text observation and find it again in the correct Field diary in 100% of tested cases.
- **SC-002**: In acceptance testing, a Season diary returns only entries associated with that Season and its Field, and excludes records from another Field or Business in 100% of tested authorization cases.
- **SC-003**: In acceptance testing, a diary traversal uses strict deterministic keyset continuation without repeating returned records or permanently skipping pre-existing eligible rows. Concurrently inserted records follow FR-008; no fixed-snapshot result is promised.
- **SC-004**: In usability testing, a farmer can create a basic observation from mobile using only the description and the default occurrence time, without entering optional organizational or technical settings.
- **SC-005**: In accessibility review, all observation create/read controls and loading, empty, error, and retry states are operable and understandable with assistive technology and without color-only cues.
- **SC-006**: Across tested authorization failures and membership revocations, no observation or diary content outside the farmer's current Business/Field scope is disclosed.

## Assumptions

- The farmer is signed in and uses the existing Field and Season access established by SPEC-001, SPEC-002, and SPEC-005.
- A Field is required for every observation; a Season association is optional and can be selected only from Seasons belonging to that Field.
- Observation creation requires connectivity and server acceptance in SPEC-006. Offline observation mutations are deferred to a later dedicated capability.
- The occurrence time defaults to the current time; the farmer may backdate it but may not choose a future time.
- Existing accepted completed-work records are the source for task events in the diary. Pending or conflicted device-local completion commands are not accepted history and are not transformed into diary records.
- The first release has no observation category because the PRD does not define an approved taxonomy.
- The first release does not provide editing or deletion of accepted observations. A correction is recorded as a new observation to preserve the original account.
- Offline observation creation is not supported by this feature; this does not change SPEC-003 completion-specific offline behavior.

## Out of Scope

- Photos, file attachments, attachment storage, and deferred upload/retry.
- AI/image analysis, disease recognition, risk evaluation, or observation-triggered tasks/actions.
- Team or advisor access, assignment, sharing, comments, notifications, or reminders.
- Weather-driven recommendations, automatic task changes, and broad active-season task management.
- Costs, profitability, irrigation, inputs, equipment, harvest, and sales records.
- Generic offline sync, Calendar implementation, and migration/import of historical records.
- Duplicating completed-work records into a new event store or changing SPEC-003 completion/history contracts.

## Dependencies

- SPEC-001 authenticated user and authorized default Business membership.
- SPEC-002 Field and Season identity and relationships.
- SPEC-003 accepted TaskCompletion records, occurrence-time behavior, Business-timezone display convention, and bounded Field/Season history semantics.
- SPEC-005 current Field management and stable historical Season context.

## Clarifications

### Session 2026-10-04

- Q: Must observation creation be supported without network access in SPEC-006? → A: No. Require connectivity and server acceptance; do not add an observation outbox, durable offline queue, authorization lease, or generic sync. Defer offline observation mutations to a later dedicated capability and preserve SPEC-003 completion-specific offline behavior.
- Q: Should SPEC-006 define a fixed observation category taxonomy? → A: No. The initial text-first observation uses Field/optional Season context, occurrence time, text, and audit/provenance; add taxonomy only after a later bounded product requirement defines its meaning.
- Q: Should the diary copy accepted task completions into a new event store? → A: No. Reuse existing canonical completed-task history alongside observations, initially showing those two supported event types chronologically.
- Q: What maximum length should one observation note allow? → A: 2,000 characters.
