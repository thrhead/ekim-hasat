# Feature Specification: Harvest Record Capture

**Feature Branch**: `013-harvest-record-capture`

**Created**: 2026-10-26

**Status**: Draft — clarification complete

**Input**: Approved bounded feature to record canonical historical harvest facts for an authorized Field and its same-Field, same-Business ACTIVE Season. V1 is online and server-authoritative. Sales, revenue, profitability, inventory, post-harvest disposition, and offline Harvest capture are excluded.

## Clarifications

### Session 2026-10-26

- Q: Must every Harvest belong to a Season, or may a farmer record a Field-only Harvest, and which Season status is eligible? → A: Every Harvest MUST belong to a Season for the same Field and Business, and that Season MUST be ACTIVE when the Harvest is recorded. Field-only Harvests and DRAFT-Season Harvests are not allowed. The PRD describes harvests as Season output; the current Season model has DRAFT and ACTIVE states, and DRAFT is an unactivated plan.
- Q: How should farmers choose Harvest quantity units, and may units differ between records in the same Season? → A: For each Harvest, the farmer selects kilograms or metric tonnes from a controlled set. Different Harvest records in one Season may use different units. The product performs no automatic conversion; each record preserves its selected unit.
- Q: What is the maximum number of decimal places a Harvest quantity may contain? → A: A positive Harvest quantity may contain up to three decimal places; more precision is rejected without rounding.
- Q: Must a Harvest date be on or after its Season's actual sowing/planting date, with equality allowed? → A: For every Season, harvestDate MUST be on or after the Season's actual sowing/planting date. Equality is valid; an earlier date is rejected. This follows the product's existing rule that Season task dates cannot precede actual sowing/planting and the Harvest fact represents realized output of that Season.
- Q: Which existing roles may create Harvests for a currently authorized Field? → A: An authorized OWNER or WORKER may create Harvests. ADVISOR is read-only for Harvests and retains ordinary authorized Diary read access. This follows the PRD's operational worker role and history-oriented advisor access without adding a role or permission system.
- Q: Is the Harvest date date-only, and what calendar determines whether it is in the future? → A: It is a farmer-entered date-only local calendar date, with no time-of-day. A future date is rejected against the authorized Business-local current date; no occurrence timestamp is fabricated. The PRD describes harvest date, SPEC-002 defines actual planting dates as local calendar dates and rejects future dates, and SPEC-012 establishes date-only Business-local handling.
- Q: Which current roles may read Harvests in Field and Season history? → A: Harvest reads follow ordinary authorized Diary visibility, with the same role access for Field and Season-filtered reads; the Season filter limits records to that Season. Current ordinary Diary access is not role-gated, WORKER read is covered by an integration test, and the PRD includes Field Diary/history in worker/advisor access. OWNER-only expense visibility remains a finance-specific rule.
- Q: Must an already accepted exact replay still have an ACTIVE Season? → A: ACTIVE is required at first acceptance. An exact replay is not a new acceptance: current authorization and same-Business/Field context are revalidated before disclosure, but a later Season lifecycle change does not invalidate the original accepted fact.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Record a harvest (Priority: P1)

As a farmer, I can record a harvest for an authorized Field and its same-Field, same-Business ACTIVE Season, including when that Season has already had an earlier harvest, so the farm's realized output is preserved as history.

**Why this priority**: Recording what was harvested is a direct farmer need in the PRD and provides useful operational history without requiring sales or profitability features.

**Independent Test**: With current authorization and connectivity, enter a harvest date, positive quantity, and unit for a valid Field and same-Field ACTIVE Season; receive server confirmation and find one matching accepted Harvest in history.

**Acceptance Scenarios**:

1. **Given** an authenticated OWNER or WORKER with current authorization for a Field and its same-Business ACTIVE Season, **When** they submit a valid Harvest with a farmer-entered date, positive quantity, and explicit unit, **Then** the server accepts one canonical historical Harvest and the product reports success only after confirmation.
2. **Given** a Season already has an accepted Harvest, **When** the farmer records another distinct harvest, **Then** both Harvest records remain separately identifiable and neither is merged into or substituted for the other.
3. **Given** the farmer submits a missing, invalid, zero, or negative quantity, a quantity with more than three decimal places, or omits the required unit, **When** they try to save, **Then** no Harvest is accepted and the farmer is told what to correct without silent rounding.
4. **Given** an ACTIVE Season already has Harvests in kilograms, **When** the farmer records another Harvest in metric tonnes, **Then** the new record retains the selected metric-tonne unit and the product does not convert or rewrite the earlier records.
5. **Given** the Season has an actual sowing/planting date, **When** the farmer enters that date as the Harvest date, **Then** the date is accepted; **When** the farmer enters an earlier date, **Then** the Harvest is rejected with a correction message.

