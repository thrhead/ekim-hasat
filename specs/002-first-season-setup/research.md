# Research: First Season Setup and Plan Approval

## Decisions

### Crop identity and template availability

- **Decision**: Treat crop identity separately from availability of an applicable validated template. List server-owned central crops without pinning a pilot list in code. Accept farmer-entered crop names as business-scoped custom crops. Resolve template applicability on the server using the crop and field context.
- **Rationale**: PRD §§9.1–9.2 and the SPEC-002 clarification require unsupported crops to remain usable, while the PRD says the named pilot crops are candidates that may change. An unsupported central or custom crop can use a manual plan.
- **Alternatives considered**: Restrict crop selection to the initial template catalog (conflicts with unsupported-crop acceptance); freeze wheat/maize/tomato/olive/grape as the permanent catalog (conflicts with adjustable pilot list).

### Draft plan provenance and template behavior

- **Decision**: Pin an immutable published template version to a template-backed draft and copy its task definitions into plan-owned draft tasks. Manual plans have a distinct source and no validated-template reference. Edits never mutate the central template.
- **Rationale**: Architecture §§15.3–15.4 and §39 require immutable published versions, preserved season context, and protection of user edits. This supports review, edits, and activation without introducing template authoring or previous-plan reuse.
- **Alternatives considered**: Read live CMS content while reviewing (runtime availability and historical-integrity conflict); mutate template tasks directly (changes central/shared content); re-resolve/re-generate at activation (could overwrite farmer edits).
- **Clarification**: An applicable published version with zero task definitions is unavailable for generation and is a content-quality/integrity issue for diagnostics/operations. Explain the unavailable validated plan and offer an explicit `MANUAL` choice; do not create an empty `VALIDATED_TEMPLATE` plan or silently convert its source. Manual-plan rules then apply.

### Season date and draft lifecycle

- **Decision**: Collect an actual sowing/planting local calendar date before creating a server-persisted draft. Pre-sowing planned seasons and later conversion are excluded. Crop/date are creation inputs; draft editing in this feature changes plan tasks only.
- **Rationale**: The approved journey asks for sowing/planting date and PRD §9.4 makes pre-sowing optional. Spec scope limits review editing to tasks and dates. Starting draft creation after crop/date selection avoids regeneration semantics that are not specified.
- **Alternatives considered**: Add a planned/actual date lifecycle and conversion/recalculation (optional PRD capability, expands state and mobile flow); regenerate plan after changing crop/date (requires replacement/merge rules for farmer edits).
- **Clarification**: Actual sowing/planting dates may be today or any past local date without a maximum lookback; future dates are invalid. Every planned task date must be on or after the actual season date, equality allowed. Task dates need not be chronologically ordered. This feature does not add pre-sowing tasks.

### Manual plan activation

- **Decision**: Persist a zero-task draft for either source; activation checks for at least one valid planned task in the transaction. On failure, keep the draft and return a stable validation error; do not insert a task.
- **Rationale**: SPEC-002 clarification applies the minimum-task rule to both `MANUAL` and `VALIDATED_TEMPLATE` plans. Server enforcement is authoritative and protects against bypassing mobile validation.
- **Alternatives considered**: Automatically create a placeholder task (explicitly prohibited); reject draft creation until a task is entered (conflicts with saving/editing a draft before activation).

### Mutation surface and consistency

- **Decision**: Use a small REST surface: scoped setup options read; idempotent season/draft creation; a scoped season read for restoring a saved proposal; task add/edit/remove under a season; explicit idempotent activation; and a read-only Bugün task query. Require expected version on draft task writes to avoid lost concurrent edits.
- **Rationale**: Follows the existing versioned REST/OpenAPI and generated-client conventions. Draft creation can resolve a template and copy initial tasks atomically, so a separate generation endpoint is unnecessary. The season read supports the spec's leave/retry and failed-activation recovery behavior. The Bugün query is the minimum needed to satisfy the feature's post-activation handoff; completion remains out of scope.
- **Alternatives considered**: Client-selected template ID (untrusted and bypasses applicability rules); generic task lifecycle endpoints (later feature scope); separate generate endpoint (adds a state transition with no required user-visible benefit).
- **Clarification**: Plan-task add/edit/remove is DRAFT-only; active plans are read-only through SPEC-002. Activation exact same-key/same-command replay returns the original result; payload/version mismatch, stale draft version, different-key concurrent loser, and different-key attempt against ACTIVE return 409. Exactly one request can perform DRAFT→ACTIVE; after 409 the client re-reads season state.

### Persistence, authorization, and transactions

