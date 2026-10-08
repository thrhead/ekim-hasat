# SPEC-008 Research: Manual Active-Season Task Adjustment

## Decisions

### 1. Keep active-season adjustment separate from draft plan editing

**Decision:** Add a task-scoped date-adjustment command in the existing task/domain API modules. Do not relax or reuse the DRAFT-only plan editor as an ACTIVE-plan editor.

**Evidence:** SPEC-002 makes task add/edit/remove a DRAFT plan operation (`specs/002-first-season-setup/spec.md`, `plan.md`, and `apps/api/src/seasons/seasons-plan-task.repository.ts`). Domain `editPlanTask` asserts DRAFT. SPEC-003 completion and the current completion repository operate on an individual `PlannedTask` within its Season/plan.

**Rationale:** SPEC-008 changes one planned date on an unfinished ACTIVE task. A distinct command preserves the completed DRAFT/ACTIVE boundary and avoids expanding arbitrary plan editing.

**Alternative rejected:** Allow the SPEC-002 plan mutation path to modify ACTIVE plans. That would broaden both the authorization/state boundary and the frozen product scope.

### 2. Use the existing task version for optimistic concurrency

**Decision:** Use `PlannedTask.version` as the expected version for adjustment, send it as the required `If-Match` precondition, and increment it atomically with the canonical planned date. Do not use or increment `Season.version` for this task-scoped command.

**Evidence:** `PlannedTask.version` exists in `apps/api/prisma/schema.prisma`; Today returns it in `apps/api/src/seasons/today.repository.ts`; Calendar snapshots capture it in `apps/api/src/calendar/calendar-read.repository.ts`; task completion accepts `If-Match` and rejects a stale task version in `apps/api/src/tasks/task-completion.controller.ts` and `task-completion.repository.ts`. SPEC-002 uses `Season.version` for aggregate DRAFT edits.

**Rationale:** A date change modifies one task and is consumed from both task reads. The task version is already the shared version precondition for task actions. Keeping season version unchanged avoids invalidating unrelated plan-level state.

**Alternative rejected:** Add a parallel adjustment version or use `Season.version`. Neither improves protection over the canonical task version; a second version would risk divergence.

### 3. Make a dedicated append-only adjustment record the audit and retry identity

**Decision:** Add a dedicated `TaskDateAdjustment` row for each accepted change. Give the row an independent server-generated UUID primary key; use the client's `adjustmentId` as the public idempotency identity with uniqueness enforced only on `(businessId, adjustmentId)`. Retain a payload fingerprint and store the row in the same transaction as the task update. A rejected `NO_DATE_CHANGE` request is not accepted and creates no row or successful idempotency receipt. Do not put this history in Diary, a generic event store, or a generic audit-event payload.

**Evidence:** `TaskCompletion` is a task-specific immutable operational record with actor, Business/Field/Season/task scope, a version and a fingerprint (`apps/api/prisma/schema.prisma`, `apps/api/src/tasks/task-completion.repository.ts`). Its public completion ID is globally unique, so its global-ID lookup must not be copied for SPEC-008, which has an explicit cross-Business non-disclosure requirement. `BusinessCommandIdempotencyRecord` uses a compound `(userId, businessId, command, key)` uniqueness boundary; tenant-scoped composite identities are also used elsewhere in Prisma. These patterns support keeping public adjustment identity scoped to Business while retaining a durable feature-specific row.

**Rationale:** Adjustment history is permanent feature data and also gives exact retries a durable identity without introducing another generic mechanism. After current authorization and authorized task scope are revalidated, exact same-actor/scope/task/payload retries return the original accepted adjustment before checking live eligibility or version; therefore the request does not become stale merely because its first acceptance advanced the version. Reuse of an accepted ID for changed input within the same Business is rejected. The compound tenant-scoped identity lets another Business independently use the same UUID and makes a foreign-only ID equivalent to an unknown ID without a global uniqueness collision. A new ID with a stale base version conflicts and cannot create a second accepted change.

