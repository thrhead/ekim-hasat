# Implementation Plan: Skip an Active-Season Task

**Branch**: `009-skip-active-task` | **Date**: 2026-10-09 | **Spec**: [spec.md](spec.md)

**Input**: Product-approved scope in `specs/009-skip-active-task/spec.md` and its requirements checklist.

## Summary

Add a dedicated append-only `TaskSkip` outcome for one eligible unfinished task in an active season. Accept it through an authenticated, Business-scoped, version-checked online mutation; serialize it with completion and date adjustment on the existing task row lock; increment the task version and commit the Skip record atomically. Add a Task History outcome read and a distinct Field Diary event. Exclude skipped tasks from new Bugün and Calendar reads, and provide a small mobile confirmation/result/conflict flow without an offline queue. Keep existing Task Completion records, local offline command store, mutation payload, and synchronization behavior unchanged; update only the server's terminal-state guard needed to prevent completion from being accepted after Skip.

## Technical Context

**Language/Version**: TypeScript 5.9 in the existing pnpm workspace.

**Primary Dependencies**: Existing NestJS/Fastify API, Prisma, PostgreSQL, OpenAPI source contracts and `openapi-typescript` generated client, Expo/React Native mobile app.

**Storage**: PostgreSQL is canonical. A new append-only `TaskSkip` table is required; no new database or local offline store is required.

**Testing**: Domain unit tests; API unit/contract tests; real PostgreSQL integration tests guarded to `ekim_hasat_test`; generated-client contract/type checks; mobile Jest tests.

**Target Platform**: Existing API and authenticated iOS/Android mobile app. Skip requires a server response and is unavailable offline.

**Project Type**: TypeScript monorepo with a modular API and mobile client.

**Performance Goals**: Keep mutations bounded to one task and one Skip record. Keep history and diary reads paginated and bounded using current repository limits; no new latency target is specified.

**Constraints**: Revalidate current Business membership and task scope for every command, including exact retry. Preserve distinct completion/skip semantics and append-only history. Serialize all task mutations through the existing Season/plan/PlannedTask row lock. Keep new Calendar reads coherent and server-filtered. Do not add offline Skip persistence, a generic task-state abstraction, notification/background processing, or generic synchronization.

**Scale/Scope**: One farmer-confirmed Skip per eligible PlannedTask instance; one corresponding Task History entry and Field Diary projection. No bulk, recurrence, or automated behavior.

## Constitution Check

### Pre-design gate

- **Farmer simplicity and mobile completeness**: PASS. One clear confirmation in the existing task action/detail surface; no admin setup or new broad task-management surface.
- **Offline work must survive**: PASS. Skip is explicitly online-only and is never queued or shown as accepted without server confirmation. Existing offline Task Completion store and workflow remain unchanged. A failed/uncertain online request retains only its exact retry identity in the active flow, not in SQLite or an outbox.
- **Server authority and Business isolation**: PASS. API resolves current membership/scope from authenticated identity; client task/Business identifiers do not authorize the mutation.
- **Historical integrity**: PASS. Skip is its own immutable outcome record. Task, plan/season context, current planned-date snapshot and prior date-adjustment rows remain preserved.
- **Human control**: PASS. Skip is a direct farmer-confirmed action; no automatic or weather-driven action is introduced.
- **Modular monolith and existing boundaries**: PASS. Extend the existing Tasks and Diary read paths; no service, queue, or generic event subsystem.
- **Test according to risk**: PASS. Tenant isolation, PostgreSQL transaction/concurrency behavior, generated contracts, read projections and mobile states receive focused coverage.

No pre-design constitution violation requires an exception.

## Project Structure

### Documentation (this feature)

```text
specs/009-skip-active-task/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
└── contracts/
    └── task-skips.openapi.yaml
```

The Task Skipped Field Diary variant is a backward-compatible addition to the existing canonical Diary operation in `specs/006-field-observations-basic-diary/contracts/observations-diary.openapi.yaml`; its generated TypeScript must be regenerated from that source rather than hand-maintained.

