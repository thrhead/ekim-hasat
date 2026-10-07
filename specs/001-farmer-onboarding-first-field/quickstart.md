# Quickstart Validation: Self-Service Farmer Onboarding + First Field

This guide defines validation scenarios for SPEC-001. The application, repository tests, and Maestro flow files now exist. The scenarios remain validation requirements: passing a unit, contract, or integration test verifies only the behavior that test exercises, and authoring a Maestro flow is not evidence that it ran on a device. Current evidence and remaining gaps are recorded at the end of this guide.

## Prerequisites

- A running development/test API and production Expo app for the scenarios being exercised.
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

### 0. Fresh signed-out authentication (repair acceptance)

1. Start a fresh mobile app install with no persisted Supabase session. Confirm the existing loading state remains visible until session restoration resolves, then confirm the default signed-out view offers **Giriş yap** and an action to switch to **Hesap oluştur**.
2. With a real configured Supabase test account, submit email/password sign-in. Confirm the app enters authenticated routing only after the existing auth observer publishes the session, then confirm the existing onboarding-status request and first-field route for an account with no completed onboarding.
3. Separately create a test account. If Supabase returns a session, confirm the same observer-driven route. If it returns no session, confirm the app remains signed out, shows email-confirmation-required, clears the password, and makes no onboarding-status request; confirm the address using the configured test inbox, return to the app, sign in with email/password, and then confirm the observer-driven route.
4. Exercise invalid credentials and an unavailable auth service. Confirm safe recoverable feedback, retained email, no provider message/code/token/password exposure, and no business/onboarding request before authentication.
5. Record whether signup returned a session or null, the app/device and platform actually used, and the exact runtime result. Do not use a fabricated session. If physical device/provider access or connectivity blocks a step, record it as unverified and name the blocker; Codespaces phone networking is an environment concern, not a product change.

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

## Superseded initial convergence attempt (2026-09-25)

This initial attempt ran repository checks but did not execute the end-to-end quickstart against a running API/mobile flow. Its failures and missing-database result below describe that attempt only; they were corrected by the later convergence update on the same date and are not the current repository check status.

- Scenarios 1–3 and 5 require live API/PostgreSQL/PostGIS state for atomic persistence, rollback, concurrent/idempotent requests, and tenant-boundary behavior.
- In the scenario list used for this initial attempt, draft recovery/expiry and geometry correction required mobile interaction. The current scenario 4 covers draft lifecycle; current scenario 6 covers geometry/default labeling. Their device interactions remain unverified as described in the current evidence matrix below.
- Scenario 7 requires manual VoiceOver and TalkBack checks from the still-open T036 task. Pilot evaluation is also not performed here.
- Maestro/device flows have not been run. Unit/contract coverage and an Expo export do not substitute for those executions.

Checks completed in this pass include OpenAPI client regeneration/reproducibility, API/client contract tests, workspace typecheck, and mobile tests. `pnpm test:contract`, `pnpm typecheck`, and `pnpm test:mobile` passed. `pnpm test:integration` stopped before execution because `DATABASE_URL` is unset. `pnpm lint` failed on existing unused-symbol and test-lint violations in API/mobile files. `pnpm test` failed in the domain runner: Node's strip-types mode could not resolve the `.js` import for `field-location.ts` while loading `complete-onboarding.spec.ts` (9 subtests passed, 1 failed). These repository issues and missing runtime/database evidence do not count as quickstart scenario passes.

### Convergence run update (2026-09-25)

The existing repository Compose `postgres` service was healthy with PostgreSQL/PostGIS available on the configured local port. `pnpm test:integration` was run with a shell-only `DATABASE_URL` derived from the active Compose configuration; no credentials were written to this file. All 21 API integration tests passed, followed by the `t008-schema-invariants.sql` checks and rollback. This provides database-level evidence relevant to scenarios 1–3 and 5:

- The integration suite verified atomic first-field persistence, transaction rollback after injected database failure, concurrent completion/bootstrap convergence, lost-response replay, retained-key conflict, post-expiry existing-completion behavior, and active-membership enforcement without fallback to unrelated memberships.
- These tests call the repository and authorization components against real PostgreSQL/PostGIS. They did not run the live authenticated HTTP flow in quickstart scenarios 1–3, exercise the status endpoint in scenario 5 against a live authenticated service, or validate farmer-visible UI state. Those scenarios remain unverified end-to-end.
- The local Compose service does not provide a configured/authenticated API session for manual quickstart execution. VoiceOver/TalkBack and pilot evaluation in scenario 7 still require manual evidence. Device recovery and geometry interaction remain runtime work; no device or Maestro infrastructure was provisioned.

The repository verification defects were also corrected: the domain runner now uses the TypeScript-aware `tsx` loader consistent with the source imports, and API/mobile lint findings were fixed without changing lint rules. The final non-runtime repository checks all passed: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:contract`, `pnpm test:mobile` (12 suites / 65 tests), and `pnpm check:diff`. `pnpm test:integration` also passed all 21 PostgreSQL/PostGIS tests and the schema invariant SQL. At that point T047 remained open because the authenticated HTTP/mobile quickstart and manual/device evidence were not obtained; the later checkpoint below adds partial Windows runtime evidence without closing T047.

## Current convergence evidence (2026-09-28)

The current Linux/Google Cloud Shell environment uses Node 22.23.3, pnpm 10.17.1, and Graft 0.20.0. PostgreSQL/PostGIS was started from the repository `compose.yaml`, Prisma migrations deployed successfully, and `pnpm test:integration` passed all 21 integration tests against that local database. This is Linux execution evidence for the API repository, authorization, transaction, geometry, rollback, tenant-isolation, concurrency, and idempotency cases covered by those tests. It does not establish a live authenticated HTTP/mobile quickstart or farmer-visible behavior.

The current repository checks are green: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:contract`, `pnpm test:mobile` (12 suites / 65 tests), `pnpm check:diff`, `graft build`, and `graft check`. No `graft build --deep` was run.

