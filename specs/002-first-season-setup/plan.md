# Implementation Plan: First Season Setup and Plan Approval

**Branch**: `002-first-season-setup` | **Date**: 2026-09-28 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/002-first-season-setup/spec.md`

## Summary

Continue from SPEC-001's persisted first field through crop and actual sowing/planting-date selection, proposed season-plan review, explicit activation, and transition to Bugün. The API resolves the farmer's authorized business scope, enforces one logical season per authorized business/field/crop/actual-date identity, creates a draft plan, and snapshots/copies applicable immutable validated-template tasks. An applicable published template with no task definitions is unavailable for generation, produces an operational content-quality diagnostic, and offers an explicit manual-plan choice. Activation requires at least one valid dated task for either plan source. The mobile client persists an unresolved create command and retries it with the same idempotency key after uncertain response/restart; this is not a general offline queue or sync feature. Active plans are read-only through SPEC-002. The app consumes the generated OpenAPI client and does not introduce task completion or device-specific work.

## Technical Context

**Language/Version**: TypeScript, Node.js >=22 (repository engine), pnpm 10.17.1.

**Primary Dependencies**: Existing NestJS/Fastify API, `packages/domain`, Prisma, `packages/api-client` OpenAPI generation, Expo/React Native mobile. No new framework or service boundary.

**Storage**: PostgreSQL is canonical. Prisma migrations own crop runtime references, business-scoped custom crops, draft/active seasons, plan/task rows, and required idempotency/snapshot records. Enforce logical season identity within authorized business/field/crop/actual-date context under concurrency. Farmer dates use PostgreSQL `DATE`; server timestamps remain UTC. The mobile client durably stores only the unresolved SPEC-002 create command/key until its result is recorded; this does not add a general outbox/sync capability.

**Testing**: Domain unit tests; API/OpenAPI contract tests; PostgreSQL transaction, concurrency/idempotency, and tenant-isolation integration tests; mobile component and app-composition tests. Run Cloud Shell-compatible commands documented in `quickstart.md`; Android builds, emulator work, and device runtime evaluation are excluded.

**Target Platform**: Authenticated NestJS API and Expo mobile client. Bugün receives a read-only planned-work surface; task completion remains out of scope.

**Project Type**: TypeScript monorepo, modular-monolith API, shared domain and generated REST client, mobile application.

**Performance Goals**: No numeric performance target is specified by the PRD or feature spec. Keep crop choices and draft plan reads bounded to the authorized field/business context.

**Constraints**: API/domain is authoritative for authorization, template resolution, task-date validation, minimum-task validation for both sources, logical season identity, idempotency, and activation. Never accept client `businessId` or client authority over template versions. Copy generated template tasks into the draft plan and pin immutable template/crop versions. Preserve approved plans after activation. Do not add CMS authoring/ingestion, general offline sync, weather, recurrence, AI, satellite, advisor, finance, harvest, or task completion behavior. Do not freeze an exact pilot crop list. Pre-sowing mode is deferred.

**Scale/Scope**: One first-season setup flow for an authorized first field; central crop catalog may contain applicable or non-applicable validated templates, and farmers may enter a custom crop. Scope ends at activation and transition to Bugün.

## Constitution Check

### Before Phase 0

- Farmer simplicity and mobile completeness: **PASS** — crop/date are the required inputs; optional details and desktop use are not required.
- Server authority and business isolation: **PASS** — active membership and field scope are resolved server-side for each read/mutation; tenant tests are required.
- Historical integrity/content versioning: **PASS** — draft tasks are copied from an immutable template version; activation records the season context and source distinction.
- Human control: **PASS** — the farmer reviews task edits and explicitly activates; no automatic changes are introduced.
- Offline correctness: **PASS** — persist only the unresolved SPEC-002 create command/key required for exact lost-response/app-restart recovery; do not add a general mutation outbox or synchronization mechanism. Failed requests must not display false success.
- Modular monolith and migration ownership: **PASS** — domain modules remain in the existing API/packages and app-domain tables use Prisma migrations.
- Fake production data: **PASS** — no production agronomic template or crop list is invented; published validated content is a release dependency. Fixtures are test-only.

## Design Decisions and Boundaries

- Crop identity and template applicability are distinct. A central crop may lack a currently applicable validated template; a farmer-entered custom crop has no central validation claim. Both can continue using a manual plan.
- The plan source is explicit: `VALIDATED_TEMPLATE` with an immutable template-version reference, or `MANUAL` without one. A manual plan is never labelled centrally validated or expert-approved. If an applicable published version has zero task definitions, treat it as unavailable, emit a content-quality/integrity diagnostic, explain the unavailable validated plan, and require the farmer to explicitly choose `MANUAL`; never create an empty template-backed plan or auto-convert sources.
- Template task definitions are copied into plan-owned rows when the draft is created. Farmer edits/removals/date changes apply only to those copies, not to published content.
- Crop/date selection precedes draft creation. SPEC-002 does not add crop/date editing or template regeneration after tasks have been edited; plan mutations are limited to task add/edit/remove/date operations.
- Any plan source may be saved with zero tasks, but activation rejects it with a clear explanation and leaves the editable draft intact. Planned task dates must be on or after actual sowing/planting date; no ordering invariant applies between tasks. No task is generated to satisfy the minimum.
- Actual sowing/planting date accepts today or any past local date, with no arbitrary lookback; future dates fail. A matching authorized business/field/logical-crop/actual-date create returns the existing season unchanged, including under concurrent requests and a different key. The client persists and retries the exact unresolved create request with its original key until the result/season ID is durably recorded; then it clears that command. Same-key payload mismatch remains a conflict.
- Draft task writes are version-checked and allowed only in DRAFT. Activation uses a single atomic DRAFT→ACTIVE transition: exact same-key command replay returns the original success; changed key payload/version, stale DRAFT version, competing different-key activation, and different-key activation against ACTIVE return 409. On activation conflict the client re-reads the season. The server rechecks membership and business scope on every request.
- A scoped season read restores a saved draft or confirmed active result after leaving review or activation failure. Unknown-ID recovery for create uses the persisted exact create command/key and the create replay response, not a dedicated recovery endpoint. A narrow read-only Bugün query includes planned tasks whose local date equals the authorized business-local date across that business's fields. Use configured `Europe/Istanbul` fallback if no business timezone is configured; device timezone and server UTC do not define the product date. Do not include completion, recurrence, overdue transitions, or diary/history.
- Existing PRD allowance to reuse personal/business plans does not require reuse UI in this feature; no reusable-plan catalog or picker is added.

## Constitution Check (Post-Design)

- No new service, framework, datastore, CMS migration owner, or runtime provider is introduced: **PASS**.
- Season activation and initial task persistence share a transaction; business authorization is repeated at the command boundary: **PASS**.
- Tests cover domain rules, contract shapes, transaction rollback/retry, authorization isolation, and mobile journey state: **PASS**.
- No device/runtime evidence is claimed or required for this planning artifact: **PASS**.

## Project Structure

### Documentation (this feature)

```text
specs/002-first-season-setup/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
└── contracts/
    └── seasons.openapi.yaml
