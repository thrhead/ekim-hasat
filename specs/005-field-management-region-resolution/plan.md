# Implementation Plan: Field Management and Region Resolution

**Branch**: `005-field-management-region-resolution` | **Date**: 2026-10-02 | **Spec**: [spec.md](spec.md)

## Summary

Deliver the mobile-first Tarlalar experience and authorized Field list, detail, create, and edit APIs. Register Tarlalar at the approved production navigation position `Bugün | Takvim | Tarlalar | + | Daha Fazla`, keeping existing route meanings and adding no Calendar workflow. Reuse the existing NestJS modular monolith, PostgreSQL/PostGIS and Prisma, membership scope, map adapter, Field geometry rules, Season read contracts, and OpenAPI-generated client. Additional Field creation requires `Idempotency-Key` and uses a generalized business-command idempotency store adapted from the existing Season command store; updates use `Field.version` / `If-Match` independently. Add append-only current-boundary and region-context versioning and concurrency-safe default labels. Resolve administrative location and agricultural region independently through provider-neutral adapters backed by versioned geospatial data, recording a server `resolvedAt` timestamp when each result is obtained and accepted. Resolution remains best-effort and cannot block valid Field writes. Future Season activation reads the explicit current boundary pointer and snapshots current administrative/agricultural context and provenance; existing snapshots are never rewritten.

The intended coverage is all of Türkiye. Research confirms relevant official data sources exist, but does not establish access terms, nationwide operational query coverage, stable classification IDs, or version guarantees for both suggestion types. The design therefore keeps source and dataset selection behind adapters and requires an implementation-time source qualification before enabling a dataset. An unavailable or unqualified source returns an explicit unresolved result. Existing Fields without region context remain valid and unresolved; migration does not call resolvers or write inferred regions. A bounded, idempotent server application operation can resolve one existing Field from its current representative point and location key while preserving provenance and manual overrides. This plan adds no scheduler or guaranteed bulk backfill.

## Technical Context

**Language/Version**: TypeScript (repository-pinned toolchain)

**Primary Dependencies**: Existing pnpm/Turborepo workspace; NestJS with Fastify; Prisma; PostgreSQL/PostGIS; Expo/React Native; existing provider-neutral map adapter; OpenAPI generator and `@ekim-hasat/api-client`.

**Storage**: PostgreSQL/PostGIS is canonical application state; Prisma migrations own application tables. Immutable versioned geospatial source data is queried behind server-side resolver adapters. No new datastore or service boundary.

**Testing**: Existing unit/API/contract test patterns plus real PostgreSQL/PostGIS integration and tenant-isolation tests. Writable integration fixtures MUST target exactly `ekim_hasat_test`. No tests are run as part of this planning session.

**Target Platform**: NestJS API and farmer-facing mobile app; responsive web is not a prerequisite.

**Project Type**: TypeScript monorepo, modular API and mobile client.

**Performance Goals**: No new latency SLA is specified. Field list requests return at most 100 records and use keyset pagination; region lookup must not make writes depend on a live external-provider response.

**Constraints**: Server-side Business authorization; immutable historical SeasonContextSnapshot; append-only boundary history; preserve SPEC-001 representative-point semantics and SPEC-004 weather fingerprint behavior; the current-boundary pointer identifies the current Polygon even while it is `UNVERIFIED` and does not assert verification; migration backfills the pointer for existing boundary history using the existing `version DESC, id ASC` selector including ties, without adding `(fieldId, version)` uniqueness, rewriting version numbers, or changing rows/references; future activation reads the pointer only and snapshots the exact current region context; explicit unresolved region state including legacy Fields with no persisted context; no resolver calls, guessed region writes, or required external-data backfill in migrations; bounded idempotent per-Field server resolution; no production scheduler or guaranteed whole-database backfill; create-only default-name allocation for omitted/blank input, with blank Field-name updates rejected; required create idempotency separated from update `If-Match`; generalized business-command idempotency adapted from the Season command store while onboarding storage remains unchanged; Field create serializes user/key lookup and conflicts on changed payload or authentication/Business/command context; stale edit recovery preserves attempted values and requires explicit action; no automatic merge/rebase/retry; screen-level deduplicated accessibility announcements for meaningful async state changes; no generic offline Field mutations; no Season mutation other than future activation snapshot capture.

**Scale/Scope**: A per-Business Field list with default page size 50 and maximum 100; list ordering is `(name ASC, id ASC)`. Mobile Tarlalar list/detail/create/edit and read-only ACTIVE season summary. Geographic target is all of Türkiye, with unresolved state for unavailable/invalid coverage.