### User Story 2 — Find harvest history (Priority: P1)

As a farmer, I can find accepted harvest records in the relevant Field or Season history, so I can review what was harvested and when.

**Why this priority**: A historical fact is useful only if it can be found again in the same history surface as other accepted farm records.

**Independent Test**: Create multiple accepted Harvest records for one Season, open its history and the Field history, and verify that each appears once with its date, quantity, and unit.

**Acceptance Scenarios**:

1. **Given** authorized Field history contains accepted Harvest records, **When** the farmer opens the Field Diary, **Then** each eligible Harvest appears as a distinct Harvest event sourced from its canonical record.
2. **Given** the farmer views a Season-filtered Diary, **When** accepted Harvests were recorded for that Season, **Then** those records appear with their original Field and Season context and records from other Seasons do not appear.
3. **Given** the history spans multiple pages or contains Harvests on the same date, **When** the farmer continues reading, **Then** entries have stable chronological order and no previously returned entry is duplicated or skipped.
4. **Given** there are no accepted Harvest records, history fails to load, or access is denied, **When** the farmer views the history, **Then** the product distinguishes the empty, retryable failure, and access-denied states without presenting an unaccepted record as canonical history.

### User Story 3 — Preserve a trustworthy harvest fact (Priority: P1)

As a farmer, I can rely on an accepted Harvest remaining a record of what I entered, even if a request response is lost or current Field/Season details later change.

**Why this priority**: Harvest is realized operational history, so duplicate retries or silent changes to its original context would make the record unreliable.

**Independent Test**: Submit a Harvest, retry after an uncertain response, and verify there is one accepted record; then change current Field/Season details and verify the accepted Harvest retains its original associations and values.

**Acceptance Scenarios**:

1. **Given** the server accepted a Harvest but the response was lost, **When** the same logical submission is retried with the same identity and unchanged content by the same currently authorized actor, **Then** the farmer receives the original accepted result and no second canonical Harvest is created.
2. **Given** a retry reuses the identity with changed content or a different Field/Season context, **When** it reaches the server, **Then** the accepted Harvest is not silently changed and the farmer receives a conflict or other clear non-success outcome.
3. **Given** a Harvest has been accepted, **When** Field or Season details later change, **Then** the Harvest retains its original Field/Season association, entered date, quantity, and unit.
4. **Given** an accepted Harvest is inaccurate, **When** the farmer views it, **Then** this feature offers no edit, delete, void, or silent correction action.

### Edge Cases

