# SPEC-014 Quickstart Validation Guide

These are future implementation checks, not results of this planning gate.

## Prerequisites

Use repo-pinned pnpm 10.17.1 and frozen dependencies; bootstrap a fresh Codex Cloud workspace with `scripts/bootstrap-codex-cloud.sh`. For any later writable database operation, first positively verify the effective database name is exactly `ekim_hasat_test` and the connection is the intended test instance. If either cannot be established, stop: do not migrate, seed, reset or run write-capable integration tests. Follow the repository integration-test setup only after this verification. Never target production. No migration or writable DB operation is authorized during planning.

## Automated checks after implementation

```sh
pnpm --filter @ekim-hasat/domain test
pnpm --filter @ekim-hasat/api test:contract
pnpm --filter @ekim-hasat/api-client test:contract
pnpm --filter @ekim-hasat/mobile test
pnpm --filter @ekim-hasat/mobile test:smoke
pnpm --filter @ekim-hasat/api test:integration
pnpm exec graft build
pnpm exec graft check
```

Run integration tests only after the database verification above. `graft build` is the ordinary build, never `--deep`. Add focused tests under the existing suites for each scenario below. Regenerate client types from updated OpenAPI before contract checks. Record real outputs; no tests were run in the planning phase.

## Scenarios

1. OWNER creates with minimal and optional fields for ACTIVE/APPROVED season; test planting date equality, before-planting rejection, valid past/today/future and timezone boundaries. WORKER, ADVISOR, revoked membership, wrong Business/field/season, draft/ineligible season are denied with no disclosure or write.
2. Compare approved plan data, activation snapshot and pre-existing source labels before/after creation. New task shows MANUAL and null template provenance under a validated plan; original approved-plan views exclude it while operational views include it. Test legacy null template key and both plan sources.
3. Exercise Today exact-local-date behavior and Calendar grouping/detail. Complete a new task online and through the existing offline completion path; separately adjust and skip eligible tasks. Verify action-specific authorization, conflicts, history, diary inclusion and original completion snapshots; no creation-only diary entry.
4. Capture offline using prior authorized OWNER context, restart while session refresh fails, and create another local pending task. Verify stable IDs, local durability, display, no acceptance and no delivery without matching authenticated session. Sign-out, account switch, definitive no-session or missing context blocks new capture and hides former account data.
5. Reconnect and deliver; simulate concurrent retries, process death at each send boundary, committed response loss, later season closure, changed task date, and role revocation. Exact authorized replay returns one original accepted receipt; changed payload/identity/actor conflicts; later denial following possible commit stays unconfirmed. No cross-Business disclosure.
6. Definitively reject for role/field/season/validation; verify visible recoverable rejected record, explicit unchanged retry with current checks, corrected new submission with new IDs, and atomic local-only removal. Race removal with delivery and restart; pending/unconfirmed/in-flight records cannot be removed as rejected. Confirm no accepted server task is removed.
7. Confirm the approved entry requirements are covered: primary Field/ACTIVE Season, optional Bugün only with explicit Field/Season, no Calendar creation entry, and unchanged navigation. Distinguish typed identity conflict, ineligible season, invalid input and authorization responses; after any possibly committed delivery, a later denial or conflict remains unconfirmed until authoritative evidence resolves it.
8. Fail local writes and subsequent refresh; show accurate errors, preserve accepted receipt until authorized reconciliation by identity, no duplicate display; test accessibility labels and statuses without color alone.

## Evidence

Retain focused unit, PostgreSQL isolation/idempotency/constraint, API contract and generated-client outputs, mobile lifecycle/screen tests, smoke results and migration compatibility checks. Test legacy tasks and old mobile response compatibility. No fake production data.
