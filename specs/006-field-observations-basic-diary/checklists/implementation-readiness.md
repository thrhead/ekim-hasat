# Implementation Readiness Checklist: Field Observations and Basic Diary

**Purpose**: Review whether SPEC-006 requirements and design artifacts are clear, complete, consistent, and ready for implementation.
**Created**: 2026-10-05
**Feature**: [spec.md](../spec.md), [plan.md](../plan.md), [data-model.md](../data-model.md), [API contract](../contracts/observations-diary.openapi.yaml)

**Note**: This custom checklist is a reviewer-owned requirements-quality artifact. It checks the written requirements and design, not implementation completion.
**Review Ownership**: Mark an item `[x]` only when the reviewer determines the requirements-quality criterion is satisfied.
**Marker Semantics**: `[x]` means the criterion has been reviewed and satisfied for requirements quality. It does not mean implementation work is complete.

## Authorization, Scope, and Privacy

- [x] CHK001 - Do the spec and plan clearly require current active Business membership authorization for observation creation and diary reads, without treating a client-supplied Business ID as authority? [Completeness, Spec §FR-001, §FR-007, §FR-015; Plan §Constitution Check]
- [x] CHK002 - Is every observation unambiguously required to belong to exactly one authorized Field? [Clarity, Spec §FR-002; Data Model §FieldObservation]
- [x] CHK003 - Is the optional Season association clearly constrained to the same authorized Field and Business, including rejection of a missing or cross-scope Season? [Coverage, Spec §FR-002, §FR-007; Contract POST]
- [x] CHK004 - Is behavior explicit when no Season is selected or available, including whether the Field diary includes unseasoned observations and whether the product avoids silently assigning a current Season? [Completeness, Spec §FR-002, §FR-006; Plan §Constraints; Data Model §DiaryEntry]
- [x] CHK005 - Are authorization revocation, missing resources, and cross-Business resources covered with privacy-safe behavior that does not reveal whether an out-of-scope Field, Season, or observation exists? [Coverage, Spec §FR-015; Plan §Authorization and privacy; Contract responses]

## Observation Data and History

- [x] CHK006 - Is the 2,000-character limit defined consistently for Unicode text, including whether counting applies before or after surrounding whitespace is trimmed? [Ambiguity, Spec §FR-003; Data Model §FieldObservation; Contract CreateObservationRequest]
- [x] CHK007 - Are the empty/whitespace-only rule, trimming behavior, Unicode support, and maximum note length consistent between the spec, model, and API contract? [Consistency, Spec §FR-003; Data Model §FieldObservation; Contract CreateObservationRequest]
- [x] CHK008 - Is `occurredAt` consistently defined as the farmer-recorded absolute instant, defaulted to current time, limited to past/current values, normalized for storage, and displayed in the authorized Business timezone? [Clarity, Spec §FR-004; Plan §Constraints; Data Model §FieldObservation; Contract CreateObservationRequest]
- [x] CHK009 - Is server-assigned `acceptedAt` clearly separate from `occurredAt`, retained for audit, and intentionally omitted from normal farmer-facing diary rows? [Consistency, Spec §FR-005; Plan §Constraints; Data Model §FieldObservation and DiaryEntry]
- [x] CHK010 - Are append-only semantics explicit, including no edit/delete in this feature, separate-record corrections, and preservation of the original Field/Season association when current context changes? [Completeness, Spec §FR-013 and Assumptions; Data Model §Integrity and lifecycle]
- [x] CHK011 - Do the spec, plan, model, and contract consistently define stable observation identity, exact-payload retry replay, changed-payload conflict, and authorization revalidation before replay? [Consistency, Spec §FR-014, §FR-015; Plan §Summary; Data Model §Integrity and lifecycle; Contract POST]
- [x] CHK012 - Does the create contract specify the outcome when simultaneous exact retries with the same observation identity race, so the requests converge on one accepted record rather than leaving the loser outcome unclear? [Ambiguity, Spec §FR-014; Plan §Summary; Contract POST]

## Diary Projection, Ordering, and Pagination

