# Implementation Plan: Task Completion and History

**Branch**: `003-task-completion-history` | **Date**: 2026-09-29 | **Spec**: [spec.md](spec.md)

**Input**: Approved feature specification at `specs/003-task-completion-history/spec.md`.

## Summary

Add a completion action to the existing `/today` workflow and persist each accepted action as a separate immutable `TaskCompletion`, preserving the ACTIVE season's planned task and activation provenance. Extend the existing Business-scoped Today query additively with task version and resolved timezone, add an idempotent completion command and a bounded field/season history read, and use one narrowly scoped Expo SQLite completion store for offline commands and their outcomes. The API revalidates Membership, task scope, ACTIVE/APPROVED state, and base task version inside a PostgreSQL transaction. Stable client-generated completion identity and a one-completion-per-task database constraint settle lost responses and concurrent attempts. Pending/conflicted local intent is never presented as accepted server history.

## Technical Context

**Language/Version**: TypeScript; Node.js `>=22`; TypeScript `~5.9` as configured in the workspace.

**Primary Dependencies**: Existing NestJS 11/Fastify API; Prisma 7/PostgreSQL adapter; Expo 54, React Native 0.81, `expo-sqlite` 16; `openapi-fetch`; `openapi-typescript` generated client. No new framework, datastore, queue technology, or external provider.

**Storage**: PostgreSQL is canonical and Prisma owns an additive migration for accepted completions. SQLite stores only the most recent authorized Today task snapshot and the completion-specific local command/result state.

**Testing**: Domain and API unit/contract tests via existing Node/tsx scripts; API transaction, concurrency, migration, and tenant tests against real PostgreSQL; generated OpenAPI client checks; mobile Jest/Jest Expo storage and component tests. Device/emulator runtime evidence remains deferred.

**Target Platform**: Existing NestJS API and Expo mobile application (Android/iOS targets); implementation and automated validation do not depend on physical-device/emulator availability.

**Project Type**: TypeScript monorepo, modular monolith API plus mobile client and shared domain/API-client packages.

**Performance Goals**: No feature-specific latency SLA is defined. Keep existing `/today` query shape and response bounded by its due-task set; page accepted history at 50 items by default and at most 100 per request.

**Constraints**: Server-authoritative authorization and PostgreSQL persistence; no client business ID as authority; task completion is append-only; distinct planned local date, absolute `occurredAt`, and server `recordedAt`; Business timezone and `Europe/Istanbul` fallback define rendering/date context; offline queue is completion-specific only; OpenAPI remains transport source of truth.

**Scale/Scope**: One accepted completion per planned task for this non-recurring slice. Mobile may keep multiple pending completion commands across different tasks. History is field-scoped with an optional season filter and cursor pagination; no general diary, reporting, or global sync feed.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Gate | Plan evidence |
|---|---|---|
| Farmer simplicity | PASS | One basic completion action; no required details; explicit pending/conflict wording. |
| Mobile completeness | PASS | The end-to-end action and history view are mobile workflows; SQLite preserves an offline action. |
| Offline work survives | PASS | Stable client ID, durable SQLite row, idempotent API, version precondition, explicit conflict state and restart/retry path. |
| Server-side authority | PASS | Current Membership and task/season scope are revalidated in the server transaction; no request business ID. |
| Historical integrity | PASS | A separate immutable completion stores actual occurrence and planned snapshots; it does not rewrite `PlannedTask` or activation context. |
| Human control | PASS | Stale, completed, non-ACTIVE, or unauthorized work is never automatically rebased/accepted. |
| Immutable content | PASS | Existing plan source and activation snapshot remain referenced and unchanged. |
| Modular monolith | PASS | Extend current seasons/Today API composition and add an internal task-completion domain area; no service boundary. |
| Test according to risk | PASS | Real PostgreSQL for uniqueness, locking, migrations, transactions, and tenancy; focused mobile restart/retry/conflict tests. |
| No fake production data | PASS | Agronomic task fixtures are test-only; no content generation or production seeding. |
| Spec before implementation | PASS | SPEC-003 was specified and clarified before this plan. |
| Small vertical delivery | PASS | Only active planned-task completion and its history are added; broad task/calendar/sync scope is excluded. |

**Gate result before research**: PASS. No unresolved product clarification remains.

## Research and Design Decisions

Phase 0 findings and rejected alternatives are recorded in [research.md](research.md). The design preserves the existing `/today` resource and Business-local date rules. To make an already-loaded task completable offline without per-task fetches, its existing response gets additive `taskVersion` and resolved `businessTimezone` fields; old clients can ignore these fields. The completion contract is a separate generated OpenAPI surface, with new route paths only.

