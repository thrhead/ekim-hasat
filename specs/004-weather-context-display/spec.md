# Feature Specification: Weather Context and Display

**Feature Branch**: `004-weather-context-display`

**Created**: 2026-10-01

**Status**: Draft

**Input**: User description: "SPEC-004: Weather Context and Display. Give the farmer trustworthy, field-relevant weather context without allowing weather to silently change the season plan or tasks. Include normalized persisted snapshots, provider-neutral acquisition, authorized field association, freshness and unavailable states, mobile display from Bugün/relevant field context, graceful provider failure, tenant isolation, mobile completeness, API/OpenAPI/generated-client integration, observability, stable errors, and appropriate tests. Preserve SPEC-001/002/003. Exclude recommendations, task changes/approval flows, risk/diagnosis, satellite, observations, finance, team, and AI. Do not synchronously query the provider when Bugün opens or claim physical-device validation."

## Clarifications

### Session 2026-10-01

- Q: What forecast should a farmer see in SPEC-004, including its horizon and level of detail? → A: Show current conditions plus three daily summaries for today and the next two local days, including condition, high/low temperature, precipitation chance, and wind.
- Q: Should SPEC-004 add offline synchronization or authorization-lease infrastructure to display a persisted weather snapshot? → A: No. It may display an already stored snapshot only where an existing approved weather snapshot path and current app behavior permit; this repository has no such weather-local persistence path. MUST NOT add general offline sync or authorization-lease infrastructure.
- Q: Should SPEC-004 set an exact numeric stale-after limit, or leave that value to the freshness policy defined during technical planning? → A: Specify the freshness rule and farmer-visible states in the product specification; define the numeric maximum age during planning/configuration according to provider refresh cadence. A snapshot remains current only while both its forecast coverage and configured freshness limit are valid; a refresh failure alone does not make a still-valid snapshot stale.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Check weather for today's work (Priority: P1)

A farmer opens Bugün and sees the weather-owned authorized overview for relevant fields, including fields with no task due today. This overview is the complete mobile weather access surface for SPEC-004; it provides enough field identity to distinguish weather. This gives the farmer useful context while leaving the season plan and tasks under the farmer's existing control.

**Why this priority**: Bugün is the farmer's daily operating surface, and field-specific weather is the central value of this feature.

**Independent Test**: With an authorized field and a valid stored weather snapshot, open Bugün on mobile; verify the weather overview is independent of Today task rows, clearly associates weather with its field, explains its period and freshness, and leaves existing tasks and plan unchanged.

**Acceptance Scenarios**:

1. **Given** an authorized field has a valid, fresh weather snapshot, **When** the farmer opens Bugün, **Then** the farmer can see current conditions and daily summaries for today and the next two local days, showing condition, high/low temperature, precipitation chance, wind, and when the snapshot was refreshed.
2. **Given** Today has zero due tasks or multiple relevant fields, **When** the farmer opens Bugün, **Then** the weather overview still shows authorized field weather with the minimum field identity needed to distinguish each entry.
3. **Given** weather context is displayed, **When** the farmer returns to Bugün or refreshes the screen, **Then** no task date, task state, season plan, or farmer decision is changed by this feature.
4. **Given** an authorized field has no task due today, **When** the farmer opens Bugün or its weather context, **Then** the field remains discoverable through the weather-owned field weather overview and can show current, stale, or unavailable weather without relying on a Today task row.

### User Story 2 — Understand stale or unavailable weather (Priority: P1)

A farmer can distinguish current weather data from an older snapshot or unavailable data. A provider refresh failure alone does not make a valid snapshot stale; the farmer can still use the rest of the app and see any last valid snapshot with its actual freshness status and update time.

**Why this priority**: Trust depends on being clear about data quality and age, especially when external services fail.

**Independent Test**: Exercise a fresh snapshot, an expired/old snapshot, no prior snapshot, and provider failure; verify each state is explicit and no stale data is labeled current.

**Acceptance Scenarios**:

1. **Given** a stored snapshot's forecast coverage has ended or it exceeds the configured maximum age, **When** it is shown, **Then** it is labeled stale and its last update time is visible; it is not presented as current.
2. **Given** a provider refresh fails but a last valid snapshot remains within its forecast coverage and configured maximum age, **When** the farmer opens weather context, **Then** the snapshot remains available with its update time and current freshness status. Once either freshness condition expires, it is labeled stale; unrelated app workflows remain usable.
3. **Given** no valid snapshot has ever been stored for a field, whether its first refresh is pending or has failed, **When** the farmer opens weather context, **Then** the interface says weather is unavailable and shows no forecast values.
4. **Given** weather is unavailable or stale, **When** the farmer opens Bugün, **Then** existing task and season information remains available and is not altered by the weather failure.
5. **Given** a field has a last valid snapshot and a later refresh returns valid, current data after an outage, **When** the snapshot is stored, **Then** the newly validated snapshot replaces the previous last-valid snapshot and becomes current.

### User Story 3 — See only weather for fields I can access (Priority: P1)

A farmer sees weather only for fields available within their current business membership and field scope. A request that names a field in another business does not reveal that field or its weather.

**Why this priority**: Weather is business-owned field context, so authorization and tenant isolation are required for trustworthy access.

**Independent Test**: Request weather for an authorized field, another business's field, a missing field, and a field after membership revocation; verify only currently authorized data is returned and denied outcomes do not disclose cross-business existence.

**Acceptance Scenarios**:

1. **Given** a user has current membership and permitted scope for a field, **When** the user requests that field's weather, **Then** the system returns only its authorized normalized snapshot/status.
2. **Given** a user supplies a field identifier belonging to another business, **When** the user requests weather, **Then** access is denied without revealing whether the field or snapshot exists.
3. **Given** membership or field scope has been revoked, **When** a previously valid client requests weather, **Then** current authorization is rechecked and the data is denied without relying on cached client authority.
4. **Given** a mobile device is offline and no already-approved weather snapshot mechanism exists, **When** the farmer opens weather in SPEC-004, **Then** weather is unavailable with retry/access state and no forecast values; Today and completion cached state remain untouched. This feature adds no offline synchronization or authorization infrastructure.

### User Story 4 — Keep weather dependable across the mobile and API experience (Priority: P2)

The farmer can use the weather display on mobile without relying on web access. Weather data has consistent meaning across the API and generated client, and provider-specific details do not leak into the farmer experience or application weather model.

**Why this priority**: The display must be complete on the primary device and behave consistently across the system boundary.

**Independent Test**: Verify normalized provider outputs map to the same weather meaning, API contract and generated client agree, and mobile presents loading, fresh, stale, unavailable, authorization, and retry states without web use.

**Acceptance Scenarios**:

1. **Given** equivalent forecast data is returned by a provider adapter, **When** it is normalized, **Then** it has the same application-facing units, time semantics, quality, and freshness meaning regardless of provider payload shape.
2. **Given** the weather service is loading or a request fails, **When** the mobile screen is displayed, **Then** it communicates loading, unavailable, access denied, or retryable failure accessibly and does not imply success.
3. **Given** the weather contract changes, **When** the mobile application consumes it, **Then** it uses the generated client corresponding to the versioned OpenAPI contract and no hand-maintained divergent transport types.

### Edge Cases