- [x] CHK013 - Is Field diary scope defined to include all observations for the Field, including those without a Season, and all accepted completions for that Field? [Completeness, Spec §FR-006; Plan §Constraints; Data Model §DiaryEntry]
- [x] CHK014 - Is Season diary scope defined to include only observations and accepted completions associated with that Season after validating its Field and Business ownership? [Clarity, Spec §FR-006, §FR-007; Data Model §DiaryEntry; Contract GET]
- [x] CHK015 - Are observations and existing accepted `TaskCompletion` records represented once as distinct projection types, with completion details/provenance preserved and no completion-row duplication or mutation? [Consistency, Spec §FR-006, §FR-009; Plan §Structure Decision; Data Model §Existing TaskCompletion and DiaryEntry]
- [x] CHK016 - Is the cross-source ordering fully specified as occurrence descending, then entry kind ascending, then source UUID descending, including same-time entries across both types? [Clarity, Spec §FR-008; Data Model §Ordering and pagination; Contract GET]
- [x] CHK017 - Are cursor semantics consistently specified for Field/optional Season binding, continuation tuple, strict no-repeat continuation, and behavior when a cursor is malformed or used with a different scope? [Consistency, Spec §FR-008; Data Model §Ordering and pagination; Contract GET]
- [x] CHK018 - Are bounded page limits consistent across plan, model, and contract, including default 50 and maximum 100, and is the no-skip/no-duplicate acceptance claim scoped clearly enough for keyset pagination? [Acceptance Criteria, Spec §FR-008 and SC-003; Plan §Performance Goals; Data Model §Ordering and pagination; Contract GET]
- [x] CHK019 - Does the OpenAPI contract describe cursor ordering and continuation semantics with enough precision to prevent drift from the data model and generated client contract? [Gap, Data Model §Ordering and pagination; Contract GET]
- [x] CHK020 - Are structured error response schemas and privacy-safe semantics defined consistently for validation, unauthenticated, forbidden, missing/out-of-scope, conflict, and unexpected failures on both operations? [Completeness, Spec §FR-011, §FR-015; Contract responses]

## Persistence, API, and Mobile Readiness

- [x] CHK021 - Are migration constraints sufficient to enforce observation Field/Business/optional-Season consistency and actor/membership provenance, while preventing historical cascade deletion? [Completeness, Spec §FR-002, §FR-013; Plan §Migration and module boundaries; Data Model §Integrity and lifecycle]
- [x] CHK022 - Do the proposed Field and Season indexes support the scoped chronological keyset reads and match the ordering/tie-break requirements? [Consistency, Plan §Performance Goals; Data Model §Integrity and lifecycle and Ordering and pagination]
- [x] CHK023 - Is OpenAPI the single transport-contract source for create and mixed diary reads, with generated client coverage and no hand-maintained duplicate client types? [Completeness, Plan §Summary and Structure Decision; Contract]
- [x] CHK024 - Are mobile create and diary loading, empty, error, retry, validation, in-progress, and server-accepted states specified without presenting an unresolved save as accepted history? [Coverage, Spec §FR-011; Plan §Mobile integration; Quickstart §Scenarios]
- [x] CHK025 - Are accessibility requirements sufficiently clear for control names/roles, focus behavior, asynchronous state announcements, non-color cues, and supported text scaling? [Completeness, Spec §FR-012 and SC-005; Plan §Mobile integration]
- [x] CHK026 - Is observation creation clearly online-only, while explicitly preserving SPEC-003 completion-specific offline behavior and excluding any observation outbox or generic synchronization? [Consistency, Spec §FR-016; Plan §Constraints; Quickstart §Expected outcomes]
- [x] CHK027 - Is the mobile diary entry point constrained to existing Field/Season context and the approved navigation direction, without expanding into Quick Add or another unrelated top-level workflow? [Scope, Plan §Scale/Scope and Mobile integration; Spec §FR-010 and §FR-017]

## Scope Boundaries and Artifact Alignment

- [x] CHK028 - Are all exclusions explicit and consistent across spec and plan: taxonomy, photos/files, generic sync, AI/risk, notifications, Calendar, active-task mutation, advisor/team sharing, and observation edit/delete? [Consistency, Spec §FR-017, §FR-018, Out of Scope, and Assumptions; Plan §Constraints; Research §Deferred decisions and out of scope]
- [x] CHK029 - Are the spec, plan, data model, and OpenAPI contract aligned on field/season scope, timestamps, immutable history, projection types, order, page size, retry identity, and farmer-visible fields? [Consistency, Spec §Requirements; Plan §Technical Context; Data Model; Contract]

## Temporal and Concurrency Boundaries

- [x] CHK030 - Is the timezone used to interpret a farmer-selected local date and time specified, given that storage is an absolute instant and diary display uses the Business timezone? [Ambiguity, Spec §FR-004; Research §Occurrence and acceptance instants; Contract CreateObservationRequest]
- [x] CHK031 - Does the no-skip/no-duplicate pagination requirement define expected behavior when new observations or completions are added while a farmer is traversing pages? [Ambiguity, Spec §FR-008 and SC-003; Data Model §Ordering and pagination]

## Notes

- Reviewer assessment completed: all 31 checklist criteria are satisfied. Checked markers record the review of requirements and design quality; they do not indicate implementation completion.
- `$speckit-implement` reads checklist state as a gate and must not modify markers.
- `checklists/requirements.md` is a separate built-in spec-quality checklist maintained by `$speckit-specify` and `$speckit-clarify`.
