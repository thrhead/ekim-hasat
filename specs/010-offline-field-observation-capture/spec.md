# Feature Specification: Offline Field Observation Capture

**Feature Branch**: `work` (specification authored without creating a branch)

**Created**: 2026-10-14

**Status**: Draft — frozen product scope, ready for human review

**Input**: Approved scope: extend SPEC-006 text observations with an observation-specific durable offline command queue for an already known Field and optional Season. Preserve stable observation identity, occurrence time and Business-timezone semantics, current server authorization, idempotent replay, canonical acceptance, and immutable accepted history. Pending work survives restart; reconnect retries the same logical command; revoked access cannot create accepted history; accepted work reconciles with the canonical diary. No generic sync or authorization lease.

## Clarifications

### Session 2026-10-14

- Q: If an observation was accepted but its response was lost, and access is revoked before retry, what should the app say about the saved note? → A: Show the outcome as unconfirmed. Preserve the local note and do not claim either acceptance or definite rejection when current access prevents verification.
- Q: After restarting the app while still offline, should a farmer be able to create another observation for a Field whose observation context was saved earlier on that device? → A: Yes, for that saved account-scoped observation context; no general offline Field or Season list is implied.
- Q: After an offline app restart, if the app can identify the original account and its saved Field context but cannot refresh the sign-in session, should it allow a new pending text observation? → A: Allow local pending capture for the identified original account and saved observation context. Delivery and canonical acceptance wait for restored sign-in and current server authorization; this is not an authorization lease.
- Q: How is the original locally active account identified after an offline restart? → A: Use an observation-specific, non-authoritative local account continuity marker established or updated only by a successfully authenticated session with a concrete `accountId`. A retryable/offline restoration failure may retain that marker solely for local pending capture in its saved observation context. A successful restoration returning no session, explicit sign-out, or authentication as another account cannot activate the former namespace. Its pending data may remain stored and become accessible again only after authentication as that account. The marker never supplies an access token or API permission.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Capture an observation without connectivity (Priority: P1)

As a farmer viewing a previously available Field, I can record what I notice even when the connection fails, and see that my note is saved on this device while it awaits server acceptance.

**Why this priority**: A field note is often written where connectivity is weak. Losing a confirmed entry undermines the diary's usefulness.

**Independent Test**: Open a Field whose observation context was already established for this account, disconnect, save a valid text observation, terminate and restart the app, and find the same pending note with its original time and Field/Season association.

**Acceptance Scenarios**:

1. **Given** a signed-in farmer has a previously established observation context for a Field, **When** they save a valid text observation offline, **Then** one durable pending observation is retained under that account before the product confirms local capture; it is clearly labelled as awaiting synchronization, not as accepted diary history.
2. **Given** that pending observation, **When** the app or process restarts before reconnecting, **Then** the same text, Field and optional Season association, occurrence time, and command identity are recoverable without creating a second logical observation.
3. **Given** the app restarts while still offline in the same locally active account namespace previously established on that device, with saved observation context for a Field and optional Season, **When** the farmer creates another valid text observation for that context, **Then** the new note can be captured as a distinct durable pending command even if sign-in cannot be refreshed offline; no delivery or canonical acceptance occurs until sign-in and current server authorization are available. A stale account ID found in storage alone does not establish the active namespace.
4. **Given** a Field or optional Season has not been safely established for this account's observation flow, **When** the farmer is offline, **Then** the product does not claim it can capture for that context and explains that the context must be loaded while connected.
5. **Given** the farmer enters an invalid or future observation time, empty text, or text beyond SPEC-006's limit, **When** they try to save, **Then** the command is not queued and the farmer is told what to correct.

---

### User Story 2 - Synchronize and find the canonical observation (Priority: P1)

As a farmer, I want my pending note to become a trusted diary entry after I reconnect, without duplicated records or a changed observation time.

**Why this priority**: Local capture has lasting value only when the server accepts it and the canonical diary reflects it.

**Independent Test**: Reconnect with current access, deliver the same pending command at least twice including after an uncertain response, and find exactly one accepted observation in the correct diary.

**Acceptance Scenarios**:

1. **Given** a pending note and restored connectivity, **When** synchronization runs, **Then** it submits the original logical command with the same observation identity, canonical text, occurrence instant and local-time representation, Field, and optional Season; server acceptance is required before it is shown as accepted.
2. **Given** a submission committed but its response was lost, **When** the farmer or app retries, **Then** the same command converges to one canonical observation through the existing replay behavior; no second observation is created.
3. **Given** server acceptance or exact replay, **When** the canonical result is durably recorded locally, **Then** the command leaves pending status even if its observation is older than the first diary page. If the retained accepted result and canonical diary entry are both visible, they represent one observation matched by `observationId`.
4. **Given** a failure to refresh the diary after acceptance, **When** the farmer reopens it, **Then** the accepted result remains recoverable and the product does not misrepresent an old or first-page-only diary view as proof the observation is absent.

