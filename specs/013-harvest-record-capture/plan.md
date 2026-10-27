# Implementation Plan: Harvest Record Capture

**Branch**: `013-harvest-record-capture` | **Date**: 2026-10-26 | **Spec**: [spec.md](./spec.md)

**Input**: Clarified SPEC-013. The feature specification is authoritative for product behavior; this plan records technical choices only.

## Summary

Add an online, server-authoritative create flow for immutable Harvest records associated with a required same-Business, same-Field ACTIVE Season. OWNER and WORKER may create; ADVISOR may use ordinary Diary reads but may not create. The authorized Diary response provides additive `viewerRole` metadata from `MembershipScopeService`; mobile uses it only to gate the active-Season `Hasat ekle` CTA (fail closed if missing), with no provider/app metadata inference. This metadata is response-level UI context, outside canonical Harvest data and Diary items, and does not affect ordinary Diary visibility or V1/V2 ordering/cursors. Persist the farmer-entered calendar date, exact positive decimal quantity, selected `KG` or `METRIC_TONNE` unit, actor provenance, and server acceptance time. The request identity is the durable Harvest identity: the server revalidates current Membership, role, Business, Field, and same-context Season access before first acceptance and replay. First acceptance requires ACTIVE; an exact authorized replay returns the original even after a later Season state change, while changed actor, payload, Field, or Season context conflicts.

Expose accepted Harvests as a distinct opt-in `HARVEST` entry in the existing Field/Season Diary. Extend its date-only cursor path for Harvest dates, preserve existing V1/default behavior and existing V2 Expense traversals, and have the new mobile client request Harvest entries. Mobile capture starts from the active Season's Diary with Field and Season context fixed in the form; after confirmed success it returns to that Diary and gives clear success feedback. The capture and Diary surfaces use accessible labels, usable touch targets, scalable text, and the required loading, empty, validation, success, connectivity, authorization, conflict, and server-error states. Mobile capture remains online-only; the active form retains the same logical submission after an uncertain response and reports acceptance only after the server confirms it.

## Technical Context

**Language/Version**: TypeScript, Node.js 22+, pnpm 10.17.1

**Primary Dependencies**: NestJS with Fastify, Prisma, PostgreSQL, Expo / React Native, OpenAPI 3.1, `openapi-typescript`, `openapi-fetch`

**Storage**: PostgreSQL is canonical; Prisma owns the Harvest schema and migration. No local/offline Harvest persistence.

**Testing**: Existing Node test runner; domain unit tests; PostgreSQL integration tests for tenant, constraint, idempotency, concurrency, and DATE/NUMERIC semantics; OpenAPI/generated-client contract checks; mobile screen and navigation tests.

**Target Platform**: Versioned REST API and existing iOS/Android mobile app.

**Project Type**: TypeScript monorepo modular monolith with API and mobile app.

**Performance Goals**: No new feature-specific latency target. Diary source queries remain bounded by the current page size and deterministic keyset pagination.

**Constraints**: Current membership and role are revalidated for creates and reads; never trust client Business identity or UI role. The authorized Diary's `viewerRole` is additive UI metadata from `MembershipScopeService`, not a permission grant or capability endpoint. First acceptance and replay require current Membership, role, Business, Field, and same-Field, same-Business Season access; only first acceptance requires the Season to be ACTIVE. Harvest date is a DATE-only value, cannot be after the authorized Business-local current date, and cannot precede Season actual planting date. Quantity remains an exact decimal string with up to three fractional digits, a technical maximum of 11 integer digits, and no conversion or rounding. Preserve historical values and associations. No sales, revenue, disposition, inventory, quality, notes, or other frozen exclusions.

**Scale/Scope**: One immutable Harvest entity and create operation, one distinct Diary event, and one mobile capture entry point. No generic historical-record framework, idempotency platform, unit-conversion framework, sync infrastructure, or new service boundary.

## Constitution Check

### Before Design

