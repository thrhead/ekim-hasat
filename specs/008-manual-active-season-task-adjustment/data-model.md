# SPEC-008 Data Model

## Canonical entity: PlannedTask

Existing Prisma model: `PlannedTask` in `apps/api/prisma/schema.prisma`.

| Field | Meaning | SPEC-008 behavior |
|---|---|---|
| `id` | Stable task identity | Identifies the one task being adjusted. |
| `seasonPlanId` | Owning plan | Must resolve to the task's ACTIVE Season and APPROVED plan. |
| `plannedLocalDate` (`DATE`) | Canonical farmer-selected planned calendar date | Updated atomically to the accepted new date; not stored as an instant. |
| `version` (`Int`) | Existing optimistic task version | Required as the submitted base version and incremented on an accepted date change. |
| `completion` relation | Accepted completion, if present | A task with a completion is not adjustable. |

The feature does not add task lifecycle states or change title, description, source, plan membership, or other task attributes. Existing `Season.version` remains the DRAFT-plan aggregate version and is not incremented by this task-scoped mutation.

## New entity: TaskDateAdjustment

One immutable row represents one accepted planned-date change. It is both the farmer-readable adjustment history source and the durable identity for an exact command retry.

| Field | Type / meaning | Rule |
|---|---|---|
| `id` | Server-generated UUID | Internal primary key for persistence and history pagination. It is not part of the public API. |
| `adjustmentId` | UUID, client-generated | Public command identity. It is stable for exact retries of one online command and is unique only within its Business. |
| `plannedTaskId` | UUID | Target task; paired with `seasonPlanId` for the existing composite task relation. |
| `seasonPlanId` | UUID | Owning plan captured at acceptance. |
| `seasonId` | UUID | Owning Season captured at acceptance. |
| `fieldId` | UUID | Owning Field captured at acceptance. |
| `businessId` | UUID | Authorized Business captured at acceptance and used in tenant-scoped relations/queries. |
| `actorUserId` | UUID | Authenticated application user who made the accepted change. |
| `actorMembershipId` | UUID | Current Business Membership used to authorize the change. |
| `previousPlannedLocalDate` | PostgreSQL `DATE` | Canonical value immediately before this accepted adjustment. |
| `newPlannedLocalDate` | PostgreSQL `DATE` | Farmer-selected value accepted by the server. |
| `baseTaskVersion` | Integer | Version supplied through `If-Match`. |
| `acceptedTaskVersion` | Integer | Task version after the atomic update; supports audit and replay interpretation. |
| `payloadFingerprint` | SHA-256 string | Binds the ID to task, new date, and base version; a changed payload under the same ID conflicts. |
| `adjustedAt` | UTC timestamp | Server acceptance time; never supplied by the client. |

### Relationships and indexes

- Restrict deletion of referenced task, plan, Season, Field, actor, and Membership rows so accepted audit history is not silently erased.
- Use composite foreign keys consistent with `TaskCompletion` to ensure task/plan, Season/Business/Field, Field/Business, and Membership/Business/User relationships agree.
- Enforce `UNIQUE (businessId, adjustmentId)` and do not add a global unique constraint to the public `adjustmentId`. A different Business may independently use the same client UUID without collision or observable difference. The internal `id` remains the row primary key.
- Order accepted history by `(adjustedAt DESC, acceptedTaskVersion DESC, id DESC)`: accepted task versions provide the per-task semantic sequence when server timestamps tie, while the internal ID is only a final total-order fallback. The matching pagination index is `(plannedTaskId, adjustedAt DESC, acceptedTaskVersion DESC, id DESC)`; retain the original index for already-issued legacy cursor continuation during rollout.
- There is no update/delete application path for this entity. It is a feature-specific append-only history record, not a generic event store.

## Command and state transition

Input: authenticated task ID, required `If-Match` task version, `adjustmentId`, and `newPlannedLocalDate` (`YYYY-MM-DD`). Business identity is derived server-side.

Accepted transaction:

1. Revalidate the current authorized Business Membership and target task scope.
2. Lock the authorized membership/context and the Season/plan/task rows, using the existing task-completion transaction pattern to serialize with completion and other task mutations.
3. After path-task authorization and before live eligibility/version checks, look up an accepted adjustment only by the compound `(authorized businessId, adjustmentId)` identity. Never perform a global lookup by public `adjustmentId` and then inspect Business ownership. Compare actor, path task, and exact original command input (including base version and requested date). Return its original accepted result for an exact retry; reject reuse within that Business with different input as `IDEMPOTENCY_KEY_REUSED`. Since identity uniqueness is Business-scoped, the same `adjustmentId` in another Business does not collide; foreign-only and unknown IDs are indistinguishable to this lookup. Current authorization is revalidated for this branch. The replay returns the immutable result of that accepted command, not a claim that its date remains current. The internal row `id` is never accepted from or exposed to the client.
4. For a new `adjustmentId`, require an ACTIVE Season, APPROVED plan, and no accepted completion.
5. Enforce `PlannedTask.version == If-Match`; reject a stale version before comparing the requested and canonical dates.
6. If `newPlannedLocalDate` equals the current canonical `plannedLocalDate`, return HTTP 400 `NO_DATE_CHANGE`. Do not update the task, increment `version`, insert `TaskDateAdjustment`, create a successful idempotency receipt, or trigger success-style data refresh. This rejection leaves the ID available because no accepted adjustment identity is persisted.
7. For a different requested date, validate the submitted `LocalDate` with the existing planting-date lower bound.
8. Update `plannedLocalDate` and increment `version` conditionally.
9. Insert `TaskDateAdjustment` with the previous/new dates, actor/scope, base/accepted versions, fingerprint, and server time.
10. Commit the canonical task update and history row together.

Any rejection leaves the canonical task and history unchanged. A version mismatch returns 409 and never reapplies the submitted date. `NO_DATE_CHANGE` is a typed validation rejection, not an accepted adjustment; it has no audit row or idempotency receipt. For an accepted exact replay, reauthorization precedes replay, but a later task-version advance does not turn the replay into a stale-version rejection.

An exact response replay returns the original adjustment row, which may describe a past accepted date change if a later farmer decision has since changed the task again. Mobile therefore reloads current task state after acceptance/replay rather than treating the replay payload as the latest canonical task.

## Read model

The task-scoped history read returns the current canonical planned date and task version alongside a bounded page of immutable adjustments ordered by `adjustedAt DESC, acceptedTaskVersion DESC, id DESC`. Accepted task version is the semantic ordering sequence for adjustments to one task; the internal ID is only a final total-order fallback. Legacy cursors without an accepted version continue using their original `(adjustedAt, id)` ordering so already-issued cursors remain decodable during rollout. It is authorized against the current Membership and the task's current Business/Field/Season scope. Adjustment history remains separate from completion history and Diary. Actor identifiers remain retained in the authoritative record; farmer-facing projection should not invent an actor display name.

Mobile follows the returned cursor for additional history pages and appends those immutable rows to the open detail. It keeps an uncertain adjustment's original ID, base version, and selected date only in ephemeral flow memory for explicit exact retry. This client state is not persisted and cannot be submitted while offline.

## Calendar snapshots

`CalendarReadSnapshotTask` remains a read projection of one immutable `readId`/`asOf` result. Adjustment does not edit old projection rows or cursors. A new Calendar read reflects the updated task date and grouping. Existing saved views remain available only under SPEC-007's same-scope, complete-coverage, explicitly stale read-only fallback rules; they cannot submit adjustments.