---

### User Story 3 - Keep denied and conflicted notes recoverable (Priority: P2)

As a farmer, I can tell when a locally captured note was not accepted, while my original words remain available to me in the appropriate account context.

**Why this priority**: An authorization change or validation conflict must never silently discard field work or turn it into unauthorized history.

**Independent Test**: Queue an observation, revoke the membership before reconnecting, then attempt delivery and verify that no canonical record or accepted diary entry is created and that the local note is clearly denied and recoverable only in its original account context.

**Acceptance Scenarios**:

1. **Given** a pending note and revoked or otherwise invalid current membership, **When** delivery is attempted, **Then** the server rejects the attempt under current authorization and creates no new canonical observation. If an earlier attempt may have committed without a received result, the device labels the outcome unconfirmed; otherwise it labels the note not accepted. Neither state exposes private Field/Season information from the server.
2. **Given** a validation, Field/Season association, or identity/payload conflict, **When** the server rejects the command, **Then** the product retains the original local note and shows a distinct needs-attention/conflict state without automatically retrying it indefinitely or claiming diary acceptance. If correcting text, temporal inputs, Field, or Season is necessary, an explicit farmer decision creates a new logical observation with a new `observationId`; the original command is never silently mutated.
3. **Given** a temporary network, server, or uncertain-response failure, **When** delivery is attempted, **Then** the exact pending command remains durable for a safe retry and is not presented as permanently denied or accepted.
4. **Given** the user signs out or switches accounts, **When** pending notes exist for the previous account, **Then** their content is not displayed or submitted under the other account; signing back into the original account can recover those unresolved notes subject to current server authorization for delivery.

### Edge Cases

