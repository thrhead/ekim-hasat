# Implementation Plan: Field Observations and Basic Diary

**Branch**: `006-field-observations-basic-diary` | **Date**: 2026-10-05 | **Spec**: [spec.md](spec.md)

**Input**: Accepted feature specification at `specs/006-field-observations-basic-diary/spec.md`.

## Summary

Add a small append-only `FieldObservation` record and a mobile Field/Season diary projection. The API will authorize through the current active Business membership, validate the Field and optional same-Field Season, store farmer occurrence time separately from server acceptance time, and prevent duplicate creates with a stable client UUID and payload-bound replay. A diary application query will merge observations with existing accepted `TaskCompletion` rows in one globally ordered, bounded page. It will not copy completions into a generic event store or alter SPEC-003's completion command, history route, or completion-specific offline support. The OpenAPI contract remains the source for generated client types.

## Technical Context

**Language/Version**: TypeScript (repository-pinned toolchain)

**Primary Dependencies**: Existing pnpm/Turborepo workspace; NestJS with Fastify; Prisma; PostgreSQL; Expo/React Native; existing authentication, membership-scope, Business-timezone, observability, and OpenAPI-generated-client utilities.

**Storage**: PostgreSQL is canonical. Prisma owns an additive migration for observations and indexes. Mobile does not persist observation mutations offline.

**Testing**: Existing domain, API contract, mobile component, and real PostgreSQL integration patterns. Business isolation, idempotent replay, immutability, and mixed-source cursor behavior require focused coverage during implementation. No tests are run in this planning phase.

**Target Platform**: NestJS API and farmer-facing mobile app; desktop is not required.

**Project Type**: TypeScript monorepo, modular API and mobile client.

**Performance Goals**: No feature-specific latency SLA. Diary reads are bounded to 50 items by default and 100 maximum; each source query is bounded and uses indexed keyset ordering.

**Constraints**: Active membership is the authorization authority; client Business IDs are not accepted. Observation content and Field/Season association are append-only. `occurredAt` is a past-or-current absolute instant; `acceptedAt` is server UTC. A Season is optional and, when present, must share the Field and Business. A Field diary includes its observations (whether season-associated or not) and completions; a Season filter includes only records associated with that Season. Use one global deterministic ordering and cursor across the two sources. Creation requires connectivity and server commitment. Do not add taxonomy, attachments, generic sync, a generic event store, risk/AI, notifications, Calendar, task mutation, or sharing. Preserve SPEC-003 completion-specific offline behavior.

**Scale/Scope**: One observation create operation, authorized observation reads through diary, Field and Season diary views, and mobile entry from existing Field/Season surfaces. No task list/history replacement or global activity feed.

## Constitution Check

| Gate | Result | Design response |
|---|---|---|
| Farmer simplicity and mobile completeness | PASS | Text and default current occurrence time are sufficient to create; entry is available from Field/Season context on mobile. |
| Offline correctness | PASS | Observation creation reports success only after server acceptance. No observation queue is added; SPEC-003 completion-specific offline behavior is preserved. |
| Server authority and tenant isolation | PASS | Every command/read resolves active membership and scopes by Business/Field; optional Season is checked against both. Out-of-scope resources use privacy-safe errors. |
| Historical integrity | PASS | Observation records are append-only; corrections are new records. Occurrence and acceptance instants are separate. Existing completions remain canonical. |
| Human control and risk safety | PASS | No inference, diagnosis, task action, or recommendation is derived from observation text. |
| External-provider isolation | PASS | No external provider is needed. |
| API contract | PASS | Additive versioned REST/OpenAPI paths and generated API-client output; no handwritten client transport types. |
| Modular monolith | PASS | Add a focused observations/diary feature area inside the current API and mobile app; no service or datastore boundary. |
| Testing by risk | PASS | Plan calls for unit, tenant-isolation, real PostgreSQL, contract/client, pagination, and mobile accessibility/state coverage. |

**Pre-design gate**: PASS. The PRD's broad future diary/event examples do not require generalized infrastructure for this bounded SPEC-006 slice. Explicit SPEC-006 decisions fix the first-release scope to text observations plus accepted task completions, with no taxonomy or duplicated completion records.

**Post-design gate**: PASS. The only new canonical record is FieldObservation. The diary is a read projection over observations and canonical TaskCompletion. No accepted SPEC-001..005 API or data lifecycle is changed.

## Project Structure

### Documentation (this feature)

```text
specs/006-field-observations-basic-diary/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
└── contracts/
    └── observations-diary.openapi.yaml
```

`tasks.md` is not created by planning; `$speckit-tasks` owns it.

### Source Code (repository root)

```text
apps/api/src/
├── observations/                 # authorized create/read and diary projection module
├── tasks/                        # existing canonical TaskCompletion repository remains source
└── main.ts                       # compose the focused module

apps/api/prisma/
├── schema.prisma                 # FieldObservation model and relations
└── migrations/                   # additive observation table/indexes/constraints

apps/mobile/src/features/
├── observations/                 # create form and diary projection/rows
├── fields/                       # Field detail diary entry point
└── seasons/                      # Season-context diary entry point where present

packages/api-client/
├── openapi-generator.config.ts   # map the new source contract
└── src/generated/                # generated paths and schemas
```

**Structure Decision**: Extend the existing modular monolith with one observations API module that owns observation commands and a diary query/application service. The service reads observations through its repository and accepted TaskCompletion candidates through a bounded read method on the existing TaskCompletion repository, then returns a unified projection. It does not change the existing completion-only history route or its contract. Register the new OpenAPI source in the existing generator and consume only generated client types in mobile.

## Phase 0 and Phase 1 Artifacts

Research decisions are in [research.md](research.md). Canonical entities and constraints are in [data-model.md](data-model.md). The REST contract is [contracts/observations-diary.openapi.yaml](contracts/observations-diary.openapi.yaml). Validation scenarios are in [quickstart.md](quickstart.md).

## Complexity Tracking

No Constitution violations or new architectural components require justification.
