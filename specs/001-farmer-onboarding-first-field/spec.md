# Feature Specification: Self-Service Farmer Onboarding + First Field

**Feature Branch**: `001-farmer-onboarding-first-field`

**Created**: 2026-09-24

**Status**: Clarified — ready for implementation

**Input**: User description: "A new farmer signs in, receives a default business transparently, and is guided to add a first field without organizational setup."

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Sign in and start farming (Priority: P1)

A new farmer signs in and can begin the first-use flow without being asked to create or configure an organization, business, roles, or administration settings. The system provides the farmer with a default business context behind the scenes.

**Why this priority**: Sign-in must lead directly to useful farm work and honor the self-service principle.

**Independent Test**: Sign in as a new farmer and verify the first-use experience proceeds to adding a field without any organizational setup step or terminology.

**Acceptance Scenarios**:

1. **Given** a newly authenticated farmer with no farm workspace, **When** the first-use experience opens, **Then** the farmer is guided to add a first field and is not asked to create a business or configure roles.
2. **Given** a newly authenticated farmer completes first-field onboarding, **When** the onboarding command succeeds, **Then** the server has atomically ensured the application user, default business, OWNER membership, and first field without exposing business setup as a farmer-visible step.
3. **Given** a returning farmer with an existing default business and fields, **When** they sign in, **Then** the system does not create a duplicate default business or restart first-field onboarding.
4. **Given** the onboarding flow needs to decide whether first-field onboarding is needed, **When** it reads onboarding status, **Then** the response exposes only the minimal completion state required for that decision and does not list fields.

---

### User Story 2 — Add the first field (Priority: P1)

A farmer follows a short, mobile-usable flow to create the first field. The flow accepts a point location without requiring a verified boundary polygon. A farmer may provide a current location, choose a point on a map, or draw a polygon. A field name is optional; unnamed fields receive a simple editable default label.

**Why this priority**: A field is the farmer's first useful farm record and the entry point to the field-first product.

**Independent Test**: Complete first-field onboarding using a point location, then confirm the returned first-field summary provides the post-save confirmation/current first-field state without requiring a general field list, crop, season, or polygon setup.

**Acceptance Scenarios**:

1. **Given** a farmer in first-field onboarding, **When** they provide a point location and `POST /v1/onboarding/complete` succeeds, **Then** the returned `FirstFieldSummary` is used for the post-save confirmation/current first-field state; general field listing remains in SPEC-002.
2. **Given** location permission is declined or unavailable, **When** the farmer chooses another supported location method, **Then** they can continue without granting device location permission.
3. **Given** a farmer supplies a polygon, **When** the field is saved, **Then** the polygon is retained as the field boundary and is not described as verified unless verification has actually occurred.
4. **Given** a point-only field, **When** it is saved, **Then** it remains usable for basic field use and no fabricated boundary is shown.
5. **Given** onboarding is already complete, **When** the farmer repeats the completion command, **Then** the existing first-field summary is returned and no second first field is created, even if an idempotency cache entry has expired.

---

### User Story 3 — Recover from interruption or failure (Priority: P2)

A farmer can understand and recover when sign-in, onboarding completion, field saving, or location access fails. The product does not imply that an unsaved field was created.

**Why this priority**: A failed first use must not strand the farmer or create uncertainty about whether their field was saved.

**Independent Test**: Cause each first-use step to fail, verify a farmer-language explanation and a clear retry or alternate action, then retry without creating duplicate business or field records.

**Acceptance Scenarios**:

1. **Given** the onboarding completion command fails, **When** the farmer attempts to continue, **Then** the product shows that the field was not saved and offers a retry without exposing internal system terminology.
2. **Given** the command may have succeeded but its response was lost, **When** the farmer retries with the same request identity, **Then** the farmer sees one resulting field, business, and OWNER membership, not duplicates.
3. **Given** location services are unavailable, **When** the farmer continues, **Then** the product offers a supported manual location method and explains any unavailable option.
4. **Given** the farmer leaves onboarding before saving, **When** they return, **Then** the product provides a clear way to resume or start the first-field flow without falsely showing an unsaved field as complete.

