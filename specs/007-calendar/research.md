# SPEC-007 Research

## Decisions

### Use a dedicated authorized Calendar API reader

**Decision**: Add a Calendar read module/repository under the existing authenticated versioned API. Reuse membership scope resolution, Business timezone resolution, Prisma conventions, and response/error patterns; do not widen `GET /v1/today`.

**Rationale**: `apps/api/src/seasons/today.repository.ts` queries one exact local date and therefore cannot correctly supply overdue work, a month overview, or consistent optional Field filtering for both. It already establishes the right server-side predicates: authorized Business, ACTIVE season, approved plan, no canonical completion, and canonical planned local date. `apps/api/src/authorization/membership-scope.service.ts` is the existing Business authority. `apps/api/src/seasons/business-timezone.ts` is the existing local-date authority.

**Alternatives considered**: Reuse Today endpoint (insufficient range and would conflate product surfaces); client-side aggregation of task/season APIs (weakens server authority and produces incomplete month/overdue semantics); client-supplied Business identifier (contradicts ADR-009 and tenancy contracts).

### Derive overdue at read time and preserve the planned date

**Decision**: Derive overdue as `plannedLocalDate < businessLocalToday` with no canonical completion, keep it as a separate group, and preserve the original date. Month indicators use original planned dates.

**Rationale**: SPEC-007 freezes presentation-only overdue behavior. Existing Today/task and completion contracts keep planned dates canonical; there is no Calendar mutation.

**Alternatives considered**: Move overdue work to today or persist an overdue state (would change planning meaning and violate frozen scope).

### Bound month indicators and paginate task groups

**Decision**: Derive one Business-local month from selectedDate. Return date-presence aggregates for that month and use deterministic keyset pagination for potentially large task groups. The month indicators and task rows are captured into one Calendar-specific server read snapshot. Bind page cursors to that read identity and result group. A saved view covers task rows only for its exact selected date plus its complete overdue set; month indicators alone do not prove task-list coverage for another date.

**Rationale**: The month is a bounded navigation horizon while overdue work has no natural lower date bound and can grow. UI remains a one-selected-date agenda and does not become a backlog. Completion metadata prevents partial pages from passing offline coverage checks, while exact-date coverage avoids requiring a season/month task backlog solely for offline navigation.

**Alternatives considered**: One unbounded response (does not bound potentially large overdue results); independent live keyset queries on each request (can observe different database states and skip/duplicate work); keeping a repeatable-read transaction open across HTTP requests (holds database resources and does not fit request lifecycle); preloading every task in a month (unnecessary and expands offline data beyond the date-oriented view). A Calendar-specific persisted read snapshot is selected as the smallest option that keeps page reads coherent without requiring a generic snapshot or event platform.

### Establish one coherent, paginated Calendar read

**Decision**: Create an immutable Calendar read snapshot in a single PostgreSQL `REPEATABLE READ` transaction. The first statement establishes the MVCC snapshot and records database statement-start UTC `asOf`; within that snapshot resolve the authenticated user's default Business and current Membership, and lock/revalidate active membership/default-Business authorization. Resolve the server-authoritative Business timezone, using the existing `Europe/Istanbul` fallback when required, and derive Business-local today from that same `asOf`. If request `selectedDate` is omitted, use that Business-local today; if supplied, validate and use the explicit date. Return the resolved `selectedDate` in `CalendarRead` and bind that resolved value into the read identity. Validate the optional Field, then compute month indicators and eligible task projections from that same database snapshot. Persist only these Calendar projections under a server-generated random `readId`: the at-most-31 month indicators as JSON on the snapshot row and selected-date/all-overdue task rows in a Calendar task-projection table. Store verified user/membership, Business, resolved selected date, Field scope, month/date context, eligibility/query version, `asOf`, and a fixed 15-minute expiry. Commit/publish the read only after every projection component is persisted; rollback leaves no usable read. Continuation requests revalidate current authorization in their own transaction and query only immutable snapshot rows. The client omits `selectedDate` only for initial open; explicit farmer date selections supply it. Device timezone never determines the initial selection.

The read identity is the persisted server record, not a client assertion or field that can be forged. Each random cursor token is stored against `readId`, group, and stable last key under ascending order `(plannedLocalDate, taskId)`; a uniqueness rule on the key makes cursor issuance stable on retries. The repository's existing history cursors use encoded sort keys and query binding, but do not provide a shared point-in-time query across result groups; Calendar's stored random cursor tokens avoid adding a new signing-key dependency and prevent caller-chosen last keys. Replaying a cursor is idempotent. Tasks completed, inserted, deleted, or made ineligible after the transaction do not alter this snapshot; a new read reflects the newer canonical state. Each continuation request reauthenticates and revalidates current Business membership and Field access; loss of authorization ends the read without returning cached server projection data.

The mobile client stages the initial response and all page chains by `readId`. It promotes data to a complete local saved view only after month indicators are complete and both selected-date and overdue cursor chains reach terminal pages for the same identity and exact query scope. Expired, invalid, interrupted, mixed, or incomplete reads are discarded and restarted with a new identity; no pages are combined across reads. If restart cannot complete, only a separate already-complete local view matching the exact date and Field scope can serve the approved retryable-offline fallback.

**Rationale**: The repository has mutable planned-task rows with per-task versions and completion records that preserve historical task snapshots, but no shared revision or temporal query facility for coordinating current task state with month aggregates across HTTP requests. Separate live queries or cursors therefore cannot prove completeness under concurrent changes. PostgreSQL repeatable-read plus Calendar-only materialized projections gives a coherent point-in-time result using the existing database and Prisma transaction boundary; the short-lived table does not become a reusable platform or canonical domain state.

