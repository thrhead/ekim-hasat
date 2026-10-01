# Research: Task Completion and History

## Decisions

### Keep completion separate from the planned task

- **Decision**: Persist completion as an append-only operational record linked to the existing `PlannedTask`, season, field, business, actor, and activation provenance. Capture the planned title/date needed for a stable history row, plus `occurredAt` and server `recordedAt`. Persist actor user/membership context for historical integrity and authorization/audit. Normal farmer-facing history shows planned date and `occurredAt` rendered in Business timezone; it does not require `recordedAt` or an actor label. Do not set a mutable `completed` flag or overwrite fields on `PlannedTask`.
- **Rationale**: SPEC-002 treats planned tasks and activation provenance as read-only after activation. The PRD, Architecture, and SPEC-003 require original intent, actual occurrence, and server recording time to remain separate. A completion row can be queried as history and excluded from actionable Bugün without changing the planned task.
- **Alternatives considered**: Mutating `PlannedTask.status`/date was rejected because it blurs planned intent with the operational fact. A general event-sourcing/activity-feed system was rejected as outside this slice.

### Make the completion identity itself the permanent idempotency key

- **Decision**: The mobile client generates one UUID `completionId` when the farmer presses Complete and persists it before network submission. An exact successful replay requires the same completion ID, canonical command payload, authenticated actor, and currently authorized task/business context. A different actor never receives the first actor's result as an idempotent replay; if the task is already completed, the request follows competing-completion conflict semantics without leaking completion details outside authorized scope. The server also enforces at most one accepted completion per planned task.
- **Rationale**: An accepted completion record is durable, so exact retries by the same actor in the same authorized context can replay the same result without relying on an expiring generic idempotency cache. A database uniqueness constraint and row lock/CAS settle concurrent distinct attempts deterministically, while cross-actor attempts remain conflicts rather than exposing another actor's success.
- **Alternatives considered**: Reusing `SeasonCommandIdempotencyRecord` was rejected because the record is season-command-specific and time-limited; a generic server mutation framework was rejected as unnecessary.

### Reuse the existing Bugün boundary and extend it additively

- **Decision**: Extend the existing `/today` query to omit server-accepted completions and add the planned task version plus the resolved Business timezone to its response. Preserve its existing active-season, approved-plan, business-local-date, and authorized-business rules. Additive response fields leave current clients' required response fields unchanged.
- **Rationale**: Mobile needs the server-known base version and Business timezone to cache an actionable task safely for offline completion. A separate Today model or per-task lookup endpoint would duplicate behavior or add a round trip for each task.
- **Alternatives considered**: Creating a second offline Today endpoint was rejected as a parallel model. Fetching every season separately to recover each task version was rejected as unnecessary request fan-out. Deriving version or timezone from the device was rejected as non-authoritative.

### Keep the offline queue completion-specific

- **Decision**: Add an injectable mobile `TaskCompletionStore` backed by one completion-specific SQLite table that stores the action, cached task context, current status, and accepted server result. The table is the local outbox and local completion projection; it is not a generic entity queue. Retry pending rows when the task workflow is reopened/resumed or the farmer requests retry; do not add a global connectivity/sync service.
- **Rationale**: Expo SQLite is already used for durable unresolved commands behind an injectable storage interface. The current app has no general local domain cache/outbox, so the smallest bounded addition is a focused store that survives restarts and permits multiple pending completions.
- **Alternatives considered**: AsyncStorage was rejected as a domain store. A generalized multi-entity outbox, cursor feed, attachment queue, or new sync service was rejected as out of scope.

### Define explicit command and conflict outcomes