**Alternative rejected:** Store only a generic JSON audit event or reuse task completion/Diary rows. Those options lose the purpose-built query model or conflate planned changes with realized work.

### 4. Apply authorization, eligibility, date validation, task update, and history atomically

**Decision:** Follow the existing API repository transaction pattern, with separate accepted-retry and new-command branches. Resolve current authorized Business/task scope server-side. After authorizing the path task, look up an accepted identity only with `(authorized businessId, adjustmentId)`; never globally look up the public ID and inspect its owner. Compare actor, target task, and exact command input; replay the accepted result or reject key reuse before live eligibility/version checks. The Business-scoped unique constraint allows another Business to use the same UUID, and foreign-only versus unknown IDs produce no collision signal. For a new ID, lock/validate the active Membership and Season/plan/task rows; check ACTIVE Season, APPROVED plan, no completion, and expected task version in that order; a stale version returns conflict before any date equality check. Once the version matches, compare the request to the current canonical date. Equality returns HTTP 400 `NO_DATE_CHANGE` with no state/history/version write and no accepted idempotency receipt. For a different date, validate with `validatePlannedTaskDate`, conditionally update the task date and version, append the adjustment row, and commit all or none.

**Evidence:** `MembershipScopeService` is the standard Business authorization boundary (`apps/api/src/authorization/membership-scope.service.ts`). Completion uses a transaction and locks membership plus Season/plan/task rows before checking eligibility (`apps/api/src/tasks/task-completion.repository.ts`). SPEC-002 date validation is centralized in `packages/domain/src/seasons/local-date.ts` and rejects dates before actual planting. ADR-009 requires application-side tenant enforcement and non-disclosure of cross-Business record existence.

**Rationale:** The completion and adjustment race must serialize on the same task so a completed task cannot be adjusted and a stale update cannot overwrite newer state. The Business-local date remains a calendar date rather than an instant.

**Alternative rejected:** Trust client Business identifiers, perform eligibility checks outside the write transaction, or convert selected dates through UTC/device timezone.

**No-change error convention:** The repository's task-command error envelope is `{ error: { code, message, requestId } }`; `TaskCompletionError` uses HTTP 400 with `INVALID_REQUEST` for validation outcomes and HTTP 409 for conflicts. `NO_DATE_CHANGE` uses that same typed envelope and HTTP 400, keeping this expected validation outcome distinct without adding a new response style.

### 5. Return a task-version conflict and reload without replaying stale intent

**Decision:** Return HTTP 409 with the established `TASK_VERSION_CONFLICT` code for stale `If-Match` or a task that became non-actionable. Mobile reloads current task detail/history and makes the farmer start a new adjustment decision; no submitted date is retried automatically.

**Evidence:** SPEC-003's completion contract and `TaskCompletionError` already define task-version conflict and farmer-facing recovery language. Current Today conflict handling reloads authoritative task state rather than replaying a stale command.

**Rationale:** This directly preserves the approved stale-change behavior while keeping the error contract familiar across task actions.

**Alternative rejected:** Last-write-wins, client-side merge, automatic resubmission, or an offline conflict queue.

### 6. Keep Bugün live and Calendar snapshots immutable

**Decision:** After acceptance, fetch `/today` again for Bugün. In Calendar, close the selected detail and create a fresh Calendar read (`readId`) for the same selected date/Field request, replacing the current in-memory view only after the fresh response is accepted. Do not rewrite existing server snapshot rows or pages. Existing complete local Calendar views may remain available only through SPEC-007's explicitly stale, read-only offline fallback; saved details never expose adjustment.

**Evidence:** Today is a direct canonical database read in `apps/api/src/seasons/today.repository.ts`. Calendar materializes task/date/grouping projections within a PostgreSQL `RepeatableRead` read and pages from immutable `calendar_read_snapshot_tasks` rows (`apps/api/src/calendar/calendar-read.repository.ts`, `calendar-pages.service.ts`, SPEC-007). Mobile's Calendar store promotes only complete same-scope views and labels offline data as possibly outdated (`apps/mobile/src/features/calendar/calendar-saved-view-store.ts`, `calendar-screen.tsx`).

