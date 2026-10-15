# Quickstart: Irrigation Record Capture

**Feature**: [spec.md](./spec.md)  
**Design**: [plan.md](./plan.md), [data-model.md](./data-model.md), [create contract](./contracts/irrigation-records.openapi.yaml)

## Prerequisites

- Use the repository-pinned Node.js and pnpm toolchain.
- For writable API integration checks, configure the test database as exactly `ekim_hasat_test`, with PostGIS enabled. Use the repository's disposable-database guard; never point integration tests at `ekim_hasat`.
- Apply the Prisma migration through the existing test setup before exercising the irrigation repository.
- Sign in with an account that has an active Business Membership and an authorized Field. Use Seasons belonging to that same Field and Business for association cases.
- Keep network access available for all create/read cases. This feature has no offline persistence or retry queue.

## Planned Validation Commands

These are the commands for implementation verification; they were not run during planning.

```sh
pnpm --filter @ekim-hasat/domain test
pnpm --filter @ekim-hasat/api test
pnpm test:integration
pnpm --filter @ekim-hasat/api-client test:contract
pnpm test:mobile
```

Run writable PostgreSQL integration tests serially and only against the guarded `ekim_hasat_test` database. The API-client contract command must confirm generated files match the canonical OpenAPI contracts.

## End-to-End Scenarios

1. **Create without optional details**: Open an authorized Field Diary online, choose “Add irrigation,” retain the default current Business-local time, submit with no Season or optional details, and receive server acceptance. The record appears in the Field Diary with its occurred time rendered in the authorized Business timezone.
2. **Create with valid Season and details**: Submit a valid same-Field, same-Business Season and optional method, positive whole-minute duration, positive cubic-metre water volume with up to one decimal place, and note. The accepted record and diary projection retain those values and associations.
3. **Reject invalid Season**: Submit a Season from a different Field or Business. The request is rejected and no record appears in history; the response does not disclose cross-Business record data.
4. **Reject unauthorized Field**: Submit against a Field outside current membership scope or after membership revocation. The server rejects the request and creates no record.
5. **Validate occurrence time**: Accept a unique past or current Business-local time. Reject a future time, a DST gap, a repeated ambiguous wall time, a mismatched absolute instant, or a stale Business timezone. Rejected attempts create no history row.
6. **Retry an uncertain online create**: While the online create flow remains active, a user-initiated exact HTTP retry reuses the same `irrigationRecordId`; receive the original record without a duplicate. Reuse that ID with changed payload or context and receive a conflict. No attempt is retained after leaving the flow or restarting the app.
7. **Read chronological history**: Request the Field Diary with `includeIrrigation=true`, optionally filter by Season, and traverse pages across equal-time boundaries. Irrigation appears once in deterministic order; cursors cannot be reused with a different Field, Season, or include flag. A request without the new flag retains the older response shape.
8. **Handle connectivity loss**: Attempt creation without connectivity. Show that the server did not confirm acceptance; do not save or queue a local irrigation record. After connectivity returns, any retry is an explicit online HTTP request from the still-active form, not background delivery or reconciliation.
9. **Use mobile accessibility states**: Verify labels and announcements for loading, create success, validation failure, authorization failure, connection loss, diary empty state, and diary read failure.

## Expected Outcome

Every displayed irrigation entry is backed by one server-accepted, append-only PostgreSQL record. Its Field and optional Season are in the authorized Business context, and its occurrence time is the unique Business-local value resolved to one absolute instant. No irrigation create is retained or delivered after an offline attempt. Optional duration uses whole minutes and optional water volume uses cubic metres with at most one decimal place.
