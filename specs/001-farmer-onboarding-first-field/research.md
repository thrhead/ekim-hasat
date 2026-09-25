# Research: Self-Service Farmer Onboarding + First Field

**Date**: 2026-09-24  
**Scope**: Planning decisions reconciled with the approved SPEC-001 clarification session and repository architecture.

## 1. Onboarding reads and completion command

**Decision**: Expose authenticated `GET /v1/onboarding/status` with only `firstFieldOnboardingNeeded`, plus authenticated online-only `POST /v1/onboarding/complete`. If the status read finds an unusable `defaultBusinessId` context or no active Membership for that context, it returns HTTP 403 using the normal privacy-safe error schema. The response does not reveal whether another business exists and does not fall back to another Membership or select another business. The completion response returns the created/current first-field summary. General field listing remains SPEC-002.

**Rationale**: The app needs only a minimal read to choose whether to enter first-field onboarding. General listing belongs to field management and must not expand SPEC-001. Returning the first-field summary confirms the command outcome without a second read.

**Alternatives considered**: A general field-list endpoint; a status response containing all fields; a completion response with no field summary. The first two exceed SPEC-001 scope; the last weakens recovery after a lost response.

## 2. Transaction and durable idempotency

**Decision**: `ApplicationUser.defaultBusinessId` is a server-owned context pointer, not an authorization grant. If set, verify active Membership before use; if absent, never infer/adopt another membership and instead create a new default Business, OWNER Membership, and pointer atomically with completion. Invalid or unauthorized pointers fail safely without fallback. After auth-adapter verification, one PostgreSQL transaction resolves/creates the application User and selected context, Field and optional boundary, durable completion record scoped by user + default business and referencing the Field, and retained idempotency result. Concurrent requests converge on the same completion/Field. `FirstFieldSummary` includes `createdAt`.

**Rationale**: The transaction prevents partial domain state. The durable completion invariant ensures the no-duplicate guarantee does not depend on a cache lifetime. While a key record is retained, same-key/same-payload retries resolve to the original logical result and same-key/different-payload reuse returns 409. After key expiry, the existing completion record takes precedence: return the first-field summary with 200 and perform no mutation. Retention duration is operational configuration and must be tested at the expiry boundary.

**Alternatives considered**: Cache-only idempotency; client-side duplicate suppression; separate commits with compensating cleanup. These do not guarantee domain-level uniqueness after expiry, across clients, or after partial failure.

The external authentication provider is verified before the transaction and is not called while the database transaction is open. Concurrent requests must converge through uniqueness/locking constraints and domain logic.

## 3. Membership and tenant authority

**Decision**: OWNER Membership is the sole business ownership authority. All business-owned onboarding reads and writes enforce tenant scope server-side. PostgreSQL RLS is optional defense-in-depth, not required for MVP.

For `GET /v1/onboarding/status`, an unusable default context is an authorization failure (HTTP 403), not a cue to select another membership. Keep the error privacy-safe and independent of whether another business exists.

**Rationale**: `docs/ARCHITECTURE.md` makes the API the authoritative authorization/business boundary, prohibits client-supplied business identity as proof, and describes database RLS as an optional future control. Tenant-isolation tests remain required regardless of RLS.

**Alternatives considered**: Trust client business IDs; require RLS as the MVP enforcement layer; duplicate ownership in a Business owner column. These conflict with the server-authority boundary or add a second ownership source.

## 4. Field geometry and verification

**Decision**: Persist a representative point on every Field and optionally persist a submitted polygon as a versioned boundary. Polygon-only input derives an interior representative point with PostGIS `ST_PointOnSurface`. A submitted polygon is unverified unless an actual verification process occurs.

**Rationale**: This matches `docs/ARCHITECTURE.md` field geometry and preserves point-only onboarding without fabricating a boundary.

**Alternatives considered**: Store polygon as the only location; create a synthetic polygon from a point; mark a farmer-drawn polygon verified. These conflict with the architecture or overstate verification.

## 5. First-field name

**Decision**: Name is optional. If omitted or empty after trimming leading/trailing whitespace, the server assigns exactly the editable label “Tarla 1”; otherwise it stores the trimmed name. SPEC-001 supports Point and Polygon geometry only; MultiPolygon is outside this feature. Subsequent-field numbering/collision behavior belongs to SPEC-002.

## 6. Temporary form draft recovery

**Decision**: Persist a draft to durable app-local storage once the farmer enters either a field name or location geometry. Store only those values; never persist credentials or tokens. On the same device/account, recovery is guaranteed after connectivity loss, app restart, and app process termination/crash. It is not guaranteed after app uninstall, explicit app-data/storage deletion, device loss, local-storage corruption, or unavailable platform storage. Purge after successful save, explicit cancellation, sign-out, account switch, or 7 consecutive days without activity. It is not a domain record or outbox mutation.

**Rationale**: This limits local data to what is needed to restore the form, states exactly when recovery is guaranteed and when it cannot be promised, and defines cleanup while preserving online-only completion.

## 7. Approved auth and map adapters

**Decision**: ADR-006 selects Supabase Auth behind the auth adapter. ADR-014 selects `react-native-maps` behind the map adapter.

**Rationale**: These provider selections were explicitly approved and retain replaceable boundaries. Provider SDK types and behavior remain behind the adapters.

## 8. Mobile accessibility

**Decision**: Interactive controls expose screen-reader accessible names and roles, respect system text scaling, meet platform-appropriate minimum touch-target guidance, and maintain sufficient text/control contrast. Verify through automated accessibility assertions and manual VoiceOver and TalkBack smoke evaluations.

**Technical note**: Exact target dimensions follow applicable iOS/Android guidance during implementation; automated and manual evaluation methods are required by the specification.

## 9. Pilot success targets

**Decision**: SC-001 and SC-002 are usability/pilot evaluation measures, not release gates and do not block SPEC-001 implementation.

**Rationale**: The approved decision assigns their validation to pilot evaluation without imposing release thresholds.

## 10. Scope and remaining decisions

SPEC-001 owns minimal onboarding status and first-field completion only. General field listing and subsequent-field management are SPEC-002. ADR-009 requires server-side tenant checks, while RLS remains optional. Remaining implementation choices are listed in `plan.md`; they must preserve the approved API surface, transaction semantics, and security boundary.

**Source files reviewed**: `docs/PRD.md`, `docs/ARCHITECTURE.md`, `.specify/memory/constitution.md`, `specs/001-farmer-onboarding-first-field/spec.md`.