## Constitution Check

| Gate | Result | Design response |
|---|---|---|
| Farmer simplicity and mobile completeness | PASS | Tarlalar is usable on mobile; location permission is optional; map point and Polygon remain available. Generated names are server defaults. |
| Offline correctness | PASS | This feature does not claim offline Field writes. UI reports success only after server acceptance; existing supported offline workflows remain unchanged. |
| Server authority and tenant isolation | PASS | Scope is resolved from authenticated membership; no client Business ID authorizes access. List/detail/mutation queries remain Business-scoped. |
| Historical integrity | PASS | Boundary and region context changes append new versions; migration preserves tied legacy versions and rows; only future activation snapshots read the current pointers; existing SeasonContextSnapshot rows remain immutable. |
| Human control and uncertainty | PASS | Automatic values are suggestions with provenance; explicit agricultural-region override wins; unresolved is explicit. No task or season mutation is added. |
| External-provider isolation | PASS | Resolver ports do not expose provider payloads to domain/UI. Data source access and quality failures do not fail valid Field writes. |
| Testing by risk | PASS | Plan calls for authorization/tenant, concurrency, cursor, geometry, immutable-history, resolver-failure, API-client and weather-fingerprint coverage. |
| No fake production reality | PASS | Do not use statistical regions as agronomic regions or fabricate a result; qualify official datasets before enabling them. |
| Modular monolith and API contract | PASS | Add a Fields feature module and versioned OpenAPI contract; no new service boundary or hand-maintained client types. |

**Pre-design gate**: PASS after artifact reconciliation. Field create uses a generalized form of the existing Season command-idempotency pattern; onboarding's specialized durable completion store remains unchanged. The real agricultural dataset's licensing and nationwide operational coverage remain a source qualification risk, not a reason to hard-code a provider or block core Field management.

**Post-design gate**: PASS. The design preserves all accepted SPEC-001..004 contracts, adds only future activation snapshot capture, and leaves ADR-012 deferred. Tarlalar uses the approved navigation position without repurposing other routes. Any dataset selected for implementation must satisfy the provenance and coverage contract in [research.md](research.md); if no qualified dataset is available, the resolver returns unresolved.

## Project Structure

### Documentation (this feature)

```text
specs/005-field-management-region-resolution/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
└── contracts/
    └── fields.openapi.yaml
```

`tasks.md` is intentionally not created in this phase.

### Source Code (repository root)

```text
apps/api/src/
├── fields/                         # scoped Field commands, queries, validation
├── regions/                        # resolver ports, unavailable provider, and qualified dataset adapters
├── seasons/                         # existing activation writer updated for future pointer/context snapshots
├── weather/                         # existing SPEC-004 fingerprint validity remains authoritative
└── main.ts                          # module composition

apps/api/prisma/
├── schema.prisma
└── migrations/                      # Field current-boundary/region context versioning

apps/mobile/src/features/
├── fields/                          # Tarlalar list, detail, create/edit flows
└── onboarding/map/                  # existing map adapter reused without changing onboarding contract

apps/mobile/
├── App.tsx                           # preserve approved top-level navigation positions
└── src/app-composition.ts            # register Tarlalar without changing unrelated route meanings

packages/api-client/
├── openapi-generator.config.ts      # add the SPEC-005 source contract mapping
└── src/generated/                   # generated client/types; no handwritten duplicate transport types

specs/001-* .. specs/004-*/           # accepted source contracts and regression coverage
```

**Structure Decision**: Extend the existing modular monolith with a dedicated API Fields module and a server-side Regions resolver boundary. Main Agent owns composition in `apps/api/src/main.ts`, Fields/Regions module wiring, production mobile app composition/navigation, activation snapshot integration, and shared error-presentation integration. Reuse the mobile map adapter, membership scope, existing Season read model, weather validity checks, and generated API client. Field handlers use the established structured `ApiError` presentation path already used by Season commands, sharing request context and logging; generalize that path for Field command errors rather than adding a competing error framework. Preserve machine-readable `STALE_VERSION` and `IDEMPOTENCY_KEY_REUSED` codes, privacy-safe 403/404 behavior, correlation IDs, and the OpenAPI `ApiError` envelope. Do not change onboarding behavior or create a new runtime service.

## Complexity Tracking

No Constitution violations or added architectural components require justification.