### Source Code (repository root)

```text
packages/domain/src/tasks/task-skip.ts
packages/domain/test/tasks/task-skip.spec.ts
packages/domain/src/tasks/task-date-adjustment.ts                 # add skipped-task eligibility rejection
packages/domain/test/tasks/task-date-adjustment.spec.ts           # skipped-task guard regression

apps/api/prisma/schema.prisma
apps/api/prisma/migrations/20261009120000_task_skip/migration.sql
apps/api/src/tasks/task-skip.controller.ts
apps/api/src/tasks/task-skip.dto.ts
apps/api/src/tasks/task-skip.error.ts
apps/api/src/tasks/task-skip.error.filter.ts
apps/api/src/tasks/task-skip.repository.ts
apps/api/src/tasks/task-skip.service.ts
apps/api/src/tasks/task-completion.repository.ts                  # reject terminal skipped task
apps/api/src/seasons/today.repository.ts                          # exclude skipped outcomes
apps/api/src/calendar/calendar-read.repository.ts                 # exclude before snapshot creation
apps/api/src/observations/diary-query.ts                           # distinct TASK_SKIPPED union member/cursor kind
apps/api/src/observations/observation-diary.repository.ts         # merge skipped diary candidates
apps/api/src/main.ts                                               # compose task skip/history dependencies

specs/006-field-observations-basic-diary/contracts/observations-diary.openapi.yaml
packages/api-client/openapi-generator.config.ts
packages/api-client/src/generated/task-skips-api.ts               # generated
packages/api-client/src/generated/observations-diary-api.ts       # generated
packages/api-client/src/index.ts
packages/api-client/test/task-skips-consumer.type-test.ts
packages/api-client/test/observations-diary-consumer.type-test.ts

apps/mobile/src/features/tasks/task-skip.ts
apps/mobile/src/features/tasks/task-skip-view.tsx
apps/mobile/src/features/tasks/task-completion-history-screen.tsx  # adapt current screen to distinct outcome rows
apps/mobile/src/features/tasks/task-completion-command-store.ts  # Today snapshot projection helpers only; no command-store changes
apps/mobile/src/features/seasons/today-screen.tsx
apps/mobile/src/features/calendar/calendar-task-detail.tsx
apps/mobile/src/features/observations/field-diary-screen.tsx
apps/mobile/test/tasks/task-skip.test.tsx
apps/mobile/test/tasks/task-completion-history.test.tsx
apps/mobile/test/seasons/today-skip.test.tsx
apps/mobile/test/observations/field-diary-screen.test.tsx
```

Paths identify bounded existing seams, not a requirement to split code into every listed file if repository composition supports a smaller cohesive module. Do not create a `TaskSkip` local command store or touch `task-completion-command-store.ts` for Skip.

**Structure Decision**: Extend the existing `packages/domain` task rules, `apps/api` task mutations/read models, existing SPEC-006 Diary contract, generated shared client, and mobile task/diary surfaces. Keep the legacy Task Completion endpoint and local offline completion workflow compatible. Add a small task-skip API module and a bounded task-outcome history projection; do not add a service boundary.

## Design

### Domain and persistence

- Represent Skip with a dedicated one-to-one append-only `TaskSkip` row related to `PlannedTask`; do not store Skip in `TaskCompletion` and do not add a general task-status enum.
- Eligibility is an unfinished task with no completion or prior Skip, in an ACTIVE Season with an APPROVED plan and its activation snapshot, under current authorization.
- For a new command, validate current scope, task eligibility and `If-Match`; atomically increment `PlannedTask.version` and insert the Skip record. Do not alter `plannedLocalDate`, completion data, or adjustment rows.
- Store the task title and current planned local date as immutable Skip snapshots, plus task/plan/season/field/Business, actor user/membership, server acceptance time, client command identity/fingerprint, and base/accepted task versions.
- Keep public command identity unique within Business and one Skip per PlannedTask. The database cannot express cross-table uniqueness against TaskCompletion with ordinary unique constraints; every task mutation therefore shares the existing row lock and checks the competing terminal record in the same transaction.

