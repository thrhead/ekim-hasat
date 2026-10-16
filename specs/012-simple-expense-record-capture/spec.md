# Feature Specification: Simple Expense Record Capture

**Feature Branch**: `012-simple-expense-record-capture`

**Created**: 2026-10-16

**Status**: Draft — approved product boundary

**Input**: Approved simple expense record capture. Expense is a canonical historical financial fact with a required Field and optional same-Field, same-Business Season. Business-wide expenses and silent allocation of Field-only expenses to Seasons are excluded.

## Clarifications

### Session 2026-10-16

- Q: What currency behavior does this feature require? → A: Currency is required and uses an ISO 4217 code. There is no canonical default currency; TRY is one valid value. Do not add Business default-currency configuration, currency conversion, or remembered-last-currency behavior.
- Q: What product-level amount precision and maximum should this feature require? → A: Require a positive exact decimal amount and preserve it without binary floating-point loss or silent rounding. Do not set a product-level scale or maximum; exact storage and contract limits are for technical planning.
- Q: What product-level length limit applies to the optional note? → A: No product-level length limit is approved. Keep the note optional and leave transport/storage limits to technical planning.
- Q: What does the expense date represent? → A: The calendar date on which the expense occurred. It is date-only, not a time-of-day or timestamp, and must not shift through device-timezone or UTC conversion. Use the established Business-local date behavior for any current-date default; do not introduce an expense-specific timezone fallback in this specification.
- Q: What must happen when an online expense submission has an uncertain result and is retried? → A: The product must not show acceptance before server confirmation, and retrying the same submission must not create a duplicate accepted expense. Stable identity, conflict details, and concurrency handling are technical design decisions.
- Q: Should the PRD's seven suggested cost categories be the fixed V1 set? → A: Yes. V1 uses seed/seedling, fertilizer, pesticide, fuel, labor, irrigation, and other as its fixed categories; category management and custom categories remain out of scope.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Record a Field expense (Priority: P1)

As a farmer, I can record what I spent on a Field and find the accepted expense in its history, so I can remember the cost without using accounting concepts.

**Why this priority**: Simple cost tracking is an explicit MVP need and answers a core farmer question.

**Independent Test**: With an authorized Field and connectivity, enter an amount, currency, category, and expense date; submit once and find one matching expense in that Field's chronological diary.

**Acceptance Scenarios**:

1. **Given** an OWNER authorized for a Field, **when** they submit a valid expense, **then** one historical expense is accepted and appears in that Field's diary with its amount, currency, category, and date.
2. **Given** no expense is associated with a Field, **when** the farmer views its diary, **then** the existing diary remains usable and no fabricated expense appears.
3. **Given** connectivity is unavailable or acceptance is uncertain, **when** the farmer submits an expense, **then** the product does not claim acceptance and offers a clear retry path without creating a duplicate accepted expense.

### User Story 2 — Associate an expense with a Season (Priority: P2)

As a farmer, I can associate an expense with a Season in the same Field when I know its context, so later season records can distinguish it from costs recorded only for the Field.

**Why this priority**: A truthful Season association supports future cost analysis without guessing an allocation.

**Independent Test**: Record expenses with and without a valid Season, inspect Field and Season diary views, and verify that the Season view contains only explicitly associated expenses.

**Acceptance Scenarios**:

1. **Given** an authorized Field and a Season belonging to it, **when** the farmer records an expense with that Season, **then** the accepted expense retains both associations and appears in the applicable Season diary.
2. **Given** an expense recorded for a Field without a Season, **when** a Season diary is viewed, **then** the expense does not appear as a Season expense.
3. **Given** a Season from another Field or Business, **when** the farmer submits it with an expense, **then** no expense is accepted and protected information is not revealed.

### Edge Cases

