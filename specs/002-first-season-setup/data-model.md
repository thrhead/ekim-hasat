# Data Model: First Season Setup and Plan Approval

This is a planning-level domain shape. Exact Prisma scalar mappings and indexes are implementation details for the later task/implementation phase. PostgreSQL is canonical and Prisma owns app-domain migrations.

## Crop Catalog Entry

Represents a centrally maintained crop choice with stable logical identity and immutable runtime definition version.

- Stable crop key and display name.
- Immutable definition version reference used by a season.
- Optional production type/context needed to distinguish seasonal and perennial crops where the runtime catalog supplies it; no exact pilot crop list is encoded.
- Current selectable state for farmer-facing crop choices.
- Template availability is resolved separately and is not a property that makes the crop unusable.

## Custom Crop

Represents a farmer-entered crop scoped to the authorized business.

- ID and `businessId`.
- Farmer-entered display name (required, normalized for surrounding whitespace).
- Created timestamp.
- It has no centrally validated crop/template version unless a later content process explicitly maps it.
- Custom crop identity does not imply agronomic validation. A season using it has a manual plan.

## Validated Template Version

Represents an immutable, centrally published plan source.

- Stable template key and immutable version identifier.
- Applicable central crop definition version and optional region selector.
- Published task definitions with logical source-task keys and default local-date offsets/rules already defined by the content system.
- A published version with zero task definitions is a content-quality/integrity issue and is unavailable for plan generation in SPEC-002.
- Published/available state sufficient for server-side applicability resolution.
- Runtime reads never depend on mutable live CMS documents. SPEC-002 consumes published versions; it does not author/publish agronomic content.

## Season

Represents the crop cycle being set up for an authorized field.

- ID, `businessId`, and `fieldId` (the field must belong to the same business).
- Exactly one crop identity: central crop definition version or business-scoped custom crop.
- Actual sowing/planting local calendar date.
- The actual date may be today or any past local date without a maximum lookback; future dates are invalid.
- Lifecycle state: `DRAFT` before farmer approval; `ACTIVE` after successful activation.
- Optimistic version for draft updates and activation.
- Created timestamp and activation timestamp.
- Logical identity is authorized `businessId` + `fieldId` + crop identity + actual sowing/planting date. Enforce uniqueness for that identity server-side and under concurrency across DRAFT and ACTIVE seasons; a matching create returns the existing season unchanged, including for a different idempotency key.
- A central crop identity uses its stable logical crop key; its immutable definition version is retained separately as season context. A custom crop identity is business-scoped. Display labels alone do not confer central validation.
- Pre-sowing planned date/conversion state is excluded. Different crop identities or actual dates may represent distinct seasons; do not add broader lifetime/active-season limits or multi-cycle rules.

## Season Plan

Represents the editable plan associated with a draft season.

- ID and `seasonId`.
- Source discriminator: `VALIDATED_TEMPLATE` or `MANUAL`.
- Nullable immutable template-version reference; required for `VALIDATED_TEMPLATE`, absent for `MANUAL`.
- Source/definition snapshot sufficient to explain whether tasks came from a validated central template or farmer entry.
- Draft/approved lifecycle aligned with the parent season.
- Any personal/business reuse representation remains outside UI scope; no reusable-plan catalog is introduced here.

## Planned Task

Represents a task proposal, not a completed operational record.

- ID and `seasonPlanId`.
- Required farmer-visible task title and planned local calendar date; optional description may be copied from the published template when present.
- Planned local date must be on or after the season's actual sowing/planting local date; equality is allowed. No chronological-order invariant applies between separate tasks.
- Optional source template-task key for provenance; absent on manually added tasks.
- Version for safe edits; template-derived tasks are plan-owned copies.
- Add/edit/remove is allowed only while the parent season is DRAFT; ACTIVE plans are read-only through SPEC-002.
- No completion timestamp, actual date, recurrence state, weather policy, assignment, or execution lifecycle is added for SPEC-002.

## Season Context Snapshot

Created atomically with activation to preserve the context on which the active season began.

- Season ID.
- Field boundary version reference when one exists (point-only fields remain valid).
- Region/context captured for template resolution, if available.
- Central crop definition version or custom crop identity/name snapshot.
- Immutable template version reference for template-based plans; explicit manual source for manual plans.
- Activation timestamp and relevant timezone/date context.
- Authorized business IANA timezone used to define Bugün across its fields/seasons; use configured `Europe/Istanbul` when no business timezone is explicitly configured. Device/app timezone and server UTC do not define “today.”

## Command Idempotency Record

Supports retry-safe season creation and activation using the established API convention.

- Authenticated application user ID and idempotency key, with unique scope appropriate to the season command.
- Payload fingerprint and command result/season reference.
- Creation/expiry timestamps per operational policy.
- Persisted in the same transaction as the command's state change. Draft task edits use optimistic versions; they do not create duplicate records on retry.
- Same-key/same-command create and activation retries replay the original committed result. Same key with changed payload/version conflicts. Activation is one atomic DRAFT→ACTIVE transition; stale DRAFT version, different-key concurrent loser, and different-key request against ACTIVE return 409; client re-reads after conflict.

## Mobile Unresolved Create Command

Retains only an in-flight SPEC-002 season-create operation until its result is durably recorded.

- Exact create request fields and original idempotency key are persisted before/while submission.
- After lost response or restart before durable season-ID recording, retry the identical request with the same key and receive the same season ID.
- Clear the command only after durable successful-result recording.
- This is not a general offline mutation queue or synchronization subsystem.

## Relationships and Integrity

```text
Business 1 ── * Field
Business 1 ── * CustomCrop
Field 1 ── * Season
Season 1 ── 1 SeasonPlan
SeasonPlan 1 ── * PlannedTask
SeasonPlan * ── 0..1 immutable ValidatedTemplateVersion
Season 1 ── 0..1 SeasonContextSnapshot (created on activation)
Season 1 ── * command idempotency outcomes
```

- Every business-owned query/mutation is scoped using server-resolved active membership and the field/season's business relation.
- Creation atomically persists season, plan, optional custom crop, and copied template tasks (or an empty draft). An empty applicable published template is reported as unavailable; the farmer must explicitly choose MANUAL, which retains MANUAL provenance.
- Either plan source may be saved empty. Activation rejects zero-task plans until at least one task has a valid title and planned local date on/after the actual season date; rejection leaves the DRAFT editable and creates no default task.
- Activation atomically verifies authorization, DRAFT/version state, and minimum task count, then performs one DRAFT→ACTIVE transition and stores its context snapshot. Exact same-key/same-command replay returns the original result; changed-key/payload conflicts follow the specified rules. Activation and task mutations never mutate an already ACTIVE season through SPEC-002.
- User edits change plan-owned tasks only and only before activation. Later template publication cannot rewrite draft or active plan tasks.
- Bugün's local date uses the authorized business timezone across that business's fields, with configured `Europe/Istanbul` fallback, never server UTC or device timezone.
- Database semantics enforce the logical season identity, valid same-business relationships, source/template consistency, non-null local planned dates, task-date constraints, DRAFT-only task mutations, and command idempotency. Tenant-isolation and rollback behavior require PostgreSQL integration tests.