### Transaction, concurrency and idempotency

1. Authenticate and resolve current Business membership; within the transaction re-lock the current user/membership and authorized Season/plan/task rows using the existing mutation lock order.
2. Resolve exact `(authorized businessId, skipId)` replay before live task-version/eligibility checks. Replay only if actor, task, season and fingerprint match; otherwise return `IDEMPOTENCY_KEY_REUSED`. Reauthorization remains mandatory for replay.
3. For a new command, reject a task with an accepted completion or Skip, then require ACTIVE/APPROVED/snapshot eligibility and exact `If-Match` version.
4. Conditionally increment `PlannedTask.version` from the submitted base version and insert `TaskSkip` in one transaction. Return the immutable accepted result.
5. Recheck/recover an insertion race by reauthorizing and looking up the Business-scoped command identity; do not globally look up a public ID or expose foreign state.

All three mutation paths lock the same PlannedTask row. The first transaction that commits a terminal action wins. A later Skip sees the completion/Skip record and conflicts. Completion must explicitly reject an existing Skip; date adjustment must treat Skip as ineligible. An adjustment that wins first increments the version, so an old Skip command conflicts; a new Skip based on refreshed version records the adjusted current planned date. No conflicting completion and Skip can both commit through the application paths.

### Read models and mobile behavior

- Today and Calendar source queries exclude tasks with either a completion or Skip. Calendar applies this eligibility before generating its immutable read snapshot, so every group and month indicator agrees. Existing saved views/read IDs are not rewritten; saved Calendar data remains explicitly stale and read-only under SPEC-007 rules.
- Add a separate paginated `GET /fields/{fieldId}/task-history` projection with discriminated `TASK_COMPLETION` and `TASK_SKIPPED` entries. Keep existing `/task-completions` unchanged for installed clients. Adapt the current mobile history experience to show outcome labels distinctly while keeping pending offline completion commands visibly pending and unchanged.
- Add accepted Skip as `TASK_SKIPPED` to the existing Diary discriminator. Order by the current global tuple `(event time DESC, kind ASC, event ID DESC)`; include Skip in source filtering and strict-after cursor continuation for every event kind. Preserve existing event ordering and ensure old Diary cursors still decode.
- The mobile action uses a small confirmation view. On accepted/replayed response, close it and reload Bugün/Calendar from the API. On conflict, refresh current work and show the canonical outcome. On offline failure, no request is queued and no success state is shown. If acceptance is uncertain, keep the same `skipId`, task ID and base version only in the open flow for exact retry; do not persist it to SQLite.
- When Skip is accepted from either Bugün or Calendar, remove that task from the in-memory/current view and the existing account-scoped cached Today projection. This post-acceptance projection update is not a Skip command, queue, or synchronization mechanism; it prevents a failed refresh or app restart while offline from presenting the server-skipped task as actionable. Reuse only the existing Today snapshot read/write boundary. Do not alter or clear its separate pending Task Completion command. If the cache cannot be updated, invalidate it or keep the task suppressed rather than restoring stale actionable work.

### Post-design constitution gate

- **Farmer simplicity/mobile completeness**: PASS — one task action, confirmation and distinct status messages.
- **Offline work**: PASS — no unsupported local success/queue; existing offline completion is unchanged. Explicit retry uses the same command identity only while the online flow is active.
- **Authorization/tenant isolation**: PASS — scope resolved and revalidated by API on every mutation/read; tenant-scoped event queries.
- **Historical integrity**: PASS — append-only Skip and snapshots; no completion/date-adjustment rewrite.
- **Testing**: PASS — PostgreSQL integration verifies shared-row-lock races and isolation; API/client/mobile checks cover outcomes and regression boundaries.

No post-design constitution violation or ADR requirement remains.

## Complexity Tracking

No constitution violations. A distinct Skip record and Task History projection are required by the approved semantics; a generic task-status framework or new platform subsystem is not introduced.
