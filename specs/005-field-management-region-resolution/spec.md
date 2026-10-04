# Feature Specification: Field Management and Region Resolution

**Feature Branch**: `005-field-management-region-resolution`

**Created**: 2026-10-02

**Status**: Draft

**Input**: User description: "SPEC-005 — Field Management and Region Resolution. Add the farmer-facing Tarlalar surface for authorized Field listing and detail, additional Field creation using the existing current-location / map-point / Polygon model, Field editing for name/location/representative point/Polygon boundary/agricultural-region override, automatic administrative-location and agricultural-region suggestions with explicit unresolved state and manual override precedence, boundary versioning and historical SeasonContextSnapshot integrity, weather fingerprint semantics, and a small read-only ACTIVE season summary. Preserve SPEC-001..004. Exclude delete/archive, FieldSection, other farm attributes, verification workflow, satellite/NDVI, calendar, plan/task changes, notifications, generic offline sync and offline Field mutations, search/filter, bulk, team/advisor, finance, harvest/sales, and AI."

## Clarifications

### Session 2026-10-02

- Q: What geographic coverage should farmers expect for automatic administrative-location and agricultural-region suggestions? → A: The intended coverage is all of Türkiye; locations without a valid result remain unresolved. Exact provider and dataset selection is a planning/research decision.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Find and inspect my fields (Priority: P1)

As a farmer, I can open **Tarlalar**, see the fields in my authorized Business, and open a field to understand its current location, boundary and region state.

**Why this priority**: Farmers need a real place to manage and identify all of their fields after first-field onboarding.

**Independent Test**: With multiple fields and memberships in multiple Businesses, verify the list and details show all and only authorized fields and that each detail identifies current unresolved or suggested region values accurately.

**Acceptance Scenarios**:

1. **Given** an authenticated farmer with authorized fields, **When** they open Tarlalar, **Then** the system shows those fields ordered by name ascending and then ID ascending, using pages of 50 by default and no more than 100 per page.
2. **Given** more fields than fit on one page, **When** the farmer continues the list, **Then** the next page continues after the last item without duplicates or omissions while field names remain unchanged.
3. **Given** a field in the farmer's authorized Business, **When** they open its detail, **Then** they see the current editable field information and any active-season summary is read-only.
4. **Given** a field in another Business, **When** the farmer requests its list or detail, **Then** the system denies access with a privacy-safe outcome that does not disclose the field's existence.

### User Story 2 - Add another field (Priority: P1)

As a farmer, I can add another field with the same simple location choices used for my first field, without first configuring advanced farm details.

**Why this priority**: Multiple-field farms need to grow beyond the one-field onboarding path.

**Independent Test**: Create a point-only field and a polygon field using each supported location path; verify default naming, persistence, authorization, and recoverable save failures.

**Acceptance Scenarios**:

1. **Given** an authorized farmer, **When** they add a field using current location or a map point, **Then** the field is saved with that location as its representative point and no fabricated boundary.
2. **Given** an authorized farmer submits a valid Polygon, **When** the field is saved, **Then** the system stores a representative point and a new versioned boundary that remains unverified unless an actual verification process has occurred.
3. **Given** the farmer omits the name or submits only whitespace, **When** the field is saved, **Then** the server assigns the first available default label `Tarla N` in that Business; concurrent creations cannot receive the same generated default label.
4. **Given** the farmer enters a nonblank name already used by another field, **When** the field is saved, **Then** the trimmed farmer-entered name is accepted without requiring uniqueness.
5. **Given** location permission is denied or unavailable, **When** the farmer adds a field, **Then** map-point selection or Polygon drawing remains available.
6. **Given** invalid location geometry or a save failure, **When** the farmer submits the form, **Then** the system explains the failure in farmer-facing language and does not report an unsaved field as created.
7. **Given** a create request is retried with the same `Idempotency-Key` and identical payload after a lost response, **When** the retry is received, **Then** it returns the original accepted result without creating another Field or allocating another default name; reusing the key with a different payload conflicts.

### User Story 3 - Correct current field information (Priority: P1)

As a farmer, I can update a field's name, location, boundary, or manual agricultural-region choice while keeping earlier season context intact.

**Why this priority**: Field information can be corrected as the farmer learns more, while completed seasonal history must stay trustworthy.

**Independent Test**: Edit each permitted current field value on a field with an active season and historical snapshot; verify current values update, boundary history is retained, and the snapshot is unchanged.