The completion UUID is both the client-generated completion ID and permanent idempotency identity. The accepted row itself stores a canonical request fingerprint, so a retry replays the original result only when ID, payload, authenticated actor, and currently authorized task/business context match. A different actor cannot receive another actor's completion as a replay; an already-completed task follows the competing-completion conflict path without disclosing the completion outside authorized scope. A unique constraint on `plannedTaskId` prevents a second accepted completion even when two devices use different IDs. This avoids a new generic server idempotency subsystem.

The SQLite completion row is also the narrow local outbox. Persist it before request submission. Its state transitions `PENDING → ACCEPTED` only after the accepted response is written in a local transaction, or `PENDING → CONFLICTED` after a definitive stale-state/authorization response. Network uncertainty remains `PENDING` and retries the exact command. No global connectivity/sync service is added; retry on workflow/app resume or explicit farmer retry.

## API and Domain Boundaries

### Domain

- Add a task-completion command and accepted-record types under `packages/domain/src/tasks/` (within the existing domain package; no new package).
- Validate UUID identity, absolute occurrence instant, base task version, and allowed lifecycle/conflict transitions. Keep timezone rendering/date resolution in the authorized server/application boundary, not in device-local business rules.
- Keep completion as a separate operational fact. Do not put completion status or actual date on the SPEC-002 planned task or activation snapshot.

### API and persistence

- Extend the existing Today repository/query in `apps/api/src/seasons/today.repository.ts`; keep its membership, ACTIVE season, APPROVED plan, field/business, and Business-local date rules. Exclude rows with accepted `TaskCompletion` records. Return additive task version and resolved Business timezone metadata.
- Share the existing Business timezone/fallback calculation between Today and history through a small server utility in the current seasons/application boundary; history must use the same `Europe/Istanbul` fallback and invalid-timezone handling.
- Add a focused `apps/api/src/tasks/` command/read module and wire it into the existing Nest application composition. `POST /tasks/{taskId}/completions` accepts only client `completionId`, absolute `occurredAt`, and `If-Match` task version. The server derives Business, field, season, actor, and membership from the authenticated scoped query.
- Add `GET /fields/{fieldId}/task-completions` with optional authorized `seasonId`, cursor, and bounded page limit. It returns accepted completion records only, ordered by actual occurrence descending with completion ID as a stable tie-breaker, and includes resolved Business timezone.
- Add one Prisma migration and a `TaskCompletion` table with a client-supplied UUID primary key, unique planned-task relation, server `recordedAt`, `occurredAt`, base task version, canonical payload fingerprint, actor and tenant context, and stable task-title/planned-date snapshots. Keep references to the immutable plan source and activation snapshot for provenance. Do not add a server background queue or event bus; no asynchronous side effect is in scope.
- In one PostgreSQL transaction, revalidate/lock current default-business context and ACTIVE Membership, then scope and lock season/task; check an existing completion ID and fingerprint, current ACTIVE/APPROVED state, base task version, and existing task completion; insert the completion and any required audit evidence atomically. Retain application tenant filtering and add database uniqueness/FK protection. Do not rely on device-provided Business IDs, role claims, or local authorization as server proof.
- Use correlated request logging and a focused completion error presentation with stable conflict codes; log outcome and conflict category only, never auth material or unnecessary personal data. The immutable completion row is the operational history/audit fact; do not add a general audit service, worker, or server outbox without an in-scope asynchronous consumer.

### Idempotency, concurrency, and conflicts

