# SPEC-007 Data Model

PostgreSQL remains canonical. The models below describe Calendar projections and its local, read-only saved view; Calendar does not create or mutate domain tasks.

## Canonical read entities

### CalendarTaskProjection

| Field | Meaning |
|---|---|
| `taskId` | Existing canonical planned-task ID. |
| `title` | Existing farmer-facing task name. |
| `plannedLocalDate` | Original canonical Business-local planned date; immutable from Calendar. |
| `taskVersion` | Existing task version where available for stable projection/read identity. |
| `fieldId`, `fieldName` | Authorized Field identity and display name. |
| `seasonId`, `seasonContext` | ACTIVE Season identity and relevant display context. |
| `planContext` | Existing approved plan provenance needed for read-only details. |
| `overdue` | Derived for this read when unfinished and `plannedLocalDate < businessLocalToday`; not persisted to the task. |

### CalendarReadScope

Resolved on the server from authenticated identity: account/user identity, authorized Business membership, Business timezone, optional validated Field filter, resolved selected date, and its Business-local month. When request `selectedDate` is omitted, the server derives current Business-local today from its captured `asOf`; when supplied, the server validates and uses that explicit date. The API returns the resolved `selectedDate`, which is bound into the logical read identity and saved-view identity. Client input cannot establish account, Business, role, or Field authority, and device timezone never determines the initial date.

### CalendarDayIndicator

Business-local date and whether one or more qualifying unfinished ACTIVE-season tasks have that original planned date under the resolved scope. A count may be returned if useful, but presence semantics are required; exact display is left to design. Overdue work is indicated on its original date.

### CalendarReadSnapshot (short-lived API persistence)

An immutable Calendar-specific projection created in one PostgreSQL `REPEATABLE READ` transaction. `readId` is the primary key and is the parent key referenced by every task projection and cursor row. Fields: opaque random `readId`; verified `userId` and `membershipId`; server-resolved `businessId`; authorized Field scope (`ALL_AUTHORIZED` or a validated `fieldId`) plus the exact `includedFieldIds` captured for that read; resolved `selectedDate` (validated request value or Business-local today when omitted); `businessTimezone`; `businessLocalToday`; `monthStart`/`monthEnd`; eligibility/query version; complete month-indicator JSON (one entry for each month date); UTC `asOf` captured by the first statement that establishes the MVCC snapshot; expiry timestamp; and `READY` state. Add a B-tree index on `expiresAt` for request-time expiry lookup. No read ID is published until snapshot components commit. No client-supplied business identity is trusted. Current membership and Field authorization are revalidated on every continuation request.

### CalendarReadSnapshotTask

Snapshot task rows hold immutable task projections grouped as `selectedDateTasks` or `overdueTasks`; the groups are disjoint. Each row has a required `readId` foreign key to `CalendarReadSnapshot.readId` with `ON DELETE CASCADE`, plus a projection-row primary key (or composite primary key including `readId`) and uniqueness for `(readId, group, taskId)`. `taskId` is copied as projection identity only; it must not have a foreign key to the mutable canonical task row. `plannedLocalDate < businessLocalToday` defines `overdueTasks`; `plannedLocalDate = selectedDate` and not overdue defines `selectedDateTasks`. If a past date is selected, its tasks remain only in `overdueTasks`. Stable ascending ordering is `(plannedLocalDate, taskId)`. Projections are generated from the same repeatable-read database view as month-indicator JSON and remain readable when canonical tasks are later deleted or changed. The snapshot stores exact selected-date tasks and all overdue tasks, not task rows for every date in the month.

### CalendarReadCursor

A random server-issued token associated with one `readId`, one task group, and one stable last key `(plannedLocalDate, taskId)` under ascending order. `token` has a unique constraint; required `readId` references `CalendarReadSnapshot.readId` with `ON DELETE CASCADE`. A uniqueness constraint on `(readId, group, lastKey)` ensures a retry returns the same next token. The token is stored in a Calendar-specific cursor table, so the server can reject unissued or cross-read/group tokens without introducing cursor-signing key infrastructure. It is not authorization; every continuation still revalidates current membership and Field access. Reusing a valid token returns the same immutable page.