**Acceptance Scenarios**:

1. **Given** an authorized farmer edits a field, **When** they change its name, location/representative point, Polygon boundary, or manual agricultural-region override, **Then** only those supported current Field values are changed.
2. **Given** a farmer replaces or changes a Polygon boundary, **When** the edit is saved, **Then** the prior boundary version remains available and the new geometry is recorded as a new current version.
3. **Given** a field has a SeasonContextSnapshot, **When** its current location, boundary, or region changes, **Then** the historical snapshot and its boundary/region context remain unchanged.
4. **Given** a field's representative point changes, **When** its existing weather is read, **Then** weather tied to the prior location is unavailable until a valid refresh is accepted for the new point, following SPEC-004 fingerprint semantics.

### User Story 4 - Understand location and agricultural region (Priority: P2)

As a farmer, I can distinguish where a field is administratively located from the agricultural region used for farming context, review available suggestions, and keep my own region choice.

**Why this priority**: These values serve different purposes and must not be conflated or silently changed.

**Independent Test**: Exercise available, missing, failed and changed-location resolution; verify separate values and explicit unresolved status, plus override precedence.

**Acceptance Scenarios**:

1. **Given** the field location can be resolved, **When** location suggestions are available, **Then** administrative location and agricultural region are shown as distinct suggestions.
2. **Given** no valid suggestion can be produced or the resolver is unavailable, **When** the field is created or edited, **Then** the valid Field save succeeds and the unresolved state is explicit.
3. **Given** a farmer sets an agricultural-region override, **When** suggestions are refreshed or the field location later changes, **Then** the override remains in effect and is never silently overwritten.
4. **Given** a farmer explicitly changes or clears the manual override, **When** the edit is saved, **Then** the new explicit choice is reflected in current field state and the resolution state remains understandable.

### Edge Cases

