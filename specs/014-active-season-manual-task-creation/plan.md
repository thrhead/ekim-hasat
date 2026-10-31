# Implementation Plan: Active-Season Manual Task Creation

**Branch**: `main` (no feature branch created) | **Date**: 2026-10-30 | **Spec**: [spec.md](./spec.md)

**Input**: Clarified SPEC-014 including the approved OWNER-only correction. Planning only; no implementation or database operation is performed.

## Summary

Add a distinct server-authoritative active-season create command, separate from draft plan authoring. An OWNER creates an operational PlannedTask linked to the existing approved SeasonPlan, with explicit post-activation manual origin and a durable create receipt. Preserve the plan's source and activation snapshot, and keep post-activation tasks out of the original approved-plan projection. Resolve task provenance in shared read/action projections, with legacy fallback preserving existing records. Mobile captures in a feature-specific account-scoped durable outbox; only a confirmed, locally recorded server result is accepted. See [research](./research.md), [data model](./data-model.md), and [contract](./contracts/manual-tasks.openapi.yaml).

## Technical Context

**Language/Version**: TypeScript; Node.js 22+; pnpm 10.17.1.

**Primary Dependencies**: NestJS/Fastify, Prisma, Expo/React Native, OpenAPI and generated shared client; existing domain validators and auth services.

**Storage**: PostgreSQL canonical task and durable create receipt; SQLite mobile task-specific pending commands and minimum saved context. No new service or generic synchronization framework.

**Testing**: Domain unit; PostgreSQL integration for authorization, isolation, race/idempotency, lifecycle, snapshots and DATE semantics; contract/generated-client checks; mobile offline/restart/race and UI tests; focused end-to-end smoke.

**Target Platform**: Existing mobile app and versioned application REST API.

**Project Type**: TypeScript monorepo modular monolith with mobile.

**Performance Goals**: No new numeric target; use existing bounded task reads and responsive mobile states.

**Constraints**: OWNER only; Business derived server-side; ACTIVE and APPROVED for first acceptance; exact replay after current authorization even if lifecycle later changes; no offline success before authoritative acceptance. DATE is a local date, not a timestamp. Existing accepted actions and diary semantics remain intact. No schema migration or database writes in planning.

**Scale/Scope**: One task-specific creation command and local outbox; no broad offline season edits, task-management redesign, WORKER assignment infrastructure, or provider dependency.

## Constitution Check

| Gate | Before / after design | Response |
|---|---|---|
| Farmer simplicity and mobile | PASS / PASS | Contextual task entry, accessible pending and recovery states; no configuration. |
| Offline durability | PASS / PASS | Account-scoped SQLite; stable identities, attempt marker and explicit recovery. |
| Authorization and business isolation | PASS / PASS | Current OWNER membership and same-Business field/season checks on create and replay; cached context is not authority. |
| Historical integrity | PASS / PASS | Immutable activation/approved-plan snapshot, task origin and receipt; actions keep existing audit history. |
| Domain architecture and API | PASS / PASS | Existing modular monolith, Prisma, REST/OpenAPI, generated client; no new framework. |
| Risk-based tests | PASS / PASS | Required tenant, role, offline, contract, database and action regression checks in quickstart. |
| Agronomic safety and external data | N/A / N/A | Manual work capture does not infer risk or require external data. |

## Project Structure

### Documentation

```text
specs/014-active-season-manual-task-creation/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── contracts/manual-tasks.openapi.yaml
├── contracts/existing-reads.md
└── quickstart.md
```

### Source areas for later implementation

```text
packages/domain/src/seasons/       existing task/local-date validation and origin resolver
apps/api/src/seasons/              active create, Today and season-plan reads
apps/api/src/tasks/                completion, adjustment, skip and history projections
apps/api/src/calendar/             Calendar projection/snapshot
apps/api/src/observations/         existing diary task outcome projections
apps/api/prisma/                   additive schema and later migration
packages/api-client/               OpenAPI generation and shared client
apps/mobile/src/features/          task capture, existing Today/Calendar and account-scoped SQLite
apps/api/test/ packages/domain/test/ apps/mobile/test/   focused and regression coverage
```

**Structure Decision**: Extend existing domain/API/mobile boundaries, not a new service. Draft `seasons-plan-task` mutation remains draft-only. Link operational tasks to the approved plan for existing actions; a task origin discriminator distinguishes later additions from activation-time membership and legacy fallback. Do not rewrite frozen plan content or activation JSON.

## Approved UI Shape

[UI shape](./ui-shape.md) is the authority for the contextual entry: selected Field / ACTIVE Season is primary; Bugün is optional only with explicit Field/Season context; no Calendar creation entry or navigation redesign. Pending, unconfirmed and definitive rejection remain visibly distinct.

## Phase 0 — Research

[research.md](./research.md) records choices, repository evidence and alternatives. The old WORKER-scope blocker is resolved by the approved OWNER-only correction.

## Phase 1 — Design & Contracts

- [data-model.md](./data-model.md): task origin, receipt, local context/command, lifecycle and migration constraints.
- [manual-tasks.openapi.yaml](./contracts/manual-tasks.openapi.yaml): new create and exact replay transport contract.
- [existing-reads.md](./contracts/existing-reads.md): additive projections and preservation of canonical prior contracts.
- [quickstart.md](./quickstart.md): post-implementation validation, including safe test-database precondition.

## Acceptance Coverage

| Requirement | Planned verification |
|---|---|
| FR-001–004, SC-001–002, SC-006 | OWNER-only live membership, same-Business field/season, ACTIVE+APPROVED, local-date and existing title/description validation; manual origin and unchanged approved artifacts; denial and cross-tenant tests. |
| FR-005, SC-005 | Today/Calendar detail, completion including existing offline completion, reschedule, skip, history and applicable diary behavior; old task provenance and pagination regressions. |
| FR-006–009, FR-011–012, SC-003–004 | Account continuity after restart, SQLite durability, identity/replay, uncertainty, durable acceptance, de-duplication, account isolation and accessible statuses. |
| FR-010, SC-007 | Definitive reject vs unconfirmed, explicit same-command retry, new-identity correction, atomic rejected-only local removal and race tests. |
| FR-013 | No accepted-task edit/delete, WORKER create, broad sync or new authorization framework. |

## Complexity Tracking

No constitution exception. The task-origin discriminator and durable receipt are required because plan source is not task origin and task dates can change after creation. No tasks or implementation artifacts are produced by this gate.