---

### Edge Cases

- Authentication succeeds but default business context creation or resolution fails.
- A field save times out after the server may have accepted it; retry must not create duplicates.
- Location permission is denied, device location is unavailable, or the map cannot load.
- The farmer submits an invalid or incomplete location or an invalid polygon; explain what needs correction while retaining entered name and location geometry according to FR-025.
- Connectivity is lost during initial onboarding before the command commits; recover the durable local draft on the same device and authenticated account and provide retry without reporting success.
- The app process terminates or crashes after draft persistence; reopening on the same device and authenticated account restores the entered field name and location geometry.
- App uninstall, explicit app-data/storage deletion, device loss, local-storage corruption, or unavailable platform storage prevents guaranteed draft recovery; the farmer can re-enter the field information.
- Two onboarding completion requests for the same authenticated user race; only one default business, OWNER membership, and first field may be created for the logical request.
- Onboarding is complete but the client retries after idempotency-key cache retention expires; resolve the existing first field by domain state and do not create another.
- A signed-in user returns with existing fields; onboarding must not create another default business or duplicate a field.
- A user is authenticated but has no usable membership in the business context needed for the field; do not trust client-supplied business identity to grant access.
- `GET /v1/onboarding/status` encounters a present but unusable default context; return privacy-safe HTTP 403 without revealing whether another business exists or falling back to another Membership.
- An account that already participates in multiple businesses must not be silently given access to another user's business. This feature does not add business switching or membership administration.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST allow a farmer to enter this flow after successful sign-in, without requiring a separate organization/business creation step.
- **FR-002**: An authenticated onboarding completion command MUST atomically ensure the application user, default business context, OWNER membership, and first field without asking the farmer to name, configure, or administer the business or membership.
- **FR-003**: The system MUST guide a farmer with no fields toward adding a first field as the next onboarding action.
- **FR-004**: The system MUST let a farmer create a first field using a point location; a verified polygon MUST NOT be required for basic field creation.
- **FR-005**: The system MUST offer the location methods supported by the product baseline: current location, point selection on a map, or manually drawn polygon. It MUST permit continuing without device location permission by using another available method.
- **FR-006**: The system MUST associate the first field with the default business authorized through the authenticated user's OWNER membership. Membership MUST be the authority for business ownership; the system MUST NOT introduce a separate `owner_user_id` authority. A client-supplied business identifier MUST NOT be treated as proof of authorization.
- **FR-007**: The system MUST enforce business isolation when creating and reading the field. A farmer MUST NOT gain access to another business's fields through onboarding.
- **FR-008**: The system MUST avoid creating duplicate default businesses or fields when a farmer retries after an uncertain response.
- **FR-009**: The system MUST show a clear saved state only after the field has been accepted, and MUST provide a farmer-language failure state and retry path when saving fails.
- **FR-010**: The onboarding flow MUST use farmer-facing language and MUST NOT expose terms or tasks such as tenant, organization setup, role configuration, or business administration.
- **FR-011**: The first-field experience MUST be complete on mobile, with readable content, touch-usable controls, and an alternative to device-location permission.
- **FR-012**: Sign-in MUST use Supabase Auth behind the authentication adapter. Provider SDK behavior and tokens MUST remain behind the adapter.
- **FR-013**: The flow MUST preserve the distinction between a point location and a verified field boundary and MUST NOT present a fabricated polygon as real.
- **FR-014**: The flow MUST leave crop selection, season creation, crop planning, and task generation to their separately scoped feature work.
- **FR-015**: First-time onboarding MUST require online connectivity and use one idempotent server command to atomically ensure the application user, default business, OWNER membership, and first field. The field MUST NOT be shown as successfully created until this command commits.
- **FR-016**: The system MUST provide structured, privacy-conscious diagnostic events for onboarding start, default business context resolution outcome, field save outcome, and recoverable failures. Events MUST include a correlation identifier and useful error category while excluding credentials, tokens, and unnecessary personal/location data.
- **FR-017**: The feature MUST be testable for successful and failed onboarding, retry/idempotency, authorization, business isolation, location alternatives, and mobile usability. The exact implementation and test tools are outside this specification.
- **FR-018**: If connectivity is lost before the onboarding command commits, the system MUST show a recoverable retry state and recover the durable local onboarding draft on the same device and authenticated account. It MUST NOT report success before commit. Offline creation of additional fields after the business has been created and synchronized is outside this feature.
- **FR-019**: A field name MUST NOT be required during first-field onboarding. If `name` is omitted or becomes empty after trimming leading and trailing whitespace, the server MUST assign exactly the editable default label “Tarla 1”; otherwise it MUST preserve the trimmed name. The farmer may rename it later without another required onboarding step. Numbering and collision policy for subsequent fields belong to SPEC-002.
- **FR-020**: SPEC-001 location geometry supports Point and Polygon only. The field MUST persist a representative point and MAY persist a submitted Polygon as an optional versioned boundary. MultiPolygon is outside SPEC-001. A Polygon submitted in this feature MUST be marked unverified unless a real verification process has occurred.
- **FR-021**: The onboarding command MUST be idempotent for retries and concurrent duplicate submissions. A repeated request with the same identity and payload MUST return the original logical result; reuse with a different payload MUST fail clearly.
- **FR-022**: SPEC-001 MUST provide an authenticated onboarding-status read that exposes only whether first-field onboarding is needed (and the minimum state needed to distinguish complete from needed). It MUST NOT provide general field listing; general field listing belongs to SPEC-002.
- **FR-023**: `GET /v1/onboarding/status` MUST return HTTP 403 using the normal privacy-safe error schema when `defaultBusinessId` exists but the authenticated user has no active Membership for that context, or when the default context is otherwise unusable. The error MUST NOT reveal whether another business exists. The operation MUST NOT fall back to another Membership or silently select another business.
- **FR-024**: `POST /v1/onboarding/complete` MUST return a summary of the created or current first field. If onboarding is already complete, it MUST return the existing first-field summary without creating another first field, regardless of idempotency-key cache retention.
- **FR-025**: Once the farmer has entered a field name or location geometry, the onboarding draft MUST be persisted to durable app-local storage. The draft MUST contain only the entered field name and location geometry required for recovery, and MUST NOT contain authentication credentials or tokens. On the same device and authenticated account, recovery MUST be guaranteed across connectivity loss, app restart, and app process termination or crash. Recovery is not guaranteed after app uninstall, explicit app-data/storage deletion, device loss, local-storage corruption, or platform storage being unavailable. The draft MUST be purged after successful save, explicit cancellation, sign-out, account switch, or 7 consecutive days without activity.
- **FR-026**: Mobile onboarding MUST provide assistive-technology and screen-reader labels, scalable text, sufficient contrast, and platform-appropriate minimum touch targets.
- **FR-027**: The authenticated ApplicationUser MAY have a server-owned `defaultBusinessId` context pointer. The pointer selects context only and MUST NOT authorize access; an active Membership is required before it is used. If no pointer exists, onboarding MUST create a new default Business, the user's OWNER Membership, and set the pointer atomically with first-field completion; it MUST NOT infer or adopt an existing membership/business. If the pointer is invalid or lacks an active Membership, onboarding MUST fail safely without selecting another business.
- **FR-028**: Completed first-field onboarding MUST be represented by a durable record scoped to authenticated user and default business and referencing the created Field. Repeated/concurrent completion MUST converge on that record and Field. While an Idempotency-Key record is retained, same-key/different-payload reuse MUST return 409. After key expiry, existing domain completion takes precedence: return its first-field summary with 200 and perform no new mutation.

