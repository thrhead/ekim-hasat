# SPEC-014 Data Model and Lifecycle

## Canonical operational task

A PlannedTask remains linked to the existing SeasonPlan and has existing task ID, title, optional description, DATE plannedLocalDate, task version and action relationships. Add an immutable origin discriminator distinguishing `POST_ACTIVATION_MANUAL` from legacy/initial plan tasks. New manual tasks have no template task key or task-level template version and have actor attribution in their creation receipt. Existing rows retain plan-derived source behavior, including legacy null template keys; do not backfill legacy rows as manually entered based on null. Constraints prevent an origin claiming post-activation manual while carrying a template key. Task actions may update date/version or append completion/skip history but never origin or original create receipt.

## Approved plan and activation

SeasonPlan remains APPROVED with unchanged source, source snapshot and initial approval. `SeasonContextSnapshot.cropSnapshot.approvedTasks` remains immutable. New rows are operational plan-associated tasks, not approved snapshot members. Approved-plan reads exclude `POST_ACTIVATION_MANUAL`; operational Today/Calendar queries include them. Existing season response compatibility and snapshot content must be regression tested, including draft behavior and date adjustments. No approved plan or snapshot rewrite is planned.

## Create receipt

Persist durable accepted-create identity and immutable original command fingerprint or canonical original payload, task ID, mutation ID, Business, field, season, actor/membership and acceptance timestamp/result. Enforce scoped unique mutation and task identity, actor/context binding, and tenant-safe task/season relations. Persist receipt and task atomically under locking and database constraints; exact replay requires current authorization before returning the stored outcome. Reject identity reuse with changed payload/actor/context; serialize concurrent same-ID requests and reconcile unique-constraint races. Do not use current mutable task fields to compare an original request. A rejection must not create an accepted receipt or task.

First acceptance requires live OWNER membership and Business-scoped field and ACTIVE season with APPROVED plan; validate canonical title/description and local date on/after actual planting. Exact accepted replay after authorization returns the existing acceptance even if task or season subsequently changed; it does not perform a second acceptance. A revoked/different role cannot use replay to obtain protected data.

## Device-local account context

Only a prior authenticated matching OWNER session establishes locally active account continuity and previously authorized field/season identities, eligible status, actual planting date and local-date context. Retryable offline restoration may preserve continuity after restart. Definitive no session, sign-out or switch invalidates/switches active context; stale account ID alone is insufficient. Store only what capture needs. Context is not a token, authorization lease, or proof of current access; no arbitrary offline browsing.

## Device-local creation command

Persist account, task ID, mutation ID, field/season and exact canonical input, captured local context, state, and durable attempt uncertainty. Local save must complete before reporting pending. States and transitions:

| State | Transition |
|---|---|
| PENDING | Matching authenticated account can start delivery; persist attempt marker before network. Restart preserves command and identity. |
| SUBMITTING / uncertain | Timeout, crash, or lost response retains same command and indicates unconfirmed where outcome may have committed. Exact retry is safe; no false success or definite rejection. |
| ACCEPTED | Only after authoritative acceptance or exact replay is durably recorded locally. Retain accepted result if refresh fails; reconcile with authorized reads by task ID without duplicates. |
| REJECTED / needs attention | Only where rejection is definitive and no earlier unresolved possible commit. Retain original entry for original account; no indefinite automatic retry. Explicit unchanged retry returns to pending and server revalidates. |
| UNCONFIRMED | If earlier attempt may have committed, subsequent denial/conflict does not prove rejection. Retain original, do not allow rejected-only removal, and resolve only with authorized authoritative evidence. |

A corrected submission from a definitively rejected record is a new command with new task and mutation IDs, created only by explicit farmer action; the rejected original remains until explicitly removed. Rejected-only local removal must atomically verify original account, definitive rejection, no in-flight attempt and no uncertainty; it never calls server deletion and cannot alter canonical tasks/history. Account switch/sign-out hides and prevents delivery of former account's entries. Transient failures never silently discard the command.

## Migration implications

Later implementation requires an additive Prisma migration for origin/constraints and durable receipt, with tenant-safe foreign keys and uniqueness. Safe legacy default/fallback must preserve all existing source labels; older clients must tolerate additive reads and retain previous approved-plan response semantics. Plan migration/reversal and indexing with PostgreSQL integration tests. No migration file or database write occurs at this gate.