- **Decision**: Submit `completionId`, absolute `occurredAt`, and the cached planned-task base version. Within one transaction, revalidate the authenticated user's active Business Membership and task scope, lock the relevant authorization/task/season rows, then check replay identity, ACTIVE/APPROVED state, version, and existing completion before writing. Exact replay returns the original accepted completion only for the same ID, payload, authenticated actor, and currently authorized task/business context. Reused ID with changed input or a different actor, stale task version, task already completed by a different command, or non-actionable season returns a stable conflict; revoked membership returns the normal privacy-safe authorization failure. The mobile row becomes `CONFLICTED`, retains both local intent and available server state, and does not automatically rebase or clear.
- **Rationale**: The existing season activation path already uses transaction-scoped membership locking, task/season validation, version checks, unique command identity, and structured conflicts. Rechecking membership at synchronization ensures offline access never grants future server authority.
- **Alternatives considered**: Last-write-wins or auto-rebase was rejected because it can silently overwrite newer task or authorization state. Treating a different completion ID as a successful replay was rejected because the server cannot claim the farmer's local command was accepted when another command won.

### Use one bounded accepted-history read

- **Decision**: Add a field-scoped task-completion history operation with an optional season filter and cursor pagination. It returns accepted TaskCompletion rows only, ordered by `occurredAt` descending with a stable ID tie-breaker, plus the authorized Business timezone for display. Normal farmer-facing rows expose the planned date and actual occurrence; `recordedAt` remains persisted audit/synchronization metadata, and actor attribution remains persisted for audit rather than exposed in this response/UI.
- **Rationale**: One read serves both field history and a season-filtered view without creating a general diary, activity feed, analytics surface, or multiple duplicate APIs. A bounded page avoids unbounded history responses.
- **Alternatives considered**: A general diary/history service was rejected as outside scope. Duplicated season and field history endpoints were rejected because the same query with a season filter provides both views.

### Keep audit and asynchronous work proportional to the feature

- **Decision**: The immutable completion row records actor Membership, occurrence, server acceptance time, and planned snapshot; existing correlated request logs record command outcome/conflict category. No notification or background task is introduced, so no server-side job/outbox technology is added.
- **Rationale**: The operational record is the durable history. The Architecture requires transactional outbox only when a committed mutation has required asynchronous follow-up; this feature has none.
- **Alternatives considered**: Introducing a general audit service, event bus, worker, or notification flow was rejected as not needed to close this slice.

## Repository findings

- `apps/api/src/seasons/today.repository.ts` already resolves the authorized default Business through `MembershipScopeService`, uses Business timezone with `Europe/Istanbul` fallback, and returns only tasks due on that Business-local date in ACTIVE seasons with APPROVED plans.
- The existing Today task response omits `PlannedTask.version` and the resolved timezone; both are necessary for an offline command snapshot. Contract evolution is additive and the generated client remains the transport source of truth.
- `PlannedTask` already has an optimistic `version`; active plans are read-only through SPEC-002. `SeasonContextSnapshot` and `SeasonPlan.sourceSnapshot` hold immutable activation/provenance context.
- The API uses Prisma/PostgreSQL migrations, transaction-scoped `FOR UPDATE` checks, and stable 409 command errors in the existing season module. Business isolation is application-enforced under ADR-009; RLS is not an MVP requirement.
- `packages/api-client/openapi-generator.config.ts` generates independent OpenAPI path surfaces and `createApiClient` composes them. Add a separate SPEC-003 completion contract and regenerate; do not hand-maintain client payload types.
- `apps/mobile/src/features/seasons/season-create-command-store.ts` is the only current Expo SQLite feature store and demonstrates focused durable storage behind an injectable interface. There is no general local task cache, mutation outbox, or connectivity sync engine.
- No ADR currently defines offline sync mechanics or a global queue. The accepted Constitution/Architecture requirements plus SPEC-003's clarification govern this bounded command.
- Existing mobile tests use Jest/Jest Expo; API/domain unit/contract tests use the repository's Node test workflow; PostgreSQL integration tests run against real migrated PostgreSQL.

## Compatibility and scope

- Existing SPEC-001 onboarding contracts and behavior remain untouched.
- Existing SPEC-002 season creation, DRAFT review, activation, plan provenance, and business-local Bugün semantics remain unchanged. Only additive metadata is needed on the existing Today response; accepted completions are filtered from its existing actionable task query.
- No general sync cursor, generic mutation queue, offline field/season edits, attachments, team assignment, reporting, or new service boundary is introduced.
- Android/iOS runtime evidence is not available. Automated mobile unit/component tests remain required; device-only manual evidence is documented as deferred, never as passed.
