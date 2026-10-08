# SPEC-008 Validation Quickstart

This guide defines the validation path for implementation. It does not assert that implementation or these feature scenarios have been completed.

## Prerequisites

- Repository dependencies installed with the checked-in pnpm workspace.
- PostgreSQL/PostGIS integration-test environment configured through the repository's disposable-database support.
- Writable integration database resolves exactly to `ekim_hasat_test`; the guard in `apps/api/test/support/disposable-database.ts` must reject any other database. Never run destructive setup against `ekim_hasat`.
- A test fixture with an authorized Business, Field, ACTIVE Season, APPROVED plan, and unfinished planned task.

## Validation scenarios

1. **Accepted change and history**: submit a new Business-local date with the current task version; expect one accepted adjustment, the task's canonical date/version to advance, and one history item with the previous/new dates and server timestamp. The authoritative database row also retains the actor.
2. **Stale change**: load version N, accept another change to version N+1, then submit from version N; expect 409, unchanged canonical date/history, and a mobile reload that requires a new farmer decision.
3. **Exact retry and key reuse**: retry the exact request with its original `adjustmentId`; expect the original accepted adjustment and no duplicate row. Reuse that ID with a different task/date/version; expect 409.
4. **Same date and stale ordering**: with a new `adjustmentId` and current version, request the current canonical date; expect HTTP 400 `NO_DATE_CHANGE`, no accepted receipt/history/version/date change, and no success-style refresh. A new command with a stale version must return the stale-version conflict even when its requested date equals the latest canonical date. Mobile normally prevents submitting the unchanged selection and defensively presents the server result as no change.
5. **Eligibility and isolation**: DRAFT/inactive Seasons, completed tasks, revoked membership, and another Business' task cannot be adjusted or used to reveal cross-Business task existence.
6. **Tenant-scoped adjustment identity**: accept the same client-generated `adjustmentId` independently in two Businesses. In either Business, an ID used only in the other Business and an ID unknown everywhere must not produce a uniqueness error, replay, payload/history leak, or distinguishable existence signal. Within one Business, exact input replays and changed input returns `IDEMPOTENCY_KEY_REUSED`.
7. **Fresh operational reads**: after acceptance, refresh Bugün and create a new Calendar `readId`; verify date grouping and month indicators follow the new canonical date. Existing Calendar read pages remain unchanged and an offline saved view remains explicitly stale/read-only with no adjustment action. A no-date-change rejection does not trigger a success-style refresh.
8. **Mobile recovery**: start the same shared flow from Bugün and eligible Calendar task detail; verify online acceptance, loading/unavailable state, no false success, stale conflict reload, accessible status, and task-detail history.

The shared mobile command/current-state read lives in `apps/mobile/src/features/tasks/task-date-adjustment.ts`; the accessible form and bounded history live in `task-date-adjustment-view.tsx` and `task-date-adjustment-history.tsx`. An uncertain command retains its identity only in memory for explicit exact retry and cannot be submitted offline. Today acceptance triggers a new `/today` request. Calendar acceptance starts a new read using the server-resolved selected date and current Field scope; previous read pages remain unchanged.

## Commands

Run after implementation, not during planning:

```sh
pnpm --filter @ekim-hasat/domain test
pnpm --filter @ekim-hasat/api test:contract
pnpm --filter @ekim-hasat/api-client test:contract
pnpm --filter @ekim-hasat/api test:integration
pnpm --filter @ekim-hasat/mobile test
pnpm --filter @ekim-hasat/mobile exec jest --runInBand test/tasks/task-date-adjustment.test.tsx test/tasks/task-date-adjustment-history.test.tsx test/tasks/task-date-adjustment-view.test.tsx test/seasons/today-task-adjustment.test.tsx test/calendar/calendar-task-adjustment.test.tsx test/calendar/calendar-screen-task-adjustment.test.tsx
pnpm typecheck
pnpm lint
git diff --check
```

`api-client test:contract` checks generated output and consumer types. API integration tests are writable/destructive only against the guarded `ekim_hasat_test`. Do not point them at the interactive `ekim_hasat` database.

## Expected result

Focused SPEC-008 domain, API, generated-client, guarded integration, and mobile checks pass. The broad repository test runners retain the known Calendar baseline: `pnpm test` is 39/41 and `pnpm test:contract` is 19/21 because `calendar-http.contract.spec.ts` and `calendar.openapi.contract.spec.ts` fail under the combined runner; those files pass individually/together, and the SPEC-008 focused contract checks pass. Do not attribute this baseline to SPEC-008 without evidence of changed behavior. The fresh Today and Calendar reads show one canonical accepted date; old Calendar read identities remain coherent; exact retry never adds another history row; stale requests never overwrite; completed tasks and unauthorized Business data remain unchanged/unavailable.
