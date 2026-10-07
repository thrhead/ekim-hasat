# Implementation Plan: Manual Active-Season Task Adjustment

**Branch**: `main` (no feature branch created) | **Date**: 2026-10-07 | **Spec**: [spec.md](spec.md)

**Input**: Approved specification at `specs/008-manual-active-season-task-adjustment/spec.md`.

## Summary

Add one online-only task-scoped command for a farmer to change the planned local date of an unfinished task in an ACTIVE Season. The API uses the existing `PlannedTask.version` as its optimistic-concurrency guard, updates the canonical task and writes a dedicated immutable date-adjustment record in one PostgreSQL transaction, and uses the record's client-generated UUID for exact retry identity. An authorized task-scoped history/current-state read supports both Bugün and Takvim details. On acceptance, Bugün reloads `/today`; Calendar opens a fresh immutable read snapshot for the same date/Field scope. The existing OpenAPI generation workflow supplies shared mobile types.

## Technical Context

**Language/Version**: TypeScript, Node.js >=22, pnpm 10.17.1.

**Primary Dependencies**: Existing NestJS/Fastify modular-monolith API, `packages/domain`, Prisma, PostgreSQL/PostGIS database, Expo/React Native mobile, `openapi-typescript` generated API client. No new framework, service, provider, or datastore.

**Storage**: PostgreSQL is canonical. Prisma owns the additive `TaskDateAdjustment` table migration. Existing `PlannedTask.plannedLocalDate` (`DATE`) remains the one canonical task date; existing `PlannedTask.version` is incremented for accepted adjustments. Existing mobile SQLite remains only the bounded Calendar saved-view store; SPEC-008 adds no task-adjustment outbox or offline mutation persistence.

**Testing**: Domain unit tests; API OpenAPI contract and authorization/error tests; PostgreSQL transaction, tenant-isolation, idempotency, stale-version and completion-race integration tests; API-client generated-contract/type tests; mobile Bugün/Calendar task-detail and state/reload tests. Integration tests may target only `ekim_hasat_test` through the repository's disposable-database guard.

**Target Platform**: Authenticated versioned REST API and Expo mobile app on supported iOS/Android versions. Adjustment requires a current online server response.

**Project Type**: TypeScript monorepo; modular-monolith API, shared domain package, generated REST client, mobile application.

**Performance Goals**: No numeric latency or throughput target is specified for this feature. Keep task history reads bounded and cursor-paged (default 50, maximum 100); the command locks and updates only the authorized Season/plan/task context and one history row.

**Constraints**: Preserve the explicit SPEC-008 boundary; authenticate and derive Business Membership server-side; validate `If-Match` against `PlannedTask.version`; preserve Business-local `YYYY-MM-DD` semantics and the existing planting-date lower bound; commit task update and history atomically; never mutate completed tasks; no false success, silent overwrite, automatic retry, Skip state, generic event store, generic offline sync, or general ACTIVE-plan editor. Calendar task-detail adjustment is the explicitly approved narrow SPEC-007 exception; agenda/month reads and immutable read snapshots remain unchanged.

**Scale/Scope**: One task date per farmer decision in an ACTIVE Season, plus a bounded task-specific history read and two mobile entry points. No bulk task operations or background work.

## Constitution Check

### Before Phase 0

- Farmer simplicity and mobile completeness: **PASS** — one Postpone / Reschedule action is available from both approved farmer workflows; no global configuration or desktop prerequisite.
- Server authority and Business isolation: **PASS** — every read/write resolves current membership/scope through the API; no client Business ID authorizes access; tenant-isolation coverage is required.
- Historical integrity: **PASS** — each accepted change gets a dedicated append-only record; completed-task snapshots are unchanged.
- Human control: **PASS** — only an explicit online farmer command changes a date; no weather or automatic change path is added.
- Offline correctness: **PASS** — online-only is explicit, cached/saved task details cannot mutate, and uncertain/rejected requests never show success. Completion-specific offline command storage is not generalized.
- Modular monolith, migration ownership, and generated contracts: **PASS** — API/domain remain in current modules, Prisma owns the additive app-schema migration, and mobile types come from OpenAPI generation.
- API compatibility and observability: **PASS** — versioned REST, stable conflict/error codes, request correlation, and current authorization checks are preserved.
- Testing and database safety: **PASS** — test design includes unit, contract, integration, tenant, mobile, and conflict coverage; writable DB tests are restricted to `ekim_hasat_test`.

### Phase 0 Research Gate

**PASS** — Repository evidence resolved the implementation choices in [research.md](research.md). No product clarification or architecture decision remains open.

## Design Decisions

