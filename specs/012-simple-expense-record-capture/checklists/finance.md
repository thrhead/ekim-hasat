# Finance Requirements Checklist: Simple Expense Record Capture

**Purpose**: Review the quality of expense, privacy, history, and mobile requirements before implementation.
**Created**: 2026-10-16
**Feature**: [spec.md](../spec.md)

**Note**: This custom checklist tests requirements writing, not implementation.
**Review Ownership**: The reviewer marks `[x]` only after deciding the requirement-quality criterion is satisfied.
**Marker Semantics**: `[x]` is requirements-quality approval, not implementation completion.

## Requirement Completeness

- [x] CHK001 Are all required and optional Expense inputs and associations explicitly defined? [Completeness, Spec §FR-002]
- [x] CHK002 Are amount precision, range, and no-rounding rules complete for valid and invalid entries? [Completeness, Spec §FR-003]
- [x] CHK003 Are currency validity, default, preservation, and excluded conversion clearly specified? [Completeness, Spec §FR-004]
- [x] CHK004 Are all seven category meanings and Turkish presentation requirements defined consistently? [Completeness, Spec §FR-005]
- [x] CHK005 Is date-only meaning, Business timezone, fallback, default, and future-date rule unambiguous? [Clarity, Spec §FR-006]

## Privacy and Historical Consistency

- [x] CHK006 Are OWNER create/read permissions and WORKER/ADVISOR finance exclusions aligned across scenarios and requirements? [Consistency, Spec §FR-001, §FR-011]
- [x] CHK007 Are cross-Business, wrong-Field Season, revoked membership, and privacy-safe failure requirements complete? [Coverage, Spec §FR-011]
- [x] CHK008 Is the immutable accepted Expense lifecycle clear, including excluded correction and void behavior? [Clarity, Spec §FR-008]
- [x] CHK009 Is non-allocation of Field-only expenses to Season history or totals explicit and consistent? [Consistency, Spec §FR-009]
- [x] CHK010 Are exact retry, changed-identity conflict, and concurrent duplicate outcomes objectively testable? [Measurability, Spec §FR-012]

## Diary and Mobile Scenarios

- [x] CHK011 Are distinct Expense diary identity and canonical-source requirements clear? [Clarity, Spec §FR-010]
- [x] CHK012 Are same-date ordering, pagination, and filter requirements sufficient to assess duplicate-free history? [Coverage, Spec §FR-010]
- [x] CHK013 Are older-client response compatibility requirements clear for opt-in Expense entries? [Coverage, Spec §FR-015]
- [x] CHK014 Are mobile entry, date/currency defaults, accessibility, and loading/empty/error states specified? [Completeness, Spec §FR-014]
- [x] CHK015 Are uncertain online responses and offline attempts distinguished from accepted records? [Coverage, Spec §FR-013]

## Boundary and Acceptance Quality

- [x] CHK016 Are excluded totals, conversion, allocation, accounting, inventory, attachments, offline sync, and AI consistent throughout the artifacts? [Consistency, Spec §FR-016]
- [x] CHK017 Can every success criterion be checked without assuming an implementation method? [Measurability, Spec §Success Criteria]
- [x] CHK018 Are Field-only and Season-linked paths independently demonstrable from the acceptance scenarios? [Coverage, Spec §User Stories]

## Notes

- All items were reviewed against the approved specification and planning artifacts; `[x]` marks a satisfied requirements-quality criterion.
- `$speckit-implement` reads checklist state and does not change markers.

## Reconciled Coverage Checks

- [x] CHK019 Is the scope explicit that every Expense requires one Field and may have only an explicitly supplied Season from the same Business and Field, with no Business-wide expense or implicit Season allocation? [Completeness, Spec §FR-002, §FR-009, §FR-016]
- [x] CHK020 Are the seven fixed V1 categories and Turkish farmer-facing labels specified without implying category management or unapproved category-specific definitions? [Clarity, Spec §FR-005, §FR-016]
- [x] CHK021 Do amount and currency requirements distinguish positive exact-decimal preservation from technical precision/range limits, and require ISO 4217 without default currency, TRY-specific behavior, FX, or cross-currency totals? [Consistency, Spec §FR-003, §FR-004]
- [x] CHK022 Is Expense date consistently specified as the occurred-on calendar date, without time-of-day, UTC/device-timezone shifting, or a fabricated timestamp in the Diary? [Consistency, Spec §FR-006, §FR-010]
- [x] CHK023 Is the accepted Expense lifecycle explicitly immutable, including the exclusions for edit, delete, void, silent reallocation, and unapproved correction workflows? [Completeness, Spec §FR-008, §FR-016]
- [x] CHK024 Do retry and concurrency requirements distinguish truthful server-confirmed acceptance and no-duplicate outcomes from technical identity/conflict mechanics? [Clarity, Spec §FR-012, §SC-003]
- [x] CHK025 Is online-only creation clearly distinguished from generic offline expense synchronization, including uncertain or failed submissions? [Consistency, Spec §FR-013, §SC-005, §FR-016]
- [x] CHK026 Are Field Diary inclusion and Season-filtered inclusion clearly distinguished so Field-only expenses never appear as Season expenses? [Clarity, Spec §FR-009, §FR-010, §SC-004]
- [x] CHK027 Do compatibility requirements preserve V1 ordering/cursor behavior when `includeExpenses=false`, define a date-aware V2 cursor when true, bind its projection mode, and reject cross-mode cursor reuse? [Completeness, Spec §FR-010, §FR-015]
- [x] CHK028 Do Diary ordering and mobile presentation define deterministic same-date groups while making clear that Expense group placement does not imply an unknown intra-day occurrence time? [Clarity, Spec §FR-010, §FR-014]

## Reconciliation Notes

- CHK004's reference to category “meanings” is limited to clarity of the approved fixed category set and its Turkish labels; it does not require unapproved category definitions or management behavior.
- CHK013 is read together with CHK027: compatibility preserves the existing V1 path when Expense inclusion is off and uses the versioned date-only cursor path only when it is on.
- CHK016 is supplemented by CHK019, CHK020, and CHK023 to make the no-Business-wide, no-custom-category, and immutable-history exclusions explicit.
