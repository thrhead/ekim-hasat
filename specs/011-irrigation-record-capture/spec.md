# Feature Specification: Irrigation Record Capture

**Feature Branch**: `011-irrigation-record-capture`

**Created**: 2026-10-15

**Status**: Implemented — frozen scope, clarified, and verified

**Input**: Irrigation record capture for a Field and optional Season. The feature is server-authoritative and online-only. It creates and displays irrigation records for authorized Fields and optionally associates a valid Season in that Field and Business context. Records are preserved as historical operational data.

## Clarifications

### Session 2026-10-15

- Q: Besides the required Field and optional Season, what is the minimum information a farmer must provide for an irrigation record? → A: Occurrence time is required; irrigation method, duration, water volume, and note are optional.
- Q: How should a farmer enter an irrigation record's occurrence time, and how should the product validate, store, and display it? → A: The farmer enters local date and time, defaulted to now; the value is interpreted in the Business timezone, falling back to `Europe/Istanbul` when unset. Future, ambiguous, and nonexistent local times are rejected. The accepted value is stored as one absolute instant and displayed in the Business timezone.
- Q: For optional irrigation duration, which unit and entry granularity should farmers use in V1? → A: Enter a positive whole number of minutes.
- Q: For optional irrigation water volume, which unit and precision should farmers use in V1? → A: Enter a positive volume in cubic metres, with up to one decimal place.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Record irrigation for a Field (Priority: P1)

As a farmer, I want to record irrigation for one of my Fields so that the work is preserved in that Field's operational history.

**Why this priority**: Recording completed field work supports the farmer's operational history and is an explicit MVP capability.

**Independent Test**: With an authorized Field and an internet connection, create an irrigation record, receive server confirmation, and find the accepted record in that Field's history.

**Acceptance Scenarios**:

1. **Given** a signed-in farmer with permission to record work for a Field and an internet connection, **When** they submit a valid irrigation record for that Field, **Then** the server accepts and preserves it and the product shows it in the Field's irrigation history.
2. **Given** an irrigation record has been accepted, **When** the farmer views that Field's irrigation history, **Then** the record is shown with its Field association and occurrence time displayed in the Business timezone.
3. **Given** the device has no internet connection, **When** the farmer attempts to create an irrigation record, **Then** the product does not queue it or claim that it was saved or accepted.

### User Story 2 — Associate irrigation with a Season (Priority: P2)

As a farmer, I want to associate irrigation with a relevant Season when appropriate so that the record can be understood in its farming context.

**Why this priority**: A Season association adds context while keeping Field-only records available when no Season applies.

**Independent Test**: Create an irrigation record for an authorized Field with a valid Season belonging to that Field and Business, then view the accepted record and confirm the association is retained.

**Acceptance Scenarios**:

1. **Given** an authorized Field and a valid Season associated with that Field and Business, **When** the farmer submits an irrigation record with that Season, **Then** the accepted record retains the Field and Season associations.
2. **Given** an authorized Field and no Season association, **When** the farmer submits an irrigation record, **Then** the accepted record is associated with the Field and has no Season association.
3. **Given** the supplied Season is not valid for the Field and Business context, **When** the farmer submits the record, **Then** the server rejects it and no irrigation record is added to history.

### Edge Cases