| Situation | Server result | Mobile result |
|---|---|---|
| Same completion ID, same payload, same authenticated actor, and same currently authorized task/business context after commit | Return original accepted result (`200` replay); no insert | Persist accepted result locally, then settle retry |
| Same completion ID/payload from a different actor, or same actor after task/business authorization is no longer valid | Do not return the original actor's accepted row as a replay; return the privacy-safe authorization or already-completed/competing-completion outcome appropriate to current authorized context | Preserve intent as conflicted/access-unavailable; do not claim the caller's command was accepted |
| Same completion ID with changed payload | Stable ID-reuse conflict; no completion detail disclosure beyond authorized scope | Mark conflicted; retain local row |
| Different IDs race for the same task | One insert wins under task row lock and unique `plannedTaskId`; other receives `TASK_ALREADY_COMPLETED` without treating the winner's result as its replay | Winner becomes accepted; loser becomes conflicted and may refresh only currently authorized history |
| Stale task base version | `TASK_VERSION_CONFLICT`; no write | Keep intent as conflicted; refresh current authorized task/season state; require explicit farmer review before a new ID can be submitted |
| Task/season not ACTIVE/APPROVED | `TASK_NOT_ACTIONABLE`; no write | Keep as conflicted; do not re-offer an ordinary Complete action |
| Membership revoked or scope lost before sync | Existing privacy-safe 403/404 behavior after current Membership resolution; no write and no replay data | Keep local intent as conflicted; do not retry or expose server history until access is revalidated |
| Membership is revoked after commit but before a lost response can be replayed | Revalidate Membership before returning any replay; deny access without disclosing whether the write exists | Keep a conflicted/access-unavailable state; do not claim accepted or not accepted while the server result is inaccessible |
| Server committed but response was lost while Membership remains active | Exact ID replay returns the committed result | Retain pending until accepted response is durably recorded in SQLite |

For a stale task conflict, recovery reads current scoped Today/season data. If the task remains actionable, the farmer may explicitly confirm the original work and create a new completion ID using the current base version while preserving the original `occurredAt`; the conflicted command remains recorded locally. If the server already has a completion, show an accepted history row only when the current user is authorized to read it; never claim the caller's command replayed another actor's success. A revoked Membership has no automatic reauthorization/retry path.

### Mobile

- Extend `TodayScreen` with a one-action completion control and distinct saving, pending, accepted, and conflicted states; preserve existing loading/error/empty and accessibility patterns.
- Add an injectable `TaskCompletionStore` backed by an additive table in the existing `ekim-hasat.db`. Store the latest server Today task projection (including base version, `localDate`, Business timezone, and fetch time) and multiple completion command rows partitioned by authenticated account. The queue is not a generic entity outbox.
- Save `completionId`, the UTC absolute `occurredAt` captured at the tap, base task version, and task context in SQLite before posting. While pending, stop offering the task as actionable on that device but label it as waiting to sync, not accepted history. On a successful response, atomically persist the server result and state `ACCEPTED`; on definitive conflicts, preserve command and state `CONFLICTED`; on network ambiguity, keep `PENDING` and retry the exact request.
- Retry pending commands when Today/completion workflow is opened or resumed and through explicit retry. No new network-state dependency or generalized background sync service is required. Do not calculate Bugün from the device timezone; show the last server-provided Business-local date for cached offline tasks and identify cached/pending status.
- Add a bounded history screen from Today/task season context; field ID is the query scope and season ID is an optional filter. Normal farmer-facing history shows planned date and actual `occurredAt` rendered with the authorized Business timezone; `recordedAt` is persisted audit/synchronization metadata and actor user/membership context is retained for audit, but neither timestamp nor actor attribution is required in the history row/UI. Local pending/conflicted commands remain separately labelled and never masquerade as history. Team/worker attribution is outside scope.
- Do not include business ID in completion request authority. Account partitioning prevents local results from leaking across sign-out/account switch; existing business offline-access rules continue to apply.

### Generated contract

- Add `specs/003-task-completion-history/contracts/task-completions.openapi.yaml` for the two new completion/history paths and their request/response/error schemas.
- Add this contract to `packages/api-client/openapi-generator.config.ts`, generate a separate completion transport file, and compose its paths/operations/components into the public client and mobile exports.
- Add the two additive Today metadata fields to the existing Today contract source and regenerate its existing client. Do not hand-edit generated TypeScript. Preserve all existing onboarding and season operations and required fields; this is additive API evolution, not a change to SPEC-002 product behavior.

## Testing Strategy

- **Domain unit tests**: request validation, absolute-time preservation, exact replay fingerprint rules, PENDING/ACCEPTED/CONFLICTED transitions, and recovery not changing the original occurrence.
- **API contract tests**: authentication, request allowlist, required task-version precondition, stable response/error shapes, no client Business ID, new operation client types, additive Today metadata, and no divergent transport types.
- **Real PostgreSQL integration tests**: migration application/rollback, same-ID replay after lost response, same-ID changed command, different-ID race for one task, unique constraint defense, stale task version, DRAFT/non-ACTIVE/non-APPROVED rejection, atomic completion record with actor/time fields, membership revoked between offline creation and sync, replay denial after authorization revocation, cross-business completion/history privacy, `/today` exclusion only after accepted write, and history field/season filtering/cursor ordering. Use PostgreSQL for lock/transaction/unique semantics; PostGIS geometry behavior is not involved.
- **Mobile store tests**: persist before network, app/process restart, offline completion then reconnect, retry same ID after lost response, crash after server commit before local result persistence, settle only after local transaction, multiple different pending tasks, account switching, and pending/accepted/conflicted recovery.
- **Mobile component tests**: one-tap action, prevent duplicate tap, server/local Today overlay behavior, accessibility names/state announcements, scalable text, non-color status, loading/saving/pending/conflict/retry/error/empty history.
- **Automated mobile journey**: from authorized ACTIVE task in Bugün through completion and season-filtered history with generated client. Jest/Jest Expo automation is in-scope; any physical-device/emulator-only evidence is explicitly deferred and must not be reported as passed.