| Principle / Gate | Status | Plan response |
|---|---|---|
| Farmer simplicity and mobile completeness | PASS | Add a focused contextual mobile capture flow and render accepted records in existing Field/Season history. |
| Offline work and honest connectivity states | PASS | Harvest creation requires online server acceptance; no queued/local accepted record. Keep retry identity in the active submission flow. |
| Server authorization and Business isolation | PASS | Require current OWNER or WORKER membership, authorize Field and ACTIVE Season within that Business, and keep Advisor create denied. |
| Historical integrity | PASS | Persist immutable accepted facts, actor and server acceptance time; no edit/delete/void/correction endpoint. |
| Human control and agronomic safety | N/A | This records farmer-entered history and makes no agronomic recommendations. |
| Modular monolith / approved storage | PASS | Harvest domain and API module use current TypeScript/PostgreSQL/Prisma architecture; Diary only composes a read projection. |
| API and generated-client contract | PASS | Add a feature-owned create contract and amend the existing canonical Diary contract additively with response-level `viewerRole`; derive it from `MembershipScopeService`, regenerate shared client types, and use it only for fail-closed CTA gating. |
| Tests by risk | PASS | Plan database-backed tenant, immutable history, exact replay/race, date and decimal tests plus mobile states. |

No constitution violation requires a complexity exception.

## Phase 0 — Research

See [research.md](./research.md). The design follows the repository's Harvest & Sales ownership boundary while limiting this feature to Harvest capture. It reuses durable record identity for online idempotency, LocalDate and Business-timezone utilities for date validation, exact decimal persistence conventions, and the existing Diary date-only V2 ordering/cursor behavior.

## Phase 1 — Design & Contracts

- [Data model](./data-model.md): append-only canonical Harvest with tenant-safe Field/Season and actor relationships.
- [Create contract](./contracts/harvests.openapi.yaml): online `POST /fields/{fieldId}/harvests` request, exact replay, result and privacy-safe errors.
- [Diary contract extension](./contracts/diary-extension.md): precise additive amendment to the canonical SPEC-006 Diary OpenAPI source; no second Diary operation.
- [Quickstart](./quickstart.md): end-to-end validation scenarios and repository commands. Commands are planning guidance and were not run in this plan stage.

### Proposed Source Structure (implementation scope only)

```text
packages/domain/src/harvest/harvest-record.ts
packages/domain/test/harvest/harvest-record.spec.ts

apps/api/src/harvest/harvests.controller.ts
apps/api/src/harvest/harvests.repository.ts
apps/api/src/harvest/harvests.module.ts
apps/api/test/harvest/harvests.*.spec.ts
apps/api/prisma/schema.prisma
apps/api/prisma/migrations/ (Prisma-generated `_harvest_record` migration)
apps/api/src/main.ts

apps/api/src/observations/diary-query.ts
apps/api/src/observations/observation-diary.repository.ts
apps/api/test/observations/observations-diary.contract.spec.ts
specs/006-field-observations-basic-diary/contracts/observations-diary.openapi.yaml

packages/api-client/openapi-generator.config.ts
packages/api-client/src/generated/harvests-api.ts
packages/api-client/src/generated/observations-diary-api.ts
packages/api-client/src/index.ts

apps/mobile/src/features/harvest/harvest-client.ts
apps/mobile/src/features/harvest/harvest-create-screen.tsx
apps/mobile/src/features/observations/diary-client.ts
apps/mobile/src/features/observations/field-diary-screen.tsx
apps/mobile/src/app-composition.ts
apps/mobile/App.tsx
apps/mobile/test/harvest/harvest-create-screen.test.tsx
apps/mobile/test/observations/field-diary-screen.test.tsx
```

**Structure Decision**: Harvest owns validation, creation, and persistence in its own domain/API module under the existing modular monolith, following Architecture §8.14. The existing Diary composes its cross-domain page with a bounded, tenant-scoped query of canonical Harvest records and deterministic ordering. Prisma remains the migration owner. Generated API types are regenerated from the canonical feature and Diary contracts; no client types are hand-maintained.

## Acceptance Coverage Review