**Alternatives considered**: Live keyset pages (unsafe under changing eligibility); long-lived database transaction across client requests (resource/lifecycle risk); generic snapshot service or event log (broader than Calendar and unsupported by current repository evidence); prefetch the full month task set (unnecessary for scope).

### Keep Calendar offline persistence feature-specific

**Decision**: Store completed/in-progress farmer-visible Calendar views in separate SQLite tables in the existing mobile database, partitioned by authenticated account and server-resolved Business, with explicit month-indicator coverage, exact selected-date/Field task coverage, `readId`, fetch time, and completion metadata. The API's short-lived immutable read pages are separately stored in Calendar-specific PostgreSQL/Prisma tables. Never use the task mutation outbox or Today snapshot table.

**Rationale**: SPEC-003 owns completion commands and Today-specific snapshot behavior. SPEC-004 and the architecture reject generic cache/sync infrastructure. SPEC-007 explicitly approves only read-only Calendar saved views.

**Alternatives considered**: Reuse `today_task_snapshot` (wrong date grain and currently account-only); put records into task outbox (would imply mutations); generic offline query cache (out of scope); no saved view (contradicts frozen scope).

### Permit saved view only for retryable connectivity failure and complete matching coverage

**Decision**: Attempt Calendar snapshot fallback only for genuine connectivity/retryable failures. Require exact account and Business match, matching stored Field coverage, the exact selected date, complete selected-date and overdue task page chains, and complete month indicators, all from the same server `readId`. Month indicators are month-level metadata; they do not cover task rows for other dates. Any unproven condition is unavailable. Explicit authentication/authorization denial or known access loss never falls back.

**Rationale**: Clarification for SPEC-007 FR-016/018 explicitly permits date/Field changes only with full coverage and prohibits partial display/speculative merge. The accepted frozen scope prohibits fallback after 401/403 or known membership loss.

**Alternatives considered**: Treat any cached rows as usable (partial-data risk); merge independent snapshots (unverifiable coverage); use cached data after auth denial (disclosure risk); introduce authorization leases/background reconciliation (explicitly excluded).

### Keep task details read-only and within Calendar's data boundary

**Decision**: Supply the task name, original planned date, Field, Season/plan context, and overdue status in the Calendar task projection so task details use the same read identity and can be saved with the authorized view. Do not link into a mutating detail workflow.

**Rationale**: SPEC-007 preserves task/date context and separates Calendar browsing, Today execution, and History/Diary records.

**Alternatives considered**: Route task taps to Field detail (loses task/date focus); reuse completion workflow (adds execution behavior); duplicate completed work (violates SPEC-003/006).

### Use latest-request identity for mobile state

**Decision**: Gate state and persistence writes with a generation/request identity containing account, Business context, selected date/month and Field filter; ignore superseded responses and clear in-memory state on auth-context changes.

**Rationale**: Calendar controls can change while network requests overlap. Existing History uses request identity patterns; Today code is a precedent for load states but does not provide the same race guard. Scope changes must not let an old result replace the selected view.

**Alternatives considered**: Apply responses on arrival (older request can overwrite current scope); introduce a generic request/sync framework (not needed).

### Use native adaptive accessibility conventions

**Decision**: Preserve meaningful date/work indicators and selected/filter/status semantics for assistive technology, native navigation/back behavior, touch target and system text scaling conventions. Leave exact indicator form and visual styling to the approved Impeccable design phase.

**Rationale**: SPEC-007 FR-019 requires understandable accessible names/status. Impeccable context identified an incumbent mobile design system without a separate DESIGN.md and recommends extending it; platform guidance is advisory and does not redefine scope.

**Alternatives considered**: Choose visual marker style in the technical plan (premature styling decision); rely on color-only dots (does not meet accessible semantic requirement).

## Evidence Sources

- `apps/api/src/seasons/today.repository.ts`: authorized exact-day task read and canonical task projection.
- `apps/api/src/seasons/business-timezone.ts`: Business timezone and local-date semantics.
- `apps/api/src/authorization/membership-scope.service.ts`: server-resolved Business membership scope.
- `apps/api/src/seasons/today.controller.ts` and `apps/api/src/seasons/today.module.ts`: authenticated versioned read API wiring pattern.
- `apps/api/src/tasks/task-completion-history.controller.ts`: validated query/keyset pagination precedent.
- `apps/mobile/App.tsx`: existing disabled primary Takvim navigation destination.
- `apps/mobile/src/features/seasons/today-screen.tsx`: loading/error/empty/saved-data UI patterns; not reused as a Calendar cache contract.
- `apps/mobile/src/features/tasks/task-completion-command-store.ts`: existing SQLite database, completion outbox, and Today-only snapshot boundary; Calendar must remain separate.
- `docs/ADR/ADR-009-business-isolation-strategy.md`: server-side Business membership and isolation authority.
- `specs/001-*` through `specs/006-*`: existing completed task, date, season, weather, field, completion/history and diary boundaries; Calendar additions do not revise them.
- `docs/PRD.md`, `docs/ARCHITECTURE.md`, and `.specify/memory/constitution.md`: agenda-first Calendar intent, local date/SQLite/server authority, and bounded offline rules.
- Impeccable context in `apps/mobile`: existing product/design context and platform accessibility guidance; advisory only.

## Unresolved Clarifications

None. Detailed visual indicator treatment remains intentionally assigned to the later Impeccable design phase and does not affect product semantics.