### Validation Rules

- A field can be saved only with a valid location input accepted by the product's field rules.
- A representative point is required for every field. A point-only location is sufficient for basic field creation; a submitted polygon is optional and stored as a versioned boundary.
- SPEC-001 accepts Point and Polygon location geometry only; MultiPolygon is outside this feature. A submitted Polygon must be validated before being represented as a saved boundary; invalid geometry must produce an actionable correction state. A Polygon submitted during SPEC-001 remains unverified unless an actual verification process occurs.
- The authenticated user's active Membership authorizes the selected context; `defaultBusinessId` selects context only. A missing pointer causes atomic creation of a new default Business, OWNER Membership, and pointer. An invalid/unauthorized pointer fails safely; other memberships are not adopted.
- An uncertain retry must resolve to the original accepted result or a clear failure, never an indistinguishable duplicate.
- User, default Business, OWNER Membership, Field, optional boundary version, and idempotency result MUST commit together or not at all.
- A field name is optional during onboarding. If `name` is omitted or becomes empty after trimming leading and trailing whitespace, the server assigns exactly “Tarla 1”; otherwise the server stores the trimmed value. The farmer may rename it later.

### Permissions and Business Boundary

- The farmer must be authenticated before creating a field.
- The system resolves the user's membership and permitted scope on the trusted side before reading or writing business-owned data.
- Application tenant isolation MUST be enforced server-side for all onboarding reads and writes. PostgreSQL row-level security (RLS) is not required for MVP.
- A new self-service farmer receives an OWNER membership in the default business atomically with first-field creation; no role selection or business setup is presented in onboarding. Membership represents ownership; there is no second owner authority field.
- `ApplicationUser.defaultBusinessId` is a server-owned context pointer, not an authorization grant. Use it only after confirming an active Membership for that business. If absent, create a new default Business and OWNER Membership and set the pointer in the first-field transaction; leave memberships in other businesses untouched. If present but invalid or unauthorized, fail safely and do not fall back to another business.
- Default business creation and field creation must not allow a client to choose an unauthorized business or infer access from a supplied identifier.
- Access to fields in any other business remains isolated. This feature does not add invitations, worker/advisor roles, or business switching.
- Authorization failures must not expose whether another business or its fields exist.