**Rationale:** A fresh Calendar read reflects the updated canonical date while the old `readId` and cursors remain coherent point-in-time history. The explicit saved-data label distinguishes a stale offline snapshot from current canonical state.

**Alternative rejected:** Mutate existing Calendar snapshot pages or month indicators in place, which would break read identity/as-of coherence; add generic cache invalidation or synchronization infrastructure.

### 7. Use task-scoped current detail/history, not Diary

**Decision:** Add a task-scoped authorized history read that returns the task's current planned date/version/adjustability with a bounded page of date-adjustment records. Use this read to populate task-detail history and refresh state after a conflict. Keep adjustment history outside the Field Diary and completion-history read model.

**Evidence:** Completion history is a distinct bounded Field/Season read, while Diary composes completion and observation candidates (`apps/api/src/tasks/task-completion.repository.ts`, `apps/api/src/observations/observation-diary.repository.ts`). Calendar task detail is a modal with task context but no mutation today (`apps/mobile/src/features/calendar/calendar-task-detail.tsx`).

**Rationale:** SPEC-008 asks for task-detail history and current state recovery, not a new Diary event type. A task-scoped read supports both Bugün and Calendar entry points.

**Alternative rejected:** Make Diary the owner, or fetch an entire Field history just to populate one task detail.

Calendar task rows currently describe `taskVersion` as optional in SPEC-007's OpenAPI contract even though the current API projection supplies it. The adjustment flow therefore reads current task detail/history before presenting the date form and uses the returned canonical task version, rather than changing the closed SPEC-007 contract or trusting an optional/stale cached value. Saved Calendar views do not expose the adjustment action.

### 8. Define versioned REST/OpenAPI and generate shared client types

**Decision:** Add a SPEC-008 OpenAPI contract for task adjustment and task-scoped adjustment history. Add it to `packages/api-client/openapi-generator.config.ts`, export its generated paths/schemas from the shared client, and consume those generated types in mobile. Do not hand-maintain transport types.

**Evidence:** `packages/api-client/openapi-generator.config.ts`, `packages/api-client/README.md`, and SPEC-001..007 contracts define one OpenAPI source and generated TypeScript output per feature. Generated files are checked with `check:generated` and contract type tests.

**Rationale:** This is the repository's established REST contract and mobile typing workflow.

**Alternative rejected:** Add handwritten request/response interfaces in mobile or API modules that can diverge from OpenAPI.

### 9. Use an additive Prisma migration and existing test safety guard

**Decision:** Add the dedicated history model through `apps/api/prisma/schema.prisma` and an additive Prisma migration, then use the existing Prisma generation script. Integration tests must use only the guarded `ekim_hasat_test` database. Do not reset or target `ekim_hasat`.

**Evidence:** Architecture §9.2 assigns app-domain migrations to Prisma. Existing migrations are additive and use composite Business relations (`apps/api/prisma/migrations/20260929000000_plan_task_idempotency/`, `20261006120000_calendar_read_snapshot/`). `apps/api/test/support/disposable-database.ts` guards the integration database.

**Rationale:** This adds only the history persistence needed by SPEC-008 while preserving canonical PostgreSQL ownership and existing test safety.

**Alternative rejected:** Untracked DDL, generated-client hand edits, a second database, or destructive test against `ekim_hasat`.

## Constraints confirmed

- The approved SPEC-008 boundary overrides SPEC-007's historical prohibition only for the eligible task-detail action; Calendar agenda/month behavior remains read-oriented. SPEC-007 itself is not rewritten.
- PRD §12.3 mentions Postpone and Skip for overdue tasks. The newer explicit SPEC-008 decision excludes Skip; no Skip state/action is designed here.
- The API's existing `PlannedTask.version`, local `DATE`, active-membership, error, OpenAPI, Prisma, and Calendar snapshot mechanisms are sufficient. No new framework, service, datastore, generic event store, sync queue, or provider is required.
- No unresolved product question or architecture gate was found during planning research.