- The requested Field does not exist or is outside the farmer's authorized Business scope; reject without revealing protected Field information.
- The farmer's access is revoked before the server accepts the create request; do not create an accepted record.
- A Season from another Field or Business is supplied; reject the request without creating a record.
- Connectivity is lost before server acceptance; do not represent the record as accepted or retain it for later synchronization.
- A request fails or its outcome cannot be confirmed; show an appropriate retry/error state without falsely claiming acceptance.
- The Field has no irrigation records; show a clear empty state.
- The entered occurrence time is in the future, ambiguous, or nonexistent in the Business timezone; reject it without shifting or guessing.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The product MUST allow an authenticated, authorized farmer to create an irrigation record for a Field in the farmer's authorized Business context.
- **FR-002**: The Field MUST be required. The server MUST resolve and validate the farmer's current authorization and Field scope; client-supplied Business identity MUST NOT establish authorization.
- **FR-003**: A Season association MUST be optional. When supplied, the server MUST verify that the Season is valid for the same Field and Business context before accepting the record.
- **FR-004**: The product MUST show irrigation records associated with an authorized Field and preserve their Field and optional Season context in history.
- **FR-005**: The server MUST be authoritative for create acceptance. The product MUST NOT show a record as accepted before receiving a successful server result.
- **FR-006**: Irrigation record creation MUST require connectivity. The product MUST NOT queue an irrigation record offline, synchronize it later, or imply that an offline attempt was accepted.
- **FR-007**: Accepted irrigation records MUST be preserved as historical operational data. This feature MUST NOT silently erase or rewrite accepted records.
- **FR-008**: In addition to the required Field and optional Season association, an irrigation record MUST require occurrence time. Irrigation method, duration, water volume, and note MUST remain optional.
- **FR-009**: The farmer MUST be able to enter a local date and time for when irrigation occurred, defaulted to the current time. The server MUST interpret the local value in the authorized Business timezone, using `Europe/Istanbul` if no Business timezone is configured. The submitted local value MUST resolve to exactly one instant; future, ambiguous, or nonexistent local times MUST be rejected without shifting or guessing. The accepted occurrence time MUST be stored as an absolute instant and displayed using the Business timezone.
- **FR-010**: The farmer-facing capture and history experience MUST be usable on mobile, with loading, empty, success, connectivity, authorization, validation, and server-error states.
- **FR-011**: The feature MUST NOT add input catalogs or applications, equipment, automated irrigation, weather-driven irrigation suggestions, photos or attachments, costs, analytics, or generic offline synchronization.
- **FR-012**: When supplied, irrigation duration MUST be entered and stored as a positive whole number of minutes.
- **FR-013**: When supplied, irrigation water volume MUST be entered and stored as a positive number of cubic metres with no more than one decimal place.
- **FR-014**: Each online create attempt MUST use a stable identity scoped to the authorized Business. An exact retry by the same authenticated actor, with the same payload and currently authorized Business context, MUST return the previously accepted record; reusing the identity with a different actor, payload, Field, or Season MUST be rejected as a conflict. Retry state MUST exist only for the active online create flow and MUST NOT be retained for offline delivery or reconciliation.
- **FR-015**: Accepted irrigation records MUST appear in the chronological Field Diary as distinct `IRRIGATION` entries sourced from their canonical irrigation records. They MUST retain their own record identity and MUST NOT be represented as FieldObservations.

### Key Entities

- **Irrigation record**: A historical operational record of irrigation, associated with one required Field and optionally a Season. It requires an occurrence time entered as Business-local date/time (default now) and stored as one absolute instant; irrigation method, duration, water volume, and note are optional. A supplied duration is a positive whole number of minutes; supplied water volume is positive cubic metres with up to one decimal place.
- **Field**: The required authorized farming area for which irrigation is recorded.
- **Season**: An optional farming period associated with the same Field and Business as the irrigation record.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In all authorized online create scenarios, a record appears as accepted only after server acceptance and can be found in its Field's history with the same occurrence instant represented in the Business timezone.
- **SC-002**: In all tested unauthorized Field or invalid Season scenarios, no irrigation record is created and no protected cross-Business information is revealed.
- **SC-003**: In all offline create scenarios, no irrigation record is queued or presented as accepted.
- **SC-004**: Every accepted record retains its required Field association and, when supplied and valid, its Season association; its occurrence time is stored as one absolute instant and displayed in the Business timezone.
- **SC-005**: A farmer can distinguish an empty history from loading, connectivity, authorization, and server-error states on mobile.

## Assumptions

- Existing sign-in and server-side Business membership authorization are reused.
- A farmer may record irrigation for an authorized Field without an active Season; any Season association is optional.
- Irrigation method, duration, water volume, and note are optional; no additional irrigation-detail field is required in this increment.
- Optional duration uses positive whole minutes; optional water volume uses positive cubic metres with up to one decimal place.
- This increment supports online server-authoritative capture and viewing only; it does not define local persistence or later delivery.
- Historical integrity applies to accepted records; editing and deletion are not part of the create-and-view scope.