The following matrix distinguishes automated component evidence from authored device flows and complete scenario execution:

| Quickstart scenario | Automated repository evidence | PostgreSQL/PostGIS evidence | Maestro or device evidence | Still open |
|---|---|---|---|---|
| 0. Fresh signed-out authentication | Five focused mobile auth/composition suites and the complete mobile suite pass; typecheck and lint pass (2026-10-07). These tests do not prove hosted Supabase behavior. | Not applicable. | Not run: `adb` and `maestro` are unavailable in this Codespaces worktree. | Real Supabase sign-in/signup outcome, observer-driven routing on a device, and physical Android/Expo execution. |
| 1. New farmer completes onboarding | Domain, API contract, and mobile tests cover command/status contracts, default name, and UI behavior in isolation. | Atomic creation and persistence of the application user, default Business, OWNER Membership, Field, completion, and idempotency result are covered. | T038 is authored, not run. On Windows, Supabase session restoration, status HTTP 200, and first-field routing were observed before this signed-out auth repair. | Full authenticated sign-in/status/save/routing journey and committed-field UI confirmation. |
| 2. Atomic rollback on failure | Domain/mobile tests cover command and retry behavior. | Injected persistence failure rolls back all completion writes. | T038 is authored, not run. | Farmer-visible recovery and no-false-save behavior against the authenticated API. |
| 3. Idempotent retry and concurrency | Domain tests cover replay and conflict outcomes. | Concurrent convergence, lost-response replay, retained-key conflict, and post-retention existing-result behavior are covered. | T038 is authored, not run; its dropped-response and two-device scenarios have not been executed. | Authenticated HTTP/UI retry and concurrent-device evidence. |
| 4. Connectivity and temporary draft | T037/mobile tests cover persistence, account scope, recovery, seven-day expiry/activity reset, lifecycle purges, and secret exclusion. | Not applicable. | T039 is authored, not run; it covers offline failure, same-device/account relaunch restore of name and visible selected geometry, and discard. | Device execution; successful-save purge, sign-out/account-switch purge, seven-day UI expiry, and force-termination/crash behavior are not proven by Maestro. |
| 5. Business isolation and membership authority | API/domain contracts cover auth/error semantics, privacy-safe denial, and request shape. | Membership enforcement, inactive/missing membership denial, no fallback/adoption of unrelated Membership, and no unauthorized mutation are covered. | T040 is authored, not run; it exercises the generic status-denial UI with an operator-prepared isolated fixture. | Device execution; live HTTP response privacy and server-side non-fallback remain API evidence, not Maestro proof. |
| 6. Geometry and default label | Domain tests cover Point/Polygon validation, point-only behavior, unverified boundary, and name normalization. | Geometry persistence and transaction behavior are covered against PostgreSQL/PostGIS. | T038 is authored, not run. | On-device map interaction and geometry correction; Android Maps key/native rebuild remain pending. |
| 7. Accessibility and pilot evaluation | T035 automated accessibility assertions are included in the passing mobile tests. | Not applicable. | No manual accessibility or pilot evaluation has been reported. | VoiceOver/TalkBack checks and SC-001/SC-002 pilot evaluation; T036 remains open. |

### SPEC-001 authentication repair runtime check (2026-10-07)

Automated verification for the repair passed: `pnpm --filter @ekim-hasat/mobile test` (43 suites / 258 tests), `pnpm --filter @ekim-hasat/mobile typecheck`, and `pnpm --filter @ekim-hasat/mobile lint`. The focused auth/composition run passed five suites / 45 tests. These checks exercise the injected provider boundary, controller/composition behavior, and rendered mobile component; they do not establish a hosted Supabase or device journey.

A real signed-out app run was attempted but could not start in this Codespaces worktree. The Supabase public URL and publishable key environment entries were present, while `EXPO_PUBLIC_API_BASE_URL` was unset, so the mobile public configuration was incomplete. Android tooling was unavailable (`adb` and `maestro` were not installed), so no Android device/emulator could be enumerated or used. No physical app, hosted sign-in/signup, confirmation email, onboarding-status request, or first-field route was executed for this repair. Those acceptance steps remain unverified; no session or provider result was fabricated. This is an environment/evidence blocker and does not change the auth product scope.

### Partial Windows runtime checkpoint

An earlier Windows session confirmed Supabase session restoration, `GET /v1/onboarding/status` returning HTTP 200, and routing to first-field onboarding. The next blocker was a missing Google Maps Android API key; native configuration/rebuild and map interaction remain pending on the user's Windows machine. This is partial runtime evidence only: it does not mean Android was built or that any T038–T040 Maestro flow ran.

T038, T039, T040, and T036 remain open. T039/T040 flow files are authored but have not been executed. T047 remains open because Linux tests and the partial Windows status/routing checkpoint do not cover the complete authenticated HTTP/mobile quickstart, all device scenarios, manual accessibility checks, or pilot evaluation.