## Constitution Check (post-design)

| Gate | Result | Evidence |
|---|---|---|
| Mobile/offline correctness | PASS | Focused durable completion command survives restart; exact ID replay; explicit conflict state; no general sync engine. |
| Membership and tenant isolation | PASS | Server rechecks Membership/scope in the completion transaction; field history and task reads are business-scoped; DB constraints plus PostgreSQL tests. |
| Historical integrity | PASS | Separate append-only completion, task/date snapshot, original provenance references, `occurredAt` separate from server `recordedAt`. |
| API contract and compatibility | PASS | Generated OpenAPI client; additive Today metadata; existing onboarding/season paths and behavior preserved. |
| Architecture boundaries | PASS | Existing modular monolith, Prisma/PostgreSQL and Expo SQLite; no new runtime service or queue technology. |
| Testing and observability | PASS | Risk-appropriate unit, contract, real PostgreSQL, tenant, restart/retry/conflict and mobile UI tests; correlated outcome logging. |
| Scope control | PASS | No calendar, broad diary, assignments, recurrence, costs, attachments, generic sync, or device-runtime dependency. |

**Post-design gate result**: PASS. No architecture or product conflict was found. The `/today` version/timezone metadata addition is a backward-compatible contract evolution required by offline base-version and timezone correctness; it does not change SPEC-002's business behavior.

## Project Structure

### Documentation (this feature)

```text
specs/003-task-completion-history/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── task-completions.openapi.yaml
├── checklists/
│   └── requirements.md
└── tasks.md                         # Active implementation task graph
```

### Source Code (repository root)

```text
packages/domain/src/tasks/
└── completion.ts                    # Completion command, record and state/conflict rules
packages/domain/test/tasks/
└── completion.spec.ts

apps/api/prisma/
├── schema.prisma                    # TaskCompletion relations, indexes and uniqueness
└── migrations/<timestamp>_task_completion/
apps/api/src/seasons/
├── today.repository.ts              # Existing Today query; exclude accepted completions, add version/timezone
└── business-timezone.ts             # Shared resolved Business timezone/local-date policy
apps/api/src/tasks/
├── task-completion.controller.ts
├── task-completion.repository.ts
├── task-completion.service.ts
├── task-completion.error.ts
└── task-completion.error.filter.ts
apps/api/test/tasks/
├── task-completion.contract.spec.ts
├── task-completion.integration.spec.ts
└── task-history.integration.spec.ts
apps/api/test/seasons/
└── today-completion.integration.spec.ts

packages/api-client/
├── openapi-generator.config.ts
├── src/generated/task-completions-api.ts  # Generated; never hand-edited
└── test/task-completions-consumer.type-test.ts

apps/mobile/src/features/seasons/
└── today-screen.tsx                 # Completion action/status in existing Bugün
apps/mobile/src/features/tasks/
├── task-completion-command-store.ts # Injectable, completion-specific SQLite persistence
├── task-completion.ts                # Generated-client command/retry coordination
└── task-completion-history-screen.tsx
apps/mobile/test/tasks/
├── task-completion-command-store.test.ts
├── task-completion.test.ts
└── task-completion-history.test.tsx
apps/mobile/test/seasons/
└── today-completion.test.tsx
```

**Structure Decision**: Add a task-completion area inside the existing domain/API/mobile packages, extend the existing seasons Today read path, and retain current package/service boundaries. API paths stay versioned under `/v1` via the existing client base URL. The new OpenAPI contract lives under SPEC-003; the existing Today contract receives only additive metadata. This structure introduces no separate API process and changes no SPEC-001/002 product behavior; task-graph remediation is tracked in `tasks.md`.

## Complexity Tracking

No constitution violations or new service/framework/datastore/queue technology are introduced.
