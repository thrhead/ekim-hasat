# SPEC-009 Quickstart and Verification Guide

This guide describes implementation verification scenarios. It does not claim the feature is implemented or that any command below has been run.

## Prerequisites and safety

- Use the repository's installed pnpm workspace and generated API client.
- API integration tests require `DATABASE_URL` to identify exactly `ekim_hasat_test`; `apps/api/test/support/disposable-database.ts` and the integration runner enforce the repository's test-database guard.
- Run PostgreSQL integration tests serially through the API integration script. Do not run separate integration processes concurrently against the same test database.
- Use test-only Business, membership, fields, seasons, plans, tasks and Skip IDs. Never point integration tests at a canonical development or production database, and do not perform destructive database operations manually.
- Use a mobile test client with generated contract types. Tests simulate offline/network conditions; no device runtime is claimed by this guide.

## Domain and API verification

1. **Eligibility and terminal invariants**: Test an eligible task and reject completed, already skipped, inactive-season, unapproved-plan, missing-snapshot and stale-version cases. Verify rejection creates no Skip event and changes no task version/date.
2. **Atomic acceptance and history**: Submit one valid Skip. Verify one append-only Skip row, current planned date/title/context snapshot, actor/membership, acceptance time and base/accepted task versions; verify task version increments once while task date, completion rows and all date-adjustment rows remain unchanged.
3. **Exact replay/key reuse**: Retry the same `skipId` and exact input and verify the original outcome is replayed without a second version increment/event. Reuse the ID within the same Business with changed task, actor or base version and verify a safe conflict. The same public ID in a different authorized Business is independently scoped and must not collide with or reveal the first Business's event.
4. **Tenant and revoked membership**: Exercise authorized owner/member, out-of-scope/foreign task, missing membership and membership revoked before mutation or retry. Verify current authorization is checked and no foreign task existence is exposed.
5. **Skip vs completion concurrency**: Against real PostgreSQL, release concurrent Skip and Complete requests for one task. Exactly one terminal outcome commits; if completion wins, Skip returns `TASK_ALREADY_COMPLETED`, and if Skip wins, completion returns the existing `TASK_NOT_ACTIONABLE` conflict. Repeat with reversed lock acquisition and verify the same invariant.
6. **Skip vs date-adjustment concurrency**: Against real PostgreSQL, race Skip and adjustment. If adjustment commits first, stale Skip returns `TASK_VERSION_CONFLICT` and a refreshed Skip snapshots the adjusted date. If Skip commits first, adjustment returns the existing `TASK_NOT_ACTIONABLE` conflict. Verify no date or audit history is lost.
7. **Completion regression**: Verify a completion accepted before Skip prevents Skip. Verify a Skip accepted first prevents a stale online or queued offline completion from creating `TaskCompletion`; the existing completion client/outbox still records and presents its normal explicit server conflict behavior without changing its persistence or retry protocol.

## Read-model and mobile verification

8. **Bugün**: After accepted Skip, a fresh Business-local Today read excludes the task; other due tasks and timezone resolution are unchanged.
9. **Cached Bugün after acceptance**: Accept Skip from Bugün and separately from Calendar, simulate a failed follow-up refresh, then restart offline. Verify the accepted task is absent from the cached actionable projection; verify no Skip command was persisted and any separate pending Task Completion record is unchanged.
10. **Calendar**: Create a fresh coherent Calendar read after Skip and verify the task is absent from selected-date and overdue pages and month work indicators. Verify immutable pre-Skip read IDs remain coherent and existing offline saved views remain stale/read-only with no Skip action.
11. **Task History**: Verify the new outcome history returns `TASK_SKIPPED` with task identity, title, season/field context, planned-date snapshot, source and accepted timestamp; completion remains `TASK_COMPLETION`. Exercise paging across equal timestamps and both kinds. Verify the legacy completion-only route remains unchanged.
12. **Field Diary**: Verify a skipped event is rendered with distinct “Task skipped” semantics, date/context and accepted time, never completion wording. Exercise same-time ties, old Observation/Task Completion cursors, new Skip cursors, season filtering, paging, and no duplicate/missing pre-existing rows.
13. **Mobile confirmation/result/errors**: Verify confirmation precedes submission, duplicate taps do not create duplicate logical actions, accepted/replayed result refreshes current work, conflict refreshes canonical state, access errors remain privacy-safe, and connectivity errors explain retry without local acceptance or queueing.
14. **Uncertain response**: Simulate server commit followed by response loss. Verify the open flow retries the exact same `skipId` and base version, displays one accepted result, and does not persist Skip to SQLite. After process restart, fresh server reads determine whether task remains actionable or appears in history.
15. **Existing offline completion**: Run the unchanged task completion command-store/coordinator tests and verify its durable outbox/retry behavior is untouched by the Skip implementation.

## Suggested focused commands after implementation

Run each command as appropriate to the repository's current scripts and keep PostgreSQL integration work serial:

```sh
pnpm --filter @ekim-hasat/domain test
pnpm --filter @ekim-hasat/api test:unit
pnpm --filter @ekim-hasat/api test:integration
pnpm --filter @ekim-hasat/api test:contract
pnpm --filter @ekim-hasat/api-client test:contract
pnpm --filter @ekim-hasat/mobile test
pnpm --filter @ekim-hasat/mobile typecheck
```

The API/client contract check must regenerate/check OpenAPI output from source contracts and compile consumer type tests. Do not run all test groups concurrently against the same PostgreSQL database.

## Evidence to record

- Exact API/domain/mobile commands and results.
- Test database name verification and serial integration result.
- Race outcomes for Skip/Complete and Skip/date adjustment on PostgreSQL.
- Generated API/client check and consumer type-check result.
- Mobile accessible confirmation, connectivity, accepted, conflict, authorization and retry states.
- Any unverified physical-device or assistive-technology evidence, without reporting it as passed.