- A farmer has no fields, exactly one field, or enough fields to require multiple cursor pages.
- Two authorized farmers concurrently create unnamed fields in the same Business; generated labels remain distinct and use the first available `Tarla N` label.
- A user-entered name matches a generated label; user-entered names need not be unique, while generated labels must be available at creation time.
- Current-location access is denied, times out, or returns invalid coordinates; alternate location methods remain available.
- Polygon geometry is empty, malformed, outside coordinate bounds, or invalid under existing field-location rules; no boundary is persisted as accepted.
- Administrative location resolves while agricultural region does not, or vice versa; each has its own explicit state.
- A resolver or its data is unavailable during creation or editing; Field persistence continues and the result remains unresolved.
- A manual agricultural-region override exists when location or boundary changes; the override continues to take precedence.
- A field has an ACTIVE season and a later field edit occurs; its read-only season summary may reflect the active Season, but the historical snapshot is unchanged.
- A field name changes between list pages; cursor continuation remains deterministic and the farmer can restart the list to see the new order.
- Membership is revoked between list and detail requests; the later request is denied.
- Network loss prevents a Field mutation from being accepted; the interface provides a retryable outcome and never reports false success. Offline Field mutation and a generic sync queue are not included.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The product MUST provide a farmer-facing **Tarlalar** surface with authorized Field listing and Field detail.
- **FR-002**: Every list, detail and mutation MUST authenticate the farmer, resolve current Business membership and permitted scope on the server, and operate only within that authorized Business. A client-supplied Business identifier MUST NOT establish authorization.
- **FR-003**: The generic Field list MUST sort by name ascending and ID ascending and use cursor pagination with a default page size of 50 and maximum of 100. Search and filters are outside this feature.
- **FR-004**: The product MUST support creation of additional Fields using current location, map-point selection, or manually drawn Polygon, preserving the existing Point/Polygon location model and representative-point semantics.
- **FR-005**: On Field creation, the name MUST be optional. When omitted or blank/whitespace-only after trimming, the server MUST assign the first available default label `Tarla N` within the authorized Business. Generated default labels MUST be allocated safely under concurrent creation. A nonblank farmer-entered name MUST be trimmed and MUST NOT be required to be unique.
- **FR-006**: Current Field edits MUST be limited to name, location/representative point, Polygon boundary, and agricultural-region manual override, and MUST use `Field.version` through a required `If-Match` precondition. For name updates, an omitted `name` MUST leave the existing name unchanged; an explicitly supplied blank/whitespace-only name MUST be rejected; a supplied nonblank name MUST be trimmed. An ordinary edit MUST NOT allocate a new `Tarla N`; no reset-to-default-name action is included. This feature MUST NOT add Field deletion or archive behavior.
- **FR-007**: A submitted Polygon MUST be retained as a versioned boundary and MUST remain unverified unless a real verification process has occurred. Updating a boundary MUST create a new current version without erasing earlier versions. During migration, every existing Field with boundary history MUST receive a current-boundary pointer to the same version the pre-SPEC-005 implementation treated as current; preserve that implementation's version-descending, ID-ascending selection rule. Existing Fields with no boundary history MUST retain a null pointer. Migration MUST NOT create a Polygon or remove or rewrite historical boundary versions.
- **FR-008**: Every Field MUST retain the representative point semantics already established by SPEC-001. For Polygon locations, derive/use the existing server-owned representative point behavior; do not fabricate a boundary for point-only Fields.
- **FR-009**: Administrative location and agricultural region MUST be represented and presented as distinct values. The intended geographic coverage for automatic suggestions of both values is all of Türkiye. When a valid suggestion is available, it MUST retain its source, confidence/quality, source-data version, and server `resolvedAt` timestamp for when the result was obtained and accepted; `resolvedAt` is not the source dataset publication date. Suggestions MUST be distinguishable from a farmer's explicit agricultural-region override.
- **FR-010**: Failure, missing coverage, or unavailable data during automatic resolution MUST NOT prevent otherwise valid Field creation or editing. For any location without a valid suggestion, the corresponding value MUST remain explicitly unresolved rather than being guessed or presented as confirmed.
- **FR-011**: An explicit farmer agricultural-region override MUST take precedence over automatic suggestions and MUST NOT be silently replaced after a later Field location/boundary change or a later automatic resolution.
- **FR-012**: Field detail MAY include a small read-only summary of the Field's ACTIVE season. It MUST NOT expose season create, edit, activate, close, or other mutation behavior.
- **FR-013**: Current Field edits or later region resolution MUST NOT rewrite, delete, or silently rebind any existing historical SeasonContextSnapshot, including its boundary and region context. On every future Season activation after SPEC-005 is active, the server MUST snapshot the Field's exact `currentBoundaryVersionId` when non-null, and MUST snapshot the current administrative and agricultural region context, including each resolved suggestion's source, confidence/quality, `dataVersion`, and `resolvedAt`, plus the explicit agricultural override state when present. If the current region-context pointer is null, activation MUST snapshot both domains as explicitly `UNRESOLVED` with no override. Activation MUST NOT fall back to selecting a boundary by version ordering. These changes apply only to future activations; existing snapshots remain unchanged.
- **FR-014**: When the current Field representative point changes, weather freshness and visibility MUST continue to follow SPEC-004's location fingerprint semantics. Weather associated with the prior representative point MUST NOT be presented as current for the new point.
- **FR-015**: List and detail MUST provide understandable loading, empty, access-denied, and retryable failure states. Invalid submitted geometry MUST produce a correctable farmer-facing outcome.
- **FR-016**: Field creation and editing MUST NOT report success until the server has accepted the mutation. This feature adds no generic offline synchronization or offline Field mutations.
- **FR-017**: Field and region reads/writes MUST provide useful correlated, privacy-conscious failure diagnostics consistent with existing repository patterns. Logs MUST exclude credentials, access tokens, unnecessary personal data, and raw location details not needed to diagnose the failure.
- **FR-018**: Automated coverage MUST verify authorized list/detail/create/edit behavior, cross-Business isolation, default label concurrency, pagination order and bounds, point and Polygon validation, boundary version retention, unresolved resolution, override precedence, historical snapshot immutability, and SPEC-004 weather location behavior.
- **FR-019**: This feature MUST NOT add FieldSection, area, soil, irrigation, equipment, geometry verification workflow, satellite/NDVI, Calendar, task or plan mutations, notifications, generic offline sync, additional-Field offline mutations, search/filter, bulk management, team/advisor, finance, harvest/sales, or AI behavior.
- **FR-020**: Every additional-Field create command MUST require `Idempotency-Key` and persist its canonical result durably using authenticated user, server-resolved Business, command, and key context. A retry with the same key and normalized payload/context MUST return the original result; reuse of that key with a changed payload or authenticated/Business/command context MUST conflict; concurrent same-context requests MUST converge on one Field and one result. A key MUST NOT replay a result across contexts. Field create MUST use the generalized business-command idempotency storage adapted from the Season command store, not the onboarding store whose `(userId, key)` uniqueness and required `fieldId` do not fit. This is separate from Field update concurrency, which uses `Field.version` / `If-Match`.
- **FR-021**: If a Field edit receives the stale-version conflict defined by the current OpenAPI contract, the mobile client MUST NOT overwrite or silently retry. It MUST fetch and display the latest canonical Field state while preserving the farmer's attempted values in the current edit session, explain the conflict, and require an explicit farmer action before another mutation. No automatic merge or rebase of concurrent name, location, boundary, or region changes is allowed; the server remains authoritative.
- **FR-022**: If current region context is absent, the Field MUST remain valid and its Field detail region context MUST be presented as explicitly `UNRESOLVED`; listing, detail, edits, and all normal Field behavior MUST continue. The generic Field list does not require region state. The server application boundary MUST support a bounded, idempotent resolution operation for one existing Field using its current representative point and current location key. Resolution MUST record the same provenance and preserve manual-override precedence. A farmer override MUST never be replaced. With no qualified source, the operation leaves the Field `UNRESOLVED`. Database/schema migrations MUST NOT call resolvers, infer or bulk-write guessed regions, or require an external-data backfill. This feature adds no recurring scheduler, cadence, or guaranteed whole-database backfill.

