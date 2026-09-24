# AGENTS.md — Ekim Hasat

This file defines repository-wide instructions for Codex and other coding agents.

## 1. Read Before Editing

Before implementing or modifying a product feature, read in this order:

1. `AGENTS.md`
2. `docs/PRD.md`
3. `docs/ARCHITECTURE.md`
4. Relevant ADRs under `docs/ADR/`
5. The active spec-kit feature specification
6. The active technical plan
7. The active task list

If two sources conflict, surface the conflict before implementation.

Source-of-truth priority:

1. Explicit newly approved product decision
2. `docs/PRD.md`
3. `docs/ARCHITECTURE.md`
4. ADR
5. Active feature specification
6. Technical plan
7. Tasks
8. Existing code behavior

Existing code is not automatically correct merely because it already exists.

## 2. Farmer-First Product Rule

Ekim Hasat is a farmer-first product.

Internal complexity must not leak into the farmer experience.

Prefer:
- sensible defaults before configuration,
- contextual options before global settings,
- mobile completeness,
- offline resilience,
- explainability,
- conservative automation.

Do not add configuration merely because the architecture can support it.

## 3. Repository Architecture

Target architecture:
- TypeScript monorepo
- `pnpm`
- Turborepo
- Next.js web
- Expo / React Native mobile
- NestJS API with Fastify
- PostgreSQL + PostGIS
- Prisma for application-domain persistence
- Payload CMS for central content authoring
- SQLite for mobile offline persistence
- asynchronous worker for background processing
- REST + OpenAPI

Do not introduce a new framework, datastore, queue, or service boundary without an approved architecture decision.

Do not decompose the modular monolith into microservices without explicit approval.

## 4. Package and Boundary Rules

Core business rules belong in domain/server modules, not UI components.

Rules:
- clients call the application API for authoritative mutations;
- mobile never talks directly to PostgreSQL;
- web never bypasses the API for application-domain writes;
- provider SDKs stay behind adapters;
- domain code must not depend directly on weather/satellite/AI vendor payloads;
- Payload CMS is not queried live for every farmer request;
- published CMS content is converted into validated immutable runtime versions.

## 5. Multi-Business Security

Every business-owned record must be scoped by business.

Never trust a client-supplied `businessId` as proof of authorization.

For business-owned operations:
1. authenticate user;
2. resolve membership;
3. validate role/scope;
4. query/mutate within the authorized business boundary.

Every feature involving business data requires tenant-isolation tests.

## 6. Historical Integrity

Completed or realized farming records are not ordinary editable documents.

Examples:
- completed task,
- expense,
- observation,
- irrigation record,
- harvest,
- sale.

Do not silently erase operational history.

Do not silently mutate historical season context when field geometry, region, template, or rule versions later change.

## 7. Task and Decision Rules

Task-changing intelligence must respect this precedence:

1. critical safety / fixed deadline;
2. explicit user decision for the current season;
3. current conditions:
   - weather,
   - confirmed risk,
   - actual growth stage;
4. central/regional template;
5. learned personal preference;
6. general default.

Lower-priority input must not silently override higher-priority input.

Default weather-driven schedule behavior is:
> propose the change and ask the farmer for approval.

Do not silently auto-reschedule critical/fixed tasks.

Automatic changes, when allowed, must be visible, logged, and reversible.

## 8. Offline-First Rules

Mobile offline support is a product requirement.

Use SQLite for offline domain data.

Do not use AsyncStorage as the primary domain database.

Offline-capable mutations require:
- client-generated stable ID,
- `mutation_id`,
- idempotent server handling,
- base/entity version where applicable,
- durable local outbox,
- deterministic conflict behavior.

Never silently lose:
- task completion,
- field observation,
- photo,
- manual task,
- cost,
- harvest,
- sale.

Do not use `updated_at > last_sync_time` as the sole sync algorithm.

Use the approved change-log/cursor model.

## 9. External Data Freshness

Weather, satellite, and other derived external data must carry freshness and quality metadata.

Do not show stale data as current.

Do not generate high-confidence farmer guidance from data that failed its quality gate.

## 10. Risk and Agronomic Safety

A risk signal is not a diagnosis.

Farmer-facing language must use concepts such as:
- possible risk,
- attention needed,
- check the field,
- data unavailable,
- low confidence.

Do not represent AI/satellite/weather inference as confirmed disease diagnosis.

Do not create autonomous chemical dosage/prescription behavior unless the product requirements are explicitly changed.

## 11. AI Rules

AI is optional and must not be required for core workflows.

AI output is untrusted input.

All AI-proposed commands pass through the same:
- authorization,
- validation,
- domain rules,
- audit rules

as manual commands.

AI provider secrets never enter client bundles.

Critical records/actions require the approved preview/confirmation behavior.

## 12. API Contract

Use versioned REST + OpenAPI.

Do not hand-maintain divergent API types in web and mobile.

Generate the transport client from OpenAPI.

Breaking API changes require:
- explicit review,
- backward-compatibility consideration for installed mobile versions,
- migration/deprecation plan where needed.

## 13. Database Rules

PostgreSQL is the canonical application state.

PostGIS owns canonical field geometry.

Prisma owns application-domain migrations.

Payload owns its own CMS tables/schema.

Never let two migration systems own the same table.

Money must use decimal-safe types.

Server timestamps use UTC, while farmer planning dates preserve local-date semantics.

## 14. Background Work

Critical asynchronous work must use the approved job/outbox architecture.

