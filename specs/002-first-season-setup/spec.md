# Feature Specification: First Season Setup and Plan Approval

**Feature Branch**: `002-first-season-setup`

**Created**: 2026-09-28

**Status**: Draft

**Input**: User description: "Continue the approved first-time farmer journey immediately after the first field is created: select crop, enter sowing or planting date, create the first season, generate a season plan from the applicable template, let the farmer review and edit/remove/change task dates, activate the season, and transition toward Bugün."

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Set up a first season (Priority: P1)

After saving the first field, a farmer selects a crop and enters its sowing or planting date. The product creates a season for that field and prepares an initial plan from an applicable validated template when one exists. If no applicable validated template exists, the farmer can still use the crop and create a manual plan by adding tasks.

**Why this priority**: Crop and planting context turn the field into a usable seasonal plan and continue the approved first-use journey.

**Independent Test**: Starting from a SPEC-001 first field, complete crop and date entry and confirm that a proposed first season and plan are available for review without repeating field onboarding.

**Acceptance Scenarios**:

1. **Given** an authenticated farmer with a first field created by SPEC-001, **When** they select a supported crop and enter a sowing or planting date, **Then** the product prepares a proposed season for that field.
2. **Given** a season is being set up, **When** the farmer is asked for required information, **Then** crop, field, and sowing or planting date are sufficient; optional agronomic details do not block continuation.
3. **Given** a farmer selects a crop with an applicable validated template, **When** the proposed plan is generated, **Then** the plan is based on that template and its applicable regional context when available.
4. **Given** a farmer selects a crop without an applicable validated template, **When** they continue season setup, **Then** they can create a manual plan and the product clearly distinguishes it from a validated central-template plan.
5. **Given** an applicable published template contains no task definitions, **When** the farmer continues setup, **Then** the product explains that the validated plan is unavailable and offers an explicit manual-plan choice without automatically switching sources.
6. **Given** an actual sowing/planting date is today or in the past, **When** the farmer submits it, **Then** it is accepted as a local calendar date regardless of lookback; a future date is rejected.
7. **Given** a season already exists for the same authorized business, field, crop, and actual sowing/planting date, **When** a create request arrives with a different idempotency key, **Then** the existing season is returned unchanged rather than creating a second matching season.
8. **Given** season creation commits but its response is lost before the app durably records the season ID, **When** the app restarts and retries, **Then** it resubmits the persisted exact request with the original idempotency key and receives the same season ID.

---

### User Story 2 — Review and adjust the proposed plan (Priority: P1)

Before activating the season, a farmer reviews the generated tasks and can edit a task, remove a task, or change a task date. The product clearly distinguishes the proposed plan from an active season.

**Why this priority**: The farmer must retain control over proposed work before it becomes the active season plan.

**Independent Test**: Generate a proposal, edit one task, remove another, change a date, and verify the revised plan is what the farmer approves.

**Acceptance Scenarios**:

1. **Given** a generated template-based plan or a manual plan, **When** the farmer reviews it, **Then** its tasks and dates are visible before any season activation and its source is clearly identified.
2. **Given** a proposed or manual task, **When** the farmer adds, edits, or removes it or changes its date, **Then** the plan reflects that choice and preserves the other tasks.
3. **Given** a farmer has not approved the plan, **When** they leave or retry the review flow, **Then** the plan is not represented as an active season.
4. **Given** a task date is earlier than the season's actual sowing/planting date, **When** the farmer saves it, **Then** the date is rejected; equality is valid, and task dates need not be ordered relative to one another.

---

### User Story 3 — Activate the season and continue to Bugün (Priority: P1)

After reviewing the plan, a farmer approves it to activate the season. On success, the product confirms activation and takes the farmer toward Bugün, where planned work can be seen.

**Why this priority**: Activation completes the first-season setup and connects planning to the product's daily starting point.

**Independent Test**: Approve a reviewed proposal and confirm the season is active, its planned tasks are available to Bugün, and the farmer is directed there without completing a task.

**Acceptance Scenarios**:

1. **Given** a valid reviewed proposal, **When** the farmer approves it, **Then** the season becomes active with the approved task plan.
2. **Given** activation succeeds, **When** the first-season flow completes, **Then** the farmer is transitioned toward Bugün and can see the season's planned task or a clear empty state if no task is due on the authorized business-local date.
3. **Given** activation fails, **When** the farmer returns to the flow, **Then** the season is not falsely shown as active and the proposal remains available for recovery or retry.
4. **Given** any plan has no tasks, **When** the farmer attempts activation, **Then** activation is prevented, the farmer is told that at least one valid planned task is required, and the draft remains available for editing.
5. **Given** any plan has at least one valid planned task, **When** the farmer approves it, **Then** activation may proceed without generating a placeholder task.
6. **Given** a season is ACTIVE, **When** a farmer attempts to add, edit, or remove a plan task through the SPEC-002 setup flow, **Then** the request is rejected with a clear state/conflict response and the mobile UI presents no draft-edit controls.
7. **Given** activation is retried or attempted concurrently, **When** the same key and command is replayed, **Then** the original success is returned; **When** the key is reused with a different payload/version, the draft version is stale, or a different-key request loses a race or targets an already ACTIVE season, **Then** the response is `409 Conflict` and the client re-reads the season.
9. **Given** the authorized business-local date changes at midnight, **When** Bugün is read, **Then** inclusion is evaluated against that business-local date across its fields, regardless of the device timezone.

### Edge Cases