### Mobile and Offline Expectations

- The onboarding and first-field flow must be usable end-to-end on a phone; web must not be required.
- The screen must support weak connectivity with clear progress and recoverable errors; do not display false save success.
- Successful initial sign-in requires the authentication service to be reachable unless existing approved authentication behavior provides a valid session.
- First-time onboarding requires connectivity for one server-side command that atomically ensures the application user, default business, OWNER membership, and first field. If connectivity is lost before commit, show a recoverable retry state and recover the durable draft on the same device and authenticated account; do not show the field as created until commit.
- Once a field name or location geometry is entered, persist the temporary draft in durable app-local storage. Recover on the same device/account after connectivity loss, app restart, and process termination/crash. Draft state is not an offline domain mutation and MUST NOT enter the domain outbox.
- Drafts contain only field name and location geometry and never credentials or tokens. Purge after successful save, explicit cancellation, sign-out, account switch, or 7 consecutive days without activity.
- Recovery is not guaranteed after app uninstall, explicit app-data/storage deletion, device loss, local-storage corruption, or unavailable platform storage; allow the farmer to re-enter the information.
- Provide screen-reader and other assistive-technology labels, support scalable text, maintain sufficient contrast, and use platform-appropriate minimum touch targets.
- Offline creation of additional fields after the default business has been created and synchronized is outside this feature.

### Failure States and Recovery

