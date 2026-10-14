# Quickstart Validation Guide: Offline Field Observation Capture

This guide describes checks for a later implementation phase. Nothing below was executed or passed during `$speckit-plan`.

## Prerequisites

- Repository dependencies installed using the exact pinned pnpm 10.17.1 when that runtime is available. In this Codex Cloud session the executable is not proven; do not use pnpm 11 results as pinned-toolchain evidence.
- Guarded disposable PostgreSQL/PostGIS test database `ekim_hasat_test` for API integration scenarios. Verify the database guard and migration state before running destructive test fixtures.
- Test identity/provider adapter and mobile test storage isolated from production accounts. A physical device/emulator is optional for authored automated suites but required before claiming device E2E evidence.
- Graft is a platform-exception gap unless the repo-pinned command genuinely runs; do not claim `graft check` passed. Never run `graft build --deep`.

## Commands for the later implementation phase

From the repository root, using the pinned workspace toolchain:

```sh
pnpm --filter @ekim-hasat/domain test
pnpm --filter @ekim-hasat/api test:unit
pnpm --filter @ekim-hasat/api test:contract
pnpm --filter @ekim-hasat/api-client test:contract
pnpm --filter @ekim-hasat/mobile test
pnpm typecheck
pnpm lint
pnpm check:diff
```

Run focused PostgreSQL observation integration files only with the repository's disposable-database guard (`ekim_hasat_test`) and serial execution where tests share mutable database state; do not substitute an unguarded broad integration invocation. Re-run focused existing SPEC-006 observation/diary and SPEC-003 completion suites after the new observation tests. If the existing OpenAPI wire shape changes, regenerate through repository tooling and check generated-client reproducibility. These commands are a validation plan, not a record of execution.

## Acceptance scenarios

1. **Previously authorized context**: While connected, open observation creation for an authorized Field and optional same-Field Season. Confirm the stored context is account-scoped and contains the Business timezone needed for SPEC-006 local-time validation. Unknown Field/Season context cannot be used offline; no broad offline list appears.
2. **Offline capture and restart**: Disconnect, save two distinct valid notes, and terminate/restart the app. Both retain exact IDs, text, Field/Season, Business-local and absolute occurrence times, and pending status. Local write failure never reports success. Rapid repeated tap for one logical save creates one command.
3. **Offline restart without refreshed sign-in**: Establish the observation continuity marker from a successful session with concrete account A, save A's observation context, then restart with a retryable/offline restoration failure. Create a new pending note under A and verify no token or server request is available until a real A session returns. Repeat with successful restoration returning no session, an unknown/non-retryable restoration error, and a stale account ID only in command/context storage; none may activate A's saved context for capture. Explicit sign-out hides A's content and invalidates active marker use without requiring deletion of pending commands.
4. **Exact reconnect retry**: Restore connectivity and sign-in. Deliver the original command; simulate a committed 201 whose response is lost, restart, and retry the same body/ID. Verify one canonical FieldObservation and one logical farmer-facing diary observation, with original `occurredAt` and separate acceptance time.
5. **Revocation before first delivery**: Revoke Membership or Field/Season access before reconnect. The server creates no new observation and discloses no foreign data. The local note is recoverable under the original account and visibly not accepted; automatic unauthorized retries stop.
6. **Crash and revocation after uncertain send**: Crash after submission starts but before durable response recording, including a case where the server committed. After restart, preserve the exact command and classify outcome as unknown. If eligible, retry the same ID/body; if access was revoked, later denial must not reveal the canonical row or be called definite rejection. The local note remains **unconfirmed**, and no unauthorized diary read occurs.
7. **Account switch**: Queue notes under account A, then sign out/switch to an authenticated B. B's active namespace cannot see A's context or notes or submit A's commands; A's stored data may remain durable. Later authentication as A restores local access to A's data. Delivery still needs A's real authenticated session and current server authorization.
8. **Validation and conflict**: Empty/overlong text, future instant, DST gap/fold, and invalid Field/Season fail without a false accepted state. Changed payload/actor under an existing ID remains a 409 conflict. A permanent failure retains original local text and exact command without indefinite automatic retry. Corrected payload or Field/Season context requires explicit farmer choice and a new ID.
9. **Timezone change**: After an accepted response is lost, change the Business timezone and retry the original command with current authorization; exact replay still resolves to the one accepted row and original absolute instant. Separately, change timezone before first delivery and check the optional captured-timezone precondition even when the old local/instant pair would still map; the server rejects without rewriting time and the local note becomes needs attention, retaining original text, local wall time, captured timezone, and absolute instant, with automatic retry stopped. If an earlier send might have committed and its response was lost, a later mismatch leaves outcome unconfirmed rather than proving rejection. Corrected temporal context uses a farmer-approved new ID. Diary display follows the existing Business-timezone convention without changing the stored instant.
10. **Diary refresh and pagination**: After 201/200, durably save acceptance before leaving pending; then make diary refresh fail and recover. The accepted state survives restart and stays accepted even when its canonical entry is beyond the first page. Reconciliation by observation ID shows one logical entry when both representations are visible. Completion and Skip diary rows and cursor semantics remain unchanged.
11. **Tenancy and privacy**: Test revoked membership, foreign Business Field, mismatched Season, other actor replay, and absent authenticated session against a real PostgreSQL-backed API. No client-supplied Business ID grants access. Safe errors do not leak foreign existence.
12. **Mobile usability and accessibility**: Pending, retrying, unconfirmed, needs-attention, accepted, local-save failure, and diary-refresh failure states are distinguishable by text and announced accessibly. A pending note is never labelled canonical history. Physical-device results are reported separately from Jest/Expo mocks.

## Expected boundary

No generic offline sync, authorization lease, Field/Season browsing or mutation, attachment upload, categories, AI/risk, notifications, offline Skip/date adjustment, irrigation, finance, harvest/sales, or diary architecture redesign appears in the delivered feature. The existing online observation path and completion-specific offline queue continue to work.

## Implementation evidence log

- Baseline (2026-10-14): branch `work` at `2998f57907f354a1189b79dbf053a0d1d1f3fe31`, clean before implementation. Repository bootstrap succeeded with Corepack pnpm 10.17.1 and pinned Graft 0.21.1. Mobile baseline: 51 suites, 293 tests passed (`corepack pnpm --filter @ekim-hasat/mobile test`). PostgreSQL guard not yet verified.
- SPEC-010 recovery T014 (2026-10-14): `pnpm --version` reported `10.17.1`. From `apps/mobile`, ran `pnpm exec jest --runInBand --runTestsByPath test/auth/supabase-auth.adapter.test.ts test/observations/observation-account-context.test.ts test/observations/observation-command-store.test.ts test/observations/observation-command-builder.test.ts test/observations/observation-offline-capture.test.tsx test/observations/observation-offline-accessibility.test.tsx`; **6 suites and 37 tests passed**. This verifies the focused T003–T010 Jest boundary, including account restoration outcomes, local marker/context and command persistence, command validation, offline capture, and accessible pending/error states. The tests use Jest and simulated storage. **Physical-device/emulator validation was not run**: real SQLite persistence across OS process termination/restart, airplane-mode capture, and device accessibility behavior remain unverified. No API/PostgreSQL delivery or canonical acceptance scenario was part of T014.
