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

## Mobile E2E convention

- Use Maestro as the black-box mobile E2E runner. Store YAML flows in `apps/mobile/e2e/`, including the task-owned T038–T040 flow files.
- Flows interact through visible text and accessibility-visible UI identifiers. Do not add E2E-only behavior to production code. Prepare backend state through supported interfaces or explicit test fixtures; flows must not bypass application behavior.
- Authoring a valid flow does not require an available Android device. Runtime verification requires installing/running the Android app on a device or emulator and executing the flow with `maestro test apps/mobile/e2e/<flow>.yaml`.
- Record a task as runtime-verified only after that device/emulator execution succeeds. YAML validation and `pnpm test:smoke:mobile` do not count as E2E execution; the latter remains an Expo build/export smoke check.
- Install the Maestro CLI as developer tooling outside the repository. Maestro supports React Native/Expo at the rendered accessibility layer and does not require an application npm dependency. The CLI requires Java 17 or newer.

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

## Earlier convergence run status (2026-09-25)

T047 remains open. This pass ran repository checks, but did not execute the end-to-end quickstart against a running API/mobile flow. The following evidence still requires unavailable runtime or database infrastructure:

- Scenarios 1–3 and 5 require live API/PostgreSQL/PostGIS state for atomic persistence, rollback, concurrent/idempotent requests, and tenant-boundary behavior.
- Scenarios 4 and 6 require mobile interaction under connectivity interruption, restart/process termination, draft expiry, and geometry correction; those mobile runtime cases are covered by the still-open T038–T040 evidence where applicable.
- Scenario 7 requires manual VoiceOver and TalkBack checks from the still-open T036 task. Pilot evaluation is also not performed here.
- Maestro/device flows have not been run. Unit/contract coverage and an Expo export do not substitute for those executions.

Checks completed in this pass include OpenAPI client regeneration/reproducibility, API/client contract tests, workspace typecheck, and mobile tests. `pnpm test:contract`, `pnpm typecheck`, and `pnpm test:mobile` passed. `pnpm test:integration` stopped before execution because `DATABASE_URL` is unset. `pnpm lint` failed on existing unused-symbol and test-lint violations in API/mobile files. `pnpm test` failed in the domain runner: Node's strip-types mode could not resolve the `.js` import for `field-location.ts` while loading `complete-onboarding.spec.ts` (9 subtests passed, 1 failed). These repository issues and missing runtime/database evidence do not count as quickstart scenario passes.

### Convergence run update (2026-09-25)

The existing repository Compose `postgres` service was healthy with PostgreSQL/PostGIS available on the configured local port. `pnpm test:integration` was run with a shell-only `DATABASE_URL` derived from the active Compose configuration; no credentials were written to this file. All 21 API integration tests passed, followed by the `t008-schema-invariants.sql` checks and rollback. This provides database-level evidence relevant to scenarios 1–3 and 5:

- The integration suite verified atomic first-field persistence, transaction rollback after injected database failure, concurrent completion/bootstrap convergence, lost-response replay, retained-key conflict, post-expiry existing-completion behavior, and active-membership enforcement without fallback to unrelated memberships.
- These tests call the repository and authorization components against real PostgreSQL/PostGIS. They did not run the live authenticated HTTP flow in quickstart scenarios 1–3, exercise the status endpoint in scenario 5 against a live authenticated service, or validate farmer-visible UI state. Those scenarios remain unverified end-to-end.
- The local Compose service does not provide a configured/authenticated API session for manual quickstart execution. VoiceOver/TalkBack and pilot evaluation in scenario 7 still require manual evidence. Device recovery and geometry interaction remain runtime work; no device or Maestro infrastructure was provisioned.

The repository verification defects were also corrected: the domain runner now uses the TypeScript-aware `tsx` loader consistent with the source imports, and API/mobile lint findings were fixed without changing lint rules. The final non-runtime repository checks all passed: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:contract`, `pnpm test:mobile` (12 suites / 65 tests), and `pnpm check:diff`. `pnpm test:integration` also passed all 21 PostgreSQL/PostGIS tests and the schema invariant SQL. T047 remains open because the authenticated HTTP/mobile quickstart and manual/device evidence were not obtained.