- Sign-in failure: keep the farmer in the authentication flow with a clear retry/recovery action; do not create a business context before authentication.
- Onboarding command failure: explain that setup could not be completed and allow retry; do not expose business bootstrap as a separate farmer-visible step or proceed to a false success state.
- Connectivity loss before command commit: explain that setup could not be completed yet, restore the durable draft on the same device and authenticated account, and allow retry. Do not mark the field as created until the transaction commits.
- Draft recovery cannot be guaranteed after app uninstall, explicit app-data/storage deletion, device loss, local-storage corruption, or unavailable platform storage; allow re-entry and do not imply the draft was retained.
- Location permission denied: explain that permission is optional and offer map-point or polygon entry when available.
- Map/location service unavailable: identify the unavailable option and offer another supported method.
- Invalid field location or boundary: identify the correction needed while retaining the entered field name and location geometry under the FR-025 draft-recovery guarantees.
- Field save failure: state that the field was not confirmed as saved and provide retry; reconcile uncertain outcomes without duplicates.
- Session expiry or access revocation: require reauthentication/authorization before continuing and do not reveal business data from an unauthorized context.

### Observability and Testability Expectations

- Record onboarding and field-creation outcomes with correlation IDs, stable error categories, and no secrets or unnecessary sensitive user data.
- Make it possible to distinguish authentication failure, default business context failure, validation failure, authorization denial, connectivity failure, and field persistence failure.
- Tests must cover allowed and denied business boundaries, including attempts to submit a different business identifier.
- Tests must cover repeated/concurrent submissions and a lost response after acceptance to demonstrate no duplicate default business, OWNER membership, or field.
- Tests must cover representative-point persistence, optional versioned polygon persistence and unverified status, polygon validation, location permission denial, alternate location entry, weak connectivity, and user-visible error/retry states.
- Mobile smoke coverage must show that a farmer can complete sign-in and first-field creation without a desktop.
- Tests must cover draft persistence as soon as a field name or location geometry is entered; recovery on the same device/account after connectivity loss, app restart, and app process termination/crash; the stated cases where recovery is not guaranteed; purge after save/cancel/sign-out/account switch/7 consecutive inactive days; and success only after commit.
- Tests must cover an omitted or whitespace-only field name receiving exactly “Tarla 1”, non-empty names being trimmed, and verify that naming is not an additional required onboarding step.
- Tests must verify that onboarding status reveals only the minimum first-field onboarding state and does not expose a general field list.
- Tests must verify that repeating completion after onboarding is already complete returns the existing first-field summary without creating another field, including after idempotency cache retention expires.
- Tests must verify the temporary draft contains only field name and location geometry, expires after 7 consecutive days without activity (with activity resetting expiry), and is purged on each specified lifecycle event without persisting credentials or tokens.
- Mobile accessibility evaluation must verify assistive-technology labels, scalable text, sufficient contrast, and platform-appropriate minimum touch targets.
- Accessibility verification MUST assert that interactive controls expose screen-reader accessible names and roles, respect system text scaling, meet platform-appropriate minimum touch-target guidance, and have sufficient text/control contrast. Verification includes automated accessibility assertions and manual VoiceOver (iOS) and TalkBack (Android) smoke evaluations.
- Idempotency tests MUST verify retained-key payload conflicts return 409, and that after key expiry the durable user/default-business completion record returns the existing Field summary with 200 and causes no mutation.

### Key Entities *(include if feature involves data)*

- **Farmer account**: The authenticated person who starts self-service onboarding.
- **Default business context**: The farmer's automatically provided farm workspace that scopes business-owned records, with ownership represented by an OWNER Membership; its internal business terminology is not shown during normal onboarding.
- **Membership**: The server-authoritative relationship between the authenticated farmer and a business, including OWNER role; membership is the sole ownership authority.
- **Field**: A farm location in the default business, persisted with a representative point and an optional versioned polygon boundary, with an optional farmer-provided name or editable default label “Tarla 1”.
- **Location input**: Current location, selected map point, or a manually drawn polygon submitted for field creation.
- **Onboarding status**: Minimal read state indicating whether first-field onboarding is needed; it is not a general field-list response.

