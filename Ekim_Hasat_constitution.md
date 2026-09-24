# Ekim Hasat Project Constitution

**Purpose:** Non-negotiable engineering and product principles for spec-driven development.  
**Applies to:** All feature specifications, plans, tasks, implementation, review, and verification.

## Principle I — Farmer Simplicity

The product MUST optimize for a farmer completing real work, not for exposing every capability of the system.

Requirements:
- sensible defaults before configuration;
- advanced settings hidden until relevant;
- farmer-facing language instead of implementation terminology;
- onboarding asks only for information required to deliver immediate value;
- no feature may require organizational/admin setup when a single farmer can reasonably use it alone.

A technically complete feature that introduces unnecessary farmer complexity is not complete.

## Principle II — Self-Service and Mobile Completeness

A single farmer MUST be able to use the core product without:
- an administrator,
- an advisor,
- an employee,
- a desktop computer.

All essential workflows MUST be available on mobile.

Web may improve planning, reporting, and administration, but MUST NOT become a prerequisite for core farming workflows.

## Principle III — Offline Work Must Survive

Offline behavior is part of product correctness.

Supported offline actions MUST NOT be silently lost.

Offline-capable mutations MUST use:
- stable client-generated identity;
- durable local persistence;
- idempotent synchronization;
- explicit conflict semantics.

When connectivity is unavailable, the product MUST degrade gracefully rather than presenting false success or current external data.

## Principle IV — Server-Side Business and Security Authority

The API/domain layer is authoritative for:
- authorization,
- business isolation,
- planning rules,
- rule precedence,
- audit behavior,
- risk derivation,
- finance calculations,
- content-version binding,
- conflict decisions.

Clients MAY provide local validation and optimistic UX, but MUST NOT become the authority for security or domain rules.

No business-owned entity may be accessed without validated membership/scope.

## Principle V — Historical Integrity and Explainability

The product MUST preserve a trustworthy record of what happened.

Important historical/operational records MUST NOT be silently rewritten or erased.

Season context MUST preserve relevant historical versions such as:
- field boundary,
- region,
- crop/template/rule versions.

When a recommendation materially changes a plan, the system SHOULD retain enough evidence to explain why.

## Principle VI — Human Control Over Farming Decisions

The system may recommend actions, but the default behavior for meaningful plan changes is farmer approval.

Task-changing rules MUST respect the approved precedence hierarchy.

Critical/fixed-deadline tasks MUST NOT be silently auto-rescheduled.

AI, weather, satellite, and risk engines MUST NOT bypass the same domain validation and authorization used for manual operations.

## Principle VII — Risk Is Not Diagnosis

Weather, satellite, observation, and AI-derived signals MUST communicate uncertainty.

The system MUST NOT present an inferred risk as a confirmed disease diagnosis.

The product MUST NOT introduce autonomous chemical treatment or dosage prescriptions without an explicit future product decision and safety review.

## Principle VIII — Immutable Published Content Versions

Central CMS content is authored centrally but runtime behavior MUST NOT depend on live mutable CMS documents.

Published templates/rules MUST be validated and converted into immutable runtime versions.

Active seasons MUST retain the versions on which they depend.

User-modified season tasks MUST NOT be silently overwritten by later central content changes.

## Principle IX — Modular Monolith Before Distributed Systems

The default architecture is a modular monolith with clear domain boundaries.

Do NOT create microservices without evidence of a real need such as:
- independent scaling,
- security isolation,
- operational isolation,
- separate ownership,
- incompatible runtime characteristics.

Architectural novelty is not a goal.

## Principle X — External Providers Behind Adapters

Weather, satellite, push, AI, storage, auth, and similar external providers MUST be accessed through explicit adapters.

Provider-specific payloads MUST NOT become core domain models.

A provider outage MUST NOT prevent the farmer from using unrelated core workflows.

## Principle XI — Test According to Risk

Implementation MUST include tests appropriate to the behavior being changed.

At minimum:
- domain rules → unit tests;
- persistence/transactions/geometry → integration tests;
- business data → tenant-isolation tests;
- API changes → contract verification;
- offline features → sync/conflict tests;
- critical user journeys → E2E smoke coverage.

Mocks MUST NOT substitute for database/geospatial integration tests where real database semantics are the behavior under test.

## Principle XII — No Fake Production Reality

Fake production data, fake agronomic certainty, and placeholder production behavior are prohibited.

Test fixtures are allowed only in development/test environments.

Production agronomic content MUST use the controlled content/versioning process.

The application MUST clearly identify stale, unavailable, low-quality, or estimated data when that distinction matters to the farmer.

## Principle XIII — Specification Before Implementation

No substantial feature should begin from a vague implementation prompt.

The normal workflow is:

1. PRD;
2. architecture;
3. feature specification;
4. clarification where necessary;
5. technical plan;
6. task breakdown;
7. implementation;
8. verification;
9. documentation reconciliation.

A specification MUST state acceptance criteria and relevant edge cases before the feature is considered ready for implementation.

## Principle XIV — Small Vertical Delivery

Prefer end-to-end vertical slices over large horizontal infrastructure programs.

The initial reference slice is:

> Sign in → Add field → Select crop → Enter sowing date → Generate plan → Approve plan → See task in Bugün → Complete task → See completion in history.

Infrastructure should be introduced when required by a real vertical slice or an approved near-term dependency.

## Principle XV — Agent Tooling Does Not Define Product Behavior

Codex, spec-kit, Superpowers, and Graft are development tools.

They MUST NOT become runtime dependencies or silently redefine product scope.

Roles:
- **PRD:** product source of truth;
- **Architecture:** technical structural decisions;
- **spec-kit:** feature specification and planning;
- **Superpowers:** implementation/testing/debugging discipline;
- **Graft:** repository structure/context discovery;
- **Codex:** implementation agent.

If a tool-generated artifact conflicts with approved product or architecture decisions, the conflict MUST be surfaced.

# Governance

## Source-of-Truth Priority

When two artifacts conflict:

1. explicit newly approved product decision;
2. PRD;
3. architecture;
4. ADR;
5. active feature specification;
6. technical plan;
7. task list;
8. existing code.

Existing code is evidence of current implementation, not automatic product authority.

## Amendment Rule

A constitutional principle may be changed only when:
- the reason is documented;
- affected PRD/architecture/spec artifacts are reviewed;
- migration/compatibility impact is considered;
- the change is explicit rather than introduced indirectly through implementation.

## Feature Review Gate

Before implementation begins, a feature SHOULD answer:
- What farmer problem does this solve?
- What is the minimum farmer-facing interaction?
- What business/permission boundary applies?
- What happens offline?
- What happens when an external provider fails?
- What historical/audit behavior applies?
- What uncertainty must be communicated?
- What tests prove it works?

If a question is irrelevant to the feature, record it as not applicable rather than inventing unnecessary behavior.

## Completion Gate

A feature is done only when:
- approved acceptance criteria pass;
- required tests pass;
- tenancy/security checks pass;
- offline behavior is verified where applicable;
- failure modes are handled;
- product wording does not overstate certainty;
- documentation and implementation agree.

## Development Tooling Rule

Before the first feature implementation:

1. initialize Graft with `graft init --dry-run`;
2. review proposed integration changes;
3. complete repository wiring;
4. run `graft build`;
5. run `graft check`;
6. confirm `graft/` is Git-ignored;
7. confirm Graft owns only its marker-fenced section inside `AGENTS.md`.

Do NOT run `graft build --deep` unless explicitly approved.

**Constitution status:** Initial approved baseline for Ekim Hasat spec-driven development.
