# SPEC-009 Research: Skip an Active-Season Task

## 1. Skip persistence and terminal semantics

**Decision**: Add a dedicated immutable `TaskSkip` row related one-to-one with `PlannedTask`. Do not represent Skip as `TaskCompletion`, do not overload `TaskDateAdjustment`, and do not add a generic task status framework.

**Rationale**: `TaskCompletion` already stores actual occurrence and completion snapshots; `TaskDateAdjustment` records mutable planning-date history. Skip has different meaning and audit metadata. A separate record preserves these distinctions and naturally excludes skipped tasks from current-work queries through a nullable one-to-one relation, like completion.

**Evidence**: `apps/api/prisma/schema.prisma` defines `PlannedTask.version`, one-to-one `TaskCompletion`, and separate `TaskDateAdjustment`. `specs/003-task-completion-history/data-model.md` makes completion an immutable operational fact. `specs/008-manual-active-season-task-adjustment/data-model.md` preserves date changes as append-only rows.

**Alternatives considered**: Add `status = SKIPPED` to PlannedTask; rejected because it makes an audit event mutable task state and expands the domain toward a general status framework. Store Skip as a fake completion; rejected because completion has occurrence semantics and must never represent skipped work. Reuse TaskDateAdjustment; rejected because a date change is not a terminal outcome.

## 2. Terminal concurrency and task version

**Decision**: Use the existing transaction lock order over current user/membership and authorized season/plan/task rows. Skip atomically increments `PlannedTask.version` and inserts its immutable record. Completion and date adjustment must check for an accepted Skip under the same lock before accepting a new operation. First committed terminal outcome wins; the other incompatible operation returns a typed conflict.

**Rationale**: All current task mutations lock `Season`, `SeasonPlan`, and `PlannedTask` with `FOR UPDATE`. This provides a single serialization point for completion, Skip, and adjustment. `TaskDateAdjustment` already conditionally updates the task version and stores base/accepted versions. Completion does not increment the task version, so a distinct Skip check is still required in completion even when a caller presents the current version. Incrementing on Skip invalidates stale cached task commands and records the version transition without rewriting completion or date history.

**Race outcomes**:

- **Skip vs Complete**: whichever obtains the task lock and commits first is the sole terminal outcome. If completion wins, Skip returns `TASK_ALREADY_COMPLETED`; if Skip wins, completion returns the existing `TASK_NOT_ACTIONABLE` conflict code from the Task Completion contract.
- **Skip vs date adjustment**: if adjustment commits first, it changes the version and date; an old Skip conflicts with `TASK_VERSION_CONFLICT`, while a refreshed Skip records the new current date. If Skip commits first, date adjustment returns its existing `TASK_NOT_ACTIONABLE` conflict code. The Skip endpoint itself continues to use `TASK_ALREADY_SKIPPED` for a new Skip attempt against an already skipped task.
- **Repeated Skip identity**: current authorization is revalidated, then exact Business-scoped identity/payload replay returns the original event before live version checks. A key reused for another task/actor/payload conflicts.
- **Different Skip identity on terminal task**: returns a stable terminal-task conflict and writes no second event.

**Evidence**: `apps/api/src/tasks/task-completion.repository.ts` and `task-date-adjustment.repository.ts` share row-lock order and transaction-scoped authorization. SPEC-008 uses `If-Match`, conditional version increment, payload fingerprint and exact retry recovery. `apps/api/src/tasks/task-completion.repository.ts` currently does not increment task version on completion.

**Alternatives considered**: Rely only on per-table unique constraints; rejected because independent `TaskCompletion` and `TaskSkip` unique constraints cannot enforce mutual exclusion across tables. Add a shared generic terminal-outcome table/framework; rejected as unnecessary scope. Use serializable isolation; rejected because the existing shared row lock plus cross-checks provide an established bounded pattern.

**Residual invariant**: PostgreSQL cannot enforce cross-table TaskCompletion/TaskSkip mutual exclusion with the current simple schema. Every application writer of task terminal outcomes must retain the shared row lock and cross-check; tests must exercise concurrent requests against real PostgreSQL.

## 3. Authorization and idempotency

**Decision**: Require authenticated identity, current Business membership/scope, authorized task path, required `If-Match` version, and client-generated `skipId`. Scope is derived from authenticated membership, never from a body Business ID. Uniqueness for public `skipId` is `(businessId, skipId)`; the event has a server-generated internal row ID and payload fingerprint.

**Rationale**: This follows SPEC-008’s task mutation pattern while keeping public command identity Business-scoped. Authorization is revalidated before exact replay, so retry does not grant stale or revoked authority. Unknown and foreign task identities remain privacy-safe.

**Evidence**: `apps/api/src/authorization/membership-scope.service.ts`, task completion and task date adjustment repositories, `specs/008-manual-active-season-task-adjustment/contracts/task-date-adjustments.openapi.yaml`, and `apps/api/test/tasks/task-date-adjustment.authorization.integration.spec.ts`.

## 4. Task History contract and compatibility

**Decision**: Add a new bounded `GET /fields/{fieldId}/task-history` response that is a discriminated union of completed and skipped task outcomes. Preserve existing `GET /fields/{fieldId}/task-completions` unchanged. Adapt the current mobile history experience to use the outcome history and label outcomes distinctly; keep locally pending/conflicted offline completion rows clearly separate and unchanged.

**Rationale**: Current Task Completion History is completion-only and labels all entries completed. Expanding that response in place would change the interpretation of an existing operation for installed clients. A separate outcome-history route satisfies the approved Task History behavior without reclassifying completion rows or breaking the legacy contract.