- A field has no usable representative point; weather is unavailable with no weather values. If its representative point changes after a snapshot was acquired, that old snapshot is unavailable for the field until refreshed for the new point; do not present it as stale weather for the changed location. Do not substitute device location, business location, polygon centroid, or a guessed region.
- A Business timezone changes after a snapshot was acquired; its local-date coverage is evaluated against the current authorized timezone, and the snapshot is stale until it covers the current three requested local dates.
- A field has a point-only location; it remains eligible for field weather and does not require a verified polygon.
- A provider response is malformed, incomplete, outside supported units/time ranges, or fails quality validation; it must not replace the last valid snapshot or be shown as current.
- A new provider response is older than the currently stored valid snapshot, or a delayed refresh completes after a newer refresh; an older result must not overwrite newer valid context.
- A snapshot is fresh by acquisition time but its forecast period does not cover the displayed period, or the covered period has elapsed; status must reflect the period and freshness policy accurately.
- The provider times out, rate-limits, or is unavailable; weather failure must not block Bugün, field access, task completion, or season workflows.
- The user loses connectivity; because this repository has no approved weather-local persistence path, SPEC-004 shows unavailable/access/retry and leaves cached Today/completion state untouched. If an approved weather snapshot path exists in another context, display remains subject to its existing access behavior and freshness state.
- A cached snapshot is present while offline but existing app behavior does not permit its display; the weather feature must follow that existing behavior and must not add a new authorization lease or generalized cache-access mechanism.
- Membership or field permission is revoked before an online weather read; the server rechecks current authorization and returns the stable privacy-safe denial.
- A field is deleted, moved, or becomes inaccessible while a weather refresh is pending; results must not be associated with a different or unauthorized field.
- A provider error or authorization denial occurs; farmer-facing messaging must be useful and privacy-safe, while operational diagnostics retain correlation context without secrets or unnecessary personal data.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST request weather using the field's existing server-owned representative point. For a point field, this is its stored point; for a polygon field, this is the representative point already associated with that field. The system MUST NOT substitute device location or invent a fallback location. If the representative point is absent or unusable, weather MUST be shown as unavailable.
- **FR-002**: The system MUST keep provider-specific request, response, unit, and error details behind a provider-neutral weather boundary and normalize accepted data into a consistent application weather representation. Normalization MUST require finite temperatures and wind/precipitation values; precipitation chance MUST be within 0–100%, wind MUST be non-negative, and daily high temperature MUST be greater than or equal to low. Unsupported units, invalid or future timestamps, duplicate/missing forecast dates, missing required values, or invalid coordinates MUST be rejected. Provider condition labels MUST map to the application condition vocabulary; unrecognized conditions MUST map to `UNKNOWN` with a safe application label.
- **FR-003**: The normalized snapshot MUST preserve the field/location association, covered weather period, acquisition/update time, validity/freshness status, and quality needed to explain whether data is current, stale, or unavailable.
- **FR-004**: The system MUST persist the last valid normalized snapshot so the display does not depend on a live-only response. An invalid or older provider response MUST NOT replace a newer valid snapshot. When both snapshots have provider issue times, compare those times; otherwise compare server refresh-start times to reject a delayed older request.
- **FR-005**: Weather refresh MUST be a server-side application use case that runs independently of a farmer opening Bugün or field context. Those reads MUST NOT synchronously query or await an external weather provider. Live production provider configuration and its scheduler/operational cadence remain disabled until the ADR-012 release gate is approved.
- **FR-006**: The system MUST determine and communicate current, stale, and unavailable states using forecast-period coverage, location and timezone/date validity, and an explicit maximum-age freshness policy. A snapshot is CURRENT only when its age is within the configured maximum, coverage is valid for the requested Business-local dates, its representative point matches, and timezone/date context is valid. Default and deterministic test maximum age is 6 hours; exactly 6 hours remains CURRENT when all other validity conditions hold, and older than 6 hours is STALE. A refresh failure alone MUST NOT change CURRENT to STALE. UNAVAILABLE remains distinct from STALE. Acceptance tests MUST verify the boundary. The system MUST show an update time when weather is shown and MUST never present stale data as current.
- **FR-007**: The system MUST allow an authorized farmer to view current conditions and daily summaries for today and the next two local days through the weather-owned authorized overview surfaced from Bugün on mobile, regardless of Today task presence. This is the complete mobile weather access surface in SPEC-004; no separate field-detail screen/navigation architecture is required. Day boundaries MUST use the authorized Business timezone already used by SPEC-002 Bugün. The overview MUST include enough field identity to distinguish weather for multiple relevant fields. The display MUST include current condition and temperature; each daily summary MUST include condition, high/low temperature, precipitation chance, and wind speed. Display temperature in Celsius, precipitation chance as a percentage, and wind speed in km/h. The display MUST include the covered period and freshness state.
- **FR-008**: When refresh fails, the system MUST retain the last valid snapshot and display it with its freshness state and update time; a provider failure alone does not make it stale. When no valid snapshot has ever been stored for the field, it MUST display an unavailable state with no forecast values. After recovery, a newly validated snapshot MUST become the current snapshot without an invalid or older response replacing last-valid data. Weather failure MUST NOT block unrelated core workflows.
- **FR-009**: Every weather read MUST authenticate the user, resolve current business membership and field permission on the server, and return data only for fields within that authorized scope. A client-supplied business identifier MUST NOT establish authority.
- **FR-010**: Cross-business, missing, revoked, and out-of-scope weather requests MUST use stable, privacy-safe error outcomes that do not disclose whether another business's field or snapshot exists.
- **FR-011**: Weather read contracts MUST be versioned and represented in OpenAPI; mobile and web transport types MUST come from the generated API client rather than divergent hand-maintained types.
- **FR-012**: The mobile experience MUST provide accessible loading, fresh, stale, unavailable, authorization-denied, and retryable-error states using farmer-facing language. Status MUST not rely on color alone; assistive technology MUST be able to identify state text and be notified accessibly when asynchronous state changes occur, and retry controls MUST have an accessible name.
- **FR-013**: Operational telemetry MUST make provider refresh success/failure, normalization or quality rejection, persistence outcome, and every weather read/API failure diagnosable with the repository's existing correlation/request ID pattern and server-side correlated diagnostics. API failures MUST include a stable machine-readable error category/code. Logs MUST be authorization/privacy-safe and exclude access tokens, credentials, provider secrets, raw provider payloads, and unnecessary personal data. Do not introduce a new observability framework.
- **FR-014**: Provider data quality and application normalization MUST be testable without depending on live production provider responses. Authorization, tenant isolation, freshness transitions, persisted last-valid fallback, stable error behavior, API contract/client agreement, and mobile display states MUST have appropriate automated coverage.
- **FR-015**: This feature MUST NOT create, reschedule, postpone, skip, or otherwise modify a task or season plan; it MUST NOT add critical weather notifications, weather-driven task recommendations, approvals, risk generation or diagnosis, satellite, observations, finance, team, or AI behavior.
- **FR-016**: The feature MUST preserve existing SPEC-001 onboarding/field behavior, SPEC-002 season setup and Bugün behavior, and SPEC-003 task completion/history behavior except for additive weather context that does not change those flows.
- **FR-017**: Mobile MAY display an already stored weather snapshot while offline only where an existing approved weather snapshot mechanism and existing application behavior permit it, and MUST show its saved update time and stale state when its freshness policy classifies it stale. The current repository has no approved weather-local persistence path. SPEC-004 MUST NOT store weather in the completion-specific SQLite command store, extend the Today task projection into a generic weather cache, create SQLite weather persistence, a generic cache/sync layer, new authorization-lease infrastructure, or generalized offline cache authorization behavior. With no existing approved weather snapshot path, offline weather MUST show unavailable/access/retry state; cached Today/completion state remains untouched.
- **FR-018**: Physical-device or emulator validation MUST be reported only when performed with evidence; lack of such a runtime MUST be recorded as deferred validation rather than fabricated completion.
- **FR-019**: The system MUST provide a weather-owned authorized field overview so farmers can reach weather for relevant fields independently of Today task rows. It MUST resolve the current server-side Business membership and field permissions, return only fields in scope, and include only field ID, field display name, and the corresponding weather context. It MUST include authorized fields with no current snapshot or usable representative point as `UNAVAILABLE`. The operation MUST NOT accept a client-supplied business ID or become a general-purpose field-list API. The response MUST support bounded cursor pagination with a default page size of 50 and maximum of 100, sorted by field display name and field ID.
- **FR-020**: When a field representative point changes, a snapshot fingerprinted to the old point MUST produce `UNAVAILABLE` with no weather values until a validated refresh exists for the new point. When only the Business timezone changes, the snapshot remains associated with the same location but MUST be `STALE` until it covers the current three local dates.