### Permissions and Business Boundary

- A farmer can list, inspect, create and edit Fields only within a Business for which current membership and scope authorize the operation.
- Field detail and mutation failures for inaccessible records must not reveal whether a Field exists in another Business.
- Authorization is rechecked for each request; a stale list result does not grant later access.

### Historical Integrity

- The Field detail represents current editable state.
- Boundary changes append a version; they do not rewrite prior boundary versions.
- SeasonContextSnapshot represents historical activation context and is immutable through current Field management.
- Weather is derived context and becomes unavailable for the old point according to SPEC-004 after representative-point change.

### Mobile and Connectivity Expectations

- Tarlalar, Field detail, creation and editing are usable on mobile with accessible labels, scalable text, sufficient contrast and touch-usable controls.
- Tarlalar is reachable from the production mobile navigation at the approved target position: `Bugün | Takvim | Tarlalar | + | Daha Fazla`. The Tarlalar entry opens the authorized Field list, list items open Field detail, and add-field starts from Tarlalar. This does not add Calendar behavior or repurpose unrelated routes.
- Visible loading, result, error, conflict, and unresolved text remains available while the farmer is on the screen. For meaningful asynchronous transitions not conveyed by focus movement, provide a screen/form-level accessible announcement path. This includes save success, save failure/conflict, and asynchronous region-resolution result/unavailable transitions. Announce each meaningful transition once; deduplicate by transition identity so repeated renders, polling-like updates, and child components cannot create announcement storms. Reuse repository accessibility conventions (React Native `accessibilityRole` / `accessibilityLiveRegion` and web semantic live regions where applicable). Meaning MUST NOT depend on color alone.
- On a stale-version Field edit conflict, keep attempted values in the active edit-session state, load the latest canonical Field, and expose both the conflict and canonical values. Do not retry, overwrite, merge, or rebase automatically. The farmer must explicitly choose what to do before another mutation is sent.
- Location permission is optional; map-point and Polygon options remain available if it is denied.
- Field writes require a successful server outcome before showing success. Offline Field mutation, additional-Field offline drafts, durable outbox and generic synchronization are outside this feature.

### Key Entities *(include if feature involves data)*

