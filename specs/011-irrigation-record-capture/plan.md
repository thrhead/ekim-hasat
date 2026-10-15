# Implementation Plan: Irrigation Record Capture

**Branch**: `011-irrigation-record-capture` | **Date**: 2026-10-15 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/011-irrigation-record-capture/spec.md`

**Implementation readiness**: The quantity-unit clarifications are resolved in the specification. Duration is positive whole minutes; water volume is positive cubic metres with up to one decimal place.

## Summary

Add a server-authoritative online irrigation record create flow for an authorized Field, with an optional Season belonging to the same Field and Business. Persist the accepted operation as immutable historical data and surface it as a chronological Field Diary event. Add a mobile capture form reachable from the existing Field Diary. Reuse the existing Business-timezone local-time validation and server-side exact HTTP retry pattern; do not import durable local command storage, offline retry/reconciliation, or generic sync behavior. Optional duration uses positive whole minutes; optional water volume uses positive cubic metres with up to one decimal place.

The API creates records at `POST /v1/fields/{fieldId}/irrigation-records`. The existing Field Diary read contract is extended with an opt-in `includeIrrigation=true` query so new mobile clients can render irrigation entries while older clients retain their current response by default. The mobile Field Diary opts in, and its existing cursor pagination includes the new event kind.

## Technical Context

**Language/Version**: TypeScript, Node.js 22+, pnpm 10.17.1

**Primary Dependencies**: NestJS with Fastify, Prisma, PostgreSQL, Expo / React Native, OpenAPI 3.1, `openapi-typescript` and `openapi-fetch`

**Storage**: PostgreSQL as canonical state, owned through Prisma migrations. No SQLite irrigation store.

**Testing**: Domain/API tests use the repository's Node test runner; API persistence and tenant tests use PostgreSQL integration tests; API contracts use generated-client contract checks; mobile screen/navigation tests use Jest.

**Target Platform**: Versioned REST API and the existing iOS/Android mobile app.

**Project Type**: TypeScript modular monolith with API and mobile app.

**Performance Goals**: No new feature-specific latency target. Diary reads remain bounded to the existing page size and cursor behavior; mobile states remain responsive while the API request is pending.

**Constraints**: Current server authorization is required for every create and read. Field identity is required; Season is optional and must match Field and Business. Online only: no durable local create storage, offline delivery, automatic/background retry, or reconciliation; an exact user-initiated HTTP retry may reuse the request identity only for the same actor, payload, and currently authorized Business context while the online flow remains active. Interpret local date/time in the authorized Business timezone (`Europe/Istanbul` fallback), reject future and ambiguous/nonexistent values, persist one absolute instant, and display using Business timezone. Optional duration uses positive whole minutes; optional water volume uses positive cubic metres with up to one decimal place. Preserve current REST/OpenAPI versioning, API error envelopes, and compatibility for older mobile clients.

**Scale/Scope**: One append-only business-owned operation, one create endpoint, an additive Field Diary event, and one mobile create entry point. No new service, provider, catalog, or worker.

## Constitution Check

### Before Design

| Principle / Gate | Status | Plan response |
|---|---|---|
| Farmer simplicity and mobile completeness | PASS | Add one mobile form from the existing Field Diary; only occurrence time is required beyond the Field. |
| Offline work and honest connectivity states | PASS | The feature is online-only by approved scope; no local queue or success claim before server acceptance. |
| Server authorization and Business isolation | PASS | Resolve active membership on the server and validate Field/Season within that Business; never trust client Business identity. |
| Historical integrity | PASS | Persist the accepted operation with actor and server recording time; expose create/read only and guard against update/delete. |
| Human control and agronomic safety | N/A | The feature records completed work and provides no recommendation or automatic action. |
| Modular monolith / approved storage | PASS | Use a bounded Operations domain module and Prisma/PostgreSQL; no new service or datastore. |
| API and client contract | PASS | Add a versioned OpenAPI create operation, update the Field Diary contract additively, and generate the shared client types. |
| Tests by risk | PASS | Plan domain validation, Postgres tenant/relationship/history checks, API contract checks, and mobile flow/accessibility coverage. |

No constitution violation requires a complexity exception.

## Phase 0 — Research

See [research.md](./research.md). The design reuses server-side observation patterns for current authorization, Business-local time validation, absolute timestamp persistence, and safe exact HTTP retry. It does not reuse the observation mobile command store or its offline workflow. Irrigation remains owned by an Operations module; the existing Field Diary is only the chronological read projection and renders an independent event sourced from `IrrigationRecord`.

## Phase 1 — Design & Contracts

- [Data model](./data-model.md): a new Prisma-owned, append-only `IrrigationRecord` with same-Business Field/Season relationships and actor provenance.
- [Create contract](./contracts/irrigation-records.openapi.yaml): the new irrigation create endpoint and its request/result/error behavior.
- Existing contract extension: add the opt-in irrigation diary query and `IRRIGATION` entry variant to `specs/006-field-observations-basic-diary/contracts/observations-diary.openapi.yaml`; do not define a second conflicting diary endpoint contract.
- [Quickstart](./quickstart.md): planned end-to-end validation scenarios and repository commands. These commands were not run during planning.

### Proposed Source Structure

```text
packages/domain/src/operations/irrigation-record.ts
packages/domain/test/operations/irrigation-record.spec.ts

