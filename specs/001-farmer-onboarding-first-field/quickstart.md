# Quickstart Validation: Self-Service Farmer Onboarding + First Field

This guide defines implementation-time validation scenarios for SPEC-001. No application source tree, package manifest, or runnable test commands exist yet. These scenarios are validation requirements, not evidence that the feature is implemented.

## Prerequisites

- Minimal SPEC-001 API and mobile scaffolding.
- Development/test PostgreSQL with PostGIS.
- Configured Supabase Auth integration behind the auth adapter per [ADR-006](../../docs/ADR/ADR-006-authentication-provider.md).
- Configured `react-native-maps` behind the map adapter per [ADR-014](../../docs/ADR/ADR-014-mobile-map-sdk.md).
- Server-side tenant authorization per [ADR-009](../../docs/ADR/ADR-009-business-isolation-strategy.md); PostgreSQL RLS is not an MVP prerequisite.
- Network controls or a test proxy for dropping requests/responses.
- Generated API client from `contracts/onboarding.openapi.yaml`.

## Scenarios

### 1. New farmer completes onboarding

1. Sign in as a user with no application User, default Business, Membership, or Field records.
2. Confirm the only farmer-facing setup is the first-field flow.
3. Read `GET /v1/onboarding/status`; confirm it returns only `firstFieldOnboardingNeeded: true` and no field list.
4. Submit a valid point and omit the name.
5. Confirm one `POST /v1/onboarding/complete` request is sent and succeeds with a first-field summary.
6. Confirm the database has one application User, one default Business, one active OWNER Membership, and one Field with name “Tarla 1”. Also submit a whitespace-only name and confirm the server stores exactly “Tarla 1”; submit a padded non-empty name and confirm leading/trailing whitespace is trimmed.
7. Confirm the response and UI show saved state only after transaction commit; confirm the draft is purged.

### 2. Atomic rollback on failure

1. Cause field validation or persistence to fail after the server begins the command.
2. Confirm no partial new User/Business/Membership/Field state is committed.
3. Confirm the farmer sees a recoverable retry state and the field is not shown as saved.

### 3. Idempotent retry and concurrency

1. Commit the command, then drop the response.
2. Retry with the same authenticated user, idempotency key, and payload.
3. Confirm the API returns the original Field result and exactly one User/Business/OWNER Membership/Field chain exists.
4. Submit concurrent copies of the same logical command and confirm they converge to that same single result.
5. Reuse the key with a different payload and confirm a clear conflict without a second write.
6. Expire/remove the idempotency-cache entry, then repeat completion after onboarding is complete; confirm the current first-field summary returns and no second field is created.

### 4. Connectivity interruption and temporary draft lifecycle

1. Disable connectivity before command submission and separately drop the request/response during submission.
2. Confirm recoverable retry, no false success, and no offline outbox mutation.
3. Confirm draft persistence begins after either field name or location geometry is entered.
4. On the same device and authenticated account, confirm the draft recovers after connectivity loss, app restart, and forced app process termination/crash.
5. Confirm documentation and user recovery behavior make no guarantee after uninstall, explicit app-data/storage deletion, device loss, local-storage corruption, or unavailable platform storage; the farmer can re-enter the information.
6. Confirm the temporary draft contains only entered field name and location geometry and never credentials/tokens.
7. Confirm the draft expires after 7 consecutive days without activity.
8. Confirm the temporary draft is purged after successful save, explicit cancellation, sign-out, and account switch.

### 5. Business isolation and membership authority

1. Attempt the command without valid authentication.
2. For `GET /v1/onboarding/status`, set a default business pointer with no active Membership for that user and separately exercise another unusable default context; confirm both return HTTP 403 using the normal privacy-safe error schema.
3. Confirm the status error does not reveal whether another business exists and does not fall back to another Membership or select another business.
4. Confirm the completion request has no business or membership selector and cannot create a field under another business.
5. Confirm membership is the only representation of OWNER authority; no duplicate owner field is written.
6. Confirm errors do not reveal whether unrelated businesses exist.

### 6. Geometry, verification, and default label

1. Submit a point and confirm it is persisted as the representative point with no fabricated polygon.
2. Submit a valid polygon and confirm the Field has a representative point plus a versioned unverified boundary.
3. Submit invalid geometry and confirm an actionable error and no transaction commit.
4. Confirm omitted or whitespace-only name becomes exactly “Tarla 1”, and a non-empty name is stored after trimming leading/trailing whitespace; subsequent-field numbering is not inferred from this feature.

### 7. Mobile accessibility and pilot evaluation

1. Evaluate that all controls and location interactions expose assistive-technology/screen-reader labels.
2. Evaluate scalable text, sufficient contrast, and platform-appropriate minimum touch targets on supported mobile platforms.
3. Measure SC-001 and SC-002 through usability/pilot evaluation; treat the results as pilot targets, not release gates.

## Required verification categories

- Domain unit tests for transparent user/business/membership resolution, OWNER authority, default label, and idempotency.
- PostgreSQL/PostGIS integration tests for all-or-nothing transaction behavior, concurrency, geometry validity, representative-point derivation, and boundary version persistence.
- API/OpenAPI contract verification and generated-client compatibility.
- Tenant-isolation and authorization tests for all business-owned reads and writes in scope; RLS is not required for MVP.
- Mobile E2E and accessibility evaluation for first-field onboarding, alternate location entry, weak connectivity, no false success, draft lifecycle, and accessibility requirements.
- Structured diagnostic-event checks for correlation IDs and exclusion of credentials, tokens, and unnecessary personal/location data.