### Expired-read deletion

Prune expired reads only during Calendar read creation/request handling, using the `expiresAt` index and a bounded batch (fixed small maximum per request). Delete parent `CalendarReadSnapshot` rows only; database `ON DELETE CASCADE` removes child task projections and cursor rows. No scheduler, worker, or unbounded cleanup scan is introduced. Expiry checks still reject an expired read even when it has not yet been pruned.

### CalendarReadPage

An ordered page of at most 50 immutable snapshot task rows for one group, with `readId`, the consumed cursor token where applicable, and `nextCursor` (absent only when terminal for that group). Page order is stable. Since only server-issued cursor tokens resolve to stored last keys, a caller cannot forge a later key and skip rows.

## Mobile-only persistence

### CalendarSnapshot

One complete or incomplete in-progress saved Calendar read model. Suggested columns: `snapshot_id`, `account_id`, `business_id`, `field_scope_kind`, `field_id` when narrowed, `month_start`, `month_end`, exact server-resolved `selected_date`, `business_timezone`, `business_local_today_at_fetch`, `server_read_id`, `fetched_at`, `month_indicators_complete`, `selected_date_tasks_complete`, `overdue_complete`, `coverage_status`, and source metadata. Persist the response's resolved date whether the request omitted it or explicitly supplied it. Never store auth tokens or interpret snapshot membership as current authorization.

### CalendarSnapshotTask

Feature-specific task rows keyed by local saved view, group and canonical task ID, preserving title/context, Field/Season/plan display fields, unchanged `plannedLocalDate`, task version, and original-date group. Rows are written transactionally as pages arrive; the parent remains ineligible until the exact selected-date task set and overdue cursor chains are complete for one server `readId`. Rows for one selected date do not imply coverage of other dates in the month.

### CalendarSnapshotDay

One row per covered Business-local month date with work-presence (and optional aggregate count). This makes month indicators locally complete for that exact month and scope.

## Validation and invariants

- Canonical query includes only ACTIVE Season, approved plan, authorized Business/Field, and tasks without accepted completion.
- Calendar writes no canonical records.
- Expired Calendar reads are bounded Calendar storage hygiene only: request-time pruning uses the indexed expiry lookup, deletes at most a fixed batch of expired parents, and cascades only Calendar-owned projections/cursors. No worker or scheduler is required.
- `plannedLocalDate` is preserved, not recomputed from UTC or device timezone.
- The API read snapshot is coherent because every projection is captured in one repeatable-read transaction and later pages read only immutable snapshot rows. Its identity binds the resolved selected date. When the request omits `selectedDate`, the server derives Business-local today from captured `asOf`, authoritative Business timezone, and the existing `Europe/Istanbul` fallback. Explicit selected dates are validated and used. Concurrent canonical changes after snapshot creation do not alter its page membership or ordering; they appear in a newly created read. Expired or unauthorized continuation requests return no data.
- A complete local saved view includes all selected-date task pages, all overdue pages, and all month indicators from one server `readId`, for one exact Field scope. Other dates are offline-selectable only if a complete saved view exists for that exact date and matching scope; month indicators alone are not task-list coverage. A page gap, invalid read, or mixed read ID makes the local view incomplete.
- The short server-read expiry prevents further API paging; it does not expire or revoke a local saved view that was already promoted to complete before the deadline. An incomplete staged local view whose server read expires is discarded.
- A Field-specific snapshot covers only that Field. An all-Fields snapshot may be narrowed only when its complete stored projection and server-provided coverage metadata prove that Field was included in that snapshot.
- Snapshot partition must match authenticated account and Business. Access denial is handled before snapshot display eligibility.
- Snapshot data are immutable for display once marked complete; refresh replaces the matching snapshot atomically rather than speculative cross-snapshot merging.
- No task state transitions or offline mutation entities are introduced.