- A connection drops during the initial save: local capture succeeds only once the pending command is durably retained; a failed local write cannot be reported as saved.
- Multiple rapid taps or process relaunches must not create multiple logical observations for one confirmed save.
- A known Field is renamed or its current Season changes before delivery: the original Field/Season identities and occurrence data remain the submitted command; the server decides current eligibility. A failed association cannot be silently redirected to a different Field or Season.
- A local calendar time that is nonexistent or ambiguous in the Business timezone is rejected according to existing observation rules; device timezone never substitutes for Business timezone.
- A queued occurrence time later becomes older while offline: it remains the original occurrence instant. Acceptance time is assigned only by the server.
- A pending note and a canonical diary entry for the same observation identity may coexist briefly during recovery; the farmer sees one logical observation with an accurate acceptance status.
- A known authorization denial does not trigger display of protected saved Field/Season content under a different account.
- If an earlier submission may have committed but its response was lost, a later authorization denial cannot prove whether that earlier submission was accepted; the original account retains an unconfirmed local note without a claim of canonical status.
- If the original account cannot be identified after restart, saved context alone does not permit new local capture or display of that account's pending notes.
- A crash or process termination after submission starts but before the canonical response is durably recorded leaves the server outcome unknown. The unchanged command survives restart and is eligible for exact retry when sign-in and current authorization permit it; a later authorization denial leaves the outcome unconfirmed.
- If the authoritative Business timezone differs from the saved timezone before first canonical acceptance, the original command moves to needs attention without changing its note, local wall time, timezone context, or absolute instant. A farmer who chooses corrected temporal context creates a new logical observation with a new `observationId`.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The product MUST offer offline text observation capture only for a Field and optional Season whose identities and required Business-timezone context were previously established and saved through the existing observation flow for the same locally active account namespace on that device. An observation-specific local account continuity marker MUST be established or updated only from a successfully authenticated app session with a concrete `accountId`. After an offline app/process restart, a retryable/offline session-restoration failure MAY preserve that marker for new local pending capture using saved observation context in that same account namespace. Merely finding an old account ID elsewhere in storage MUST NOT establish the active namespace. Successful restoration returning no session or explicit sign-out MUST invalidate the active marker for new offline capture and hide saved account context from signed-out presentation; authentication as another `accountId` MUST switch the active namespace and hide the former account's local data. Existing pending data MAY remain durably stored and become locally accessible again only after a later successfully authenticated matching-account session. The marker MUST NOT represent authentication, authorization, Membership or Business access, an authorization lease, or an access token. Server authorization remains required for acceptance. The product MUST NOT provide or promise cold-start access to arbitrary Fields or Seasons.
- **FR-002**: Each confirmed local capture MUST durably retain one observation-specific pending command before reporting local success. It MUST survive app/process restart until accepted or explicitly presented as needing attention; transient connectivity failure MUST NOT discard it.
- **FR-003**: The pending command MUST retain the stable `observationId`, account and Field identity, optional Season identity, canonicalized text, absolute `occurredAt`, entered Business-local wall time, and the Business timezone context used at capture, plus all values necessary to retry the exact logical create. The existing SPEC-006 text and time validation rules MUST apply before queueing and at first server acceptance.
- **FR-004**: Pending, retrying, outcome-unconfirmed, accepted, and needs-attention/conflict states MUST be distinguishable in farmer language. Pending, unconfirmed, or denied local observations MUST NOT be displayed as canonical accepted diary entries, and a failed local save MUST NOT be reported as captured.
- **FR-005**: On reconnection, retryable connectivity failures, process interruption, crash during submission, and otherwise unknown delivery outcomes MAY retry the same unchanged logical command with its original `observationId` when delivery is eligible. If a crash or process termination occurs after submission begins but before a canonical response is durably recorded, the outcome MUST be treated as unknown, not rejected; the exact command MUST survive restart. A later authorization denial in that state MUST show outcome unconfirmed. No retry MAY silently change the payload or identity.
- **FR-006**: The observation flow MUST distinguish an authenticated restored session, a definitive no-session result (including explicit sign-out), and a retryable/offline restoration failure. Only the failure state with a valid active continuity marker MAY allow new local pending capture without refreshed sign-in; a definitive no-session result MUST NOT be treated as that failure. Local capture in the failure state MUST remain pending without a delivery attempt. Delivery or replay MUST require a real authenticated session whose `accountId` matches the command's account namespace; the marker MUST NOT supply an access token or permit an API request. The server MUST continue to authenticate the actor and revalidate current membership, Business, Field, and optional Season authorization on every create or replay attempt. Locally stored context MUST NOT authorize acceptance. Revoked or out-of-scope access MUST create no new canonical observation and reveal no unauthorized Field/Season data.
- **FR-007**: Exact retries MUST converge to one canonical accepted observation under SPEC-006's idempotency rules. Reuse of an observation identity with a different payload or actor MUST remain a conflict, not a second accepted observation.
- **FR-008**: The product MUST preserve the captured absolute `occurredAt`, entered local wall time, and Business timezone context used when the offline command was created. Once canonically accepted, the observation's absolute occurrence instant, text, and Field/Season association MUST remain immutable and distinct from server acceptance time. A later Business timezone change MUST NOT reinterpret or mutate that accepted observation. Farmer-facing diary display continues the existing canonical Business-timezone display convention; converting the stored instant for display does not change it. An exact replay of an already accepted command MUST converge to that canonical observation subject to current authorization and privacy rules, without requiring its captured time to remap under a later Business timezone.
- **FR-009**: A command MAY leave pending status only after the canonical server acceptance result is durably recorded locally. Diary refresh or the observation's position beyond the first diary page MUST NOT keep a confirmed accepted command pending, downgrade it, or invalidate acceptance. Reconciliation and de-duplication MUST match the stable `observationId`; if a locally retained accepted representation and canonical diary entry are both visible, they MUST appear as one observation. A refresh failure MUST preserve the accepted result for later authorized reconciliation. The locally retained accepted representation MAY be retired only after an authorized diary read confirms the canonical entry with that same `observationId`.
- **FR-010**: A definitive authorization, association, validation, or identity/payload conflict rejection MUST leave the original local note recoverable and visibly not accepted when no earlier acceptance is possible. If an earlier attempt may have committed but its response was lost, a subsequent authorization denial MUST instead show outcome unconfirmed until authorized canonical evidence can establish the result; it MUST NOT claim definite rejection or acceptance. Validation, association, and identity/payload conflicts MUST NOT be automatically retried indefinitely. The product MUST NOT silently alter the original command's payload, Field/Season context, or `observationId`, or insert it into accepted history. If correction of payload or Field/Season context is needed, only an explicit farmer decision MAY create a new logical observation with a new `observationId`. Reattempting after a changed authorization state requires a fresh current server decision.
- **FR-011**: Pending and failed local observations MUST be isolated by authenticated account. Signing out or switching accounts MUST prevent cross-account display or submission; existing canonical diary reads MUST continue to follow current server authorization.
- **FR-012**: Existing online observation creation, diary ordering/pagination, completion-specific offline behavior, and accepted Task Completion and Skip history MUST retain their current semantics.
- **FR-013**: The feature MUST provide understandable loading, local-save failure, pending, retrying, outcome-unconfirmed, denied/conflicted, accepted, and diary-refresh failure states on mobile, with accessible text and state announcements rather than color alone. Outcome unconfirmed MUST NOT be announced as accepted or rejected.
- **FR-014**: This feature MUST remain observation-specific. It MUST NOT introduce generic offline sync, a generic authorization lease, broad offline Field/Season browsing or mutation, offline Field or Season create/edit, photos/attachments or deferred upload, categories, AI/risk inference, notifications, offline Skip/date adjustment, irrigation, finance, harvest/sales, or a diary/offline architecture redesign.
- **FR-015**: Before first canonical acceptance, if the authoritative Business timezone differs from the saved timezone used to capture the command and no earlier submission may have committed, the command MUST move to needs attention without silent reinterpretation or automatic alteration. If an earlier submission may have committed without a durable response, a later timezone-mismatch response MUST leave the outcome unconfirmed rather than imply definite rejection. In either case, automatic retry MUST stop and the original note, entered local wall time, saved timezone context, and absolute `occurredAt` MUST remain recoverable. Submitting with corrected temporal context requires an explicit farmer decision and a new logical observation with a new `observationId`.