1. **Dedicated command and history**: implement task-date adjustment separately from SPEC-002's DRAFT-only plan editor. Persist each accepted change in `TaskDateAdjustment`; do not use completion, Diary, a generic event store, or general ACTIVE-plan mutation.
2. **Concurrency**: use `PlannedTask.version` as the required `If-Match` value; atomically increment only that task version. Do not use `Season.version`, which protects DRAFT plan aggregate edits.
3. **Idempotency and command ordering**: `adjustmentId` is a stable client-generated UUID and the public retry identity; it is not globally unique. `TaskDateAdjustment` uses an independent server-generated internal row primary key and enforces uniqueness only on `(businessId, adjustmentId)`, so only accepted adjustments have durable receipts and another Business may use the same UUID independently. Fingerprint the task/date/base version and bind it to the actor and authorized Business. Every request first revalidates current authorization and access to the path task. Then query by the authorized Business plus `adjustmentId`—never by the public ID globally: exact original actor/task/command input replays its original result before live task eligibility or version checks; the same ID within that Business with different command input returns `IDEMPOTENCY_KEY_REUSED`. A foreign-only ID is indistinguishable from an unknown ID and cannot collide at persistence. This prevents an accepted retry from failing only because its first success advanced the task version. No local mutation queue is added.
4. **New command validation and atomic history**: for a new `adjustmentId`, lock the authorized membership plus Season/plan/task rows following task-completion locking; require ACTIVE Season, APPROVED plan, and no completion; enforce `If-Match` against `PlannedTask.version`; reject stale state before comparing dates. After a matching version, if `newPlannedLocalDate` equals the canonical date, return HTTP 400 `NO_DATE_CHANGE` with no task write, version increment, adjustment row, success receipt, or success-style refresh. Otherwise validate the new date with `validatePlannedTaskDate`, conditionally update date/version, and append history in one transaction. Only an accepted adjustment persists the `adjustmentId` identity. A no-date-change response is not an accepted adjustment and creates no idempotency receipt.
5. **History/current state API**: task-scoped GET returns current canonical date/version/adjustability with a bounded history page. It is independent of Diary and is loaded before opening the date form and after a conflict. Calendar's current OpenAPI taskVersion is optional even though the current server projection supplies it, so the flow uses this current detail read rather than trusting an absent or stale Calendar version. A stale conflict triggers another read; the farmer must make a new choice.
6. **Calendar/Today refresh**: re-read Today from `/today`. After Calendar acceptance, close task detail and start a new Calendar read for the same requested date/Field scope, then replace the active in-memory view with the fresh coherent result. Never edit rows/pages under the prior `readId`. A saved Calendar fallback remains explicitly stale/read-only and cannot expose the adjustment action.
7. **OpenAPI and mobile**: publish the command/history endpoints in the SPEC-008 OpenAPI contract and register the contract with the existing generator. Both Bugün and Calendar task details invoke one shared mobile adjustment flow and generated client operation.

## Planned API Surface

Contract source: [task-date-adjustments.openapi.yaml](contracts/task-date-adjustments.openapi.yaml).

- `POST /v1/tasks/{taskId}/date-adjustments`: `If-Match` task version; request contains stable `adjustmentId` and `newPlannedLocalDate`. First acceptance returns 201; exact accepted retry returns 200 after current authorization revalidation and before live eligibility/version checks; stale version, completed/non-actionable task, or changed-ID payload returns a stable 409 error. A new command requesting the current canonical date returns HTTP 400 `NO_DATE_CHANGE` after eligibility/version checks and before any write. No client Business identifier is accepted.
- `GET /v1/tasks/{taskId}/date-adjustments`: current canonical task date/version/adjustability plus accepted adjustment history ordered newest first; cursor-paged, default 50/max 100.
- Current membership and Business scope are required for both routes. An unavailable cross-Business task is not distinguishable from an unknown task.

## Transaction and Read Semantics

- Date values remain `LocalDate`/PostgreSQL `DATE`; UTC is used only for `adjustedAt`.
- Current authentication and authorized Business/task scope are revalidated for every request. An already accepted command is resolved by `(authorized businessId, adjustmentId)` after authorization; no global public-ID lookup is allowed. Exact original input replays its immutable accepted result; changed input within that Business is rejected as key reuse. This retry branch precedes live eligibility and version validation so it does not become stale solely due to its original version increment. The independent internal row key is not exposed publicly.
- For a new `adjustmentId`, task eligibility is checked before `If-Match`; a stale version is rejected before comparing the requested and canonical dates. Equal dates return `NO_DATE_CHANGE` without writing state or history. Only a different valid date proceeds to the atomic canonical update and append-only record.
- A completion accepted first makes adjustment fail as non-actionable; adjustment accepted first changes task version, so a completion based on the old version follows SPEC-003 conflict behavior.
- Any stale adjustment returns 409, keeps canonical state unchanged, causes mobile to reload current task detail, and requires a new explicit farmer action. It never auto-resubmits the requested date.
- Exact replay returns the original adjustment record, not an assertion that its date is still the latest. Mobile refreshes current canonical state after acceptance/replay.
- Today is a live canonical read. Calendar's prior snapshot/readId/cursors remain immutable and coherent; a new readId sees the canonical new date and recomputed date grouping. Existing saved offline Calendar data remains marked possibly out of date and read-only.

