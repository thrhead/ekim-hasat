# SPEC-013 Quickstart Validation Guide

This guide describes end-to-end checks for implementation. It does not assert that the checks have been run during the planning stage.

## Prerequisites

- Use the repository-pinned pnpm version (`10.17.1`) and installed frozen dependencies. In a fresh Codex Cloud workspace, run `scripts/bootstrap-codex-cloud.sh`.
- For persistence and tenant checks, configure `DATABASE_URL` for the repository's PostgreSQL test database and apply the Prisma schema/migrations using the repository integration-test setup.
- Start the API and mobile app using their existing development workflows when performing the manual flow.

## Automated validation

After implementation, run the focused suites:

```sh
pnpm --filter @ekim-hasat/domain test
pnpm --filter @ekim-hasat/api test:contract
pnpm --filter @ekim-hasat/api test:integration
pnpm --filter @ekim-hasat/api-client test:contract
pnpm --filter @ekim-hasat/mobile test
```

The API integration suite requires the configured PostgreSQL test database. Contract/client checks must run after updating the SPEC-006 Diary source and adding the SPEC-013 Harvest contract to the API-client generator. No production code or generated client is changed by this planning artifact.

## End-to-end scenarios

### 1. Create a canonical Harvest

1. Sign in as an authorized OWNER or WORKER and open a Field with an ACTIVE Season in that same Business.
2. Enter the Season's actual planting date as `harvestDate`, a positive quantity such as `12.375`, and either `KG` or `METRIC_TONNE`.
3. Submit while online.

**Expected:** The server returns a committed Harvest. The returned Field, Season, date, exact quantity, unit, and acceptance record match the request. The mobile flow reports success only after this response.

### 2. Reject invalid date, quantity, and context

Try each case: a date later than Business-local today; a date before actual planting; invalid calendar date; zero/negative quantity; more than three fractional digits; more than 11 integer digits; missing unit; a DRAFT Season; no Season; a Season on another Field/Business; an ADVISOR create; and revoked/unauthorized membership.

**Expected:** No canonical Harvest is created. Invalid input returns a correction response; missing or foreign protected context does not reveal whether the record exists. Season-date equality is accepted. No quantity is silently rounded or converted.

### 3. Retry an uncertain create

Submit one request, simulate losing the response after server commit, then retry with the exact same `harvestId`, actor, Field, Season, date, quantity, and unit. Separately retry the same identity after changing one of those values or using a different actor.

**Expected:** The exact retry returns the original Harvest and original `recordedAt`, including after the Season later leaves ACTIVE; concurrent exact submissions converge to one row. A changed request returns a conflict and does not mutate the accepted row. Current authorization and same-Business/Field Season access are checked before replay. A same UUID in another Business does not expose the first Business's row.

### 4. Check immutable historical identity

After acceptance, change current Field/Season details where the existing product permits, then reopen Field and Season history.

**Expected:** The accepted Harvest still references the original Field and Season and retains its date, quantity, unit, and actor/acceptance audit context. The feature offers no edit, delete, void, or correction action.

### 5. Traverse Field and Season Diary pages

Create several Harvests on the same date and across date boundaries, with existing timed Diary events on those dates. Read the Field Diary and then a Season-filtered Diary through all pages, including a page boundary within same-day records.

**Expected:** Each canonical Harvest appears once as `HARVEST` with `harvestDate`, exact decimal-string quantity, and selected unit. Field history includes eligible Harvests for that Field; Season history contains only the selected Season. Same-day DATE-only entries follow timed events and have deterministic kind/ID ordering. Traversal does not duplicate or skip previously eligible records. No time-of-day is shown or inferred.

Repeat ordinary Diary reads as OWNER, WORKER, and ADVISOR. The ADVISOR cannot create Harvests but receives the same Harvest read visibility as other ordinary authorized Diary entries. Verify old/default V1 reads remain unchanged and existing Expense V2 cursors with no `includeHarvests` flag continue as `includeHarvests=false`.

### 6. Exercise mobile connectivity and recovery states

Open the create flow offline, then online; simulate a timeout after submit, a retryable server error, an authorization denial, and an ID-reuse conflict.

**Expected:** Offline or uncertain submission is never shown as accepted and is not written to an offline queue. The active form retains the original logical submission for exact retry. Success appears only after server confirmation; validation, connectivity, authorization, conflict, and server failure remain distinguishable. Empty and retryable Diary failures do not fabricate history.

## Evidence to retain during implementation

- Focused domain/API/client/mobile command output.
- PostgreSQL integration evidence for tenant isolation, role permissions, composite relationships, append-only constraints, concurrent exact replay, and DATE/NUMERIC boundaries.
- Generated API client check output and mixed Diary V1/V2 cursor regression results.
- Mobile evidence for loading, empty, validation, success, offline, uncertain response/retry, authorization, conflict, and server-error states.