| Spec requirement | Planned coverage |
|---|---|
| FR-001–002: authenticated OWNER/WORKER create; no Advisor create; active same-Business/Field Season | API authorization, transaction validation, composite relations; create contract and tenant/role integration cases. |
| FR-003, FR-007–009: multiple immutable facts, audit context, exact retry and conflict semantics | Durable composite `(businessId, id)` identity, actor/association/payload comparison, append-only guard and transactional Business-row serialization. |
| FR-004–005: date-only Business-local future and planting boundary; exact positive quantity/unit | LocalDate/DATE storage, Business-local `today`, planting-date comparison, decimal-string validation and exact NUMERIC checks. |
| FR-006: acceptance only after server commit | HTTP 201/200 responses; mobile success state follows committed response only. |
| FR-010–011: distinct canonical Diary event; ordinary read authorization, filters and stable traversal | Additive `HARVEST` projection under existing Diary access scope; Field/Season source filtering; date-only V2 ordering and cursor extension. Strict-after traversal is not snapshot-isolated: pre-existing rows are not repeated or permanently skipped, inserts before the cursor are deferred to refresh, and inserts after it may appear on a later page. For mixed date-only entries, continuation compares the full `(precision, kind, source UUID)` order tuple. |
| FR-012, FR-016: mobile CTA and role metadata | Add response-level `viewerRole` to the existing authorized Diary read from current Membership scope and regenerate its API client. Show `Hasat ekle` to eligible OWNER/WORKER only; hide for ADVISOR and fail closed when missing. Treat it only as UI context and leave Diary visibility, items, ordering, and cursor behavior unchanged. |
| FR-012–014: mobile flow/states, online-only and no note | Start capture from the active Season Diary with fixed Field/Season context; after server confirmation return to that Diary and show success. Provide accessible labels, usable touch targets, scalable text, and the specified states; add no local Harvest store/outbox and exclude note from request/model. |
| FR-015: frozen exclusions | Explicitly absent from contracts, data model and proposed source scope. |
| SC-001–002: accepted exact record and multiple distinguishable records | API/domain and Postgres integration tests plus Diary read traversal. |
| SC-003, SC-007: exact retry, uncertain response, immutable values/context | Concurrent request/retry cases and post-acceptance context-change history case; active form preserves submission identity. |
| SC-004, SC-009: role, revocation, tenant, CTA and Season privacy | Current Membership/role/Business/Field/same-context Season checks before first acceptance and replay; ACTIVE is required for first acceptance only. Test viewerRole derivation and CTA gating/missing-signal fail-closed behavior; cross-business/field/season integration tests; Advisor Diary read remains ordinary. |
| SC-005: no offline queue or premature acceptance | Mobile connectivity, timeout, retry, and server-error tests; no local persistence. |
| SC-006: Diary order, pagination, compatibility | Mixed timed/date-only boundary checks include the full tuple for same-day Harvest/Expense continuation, strict-after cursor binding, pre-existing-row traversal guarantees, concurrent-insert non-snapshot behavior, V1/V2 regression coverage and generated contract check. |
| SC-008: date boundary semantics | Leap/calendar validity, business-local today, future, planting-date equality and before-planting tests; verify DATE remains unchanged across timezones. |

No uncovered FR or SC was identified in the plan review. No product clarification is required.

## Constitution Check — Post-Design

| Gate | Status | Design evidence |
|---|---|---|
| Scope and domain boundary | PASS | Only Harvest is implemented in the Harvest & Sales area; no Sales, disposition, inventory, quality, or generic event entity is planned. |
| Tenant and authorization integrity | PASS | Server resolves active membership; role and same-Business/Field/Season access checks precede replay disclosure, and first acceptance additionally requires ACTIVE; composite constraints backstop associations. |
| Historical integrity | PASS | Append-only accepted Harvest; source associations, entered values, actor and `recordedAt` remain stable. |
| Quantity and date correctness | PASS | Decimal string + unconstrained PostgreSQL NUMERIC/checks; LocalDate + PostgreSQL DATE and no invented timestamp. |
| API/client compatibility | PASS | New type is opt-in in Diary, preserving existing default V1 and Expense V2 cursor behavior; additive generated contract changes only. |
| Offline honesty | PASS | No Harvest outbox or offline persistence; active-flow retries reuse the same logical ID and payload. |
| No unnecessary architecture | PASS | No new service, datastore, queue, generic framework, or provider. |

No constitution violations or unresolved product decisions remain.

## Complexity Tracking

No constitution violations identified.