- The Field is missing, inaccessible, or the membership is revoked before acceptance; reject without revealing another Business's data.
- Amount is zero, negative, or malformed; reject it without changing or rounding it silently. Technical precision and range limits are not specified here.
- Currency is missing or invalid, or category is missing or outside the product-approved V1 set; explain the valid entry without changing it silently.
- Expense date is invalid or in the future in the authorized Business's local calendar; reject it without reinterpretation through device timezone or UTC.
- An online submission is retried after a lost response; do not create a duplicate accepted fact or present an unconfirmed submission as accepted.
- Concurrent submissions representing the same expense must not create duplicate accepted facts; the mechanism and conflicting-request outcome are for technical planning.
- The diary has more than one page, and an expense shares a date with other events; traversal has deterministic order without duplicates.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: An authenticated OWNER with current Business ownership scope MUST be able to create and read Expenses for an authorized Field. WORKER and ADVISOR roles MUST NOT gain finance access from their Field or task access. The server MUST derive Business scope from current membership, not a client-supplied Business identifier.
- **FR-002**: Every Expense MUST have one stable identity, required Field, positive amount, currency, category, expense date, and optional note. A Season association MAY be omitted; when supplied it MUST belong to the same authorized Business and Field.
- **FR-003**: The amount MUST be positive and represented as an exact decimal in major currency units. The accepted value MUST be preserved without binary floating-point loss or silent rounding. Product-level fractional precision and maximum amount are not defined by this feature and MUST be resolved as technical contract/storage constraints during planning.
- **FR-004**: Currency MUST be required and represented by a valid ISO 4217 three-letter alphabetic currency code. The feature MUST NOT define a canonical default currency or add Business default-currency configuration or remembered-last-currency behavior. TRY is one valid currency value. Currency conversion and cross-currency totals are excluded.
- **FR-005**: Category MUST be required and selected from the fixed V1 set: seed/seedling, fertilizer, pesticide, fuel, labor, irrigation, or other. Farmer-facing labels MUST be in Turkish. Free-form categories and category management are excluded.
- **FR-006**: Expense date MUST be the calendar date on which the expense occurred, with no time-of-day. It MUST remain the chosen date and MUST NOT shift because of device timezone or UTC conversion. A current-date default, if shown, MUST follow established Business-local date behavior. The date MUST NOT be later than the current Business-local date.
- **FR-007**: A text note MAY be omitted. If present, it MUST be preserved with the accepted Expense. This feature defines no product-level note length limit.
- **FR-008**: An accepted Expense MUST be immutable in this feature and retain its original Field, optional Season, amount, currency, category, date, actor, and server recording time. This feature MUST NOT edit, delete, void, or silently reallocate it.
- **FR-009**: A Field-only Expense MUST NOT appear in Season-filtered history or be counted as a Season expense by this feature. Future allocation or correction requires a separate explicit product rule.
- **FR-010**: The existing Field Diary MUST present accepted Expenses as distinct `EXPENSE` events sourced from canonical Expense facts. Field and Season filtering, deterministic chronological ordering, and bounded pagination MUST include eligible expenses without duplicating them or treating them as observations or irrigation records.
- **FR-011**: Create and diary read MUST enforce current OWNER membership and Business/Field scope. Missing, unauthorized, cross-Business, and invalid Field/Season requests MUST have privacy-safe outcomes; a WORKER or ADVISOR viewing an otherwise permitted Field Diary MUST NOT receive Expense entries.
- **FR-012**: An online retry after an uncertain result MUST NOT create a duplicate accepted Expense. The product MUST show acceptance only after server confirmation. Stable identity, changed-request conflict behavior, and concurrency mechanics are technical design decisions.
- **FR-013**: Expense creation MUST require connectivity and server acceptance. The product MUST NOT queue an Expense offline or present a failed or uncertain attempt as accepted; retry identity MAY be retained only within the active online form flow.
- **FR-014**: The farmer MUST be able to create and read Expenses on mobile from the relevant Field Diary context, with accessible labels and clear loading, empty, validation, success, connectivity, authorization, and server-error states.
- **FR-015**: Adding Expense entries MUST preserve existing Field Diary behavior for supported existing mobile clients.
- **FR-016**: The feature MUST NOT add profitability or cost totals, revenue, harvest, sales, accounting, VAT, invoices, receivables, debt, cash flow, inventory, equipment, attachments, generic offline sync, AI entry, Business-wide expenses, or automatic Field-to-Season allocation.

### Key Entities

- **Expense**: An immutable accepted financial fact with Business and Field association, optional same-Field Season, exact amount and required currency, category, date-only occurrence date, and optional note.
- **Field**: Required authorized location to which the cost belongs.
- **Season**: Optional explicit association within the same Business and Field; absence means no Season allocation.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In every valid authorized online scenario, the farmer can submit one expense and find exactly one matching historical entry in its Field Diary after server acceptance.
- **SC-002**: In every tested invalid association or unauthorized scenario, no Expense is created and no protected Field, Season, or financial data is revealed.
- **SC-003**: Retrying an uncertain online submission or concurrently submitting the same expense does not create duplicate accepted Expenses; an Expense is shown as accepted only after server confirmation.
- **SC-004**: In every tested Season-filtered view, explicitly linked Expenses appear and Field-only Expenses do not.
- **SC-005**: In every offline or unconfirmed create scenario, the farmer sees no accepted claim and can distinguish it from success.
- **SC-006**: A farmer can complete the required mobile entry with only Field, amount, currency, category, and date, while note and Season remain optional.

## Assumptions

- The initial market is Türkiye. TRY is one valid ISO currency code; a canonical default currency has not been approved.
- The PRD's seven suggested cost categories are the fixed V1 set. Custom-category management is not in scope.
- A future-dated expense is outside this historical expense-capture scope; the recorded date represents when the cost occurred.
- Existing sign-in, membership scope, Field/Season identity, and Field Diary are prerequisites. OWNER access and no automatic WORKER/ADVISOR finance visibility follow the architecture's finance restrictions.
- This increment does not provide offline expense capture or synchronization; expense submission requires server acceptance.

## Out of Scope

- Profitability, aggregate totals, revenue, sales, harvest, and automatic currency conversion.
- Ledger, tax, invoicing, receivables, debt, cash-flow, inventory, and equipment workflows.
- Editing, deleting, voiding, correcting, or allocating accepted Expenses.
- Attachments, photos, generic offline synchronization, and AI entry/extraction.
- Business-wide/unallocated Expenses and automatic attribution of Field-only Expenses to Seasons.