### Key Entities *(include if feature involves data)*

- **Weather snapshot**: A persisted normalized set of weather values for a field location and defined time period, including acquisition time, freshness/validity, and quality status.
- **Field weather context**: The relationship between a business-authorized field and the location and snapshot used to display its weather.
- **Weather provider boundary**: The provider-neutral request/result and failure semantics through which external forecast data is obtained and translated into the application's weather representation.
- **Freshness state**: The farmer-understandable status that indicates whether a snapshot is current, stale, or unavailable, with its last update time where applicable.
- **Field membership and scope**: The user's current business relationship and permitted field access that controls all weather reads.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In the supported mobile flow, a farmer can reach weather context for relevant authorized fields through the weather-owned overview surfaced from Bugün, including when there are zero due tasks, without opening the web application.
- **SC-002**: In all tested freshness and failure cases, 100% of snapshots beyond forecast coverage or the configured maximum age are labeled stale, and 100% of no-data cases are labeled unavailable without fabricated weather values.
- **SC-003**: In provider outage tests, the last valid snapshot remains available with its age/status, and the farmer can still reach existing tasks and field/season workflows.
- **SC-004**: In authorization tests, 100% of cross-business and revoked-scope requests are denied without exposing whether another business's field or weather data exists.
- **SC-005**: In all tested weather-overview and single-field API reads, screen access does not issue a synchronous external provider request and does not modify task or season-plan state.
- **SC-006**: At least two distinct test-only provider adapters/fixtures supplied with semantically equivalent valid weather data yield equivalent normalized WeatherSnapshot output, including application-facing values, units, covered-period semantics, and freshness state. This deterministic test requires no production vendor, network call, or ADR-012 resolution.
- **SC-007**: The committed OpenAPI contract and generated API client pass contract consistency checks, with mobile using the generated weather types.
- **SC-008**: Automated offline tests show that with network unavailable and no existing approved weather snapshot path, weather is unavailable/retryable while cached Today/completion state remains untouched; they also demonstrate that SPEC-004 adds no weather persistence, general sync, or authorization-lease infrastructure.
- **SC-009**: An authorized farmer can discover weather for every in-scope field through the weather-owned paginated overview, including fields with no task due today; overview responses contain only the minimum field identity and weather context and do not expose out-of-scope fields.