### Key Entities *(include if feature involves data)*

- **Pending observation command**: Device-local, account-scoped original intent to create one SPEC-006 observation, carrying stable identity, Field/optional Season context, text, occurrence time, and delivery state. It is not canonical history.
- **Field observation**: Existing server-accepted immutable text observation with Field, optional Season, occurrence time, and distinct acceptance/audit time.
- **Observation context**: Previously established Field/optional Season identity and Business timezone sufficient for this account to compose a valid observation offline; it is not an authorization grant.
- **Diary entry**: Existing canonical presentation of accepted observations and other accepted operational events. A pending note is separately identified until reconciliation.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In 100% of acceptance scenarios where local capture is confirmed, the same pending text, original occurrence time, and Field/optional Season association remain available to the original account after app/process restart.
- **SC-002**: In tested reconnect, repeated retry, lost-response, and restart scenarios, one logical observation results in exactly one canonical diary entry after acceptance and no duplicate farmer-facing entry; a durably recorded acceptance is not kept pending or downgraded because its canonical entry is beyond the first diary page.
- **SC-003**: In 100% of tested revoked-membership and foreign-Field/Season delivery attempts, the rejected attempt creates no new canonical observation and discloses no unauthorized diary content; an earlier uncertain attempt is never labelled definitely rejected or accepted without evidence.
- **SC-004**: In 100% of tested temporary delivery failures, the original command remains recoverable for exact retry; definitive rejection is visibly distinguished from acceptance.
- **SC-005**: In mobile acceptance testing, a farmer can capture a valid text note for a previously available Field while disconnected, including after restart when the original account is identifiable but sign-in cannot be refreshed, without entering organization or synchronization settings; the note stays pending until authorized delivery and its status is clear.
- **SC-006**: In 100% of tested accepted cases, canonical history retains the original absolute occurrence instant and immutable Field/Season association even when acceptance happens later; farmer-facing display converts that instant under the existing authorized Business-timezone convention without changing the stored instant.

## Assumptions

- SPEC-006 remains the source for text normalization, 1–2000 Unicode-code-point limit after trimming, valid non-future occurrence time, Field/optional same-Field Season association, server acceptance, and canonical diary behavior.
- A farmer signs in and establishes observation context while connected before using this offline flow. The product persists only the minimum account-scoped context needed for that flow, including for a new note after offline restart within the same locally active account namespace. A stale stored account ID alone does not restore that namespace after explicit sign-out or account switch. Local account identification permits pending capture, not server authorization or canonical acceptance; no arbitrary offline Field/Season directory is implied.
- A local pending note is private device state, not evidence of current access or server acceptance. Current membership and scope are rechecked when the original command reaches the server.
- Accepted observations remain immutable; corrections continue to be new observations under SPEC-006. This feature does not add edit/delete of accepted history.

## Dependencies

- SPEC-001 authentication and account identity, SPEC-002 Field/Season identity, SPEC-003's demonstrated completion-specific offline reliability pattern, SPEC-005 Field scope, and SPEC-006 observation create/diary semantics.
- The existing observation create contract's stable identity and idempotent replay, authorized diary reads, and Business-timezone validation remain authoritative.

## Out of Scope

- Generic offline sync or authorization lease; generalized conflict resolution or two-device synchronization.
- Broad offline Field/Season browsing or mutation, Field/Season creation/editing, and cold-start access to every Field/Season.
- Photos, attachments, deferred upload, observation categories, AI or risk inference, notifications.
- Offline Skip or task-date adjustment; irrigation, finance, harvest/sales; redesign of the diary or whole offline architecture.