```

### Source Code (repository root)

```text
apps/api/prisma/schema.prisma                 # app-domain season/crop/plan persistence
apps/api/prisma/migrations/                   # Prisma-owned schema migration
packages/domain/src/seasons/                   # crop selection, plan and activation rules
packages/domain/test/seasons/                  # domain unit tests
apps/api/src/seasons/                          # authenticated REST controller/repository
apps/api/test/seasons/                         # API contract, transaction, isolation tests
packages/api-client/                           # generated OpenAPI transport types/client
apps/mobile/src/features/seasons/              # crop/date, plan review/task edit, activation UI
apps/mobile/src/app-composition.ts             # onboarding → season setup → Bugün routing
apps/mobile/App.tsx                            # route/screen composition
apps/mobile/test/seasons/                      # UI and state tests
apps/mobile/test/app-composition.test.ts       # journey transitions
```

**Structure Decision**: Extend the existing modular monolith. Season and planning rules live in `packages/domain`; Prisma and REST adapters live in `apps/api`; the API-client contract is generated from OpenAPI; the mobile flow remains in a focused season feature module. No new application boundary is created.

## Validation Strategy

- Unit: catalog/template applicability including empty published template fallback, source distinction, task add/edit/remove/date validation, local-date bounds, both-source zero-task activation rejection, and active-plan mutation rejection.
- Contract: OpenAPI request/response/error validation and generated client use for crop choices, season draft/recovery read, plan-task mutations, activation, and read-only Bugün tasks.
- PostgreSQL integration: creation and activation atomicity; rollback leaves no partial season/plan/task state; immutable template reference and copied task data survive publication changes; same logical season creation is server-enforced under concurrent different keys; same-key create replay survives lost response/app restart and returns the same ID; activation replay/concurrency yields one transition and specified conflicts; active task mutations conflict; optimistic version conflicts are explicit; Bugün day boundaries use the authorized business timezone/fallback, not device timezone or UTC.
- Authorization: each operation uses the authorized membership scope and field-to-season business boundary; cross-business field/season/task/today requests are denied without existence leakage.
- Mobile: first-field completion routes into crop/date setup; loading, empty/manual, validation, and retry states are accessible; the exact unresolved create command/key is retained until durable result recording; ACTIVE plans expose no edit controls; controls have accessible names/roles, scalable text, sufficient contrast, and platform-appropriate touch targets; template/manual source is not color-only; activation success routes to business-timezone Bugün; no completion control is added.
- Cloud Shell can run domain, API, contract, and mobile unit/component tests when dependencies and PostgreSQL are available. Device-specific visual, screen-reader, keyboard/date-picker, and real connectivity evidence remains outside this feature's planned verification and no Android/emulator work is included.

## Review Focus

- Does create resolve crop identity and applicable template from server-owned catalog data rather than trusting a client template choice?
- Does every tenant-owned query join back to the authorized field/business scope?
- Does failed zero-task activation for either source leave the same editable draft intact?
- Does an empty published template produce a content diagnostic and explicit manual choice without creating an empty template plan or silently changing source?
- Does logical season identity prevent duplicate creation under concurrent requests while preserving exact idempotency-key replay?
- Does the mobile client retain and replay the exact unresolved create command/key until it durably records the season ID?
- Are plan-task mutations rejected after activation and are activation replay/concurrency results strict and deterministic?
- Can template publication changes leave the draft and active season unchanged?
- Does the Bugün transition remain read-only and avoid task execution scope?

## Complexity Tracking

No constitution exceptions or additional architectural components are proposed.