## Assumptions

- SPEC-001 supplies authenticated users, businesses, memberships, and field point/polygon location data; this feature does not change field creation or location editing.
- SPEC-002 supplies Bugün and active field/season context. Weather appears as additive context and does not change existing task ordering, completion, plan approval, or season behavior.
- Because the product is primarily for farmers in Türkiye, weather values use familiar metric units: Celsius, precipitation chance as a percentage, and wind speed in km/h.
- Snapshot coverage and acquisition metadata are available to an explicit freshness policy. The technical plan/configuration will set the numeric maximum age appropriate to the selected forecast cadence; a snapshot is not current if that age is exceeded or its covered period has elapsed. A failed refresh does not by itself make an otherwise valid snapshot stale.
- Weather acquisition uses the field's existing server-owned representative point: the stored point for a point field or the existing representative point associated with a polygon field. If that point is missing or unusable, the display is unavailable; device location and guessed regional substitutes are not used.
- Bugün may consume the weather-owned paginated field overview; field discoverability and weather availability do not depend on Today task rows. This is not a general field list or field-management feature.
- Mobile may display an already stored snapshot offline only where an existing approved weather snapshot path and existing app behavior permit it; this repository currently has no such local persistence path. Without one, weather is unavailable/retryable offline while Today/completion cached state is untouched. This feature does not add weather persistence, general synchronization, or authorization-lease infrastructure.
- Weather is read-only farmer context in SPEC-004. Weather-based task rules, recommendations, and approval flow belong to the later weather-aware task adjustment feature described as SPEC-006 in the PRD.
- The provider-neutral contract and application-facing behavior can be implemented and accepted without selecting a weather vendor. A production provider must be selected before enabling live production refresh; the architecture's referenced ADR-012 is absent, so that selection remains an architecture decision and is not guessed in this specification.
- Physical-device and emulator verification may be deferred when the required runtime is unavailable and must not be claimed without evidence.

## Scope Boundary

SPEC-004 covers acquisition through a provider-neutral boundary, normalization, persisted last-valid field snapshots, freshness and unavailable states, authorized single-field reads and a weather-owned paginated field weather overview, generated-client integration, observability, and mobile display of current conditions plus daily summaries for today and the next two local days from the overview surfaced in Bugün. The overview is the complete mobile weather access surface, is only for weather, and returns minimum field identity; it does not create a general field-list capability or require separate field-detail navigation. Live production provider configuration and scheduling remain a release/configuration gate pending ADR-012. The feature does not add weather-driven recommendations, task or plan changes, approval flows, critical weather notifications, risk generation or diagnosis, satellite, observations, irrigation, finance, team, AI, a general offline sync engine, or new authorization-lease infrastructure. It preserves SPEC-001, SPEC-002, and SPEC-003 behavior.