- The field, crop, or template becomes unavailable or unauthorized before the farmer saves or activates the season.
- No applicable validated template exists for the selected crop or regional context.
- An applicable published validated template has zero task definitions; it is unavailable for plan generation, the farmer is told why, and may explicitly continue with a manual plan.
- Two activation requests race; exactly one may activate the season, while a different-key loser receives a conflict and re-reads the season.
- Any plan has no tasks when the farmer attempts to activate it; explain the requirement and retain the editable draft without inserting a placeholder task.
- The actual sowing/planting date is in the future; any past date and today are valid, with no maximum lookback period.
- The farmer attempts to set a planned task date before the season's actual sowing/planting date; that date is invalid. Task dates do not need chronological ordering relative to other tasks.
- A template is updated after proposal generation but before activation.
- Connectivity is lost during season creation, plan generation, or activation; the farmer must not see false success or lose a confirmed active season.
- A season-create request commits but its response is lost, or the app restarts before the returned season ID is durably recorded; retain and retry the unresolved request with its original idempotency key until the committed result is durably recorded.
- A season already exists for the field and requested crop cycle, or a repeated request arrives after a lost response.
- A user whose membership is revoked or whose default business context is invalid attempts to continue.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The product MUST continue from the first field created by SPEC-001 and MUST NOT require the farmer to repeat first-field onboarding.
- **FR-002**: The farmer MUST be able to select a crop and provide its sowing or planting date for the field.
- **FR-003**: The product MUST create a proposed season using the selected crop, field, and sowing or planting date as the minimum required inputs.
- **FR-004**: When an applicable validated crop template exists, the proposed plan MUST use that template and available applicable regional context.
- **FR-004a**: An applicable published validated template version with zero task definitions MUST be treated as unavailable for plan generation and diagnosed as a content-quality/integrity issue. The product MUST explain that the validated plan is unavailable and MUST allow the farmer to explicitly choose a manual plan. It MUST NOT create an empty `VALIDATED_TEMPLATE` plan, automatically convert the flow to `MANUAL`, or insert placeholder tasks. If the farmer explicitly chooses `MANUAL`, the manual source distinction and task/activation rules apply.
- **FR-005**: When no applicable validated template exists, including when its published task definitions are empty, the farmer MUST still be able to use the crop and create a season plan by explicitly choosing a manual plan and adding tasks manually.
- **FR-006**: The product MUST clearly distinguish manual plans from validated central-template plans and MUST NOT label manual plans or unsupported crops expert-approved or centrally validated.
- **FR-007**: Before activation, the farmer MUST be able to review the plan and add, edit, or remove tasks and set or change their planned dates.
- **FR-008**: The product MUST NOT activate a season or present its proposal as active before the farmer explicitly approves the reviewed plan.
- **FR-009**: A `MANUAL` or `VALIDATED_TEMPLATE` plan with zero tasks MUST NOT be activated. The product MUST explain that at least one valid planned task is required, preserve the editable draft, and MUST NOT insert a placeholder/default task. A plan with at least one valid planned task may be activated after farmer approval.
- **FR-010**: Activation MUST persist the season context needed to preserve the selected field/crop/template versions and the approved initial task plan; a manual plan MUST remain distinguishable from a validated template plan.
- **FR-011**: After successful activation, the product MUST transition the farmer toward Bugün and make planned work available there, including an understandable empty state when nothing is due today.
- **FR-012**: Season and plan operations MUST be authorized using the authenticated user's active membership and server-resolved business context; client-supplied business identifiers MUST NOT grant access.
- **FR-013**: The product MUST prevent access to or mutation of another business's field, crop/season records, or plans and MUST return privacy-safe authorization failures.
- **FR-014**: Farmer-entered sowing/planting dates and planned task dates MUST preserve local calendar-date meaning.
- **FR-015**: Repeated or retried season creation and activation requests MUST NOT create duplicate seasons or task plans after uncertain responses. Within the authorized business and field context, a create request matching an existing season's crop and sowing/planting date MUST return that existing season without changing it; a different idempotency key MUST NOT create a second matching season. Same-key idempotency semantics remain in force. This identity rule is limited to SPEC-002 actual-date seasons and does not define pre-sowing or multi-cycle behavior.
- **FR-016**: Season creation, plan generation, and activation failures MUST communicate whether the change was saved and provide a safe recovery or retry path.
- **FR-017**: The flow MUST be usable on mobile without requiring a desktop workflow; no later clarification may add Android build, emulator, map SDK configuration, or device-runtime work to this specification.
- **FR-018**: The sowing/planting date MUST represent when planting actually occurred. Today and any past local calendar date MUST be accepted without an arbitrary lookback limit; future dates MUST be rejected. Future/planned sowing belongs to deferred pre-sowing planning and is out of scope.
- **FR-019**: A planned task date MUST be on or after the season's actual sowing/planting date, with equality allowed. Task dates need not be entered or stored in chronological order relative to each other; any chronological display order is presentation behavior. Preserve planned dates as local calendar dates. Pre-sowing preparation tasks are out of scope.
- **FR-020**: Bugün MUST determine the current local date using the authorized business's timezone and include planned tasks for that business whose planned local date matches that business-local date. Device/app timezone and server UTC MUST NOT change the product date boundary. All fields/seasons in the authorized business use the same business timezone in this feature; do not introduce per-field timezone behavior. If the business timezone is not explicitly configured, use the configured deployment fallback for this slice (`Europe/Istanbul` for the current Türkiye-first product).
- **FR-021**: Before submitting a season-create request, the client MUST persist the unresolved create command and its idempotency key. If the response is lost or the app restarts before the season ID is durably recorded, the client MUST retry the exact same request with the same key; the server MUST replay the original committed result with the same season ID. The client MUST clear the unresolved command only after durably recording the successful result. Do not add a dedicated recovery endpoint, generate a new key for recovery of that command, or generalize this requirement into an offline mutation queue/sync feature. The approved logical-season identity remains a server-side duplicate-creation safeguard.
- **FR-022**: Season plan-task add/edit/remove operations MUST be allowed only while the season is DRAFT. After activation, the approved plan and context snapshot are preserved and read-only through SPEC-002; these mutation requests MUST be rejected with a clear state/conflict response, and the mobile UI MUST NOT present draft-edit controls for an ACTIVE season. Post-activation rescheduling and all other active-season management behavior are out of scope for this feature.
- **FR-023**: Activation MUST be a one-time `DRAFT` to `ACTIVE` transition. The same idempotency key with the same activation command MUST replay the original successful result; reuse with a different payload/version MUST return `409 Conflict`. A stale draft version while the season remains DRAFT MUST return `409 Conflict`. Under concurrent activation attempts, exactly one request may perform the transition; a different-key losing request MUST return `409 Conflict`. A different-key activation request against an already ACTIVE season MUST also return `409 Conflict`, not successful replay. After a 409, the client MUST re-read the season to learn its authoritative state. No activation conflict may mutate an ACTIVE season.

