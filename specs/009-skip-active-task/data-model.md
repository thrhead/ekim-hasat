# SPEC-009 Data Model

## Existing canonical entity: PlannedTask

Existing Prisma model: `PlannedTask` in `apps/api/prisma/schema.prisma`.

| Field | Meaning | SPEC-009 behavior |
|---|---|---|
| `id` | Stable task identity | Identifies the single task instance being skipped. |
| `seasonPlanId` | Owning plan | Must resolve to the task's authorized ACTIVE Season and APPROVED plan. |
| `plannedLocalDate` (`DATE`) | Current canonical planned date | Not changed by Skip; its current value is copied into the immutable Skip snapshot. |
| `version` (`Int`) | Optimistic task version | Required through `If-Match`; incremented atomically on accepted Skip to invalidate stale task commands. |
| `completion` relation | Accepted completion, if present | A task with a completion cannot be skipped. |
| `skip` relation | Accepted Skip, if present | A task with a Skip cannot be completed, skipped again as a new command, or date-adjusted. |

`TaskCompletion` and `TaskDateAdjustment` remain separate existing entities. No general status enum is added to `PlannedTask`.

## New entity: TaskSkip

One immutable row represents one accepted farmer decision to Skip one PlannedTask. It is the authoritative Skip event, Task History source and Field Diary source; no duplicate diary row is written.

| Field | Type / meaning | Rule |
|---|---|---|
| `id` | Server-generated UUID | Internal primary key and final total-order tie-breaker; not a client authority token. |
| `skipId` | Client-generated UUID | Public command identity, stable for exact retries, unique only within the authorized Business. |
| `plannedTaskId` | UUID | Target task; unique so at most one Skip outcome is stored per task. |
| `seasonPlanId` | UUID | Owning plan captured at acceptance and paired with task FK. |
| `seasonId` | UUID | Owning Season captured at acceptance. |
| `fieldId` | UUID | Owning Field captured at acceptance. |
| `businessId` | UUID | Authorized Business captured at acceptance; used for tenant-scoped identity and reads. |
| `actorUserId` | UUID | Authenticated application user who accepted the action. |
| `actorMembershipId` | UUID | Current Business membership used to authorize the action. |
| `skippedAt` | UTC timestamp | Server acceptance time; not client-supplied. This is the Skip event time for Task History and Field Diary. |
| `baseTaskVersion` | Integer | PlannedTask version supplied in `If-Match`. |
| `acceptedTaskVersion` | Integer | PlannedTask version after the atomic increment; equals base version + 1. |
| `payloadFingerprint` | SHA-256 string | Binds the `skipId` to task, actor/context and base version; changed input under the same Business-scoped ID conflicts. |
| `taskTitleSnapshot` | String | Task title at acceptance, retained for history even if future product changes permit title changes. |
| `plannedLocalDateSnapshot` | PostgreSQL `DATE` | Canonical planned date at acceptance, including any prior accepted date adjustment. Does not replace or erase adjustment history. |

### Relationships and indexes

- Add optional one-to-one `PlannedTask.skip` relation. `TaskSkip.plannedTaskId` is unique and references the task together with `seasonPlanId` using the existing composite task/plan key.
- Use composite foreign keys consistent with `TaskCompletion`: task/plan, plan/season, Season/Business/Field, Field/Business and actor Membership/Business/User must agree. Referenced historical rows use `ON DELETE RESTRICT`.
- Enforce `UNIQUE (businessId, skipId)` and `UNIQUE (plannedTaskId)`. Keep internal `id` as the row primary key. A public ID collision in another Business is independent and unobservable.
- Add bounded-read indexes for `(fieldId, skippedAt DESC, id DESC)` and `(seasonId, skippedAt DESC, id DESC)`; use matching task history access paths where query plans require them.
- No application update/delete path is provided for `TaskSkip`. It is an append-only feature-specific outcome, not a generic event store.

### Cross-table terminal invariant

Ordinary unique constraints cannot enforce that separate `TaskCompletion` and `TaskSkip` tables are mutually exclusive for one `PlannedTask`. Preserve the existing shared task-row lock in all mutation paths and require each path to check both terminal records in the same transaction:

- Skip rejects existing completion or Skip.
- Completion rejects existing Skip before writing a completion.
- Date adjustment rejects existing Skip before changing the date.

The first terminal mutation to commit while holding the shared task-row lock wins. Real PostgreSQL concurrency tests are required. Do not add a generic status abstraction or database trigger solely to duplicate this established application invariant.

## Command and state transition

Input: authenticated task ID, required `If-Match` task version, client-generated `skipId`. Business identity, actor and acceptance time are derived by the server.

Accepted transaction:

1. Resolve current Business membership from verified identity; lock and revalidate current user/membership and authorized Season/plan/task context.
2. Look up `(authorized businessId, skipId)` only after current authorization and path task scope are established. Exact actor/task/season/fingerprint retry returns the original Skip before current version checks; any changed identity/payload is `IDEMPOTENCY_KEY_REUSED`.
3. For a new `skipId`, require no TaskCompletion and no TaskSkip, an ACTIVE Season, APPROVED plan with activation snapshot, and `PlannedTask.version == If-Match`.
4. Conditionally increment PlannedTask version from base to accepted version and insert TaskSkip with actor, context, snapshots, fingerprint and server time in the same transaction.
5. Commit both changes together. Any rejection rolls back both and creates no Skip event.

After a Skip is accepted, the task's canonical planned date is unchanged; its latest value is preserved in the Skip row. Existing TaskDateAdjustment rows remain untouched. A later exact replay returns the original Skip event even if current eligibility/version would otherwise reject a new command, but only after authorization is revalidated.

## Task History read model

Add a separate Field-scoped, optional-Season-filtered, bounded Task History read containing a discriminated union of canonical completion and Skip records. Keep the legacy completion-only endpoint unchanged for compatibility. History order is `(eventAt DESC, kind ASC, eventId DESC)` where completion uses its occurrence time and Skip uses server acceptance time. The cursor binds to authorized Field, optional Season, event time, kind and event ID. Each source query is bounded and applies strict-after filtering before the merge.

Task History completion entries continue to project canonical `TaskCompletion` snapshots. Skip entries project `TaskSkip` snapshots. Local pending/conflicted offline completions remain a distinct mobile-only pending section and are never shown as accepted Task History.

## Field Diary read model

Extend the existing Diary union with `TASK_SKIPPED`; source it directly from TaskSkip. Display “Task skipped” (localized farmer-facing copy) with task title, planned date snapshot, Season/Field context and `skippedAt`. It is not a completion, and no second event row is persisted.

Preserve global order `(occurredAt DESC, kind ASC, id DESC)` and strict-after pagination. Existing observation/completion cursor tokens remain valid; accept `TASK_SKIPPED` for new tokens. Update each source query's cursor predicate so same-time ordering agrees with the global tuple and no records repeat or are omitted.

## Current-work projections

- Bugün query excludes tasks with either `completion` or `skip` relation.
- Calendar eligible-task query excludes both before coherent read snapshot and month/group projection generation.
- Existing Calendar snapshots are immutable and are not rewritten after Skip. New reads after the Skip commits exclude the task; saved offline reads retain their existing stale/read-only semantics and do not enable Skip.
- After confirmed Skip from Bugün or Calendar, prune the task from the in-memory/current view and existing cached Today projection so the accepted terminal outcome is not actionable after failed refresh or app restart. This writes no Skip record/outbox entry locally and does not alter pending offline Task Completion records. If pruning fails, invalidate the cached projection or keep the task suppressed rather than presenting it as actionable.