- **Field**: A Business-owned farm location with optional display name, current representative point, current region context, and zero or more retained boundary versions.
- **Legacy Field region state**: A Field created before region-context persistence may have no current region-context pointer. It remains valid; reads expose administrative and agricultural results as `UNRESOLVED` with no override until a qualified resolution is accepted. No guessed values are implied.
- **FieldBoundaryVersion**: An immutable historical Polygon boundary version, with its verification status and creation order.
- **AdministrativeLocationSuggestion**: A suggested administrative place associated with the current Field location, distinct from agricultural region and explicitly unresolved when unavailable; an available suggestion retains its source, confidence/quality, source-data version, and server `resolvedAt` timestamp for when the result was obtained and accepted (not the dataset publication date).
- **AgriculturalRegionContext**: The current suggested agricultural region plus its source, confidence/quality, source-data version, and server `resolvedAt` timestamp for when the result was obtained and accepted (not the dataset publication date), an optional explicit farmer override, and a state that distinguishes resolved, overridden and unresolved outcomes.
- **SeasonContextSnapshot**: Immutable context captured for an activated Season, including the exact current boundary pointer, independent administrative/agricultural region states and suggestions with source, confidence/quality, `dataVersion`, and `resolvedAt`, plus agricultural override value/state when present; later Field changes do not alter it.
- **ActiveSeasonSummary**: A read-only projection of the Field's ACTIVE Season for display in Field detail.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In authorization tests, 100% of cross-Business Field list, detail, create and edit attempts are denied without revealing whether the target Field exists.
- **SC-002**: A farmer can list and open every authorized Field across one or more pages, with no duplicate or missing entries and the specified stable name/ID order.
- **SC-003**: In creation tests, omitted and whitespace-only names always receive the first available `Tarla N` label, while repeated nonblank display names are accepted.
- **SC-004**: In every tested resolver outage or missing-data case, valid Field creation/editing succeeds and unavailable administrative or agricultural-region values are explicitly unresolved.
- **SC-005**: In every tested manual-override case, automatic refresh and Field location changes leave the farmer's explicit agricultural-region override unchanged unless the farmer explicitly edits or clears it.
- **SC-006**: In every tested current Field edit after season activation, stored SeasonContextSnapshot values and prior boundary versions remain unchanged.
- **SC-007**: After a representative-point edit, 100% of weather reads tied to the prior location are unavailable until valid data for the new location is accepted, according to SPEC-004.
- **SC-008**: Farmers can complete supported Field listing, detail, creation and editing on mobile without using the web application, with an accessible outcome for each loading, empty, denied and retryable-error state.
- **SC-009**: On stale-version conflicts, the client sends no further mutation until explicit farmer action, displays the latest canonical Field alongside preserved attempted values, and does not silently discard or automatically rebase the attempted edit.
- **SC-010**: For every meaningful asynchronous save or region-resolution transition on the active screen, visible status text remains available and one deduplicated screen/form-level announcement is exposed where focus alone does not communicate the change.
- **SC-011**: Existing Fields without region context remain readable and editable as `UNRESOLVED`; migrations make no resolver calls or guessed region writes, and a bounded resolution operation preserves manual overrides and remains unresolved when no qualified source exists.
- **SC-012**: Migration verification confirms every existing Field with boundary history points to the exact row selected by the pre-SPEC-005 `version DESC, id ASC` rule, including tied versions; Fields without boundary history remain null, no legacy version numbers or rows are rewritten, and all existing snapshot references are preserved.
- **SC-013**: PostgreSQL integration coverage confirms each future Season activation snapshots the exact non-null current boundary pointer and current administrative/agricultural region context with provenance and override state, does not use a legacy version-order fallback, and leaves every pre-existing `SeasonContextSnapshot` unchanged.

## Assumptions

- SPEC-001's current location, map-point and Polygon model remains the source for creating a Field. Point-only Fields remain valid and a Polygon is not proof of verification.
- Existing server-side membership/scope behavior and server-authoritative Field ownership remain in force; no client-selected Business authority is introduced.
- The Field list is a generic management surface and does not inherit SPEC-004's weather-only projection or restrictions.
- The intended geographic coverage for automatic administrative-location and agricultural-region suggestions is all of Türkiye. No specific provider or dataset is selected by this product decision; exact selection and actual dataset coverage are for planning/research. Locations without valid resolution remain explicitly unresolved.
- A read-only ACTIVE season summary uses existing Season data and does not expand SPEC-002 season lifecycle behavior.
- Writable PostgreSQL integration fixtures, if needed during implementation, use exactly `ekim_hasat_test`.

## Out of Scope

- Field delete/archive; FieldSection; area, soil, irrigation, equipment; boundary verification workflow; satellite/NDVI.
- Calendar, season/plan/task mutation, notifications, generic offline sync, additional-Field offline mutation, search/filter, bulk Field management.
- Team/advisor features, finance, harvest/sales, AI.
- Any change to the accepted SPEC-001 onboarding contract, SPEC-002 Season setup and SeasonContextSnapshot contract, SPEC-003 task completion/history contract, or SPEC-004 weather fingerprint/freshness contract.
- ADR-012 remains deferred; this feature does not select or enable a live weather provider.