### Scope Boundary

This feature ends after first-season activation and transition toward Bugün. Manual plan authoring is limited to adding, editing, removing, and dating tasks; it does not add plan reuse UI, advanced recurrence, task completion or general task execution, diary/history, weather-driven rescheduling, satellite/NDVI, advisors, costs, harvest/sales, AI, or an offline synchronization engine. It uses the authenticated field/business context established by SPEC-001 and does not redo sign-in or first-field creation. The exact pilot crop list remains content/release configuration because the PRD identifies candidate crops but allows the final set to change. This journey records an actual sowing/planting date; pre-sowing seasons and later conversion to an actual date are deferred because the PRD makes that capability optional.

### Key Entities *(include if feature involves data)*

- **Crop**: A centrally maintained or farmer-entered crop choice used to describe what is grown in a field.
- **Season**: A crop cycle for a field, with sowing/planting date, lifecycle status, and preserved initial context.
- **Season plan**: A proposed collection of planned tasks generated from a validated template or assembled manually by the farmer, and reviewed before activation. Its source is retained and clearly shown.
- **Plan task**: A proposed farming action with editable details and a planned local date.
- **Crop template version**: A validated, immutable set of planning guidance applicable to a crop and, when available, a region. Manual plans do not reference or imply a validated template.
- **Season context snapshot**: The relevant field, crop, region, and template versions retained when the season is activated.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A farmer who has completed SPEC-001 can reach a proposed first-season plan using only a crop choice and sowing/planting date, without repeating account or field setup.
- **SC-002**: Every proposed season plan can be reviewed and adjusted before activation; no unapproved plan is shown as active.
- **SC-003**: After successful approval, the season's planned tasks are available from Bugün and the farmer receives a clear transition to that surface.
- **SC-004**: All cross-business season and plan access attempts are denied without revealing whether another business's records exist.
- **SC-005**: A retry after a lost response results in one season activation and one corresponding approved plan.

## Assumptions

- SPEC-001 provides an authenticated farmer, authorized default business membership, and a persisted first field; this feature consumes those records.
- The feature uses centrally published immutable crop/template versions where applicable. Production agronomic content is not fabricated by this feature.
- Farmer-visible labels and explanatory content use plain farmer language and identify uncertainty or lack of validation.
- Local calendar dates are used for planting and planned task dates.
- Weather and actual growth stage are not required inputs for this initial first-season proposal.
- When no validated template applies, a farmer-created manual plan is supported; reusable personal/business plan behavior may exist in the domain model as required by the PRD, but this feature does not add plan reuse UI.
- This flow captures an actual sowing/planting date; pre-sowing planning is optional in the PRD and is deferred.
- The exact pilot crop list is selected through the approved crop content/release process; the PRD's candidate list is not frozen by this specification.

## Clarifications

### Session 2026-09-28

