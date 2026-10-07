# SPEC-007 Validation Guide

This guide describes implementation validation scenarios; it does not claim they have been run. The following commands are recorded from the current workspace package manifests. Do not use device/emulator results unless those environments are actually exercised.

## Workspace commands

Run from the repository root unless a command changes to a package with `pnpm --filter`:

| Purpose | Command |
|---|---|
| API unit tests | `pnpm --filter @ekim-hasat/api test` |
| API contract tests | `pnpm --filter @ekim-hasat/api test:contract` |
| API integration tests | `pnpm --filter @ekim-hasat/api test:integration` |
| Mobile tests | `pnpm --filter @ekim-hasat/mobile test` |
| Mobile smoke export | `pnpm --filter @ekim-hasat/mobile test:smoke` |
| Generated client | `pnpm --filter @ekim-hasat/api-client generate` |
| Generated client check / contract types | `pnpm --filter @ekim-hasat/api-client test:contract` |
| Prisma client generation | `pnpm --filter @ekim-hasat/api prisma:generate` |
| Deploy Prisma migrations | `pnpm --filter @ekim-hasat/api exec prisma migrate deploy` |
| API lint / typecheck / build | `pnpm --filter @ekim-hasat/api lint` / `pnpm --filter @ekim-hasat/api typecheck` / `pnpm --filter @ekim-hasat/api build` |
| Mobile lint / typecheck | `pnpm --filter @ekim-hasat/mobile lint` / `pnpm --filter @ekim-hasat/mobile typecheck` |
| API client lint / typecheck / build | `pnpm --filter @ekim-hasat/api-client lint` / `pnpm --filter @ekim-hasat/api-client typecheck` / `pnpm --filter @ekim-hasat/api-client build` |
| Workspace lint / typecheck / build | `pnpm lint` / `pnpm typecheck` / `pnpm build` |
| Diff whitespace check | `pnpm check:diff` |
| Graft refresh / consistency | `graft build` / `graft check` |

Before any writable PostgreSQL integration run or migration command, inspect `DATABASE_URL` without printing credentials and require its database name to be exactly `ekim_hasat_test`. Never run Calendar fixtures or migrations against `ekim_hasat`. Calendar integration tests must call `assertDisposableDatabaseUrl` from `apps/api/test/support/disposable-database.ts` before creating fixtures.

## Preconditions

- Apply the repository's normal test database migrations and seed only test fixtures.
- Authenticate as a test user with an authorized Business and one or more Fields.
- Use controllable Business timezone/date fixtures; include the established `Europe/Istanbul` fallback case.
- Create test-only ACTIVE and DRAFT seasons, approved plans, unfinished tasks across dates/Fields, and canonically completed tasks.
- Provide a network stub capable of distinguishing connectivity/retryable failures from 401/403, revoked membership, and non-retryable failures.

## API validation scenarios

1. Read with no client Business ID and verify server membership resolves the scope.
2. Create the initial Calendar read with `selectedDate` omitted. Verify the server resolves current Membership and Business, uses Business timezone or `Europe/Istanbul` fallback, derives the date from server-side `asOf`, and returns that resolved `selectedDate` equal to `businessLocalToday` regardless of device timezone.
3. Supply an explicit valid `selectedDate` and verify the server validates and returns it unchanged, while month boundaries, indicators, selected-date tasks, and read identity use that date. Reject invalid dates.
4. Verify the endpoint returns only unfinished tasks from ACTIVE seasons with approved plans and authorized Fields; DRAFT and completed work are absent.
5. Vary client/device timezone while holding Business timezone fixed; verify omitted-date selection and overdue classification remain Business-local. Device timezone is not sent as date authority.
6. Read dates before, on, and after Business-local today. Verify overdue and selected-date groups are disjoint: selecting a past date leaves those tasks only in overdue, while a current/future selected date shows only non-overdue tasks planned for that date. Month indicators remain on original planned dates.
7. Verify a Field filter narrows selected-date, overdue, month indicators, and detail context consistently; forged/unowned Field IDs reveal no data.
8. Create a Calendar read and page through selected-date and overdue groups. Verify the server creates all task projections and month indicators in one `REPEATABLE READ` transaction, uses immutable Calendar-only snapshot rows, and issues server-recorded cursor tokens bound to the same read, group, resolved selected date, and stable key.
9. Complete or otherwise make a qualifying task ineligible, and separately add a qualifying task, after read creation but before fetching later pages. Verify later pages remain the exact point-in-time read (no page shift, duplicate, skip, or mixed month aggregate); create a new read and verify it reflects the new canonical state.
10. Replay the same cursor and verify it returns the same page and next cursor. Alter/cross-use a cursor, return a page out of the expected cursor chain, or use an expired read and verify no data is treated as complete and the client discards/restarts the whole staged read under a new read ID. Verify expiry does not invalidate a local saved view that had already been promoted to complete.
11. Verify reason-specific metadata distinguishes no ACTIVE season, no unfinished work, and selected Field with no relevant work.
12. Verify task details remain read-only and do not expose completion or task mutation operations.

## Mobile and offline validation scenarios

1. Open Takvim online. Verify the initial request omits `selectedDate`, the response's resolved date initializes the selected date, agenda is default, and month/date navigation updates one selected date. Change the device timezone and verify initial selection remains unchanged.
2. Select another date and verify the client sends that explicit `selectedDate`; the resulting response and saved-view identity use the same resolved date.
3. Change Field scope online and verify both views use the same result set.
4. Tap a task and verify read-only task/date/Field/Season-plan context and overdue presentation.
5. Complete both task cursor chains and receive complete month indicators. Verify the mobile store promotes the staged data atomically only when every response echoes the same read ID, scope, resolved date/month, and page chain reaches its terminal page.
6. Interrupt page loading, expire the server read, then simulate connectivity loss. Verify the partial staging set is not presented as complete or merged with pages from a restarted read.
7. With complete saved views, simulate a genuine retryable connectivity failure and request an exactly covered date and Field scope. Verify saved read-only data and saved/out-of-date signaling. Month indicators alone must not unlock another date's task rows.
8. Request a date without its own complete saved task set, an uncovered Field, or a scope with uncertain coverage. Verify offline/unavailable rather than partial rows or an empty state.
9. Simulate 401, 403, membership revocation between page requests, account switch, and Business switch. Verify continuation returns no snapshot data after authorization loss and no saved fallback crosses context.
10. Issue rapid date/Field changes with responses returned out of order. Verify only the latest matching read updates UI or persistence; a response from another read ID cannot complete the active local snapshot.
11. With assistive technology semantics inspected in tests, verify date selection, month work presence, Field filter, task rows, loading, errors, empty states, and saved status have meaningful accessible labels/state.

## Suggested focused test areas

- API Calendar repository/service/controller contract and tenant isolation.
- Business-local date and overdue boundary tests.
- Pagination/read-version and coverage-completeness tests.
- SQLite partitioning, atomic complete-snapshot promotion, and incomplete-page rejection.
- Offline error classification (connectivity vs authorization denial).
- Calendar screen request-race, empty/loading/error/saved states, and accessibility semantics.
- Navigation smoke coverage for the existing Takvim destination.

## Expected result

The API remains the authority for current data and permissions. Calendar presents a complete current view online, or an explicitly saved and read-only view only when a qualifying failure and exact coverage rules permit it. It never changes canonical task dates or state.