- The Field is missing, outside current authorization, or belongs to another Business; reject without revealing whether protected records exist.
- A Season is missing or belongs to another Field or Business; reject without creating a Harvest or disclosing protected context. A non-ACTIVE Season rejects first acceptance, but does not invalidate an otherwise authorized exact replay of an already accepted Harvest.
- Membership or role access is revoked before a create or read is processed; recheck current authorization and do not create or disclose protected data.
- A previously returned `viewerRole` may become stale after Membership, role, or Season access changes; the create endpoint rechecks current authorization and may return 403, which the mobile flow presents as an authorization state.
- An ADVISOR attempts to create a Harvest; reject the create while retaining the ADVISOR's ordinary authorized Field/Season Diary read access.
- The farmer enters an invalid or future harvest date; do not accept it as a historical Harvest. Future-date validation uses the authorized Business-local current date.
- The farmer enters a quantity with more than three decimal places; reject it without rounding or changing the submitted value.
- The farmer enters a Harvest date earlier than the associated Season's actual sowing/planting date; reject it. A Harvest date equal to that Season date is valid.
- The farmer records Harvests in different supported units in one Season; each record retains its own unit and no quantity is automatically converted.
- A request times out or loses its response; retain enough submission context in the active online flow to retry the same logical Harvest without prompting the farmer to create a second one.
- The device is offline before server acceptance; do not queue a Harvest or present it as saved or accepted. The farmer may retry when connected.
- Multiple valid Harvests share a date or occur near a history page boundary; stable ordering and pagination do not duplicate or skip entries.
- The relevant Field or Season has no Harvests; show the existing clear empty-history state.
- A requested history is inaccessible or belongs to a different Business/Field; return a privacy-safe denial without exposing its existence or contents.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The product MUST allow an authenticated OWNER or WORKER with current authorization for a Field to create a Harvest. An ADVISOR MUST NOT create a Harvest. Before first acceptance or disclosure on an exact replay, the server MUST revalidate current Membership, role, Business, Field, and same-Business/same-Field Season access; client-supplied Business identity or UI role MUST NOT establish authorization. First acceptance additionally requires an ACTIVE Season. An already accepted exact replay is not a new acceptance and MUST NOT be invalidated by a later Season lifecycle change.
- **FR-002**: Each accepted Harvest MUST be associated with one Season that belongs to the same Field and authorized Business. The Season MUST be ACTIVE when the Harvest is recorded. Field-only Harvests and Harvests associated with DRAFT Seasons MUST NOT be accepted.
- **FR-003**: The product MUST support multiple distinct Harvest records associated with the same Season. A new Harvest MUST NOT replace, merge with, or silently update an earlier accepted Harvest.
- **FR-004**: The farmer MUST enter the calendar date on which the harvest occurred. The date MUST be date-only and MUST NOT shift because of device timezone or UTC conversion. A future date MUST NOT be accepted as a completed historical Harvest; “today” MUST be determined by the authorized Business-local calendar. The Harvest date MUST be on or after the ACTIVE Season's actual sowing/planting date; equality is valid. The product MUST NOT fabricate a time-of-day for the Harvest date.
- **FR-005**: Each Harvest MUST have a positive quantity with no more than three decimal places and a required unit selected per record from the controlled set of kilograms and metric tonnes. Different Harvest records in one Season MAY use different units. The product MUST preserve each quantity with its selected unit and MUST NOT automatically convert, silently round, or reinterpret it. Quantities with more than three decimal places MUST be rejected.
- **FR-006**: The server MUST be authoritative for Harvest acceptance and persist accepted Harvests as canonical historical facts. The product MUST NOT show a Harvest as accepted before receiving server confirmation.
- **FR-007**: Accepted Harvest facts MUST retain the values and Field/Season associations accepted at creation, including after later changes to current Field or Season details. This feature MUST NOT edit, delete, void, or silently rewrite an accepted Harvest. A correction workflow is outside this feature.
- **FR-008**: The system MUST retain sufficient actor and server acceptance/audit context to establish who recorded an accepted Harvest and when it was accepted, separately from the farmer-entered harvest date.
- **FR-009**: One logical Harvest submission MUST NOT create duplicate canonical facts. An exact retry by the same authenticated actor, with the same stable logical identity, unchanged content, and currently authorized context MUST resolve to the original accepted result. Reusing that identity with changed content, actor, Field, or Season context MUST NOT mutate the accepted fact and MUST produce a clear conflict/non-success outcome.
- **FR-010**: Accepted Harvests MUST be represented as their own distinct event type in the existing Field/Season Diary. They MUST be sourced from canonical Harvest records, retain their own identity, and MUST NOT be represented as observations, irrigation, or expenses. The feature MUST NOT create a competing history contract.
- **FR-011**: Harvest history MUST follow the current role access for ordinary authorized Diary entries, with no role difference between Field and Season-filtered reads. It MUST respect current authorization and Field/Season filters, preserve deterministic ordering and keyset pagination, and MUST NOT repeat or permanently skip records that existed before traversal began. Pagination is not snapshot-isolated: a record inserted during traversal that sorts before the consumed cursor is not injected into that traversal and appears after a fresh traversal/refresh; a record inserted after the cursor may appear on a subsequent page. The addition MUST preserve supported existing Diary reader, filter, and pagination behavior.
- **FR-012**: Harvest capture and read MUST be usable on mobile. When the remaining active-Season Diary create context is eligible, OWNER and WORKER MAY see `Hasat ekle`; ADVISOR MUST NOT see this CTA. The capture entry point MUST be available from the active Season's Diary with the Field and Season context fixed for the form. Mobile MUST use only the server-resolved `viewerRole` from the authorized Diary response for this CTA and MUST fail closed when that signal is absent or unavailable. Mobile MUST NOT infer role from auth-provider or app metadata. This UI signal is only a CTA gate; create authorization remains server-side. After server-confirmed success, the farmer MUST return to that Diary and receive clear success feedback. The experience MUST provide understandable loading, empty, validation, success, connectivity, authorization, conflict, and server-error states, with accessible labels, usable touch targets, and scalable text.
- **FR-013**: Harvest creation MUST be online and server-authoritative in this feature. When disconnected or before server acceptance, the product MUST NOT queue a Harvest, claim it was saved, or present it as accepted. This feature MUST NOT add generic offline synchronization or offline Harvest capture.
- **FR-014**: The product MUST NOT require a note to record a Harvest. No note field is included because the current PRD does not establish one as required for the minimum Harvest fact.
- **FR-015**: The feature MUST NOT add sales, revenue, sale price, buyers/customers, harvest-to-sale reconciliation, partial-sale accounting, unsold balances, profitability, margin calculations, expense allocation, automatic valuation, storage/warehouse inventory, post-harvest disposition, lot/batch traceability, quality/grading, accounting/bookkeeping, invoices, VAT, receivables, AI entry, equipment workflows, or generalized analytics/dashboard work.
- **FR-016**: The existing authorized Diary read response MUST expose the current authorized Membership role as additive `viewerRole` metadata, derived server-side from `MembershipScopeService` and using the existing `OWNER`, `WORKER`, and `ADVISOR` role values. This metadata MUST NOT change ordinary Diary record visibility, become part of any Harvest canonical record or Diary item, alter V1/V2 ordering or cursor semantics, expose auth-provider metadata, or introduce new RBAC/capability infrastructure.