## Clarifications

### Session 2026-09-24

- Q: Should a signed-in farmer be able to save the first field offline before the server-side default business exists, or must first-field creation wait for connectivity? → A: First-time onboarding requires connectivity for one idempotent server command and database transaction that ensures the application user, default business, OWNER membership, and field together; connectivity loss shows a recoverable retry state without reporting success before commit. Offline creation of additional fields after the business is created and synchronized is out of scope. Temporary draft recovery is defined by the later clarification in this session.
- Q: Must the farmer enter a field name during first-field onboarding, or may the system save the field with a default label that the farmer can change later? → A: Field name is optional; if omitted or empty after trimming leading/trailing whitespace, use the exact editable default “Tarla 1”; otherwise store the trimmed name. Allow renaming later without a required onboarding step and leave subsequent-field numbering/collision policy to SPEC-002.
- Q: What state may the first-run read expose, and what must completion return when onboarding was already completed? → A: SPEC-001 exposes only minimal onboarding status needed to decide whether first-field onboarding is needed; general field listing remains SPEC-002. `POST /v1/onboarding/complete` returns the created/current first-field summary and does not create a second first field when completion already exists, even beyond idempotency-key cache retention.
- Q: What may a temporary local onboarding draft store, and when does it expire or get purged? → A: Store only the farmer-entered field name and location geometry; purge on successful save, explicit cancellation, sign-out, or account switch; expire after 7 consecutive days without draft activity (activity resets the expiry window); never persist credentials or tokens.
- Q: Which accessibility requirements apply to mobile first-field onboarding? → A: Provide assistive-technology/screen-reader labels, scalable text, sufficient contrast, and platform-appropriate minimum touch targets.
- Q: Are SC-001 and SC-002 release gates? → A: No. They remain pilot targets measured through usability/pilot evaluation and do not block SPEC-001 implementation.
- Q: Which architecture decisions govern authentication, application tenant enforcement, and mobile maps? → A: ADR-006 selects Supabase Auth behind the auth adapter; ADR-009 mandates server-side application tenant enforcement and does not require PostgreSQL RLS for MVP; ADR-014 selects `react-native-maps` behind the map adapter.
- Q: What persistence and recovery guarantees apply to a temporary onboarding draft? → A: Once a field name or location geometry is entered, persist it in durable app-local storage. On the same device and authenticated account, recovery is guaranteed after connectivity loss, app restart, and app process termination/crash. Recovery is not guaranteed after uninstall, explicit app-data/storage deletion, device loss, local-storage corruption, or unavailable platform storage. Store only field name and location geometry; purge after successful save, explicit cancellation, sign-out, account switch, or 7 consecutive inactive days; never store auth credentials or tokens.
- Q: How is a default business context selected without granting authority from the pointer or adopting another membership? → A: `ApplicationUser.defaultBusinessId` is a server-owned context pointer only; verify active Membership before use. If absent, create a new default Business, OWNER Membership, and pointer atomically with first-field completion, leaving other memberships untouched. If invalid or unauthorized, fail safely without fallback.
- Q: What does `GET /v1/onboarding/status` return when the authenticated user's default business context is unusable? → A: Return HTTP 403 using the normal privacy-safe error schema, without revealing whether another business exists and without falling back to another Membership or selecting another business.
- Q: What durable completion and idempotency behavior applies before and after key expiry? → A: Store completion by user plus default business, referencing the created Field. Concurrent/repeated commands converge on it. While an Idempotency-Key record is retained, different-payload reuse returns 409; after expiry, return the existing summary with 200 and make no mutation. Retention duration is operational configuration.
- Q: What implementation-verifiable accessibility checks apply to mobile onboarding? → A: Controls expose screen-reader accessible names and roles, support system text scaling, meet platform-appropriate minimum touch targets and sufficient text/control contrast, and pass automated accessibility assertions plus manual VoiceOver/TalkBack smoke evaluation.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Pilot usability target, not a release gate: evaluate whether first-time farmers reach the first-field form after sign-in without assistance or encountering a business setup prompt.
- **SC-002**: Pilot usability target, not a release gate: evaluate whether first-time farmers can save a valid point-only field on their first attempt. Neither target blocks SPEC-001 implementation.
- **SC-003**: Repeated or concurrent submission after timeout or lost response results in exactly one default business context, one OWNER membership, and one field for the logical onboarding command.
- **SC-004**: All authorization and tenant-isolation acceptance tests deny cross-business field access and field creation.
- **SC-005**: A farmer can complete the supported online onboarding and first-field flow on a mobile device without using the web application.
- **SC-006**: In failure testing, every supported sign-in, location, validation, authorization, and save failure produces a recoverable farmer-facing state and does not falsely report an unsaved field as complete.

