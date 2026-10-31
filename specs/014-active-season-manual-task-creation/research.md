# SPEC-014 Research

## Task ownership and approved history

**Decision:** Add an operational PlannedTask associated with the existing approved SeasonPlan, explicitly marked `POST_ACTIVATION_MANUAL`; preserve `SeasonPlan.source`, `sourceSnapshot`, and `SeasonContextSnapshot` exactly. Keep pre-activation/legacy tasks on the old path. Season setup's approved-plan `tasks` projection must exclude post-activation additions (or use approved snapshot membership), while normal task reads include them.

**Rationale:** `apps/api/prisma/schema.prisma` defines one plan per season and completion/skip relate task and plan. Activation writes immutable `approvedTasks` to `cropSnapshot` in `apps/api/src/seasons/seasons-activation.repository.ts`; `seasons-read.repository.ts` currently returns all live tasks under plan source, so simply appending would misrepresent initial approval. Existing date adjustments must not rewrite the activation snapshot. **Alternatives:** a second plan breaks the one-plan constraint and action relations; new parallel task table duplicates task flows; changing source snapshot rewrites history.

## Provenance and compatibility

**Decision:** Use an immutable task-level discriminator for post-activation manual creation; derive MANUAL with null template version for such tasks and use the existing plan-based provenance for all legacy tasks. Keep plan provenance separately truthful. Share the resolver across Today, Calendar, completion and skip/history projections, including replay and snapshot-derived paths; update mobile detail presentation without labelling the task as validated merely because its plan is validated.

**Rationale:** `today.repository.ts`, `calendar-read.repository.ts`, `task-completion.repository.ts` and `task-skip.repository.ts` currently derive source from the plan. A null template key is insufficient: draft manual additions can already have one. Calendar snapshots, task history, detail, and diary paths need regression coverage. **Alternative:** infer from null key or overwrite plan source; both misclassify existing tasks or original plan.

## Authorization and command

**Decision:** Separate active create from draft plan mutation. Resolve server Business and current active OWNER membership, lock/recheck membership and Business-scoped field/season/approved plan in the accepting transaction, validate date/title/description using existing domain validators, and commit task plus receipt atomically. Reject WORKER/ADVISOR; no new assignment infrastructure. Server-provided viewer role/context may gate mobile entry only, never authorize mutation.

**Rationale:** `seasons-plan-task.controller.ts` is draft-specific; `harvests.repository.ts` and `task-date-adjustment.repository.ts` show existing transactional role and scoped idempotency patterns. **Alternative:** reuse draft endpoint or assume business membership grants WORKER field access; rejected for incompatible lifecycle and authorization.

## Identity and replay

**Decision:** Client generates task ID and mutation ID. Server retains an immutable scoped receipt with actor, field/season, original canonical payload fingerprint and accepted result, uniquely bound to identities. Under current authenticated OWNER/Business/resource access, exact replay returns original result before first-create-only ACTIVE/APPROVED validation, even after later task changes or season closure. Changed identity binding, actor, context or payload is conflict; concurrent exact requests converge transactionally.

**Rationale:** task date may later change, so the current task cannot prove the original request; receipt must outlive ordinary retries rather than depend on an expiring draft-command cache. Replay is disclosure of an already accepted result, not a new acceptance; current authorization remains required. **Alternative:** compare mutable task row or only use short-lived idempotency cache; neither guarantees delayed retry correctness.

## Bounded offline and recovery

**Decision:** Use a feature-specific account-scoped SQLite context and command, patterned after `apps/mobile/src/features/observations/observation-command-store.ts` and `observation-delivery.ts`, not completion queue semantics. Persist attempt intent before send; only a matching authenticated account delivers. Retryable failure or possibly committed attempt remains pending/unconfirmed; a later denial cannot prove the earlier outcome. Only authoritative acceptance persisted locally clears pending; retain accepted result until authorized canonical read reconciles by task ID. Definitive rejection permits explicit unchanged retry, a corrected new submission with new identities, or explicit local-only removal, guarded atomically against in-flight/uncertain state.

**Rationale:** SPEC-010 establishes account continuity and distinction between retryable session restoration and definitive no-session. No saved context is authorization. **Alternative:** reuse completion outbox or generalize sync; different lifecycle, invalid removal and scope creep.

## Local date and existing flows

**Decision:** Reuse `validatePlannedTaskDate`/existing title and description validation and DATE-only storage. Include accepted tasks in existing Today (its actual exact-local-today rules), Calendar grouping, task detail, completion, adjustment, skip, history and their existing diary projections. Preserve existing action eligibility, authorization, concurrency, offline completion and online-only action restrictions.

**Rationale:** Domain validators already enforce calendar validity and planting boundary; `today.repository.ts` does not mean all overdue tasks. **Alternative:** derive a UTC instant for planned date or redesign downstream actions; both violate existing semantics.