- **Decision**: Use Prisma-owned app-domain tables and migrations. Every command resolves authenticated identity, active membership, and the requested field/season under the authorized business. Create season + plan + copied template tasks (or a zero-task plan draft) atomically. Within authorized business/field/crop/actual-date identity, create returns the existing season unchanged, including under concurrency and across different idempotency keys. Activation rechecks authorization, DRAFT state, minimum task count, and current plan version, then writes active status and context snapshot atomically. Store command idempotency within the same transaction.
- **Rationale**: Matches ADR-009, SPEC-001's transaction/idempotency/tenant patterns, and the architecture's modular monolith and canonical PostgreSQL decisions.
- **Alternatives considered**: Trust client `businessId` or template ID; write season and tasks separately (partial plans); use a second datastore/microservice (unjustified).
- **Clarification**: Before create submission, mobile persists the unresolved create command and key. After lost response/restart, it retries the exact request with the same key until it durably records the original result/season ID, then clears the unresolved command. No dedicated recovery endpoint or general offline mutation queue/sync is added. A separate server-enforced logical-season identity remains a secondary duplicate safeguard.

### Farmer-local day for Bugün

- **Decision**: The authorized business timezone defines “today” for the business's Bugün list across all its fields/seasons. Persist the business timezone used in the season context snapshot; if no business timezone is configured, use the configured `Europe/Istanbul` fallback for this Türkiye-first slice. Planned dates remain local calendar dates. Neither device/app timezone nor server UTC defines the date boundary; no per-field timezone behavior is added.
- **Rationale**: Architecture §9.4 requires local calendar-date semantics and §39 snapshots timezone. SPEC-002 clarification explicitly selects business scope and fallback; it does not require SPEC-001 field timezone changes.
- **Alternatives considered**: Use UTC (can move tasks across calendar days); make device timezone authoritative (a farmer traveling could shift farm work dates); use separate field timezones (explicitly excluded in this feature).

### Logical season identity

- **Decision**: A season identity is the authorized business + field + crop + actual sowing/planting date. A matching create returns the existing season unchanged even when a different idempotency key is used. Enforce this server-side under concurrency; preserve the separate same-key/same-payload replay and same-key/different-payload conflict behavior.
- **Rationale**: SPEC-002 clarification requires one logical season for the matching inputs and explicitly rejects client-only duplicate prevention. The rule is scoped to actual-date SPEC-002 seasons, not pre-sowing or unsupported multi-cycle semantics.

### Empty-template fallback

- **Decision**: An applicable published validated template with zero task definitions is unavailable for plan generation and is diagnosed as a content-quality/integrity issue. Explain the unavailability and let the farmer explicitly choose `MANUAL`; do not create a zero-task template-backed plan, auto-convert the source, or invent tasks.
- **Rationale**: SPEC-002 clarification preserves source provenance and farmer control while allowing manual continuation. The generic minimum-task rule still blocks activation until any manual draft has one valid task.

## Findings and Dependencies

- SPEC-001 provides `ApplicationUser`, `Business`, `Membership`, `Field`, server-side default-business scope resolution, generated REST-client usage, and transaction/idempotency/tenant-test patterns. No crop, season, planning, or task tables/modules exist yet.
- The architecture's CMS-to-immutable-runtime-template publication pipeline is the source of production validated content. This feature consumes published runtime versions; it does not author agronomic content or add a fake production seed catalog. Release readiness depends on at least one real approved template being available, while custom/manual plans provide the no-template path.
- This feature must preserve point-only field support and nullable/unavailable field geometry/region context; it cannot require a verified polygon for season setup.
- Use existing root scripts for validation: `pnpm test`, `pnpm test:integration`, `pnpm test:contract`, `pnpm test:mobile`, `pnpm typecheck`, and `pnpm lint`. Integration tests require configured PostgreSQL. The Android Expo smoke script is not part of this plan.

## Open Risks (not unresolved product decisions)

- The initial production crop/template set and content publication timing are release/content decisions, not schema constants. The feature must remain usable through an explicit manual-plan choice if a template is unavailable, including an empty published version.
- The PRD mentions reusable personal/business plans, but the clarification excludes reuse UI; persistence should not introduce a reusable-plan catalog unless later product work requires it.
- Any plan source with zero tasks remains editable in DRAFT but cannot activate. The Bugün empty state must remain understandable.
- A newly activated planned task read is required for the Bugün handoff. This slice does not define completion, recurrence, due/overdue processing, or diary projection.
- The authorized business timezone may need configuration outside SPEC-002. If absent, use the configured `Europe/Istanbul` fallback in this slice; do not add per-field timezone behavior or rely on server UTC.