**Ordering**: Use immutable event time (`TaskCompletion.occurredAt` or `TaskSkip.skippedAt`), outcome kind, and event ID as a strict total order. Bind the cursor to authorized Field and optional Season. Bound candidate reads per event source and merge/page in the shared API projection.

**Evidence**: `apps/api/src/tasks/task-completion.repository.ts:readHistory`, `apps/api/src/tasks/task-completion.controller.ts`, `apps/mobile/src/features/tasks/task-completion-history-screen.tsx`, and SPEC-003’s frozen task-completion contract.

## 5. Field Diary extension

**Decision**: Extend the existing Diary discriminator with `TASK_SKIPPED`, backed by the canonical `TaskSkip` row. Do not create duplicate Diary records. Update the existing canonical contract `specs/006-field-observations-basic-diary/contracts/observations-diary.openapi.yaml` and regenerate its client output.

**Rationale**: Diary already combines source records, sorts by event time/kind/ID, and continues with a typed strict-after cursor. A distinct kind keeps “Task skipped” separate from “Completed work.”

**Cursor handling**: Preserve the current global order and make each source’s database strict-after filter agree with `(occurredAt DESC, kind ASC, id DESC)`. Old cursors containing `OBSERVATION` or `TASK_COMPLETION` remain valid; `TASK_SKIPPED` is added to accepted kinds. When the cursor is a completion, equal-time skip events follow it by kind; when the cursor is a skip, equal-time completion events precede it and must not repeat.

**Evidence**: `apps/api/src/observations/diary-query.ts`, `observation-diary.repository.ts`, `task-completion.repository.ts:readDiaryCandidates`, and `apps/mobile/src/features/observations/field-diary-screen.tsx`.

## 6. Bugün and Calendar projections

**Decision**: Exclude a skipped task at each server source query (`TodayRepository.readToday` and `CalendarReadRepository.readEligibleTasks`) by requiring no Skip record, alongside the existing no-completion condition. Apply the Calendar exclusion before coherent read snapshot creation. On accepted mobile Skip, refresh the active current-work view.

**Rationale**: The existing completion relation is the canonical actionability filter. A one-to-one Skip relation can be applied at the same eligibility boundary. Filtering Calendar before snapshot/projection creation ensures selected-date tasks, overdue tasks and month indicators share one result.

**Saved Calendar reads**: Do not rewrite old `CalendarReadSnapshot` rows or invalidate unrelated saved views. They remain immutable read-only snapshots with existing stale-data signaling and cannot offer Skip actions while offline. A newly created Calendar read after committed Skip excludes the task.

**Evidence**: `apps/api/src/seasons/today.repository.ts`, `apps/api/src/calendar/calendar-read.repository.ts`, `apps/api/src/calendar/calendar-pages.service.ts`, `apps/mobile/src/features/calendar/calendar-screen.tsx`, and SPEC-007’s coherent-read/saved-view rules.

**Accepted Today projection**: Today can render a cached task with its existing offline completion action. After server-confirmed Skip from either Bugün or Calendar, remove the task from the in-memory/current view and the existing account-scoped cached Today projection using its current read/write boundary. This is projection maintenance only: write no Skip command/outbox entry and do not alter any offline Task Completion command. If cache pruning fails, invalidate the cached Today projection or keep the task suppressed rather than allowing a subsequent fallback to restore stale actionable work. A fresh server read remains authoritative.

## 7. Mobile retry and offline behavior

**Decision**: Use an online request with one stable `skipId` per logical action. Retain the identity and original task version only in ephemeral memory while the action is open if the response is uncertain. Do not persist or queue Skip. Show connectivity required while offline; after acceptance refresh Bugün/Calendar and close the action. Leave the completion command store/coordinator and its synchronization behavior unchanged.

**Evidence**: SPEC-008’s `task-date-adjustment.ts` flow keeps an uncertain command in memory and retries the exact request. SPEC-003’s local completion store is durable and domain-specific; SPEC-009 explicitly excludes offline Skip.

An accepted Skip from either surface may prune the corresponding task from the cached Today projection as described above; that cache contains a server-read projection, not a queued Skip. The command identity remains ephemeral. If the server result is uncertain, retain the exact command only while the action is open; exact retry or a fresh server read resolves the outcome.

## 8. API/client generation and ADR assessment

**Decision**: Add SPEC-009 OpenAPI contract for mutation and task outcome history; add it to `packages/api-client/openapi-generator.config.ts`, export generated types through `packages/api-client/src/index.ts`, and consume generated types on mobile. Extend SPEC-006’s existing Diary OpenAPI source and regenerate its existing output. Do not hand-maintain transport types.

**Evidence**: `packages/api-client/openapi-generator.config.ts` generates one source contract at a time; `packages/api-client/src/index.ts` composes path types. SPEC-008 follows this pattern for task date adjustment.

**ADR**: No new ADR is required. This design extends current task records, transaction locks, OpenAPI client generation and Diary union patterns without changing an architecture boundary.

## 9. Risks and verification focus

- The cross-table terminal invariant depends on every task mutation using the same task-row lock and checking both terminal records. Cover completion/Skip/adjustment races in PostgreSQL integration tests.
- Task History and Diary use different but compatible read contracts; verify stable pagination and same-time tie behavior across all event kinds.
- Skip increments task version while completion does not. Verify stale offline completion becomes an explicit server conflict after accepted Skip, without modifying the completion outbox or falsely recording completion.
- A Calendar read created before Skip remains an immutable older snapshot. Verify fresh reads exclude Skip and existing saved read-only data is still marked stale and has no mutation action.
- Keep API error distinctions privacy-safe: foreign/unknown task lookup must not reveal cross-Business existence.