## Assumptions

- The user has completed authentication successfully before default business context resolution and field creation.
- The first business context and OWNER membership are atomically created or resolved with the first field for a new self-service farmer; ownership is represented only through membership.
- A point-only field is a valid first field; a verified polygon is optional.
- Current location, map point, and manually drawn polygon are the product-baseline location methods, subject to whichever are available in the current environment.
- Region resolution, crop selection, seasons, plans, tasks, weather, satellite, team, finance, AI, reporting, and business administration are not part of this feature.
- ADR-006 selects Supabase Auth behind the authentication adapter; provider SDK details remain behind that adapter.
- ADR-009 requires server-side application tenant enforcement; PostgreSQL RLS is not required for MVP.
- ADR-014 selects `react-native-maps` behind the map adapter.
- First-time onboarding requires connectivity for the single server-side command and database transaction that ensures application user, default business, OWNER membership, and first field.
- Once either field name or location geometry is entered, the temporary onboarding draft is persisted in durable app-local storage. On the same device and authenticated account, recovery is guaranteed after connectivity loss, app restart, and process termination/crash, but not after uninstall, explicit app-data/storage deletion, device loss, local-storage corruption, or unavailable platform storage.
- Temporary onboarding drafts contain only field name and location geometry, are purged after save, explicit cancellation, sign-out, account switch, or 7 consecutive inactive days, and never contain credentials or tokens.
- A field name is optional; an omitted name or one empty after trimming leading/trailing whitespace receives exactly “Tarla 1”; otherwise the trimmed name is stored.
- Every field has a representative point; SPEC-001 supports Point and Polygon only. A submitted Polygon is an optional versioned boundary and remains unverified absent an actual verification process. MultiPolygon is outside SPEC-001.

## Out of Scope

- Changing the approved authentication provider, identity verification policy, or account recovery policy.
- Crop selection, season creation, plan generation/approval, tasks, Bugün, or field history beyond confirming that the field was saved.
- Region detection and manual agricultural-region override beyond any location behavior strictly needed to accept the field.
- Team invitations, advisor sharing, role configuration, business switching, or business administration.
- Satellite analysis, weather guidance, AI, finance, harvest/sales, notifications, reports, or integrations.
- Offline first-field creation before the onboarding transaction commits, and offline creation of additional fields after business creation and synchronization.
- General subsequent-field name numbering and collision policy (SPEC-002).
- General field-list behavior and subsequent-field management (SPEC-002). The minimal onboarding-status read and first-field summary returned by completion are in SPEC-001.
- Requiring PostgreSQL RLS for MVP; server-side application tenant enforcement remains mandatory.
- Detailed implementation architecture, database schema, and migrations. Minimum repository scaffolding required to deliver this onboarding and first-field vertical slice may be included in SPEC-001 implementation tasks; unrelated future modules remain out of scope.