- Q: When a farmer chooses a crop with no applicable validated template, should SPEC-002 let them create a plan by adding tasks manually, or should it explain that planning for that crop is not available yet? → A: Allow the farmer to use the unsupported crop and create a manual season plan by adding tasks. Keep manual authoring limited to adding, editing, removing, and setting/changing planned dates. Clearly separate manual plans from validated central templates; never label them expert-approved or centrally validated. Do not add advanced recurrence, weather rules, AI, automation, full task execution, or plan-reuse UI.
- Q: Should a manual plan need at least one task before the farmer can activate the season? → A: A manual plan with zero tasks cannot be activated. Explain that at least one task is required, preserve the editable draft, and do not add a placeholder/default task. After at least one valid planned task exists, activation may proceed normally.
- Q: May a farmer activate a `VALIDATED_TEMPLATE` plan after removing every task? → A: Apply the same minimum-task activation invariant to `MANUAL` and `VALIDATED_TEMPLATE` plans: zero-task plans remain DRAFT; activation is blocked with a clear explanation; the draft remains editable; and no placeholder/default task is created automatically.
- Q: If a create request uses a different idempotency key but matches an existing season's field, crop, and sowing/planting date, what should happen? → A: Treat the same field + crop + sowing/planting date as the same logical season for SPEC-002. A second create request with a different idempotency key must not create another matching season; return the existing season unchanged unless an explicitly supported update operation is used. Enforce this server-side and under concurrency, within the authorized business/field context, in addition to normal idempotency-key semantics. Do not generalize this rule to unsupported multi-cycle/pre-sowing behavior.
- Q: May the farmer enter a past date as the actual sowing/planting date for this season? → A: The actual sowing/planting date may be today or any past date and represents when planting actually occurred. Future dates are invalid for SPEC-002. Do not impose an arbitrary maximum lookback period. Future/planned sowing remains deferred to pre-sowing planning. Preserve the value as a local calendar date without reinterpretation through server UTC.
- Q: What date rules should apply to planned tasks in SPEC-002? → A: Planned tasks must be dated on or after the season's actual sowing/planting date; equality is allowed. Task dates do not need chronological ordering relative to each other. The UI may sort tasks by date as presentation behavior. Do not introduce pre-sowing preparation tasks. Preserve local calendar dates without server-UTC reinterpretation.
- Q: Which timezone and scope should determine “today” for the SPEC-002 Bugün task list? → A: Use the authorized business timezone as the canonical definition of “today” for all fields/seasons in that business. Device/app timezone must not change task inclusion, server UTC is not the boundary, and around midnight inclusion uses the business-local date. If not explicitly configured, use the configured fallback for this slice (`Europe/Istanbul` for the Türkiye-first product); do not introduce per-field timezone behavior.
- Q: After a create succeeds but its response is lost, how should the app recover the season ID if the farmer restarts the app? → A: Persist the unresolved create command and its idempotency key before/while submitting. If the response is lost or the app restarts before durably recording the season ID, retry the exact request with the same key; the server replays the original committed result and same ID. Clear the unresolved command only after durable success recording. Do not add a recovery endpoint, generate a new key for recovery, or make this a general offline queue/sync feature. Retain the logical-season identity safeguard.
- Q: After a season is activated, may the farmer edit, add, or remove its plan tasks through the SPEC-002 setup flow? → A: Reject add/edit/remove plan-task mutations after activation. Plan-task authoring is allowed only in DRAFT. The active plan is read-only through SPEC-002; return a clear state/conflict response and show no draft-edit controls. Preserve the approved plan/context snapshot. Do not add post-activation rescheduling, task execution/completion, recurrence, weather-driven changes, or later season management; any future active-plan modification is a separate feature.
- Q: If activation is retried or attempted concurrently with a different idempotency key, what response should the API return? → A: Use strict replay/concurrency semantics. Same key + same activation command replays original success; same key + different payload/version returns 409. A stale draft version while still DRAFT returns 409. Exactly one concurrent request may transition DRAFT to ACTIVE; a different-key loser returns 409. A different-key request against ACTIVE also returns 409. Do not treat distinct commands as successful replay or mutate ACTIVE state. After 409, the client re-reads the season.
- Q: How should SPEC-002 handle an applicable published VALIDATED_TEMPLATE version that contains no task definitions? → A: Treat it as unavailable for plan generation and as a content-quality/integrity issue for diagnostics/operations. Explain that the validated plan is unavailable and offer an explicit MANUAL plan choice. Do not create a zero-task VALIDATED_TEMPLATE plan or automatically convert the flow. If chosen, MANUAL follows its existing add/edit/remove/date and minimum-task activation rules, remains distinctly labeled, and receives no placeholder task.