apps/api/src/operations/irrigation-records.controller.ts
apps/api/src/operations/irrigation-records.repository.ts
apps/api/src/operations/irrigation-records.service.ts
apps/api/src/operations/irrigation-records.module.ts
apps/api/test/operations/irrigation-records.*.spec.ts
apps/api/prisma/schema.prisma
apps/api/prisma/migrations/<timestamp>_irrigation_record/migration.sql
apps/api/src/main.ts

apps/api/src/observations/observation-diary.repository.ts
apps/api/src/observations/diary-query.ts
apps/api/test/observations/observations-diary.contract.spec.ts
apps/api/test/observations/observation-diary*.spec.ts
specs/006-field-observations-basic-diary/contracts/observations-diary.openapi.yaml

packages/api-client/openapi-generator.config.ts
packages/api-client/src/generated/irrigation-records-api.ts
packages/api-client/src/index.ts

apps/mobile/src/features/operations/irrigation-record-client.ts
apps/mobile/src/features/operations/irrigation-record-create-screen.tsx
apps/mobile/src/features/observations/diary-client.ts
apps/mobile/src/features/observations/field-diary-screen.tsx
apps/mobile/src/app-composition.ts
apps/mobile/App.tsx
apps/mobile/test/operations/irrigation-record-create-screen.test.tsx
apps/mobile/test/observations/field-diary-screen.test.tsx
apps/mobile/test/app-composition.test.ts
```

**Structure Decision**: Keep writes in a new API Operations module and domain operation model. Extend the existing Field Diary projection only for read composition and presentation. Add the mobile create screen under Operations and enter/return through existing Field Diary navigation. Render `IRRIGATION` with a distinct event branch; do not identify it as a `FieldObservation`, route it through observation local-command storage/reconciliation, or reuse observation description semantics. Keep Postgres migrations under the API's existing Prisma ownership.

## Constitution Check — Post-Design

| Gate | Status | Design evidence |
|---|---|---|
| Scope remains online-only and bounded | PASS | No irrigation SQLite state, outbox, background delivery, reconciliation, or offline read cache is introduced. Server-side exact HTTP retry is limited to normal idempotent request handling. |
| Tenant and relationship integrity | PASS | API checks active membership and same-Business Field/Season; database composite foreign keys reinforce the association boundary. |
| Historical integrity | PASS | Append-only row and database guard; immutable diary projection; no update/delete surface. |
| Time correctness | PASS | Client submits local representation and matching absolute instant; server validates unique Business-zone interpretation and rejects future values. |
| API compatibility | PASS | `includeIrrigation` defaults false for existing clients; the new mobile client opts in. Cursor payload binds the option to prevent cross-filter pagination. |
| No unnecessary architecture | PASS | One module in the existing modular monolith; no new datastore, worker, provider, or generic sync abstraction. |

The two previously open quantity decisions are resolved in the spec and reflected in the design: whole minutes for duration and cubic metres to one decimal place for water volume. No product clarification blocker remains in the current plan.

## Complexity Tracking

No constitution violations identified.