Do not use fire-and-forget calls for required follow-up.

Job handlers must be idempotent.

Typical workloads:
- weather refresh,
- satellite processing,
- risk recalculation,
- notifications,
- reports,
- exports,
- CMS publication ingestion,
- attachment processing.

## 15. Attachments

Farm attachments are private by default.

Use object storage with signed access.

Do not store large binaries directly in PostgreSQL.

Offline photo capture must preserve the domain record even if file upload fails.

## 16. Testing

A feature is not complete because it compiles.

Use tests appropriate to risk.

Required categories where applicable:
- unit tests,
- integration tests,
- tenant-isolation tests,
- permission tests,
- API contract tests,
- offline/sync tests,
- E2E smoke tests.

Business-rule changes should be test-first whenever practical.

Use real PostgreSQL/PostGIS in integration tests when database/geospatial semantics matter.

## 17. Required Offline Test Cases

When applicable, test:
- create offline → reconnect;
- update offline → reconnect;
- repeated mutation retry;
- network loss during synchronization;
- two-device conflict;
- membership revoked while device is offline;
- offline photo pending upload;
- app restart before queued mutation is synchronized.

## 18. UI Rules

Farmer-facing UI must:
- use farmer language rather than architecture jargon;
- prefer a sensible default;
- hide advanced settings until relevant;
- remain usable on mobile;
- support weak connectivity;
- communicate uncertainty;
- avoid dashboard overload.

Do not expose internal terms such as:
- tenant,
- sync cursor,
- rule engine,
- template version,
- NDVI threshold,
- authorization lease

to normal farmer workflows.

## 19. Fake Data Policy

Do not ship fake production data.

Development/test fixtures are allowed only in non-production contexts.

Agronomic production content must enter through the controlled content publication process.

## 20. Observability

Preserve or add:
- structured logs,
- request/correlation IDs,
- useful error codes,
- actionable failure context.

Never log:
- auth tokens,
- OTPs,
- passwords,
- provider secrets,
- unnecessary sensitive user data.

## 21. Migrations

All schema changes must be migration-backed.

Do not make untracked production DDL changes.

Prefer backward-compatible migrations because older mobile app versions may remain active.

Call out destructive or contract-affecting migrations explicitly.

## 22. Definition of Done

Before claiming a feature is complete, verify all applicable items:
- spec acceptance criteria pass;
- relevant tests pass;
- authorization is correct;
- tenant isolation is tested;
- offline behavior is defined/tested;
- conflict behavior is defined;
- audit/history behavior is correct;
- loading/empty/error states exist;
- mobile UX is usable;
- external failure modes are handled;
- documentation/spec and implementation still agree.

Report what was verified and what remains unverified.

## 23. Graft Integration

Graft is development tooling for repository structure/context discovery.

It must never become an Ekim Hasat runtime dependency.

Repository integration is expected to use:
- `.claude/skills/graft/SKILL.md`
- `.claude/helpers/graft-hooks.cjs`
- `.claude/helpers/graft-statusline.cjs`
- `.claude/settings.json`
- `.mcp.json`
- `AGENTS.md`

Where required by the installed spec-kit integration:
- `.specify/integrations/codex.manifest.json`
- `.specify/integration.json`

Generated integration contents must come from the installed tooling. Do not fabricate generated configuration.

### Graft bootstrap

Before feature development:

1. Run `graft init --dry-run`.
2. Review the proposed changes.
3. Complete required Codex/Graft repository wiring.
4. Run `graft build`.
5. Run `graft check`.
6. Confirm `graft/` is Git-ignored.

### Graft rules

- `graft/` is local generated cache/context and must not be committed.
- Do not run `graft build --deep` unless explicitly approved.
- Graft may manage only its marker-fenced block inside `AGENTS.md`.
- Never allow Graft to overwrite hand-maintained instructions outside that block.
- Run `graft check` after material repository-structure changes.
- Prefer Graft context/structure discovery before broad manual repository exploration.

Before the first product feature, report:
- initialization status;
- wiring status;
- `graft build` result;
- `graft check` result;
- Git-ignore status for `graft/`;
- confirmation of marker-fenced `AGENTS.md` ownership.

## 24. spec-kit Workflow

Do not implement the entire PRD as one task.

For each bounded feature:
1. create/approve specification;
2. clarify unresolved requirements;
3. create technical plan;
4. produce tasks;
5. implement;
6. test/verify;
7. reconcile documentation.

Every feature spec should address where applicable:
- user stories,
- acceptance criteria,
- edge cases,
- permissions,
- tenancy,
- offline behavior,
- sync/conflicts,
- audit/history,
- observability,
- external failures,
- tests.

## 25. Superpowers Workflow

Use Superpowers as an engineering execution discipline inside the approved product/spec boundary.

Use it particularly for:
- planning,
- test-first implementation,
- systematic debugging,
- code review,
- verification,
- finishing a branch/worktree.

Superpowers must not silently redefine product scope.

If a generated plan conflicts with the PRD or architecture, stop and surface the conflict.

## 26. Implementation Discipline

Prefer small vertical increments.

The first product-quality vertical slice is:

> Sign in → Add field → Select crop → Enter sowing date → Generate plan → Approve plan → See task in Bugün → Complete task → See completion in history.

Do not front-load satellite, AI, finance, or advanced team complexity before this slice works end-to-end.

## 27. Final Rule

When uncertain, do not guess around an architectural or product contradiction.

Surface the decision that is required with the smallest set of options necessary to continue.