### Key Entities *(include if feature involves data)*

- **Harvest**: A canonical historical fact that a positive quantity of up to three decimal places, measured in kilograms or metric tonnes, was harvested on a farmer-entered calendar date on or after the actual sowing/planting date of its authorized same-Field, same-Business ACTIVE Season. Each record keeps its selected unit; no automatic conversion occurs. An accepted Harvest preserves its original content, associations, actor, and server acceptance/audit context.
- **Field**: The authorized farming area to which the Harvest belongs.
- **Season**: The farming period associated with the Field and required by each Harvest. It must belong to the same Business and Field and be ACTIVE when the Harvest is recorded.
- **Diary entry**: A presentation of the canonical Harvest fact in the existing Field/Season history; it is not a second Harvest record.
- **Diary response metadata**: `viewerRole` is the current authorized Membership role for the Diary reader. It is response-level UI context only, separate from Diary items and canonical Harvest data.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In every tested valid online create scenario, including quantities with up to three decimal places, the server accepts one Harvest and the farmer can find exactly one matching canonical history entry with the same Field, ACTIVE Season, date, quantity, and selected unit.
- **SC-002**: In every tested multiple-harvest scenario, all separately accepted Harvest records for the same Season remain separately identifiable and visible; none is replaced or merged.
- **SC-003**: Across tested uncertain-response and exact-retry scenarios, one logical submission produces exactly one accepted Harvest, and the farmer is not prompted to create a second logical record merely because the first response was uncertain.
- **SC-004**: In all tested unauthorized, revoked-access, ADVISOR-create, cross-Business, cross-Field, missing-Season, and non-ACTIVE-Season first-acceptance scenarios, no Harvest is created and no protected Field, Season, or Harvest existence/content is revealed; authorized ADVISOR Diary reads follow ordinary history visibility. An authorized exact replay remains available after a later Season lifecycle change.
- **SC-005**: In every tested offline create scenario, the product neither queues a Harvest nor reports it as saved or accepted before server confirmation.
- **SC-006**: In tested Field and Season history traversals, accepted Harvest events appear distinctly with stable keyset ordering, without repeating or permanently skipping records that existed before traversal began, while supported existing Diary behavior remains intact. Records inserted during traversal follow FR-011; no fixed-snapshot result is promised.
- **SC-007**: In all tested accepted-record scenarios, the original farmer-entered date, quantity, unit, Field/Season associations, and audit attribution remain unchanged after later current-context changes.
- **SC-008**: In all tested date-boundary scenarios, a Harvest date is date-only, uses the authorized Business-local date to reject future dates, and is accepted only when it is on or after the Season's actual sowing/planting date.
- **SC-009**: In all tested Diary create-entry scenarios, OWNER and WORKER with otherwise eligible active-Season context may see `Hasat ekle`, ADVISOR and clients without a server-resolved role signal do not; changing or revoking access before first create or replay is enforced by current server authorization regardless of the UI signal.

## Assumptions

- Existing sign-in, Field/Season identity, server-side membership authorization, and canonical Diary/history behavior are reused.
- OWNER and WORKER are the only roles permitted to create Harvests; ADVISOR remains read-only for this record type.
- A Harvest is a realized historical fact; its date is date-only and future dates are invalid relative to the authorized Business-local current date. No time-of-day is implied.
- A Harvest date cannot precede the associated Season's actual sowing/planting date; equality is valid.
- Each Harvest uses a farmer-selected kilogram or metric-tonne unit; different records in one Season may use different units, with no automatic conversion.
- V1 create/read requires connectivity and canonical server acceptance. Offline Harvest capture is a separate future feature.
- The PRD's optional harvest quality information is excluded because it is not required to establish the minimum Harvest fact. The PRD's post-harvest quantity statuses are explicitly excluded by the approved feature boundary.
- Accepted Harvest correction, editing, deletion, and voiding are not provided by this feature.

## Out of Scope

- Sales records, revenue, sale price, buyers/customers, harvest-to-sale reconciliation, and partial-sale or unsold-balance accounting.
- Profitability, margins, expense allocation, automatic valuation, and financial analytics.
- Storage/warehouse inventory, post-harvest disposition such as sold/stored/used/lost, and lot/batch traceability.
- Quality or grading workflows, accounting/bookkeeping, invoices, VAT, and receivables.
- Offline Harvest commands, offline Harvest capture, and generic offline synchronization.
- Notes, AI entry, equipment workflows, and generalized analytics/dashboard work.