## Migration and Rollback Considerations

The implementation migration is additive: create the dedicated adjustment-history table with restrictive task/Season/Field/actor relations and pagination index. No existing task columns or Calendar snapshot schema need to change. Generate Prisma client through `apps/api`'s existing `prisma:generate` script; do not edit generated Prisma output by hand.

Rollback must not silently erase accepted adjustment history. Prefer a forward corrective migration. Dropping the new table is safe only before production acceptance data exists or after a separately approved preservation/export decision. No migration or database operation is performed during this planning phase.

## Testing Strategy

- Domain: valid/invalid ISO dates, planting-date lower bound, same-date no-op semantics, stale-before-no-op ordering, and no UTC/device-timezone conversion.
- API contract: required `If-Match`, generated adjustment ID and date fields, success/replay/`NO_DATE_CHANGE` outcomes, typed error codes, strict allowed fields, and task-scoped history page.
- API/PostgreSQL: ACTIVE/APPROVED eligibility; DRAFT/inactive/completed rejection; same-date no-write behavior; stale same-date request returns version conflict; atomic task+history rollback; task-version race; adjustment-vs-completion race; exact replay after version advancement; accepted-ID reuse; Business isolation, current membership/revocation, and no cross-Business existence leak.
- Read consistency: Today shows the new date only on a fresh read; a fresh Calendar read groups it by the new date and updates indicators; an old Calendar readId remains immutable; saved offline data stays labeled stale and has no mutation action.
- Mobile: both approved entry points use the shared command; saved/cached/offline views cannot submit; success refreshes; rejected/uncertain response never looks accepted; 409 reloads current state and never reapplies the old intent; history appears in task detail with accessible status.
- Database safety: use the disposable database guard and `ekim_hasat_test` only. Never run destructive operations against `ekim_hasat`.

## Project Structure

```text
specs/008-manual-active-season-task-adjustment/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
└── contracts/task-date-adjustments.openapi.yaml

packages/domain/src/tasks/                         # task-date validation/command rules if needed
packages/domain/test/tasks/                        # date-adjustment rule tests
apps/api/src/tasks/                                # task adjustment controller/service/repository/errors
apps/api/test/tasks/                               # route, contract, authorization, transaction/history tests
apps/api/prisma/schema.prisma                      # TaskDateAdjustment model
apps/api/prisma/migrations/                        # additive adjustment-history migration
apps/api/src/generated/prisma/                     # generated by existing Prisma script; never hand-edit
packages/api-client/openapi-generator.config.ts    # register SPEC-008 source/output
packages/api-client/src/generated/                 # generated task-adjustment contract types
packages/api-client/src/index.ts                   # compose/export generated contract types
apps/mobile/src/features/tasks/                    # shared online adjustment flow/history presentation
apps/mobile/src/features/seasons/today-screen.tsx  # Bugün task action and refresh integration
apps/mobile/src/features/calendar/                  # Calendar task-detail action and fresh-read integration
apps/mobile/test/tasks/                            # shared adjustment flow and task-detail tests
apps/mobile/test/calendar/                         # Calendar action/fresh-read/saved-view boundary tests
```

**Structure Decision**: Keep the feature inside the existing domain package, NestJS API task module, Prisma-owned PostgreSQL schema, generated API client, and Expo mobile app. No new process, service boundary, generic snapshot facility, generic sync package, or external provider.

## Constitution Check (Post-Design)

- Existing authorization remains server-side and tenant scoped: **PASS**.
- One task date remains canonical; adjustment history is append-only and completed history remains immutable: **PASS**.
- Farmer decision is required and online acceptance is explicit: **PASS**.
- No generic offline mutation queue or event store is introduced: **PASS**.
- Calendar read snapshots remain immutable; only a fresh read reflects changed canonical task data: **PASS**.
- Prisma/OpenAPI generated outputs have a single source of truth: **PASS**.
- No new framework/datastore/service and no unjustified constitution violation: **PASS**.

## Risks and Known Limits

- Calendar's existing task projection marks taskVersion optional in OpenAPI. The feature-scoped task-detail/history read supplies a required current version before adjustment, avoiding a change to the closed SPEC-007 contract.
- An older Calendar `readId` remains an immutable historical view; only a fresh read is canonical after adjustment. If the network fails later, SPEC-007's saved view remains labeled possibly outdated and read-only.
- Physical iPhone runtime validation remains separately deferred by the known repository Expo SDK 54 versus App Store Expo Go SDK 57 mismatch. This plan neither treats that evidence as passed nor proposes an SDK upgrade for it.
- No numeric latency target or retention duration is present in the approved sources; bounded history pagination and append-only retention are the selected defaults, with retention policy subject to platform policy rather than farmer-facing configuration.

## Complexity Tracking

No constitution violations or new architecture boundaries are introduced.
