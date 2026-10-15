# Research: Irrigation Record Capture

**Feature**: [spec.md](./spec.md)
**Date**: 2026-10-15

## Decisions

### 1. Keep irrigation writes in the Operations domain

**Decision**: Add `IrrigationRecord` validation in `packages/domain/src/operations/` and an API module under `apps/api/src/operations/`. Keep the API in the existing modular monolith and use Prisma/PostgreSQL.

**Rationale**: Architecture §8.12 assigns irrigation to Operations; API controllers and repositories already form per-domain modules wired by `apps/api/src/main.ts`. This gives irrigation clear write ownership without a new service boundary.

**Alternatives considered**: Put irrigation writes in the observations module or add a separate service. The former mixes ownership; the latter violates the modular-monolith default without a scaling or security need.

### 2. Make the accepted record append-only and tenant-scoped

**Decision**: Persist a business-owned row with composite relationships to its Field and optional Season, plus the acting User/Membership and server acceptance time. Use a Prisma migration, composite foreign keys, and a database guard against update/delete. Recheck active membership and Field/Season scope in the server transaction.

**Rationale**: The repository's observation model already uses `(businessId, id)`, Field and Season composite relations, actor provenance, server timestamps, and a database append-only guard. These match the irrigation feature's history and tenancy requirements.

**Alternatives considered**: Trust the client to keep the association valid, store a Season without its Field/Business constraint, or allow ordinary edits/deletes. Those choices weaken tenant isolation or historical integrity.

### 3. Reuse Business-local time conventions

**Decision**: The mobile form loads the authoritative Business timezone and defaults its local date/time to now. It sends the local value, the corresponding absolute instant, and the timezone used to prepare it. The API re-resolves the local time with the current Business timezone, requires exactly one matching instant, rejects future, ambiguous, or nonexistent values, and stores the absolute instant as `timestamptz`. Return the resolved timezone for display.

**Rationale**: `apps/api/src/seasons/business-timezone.ts` and the observation create flow already implement the `Europe/Istanbul` fallback, DST uniqueness validation, future-time rejection, and absolute storage. Reusing this convention avoids a second timezone policy. Actor-supplied device timezone is not authoritative.

**Alternatives considered**: Store a local wall time without an absolute instant, use the device timezone, or silently shift a DST-invalid value. Each makes historical ordering or the recorded event time ambiguous.

### 4. Use a stable record identity for safe online retries

**Decision**: The online request has a stable `irrigationRecordId` scoped to the authorized Business; an exact HTTP retry may reuse it while the current create flow remains active. The API returns the existing accepted result for an exact replay by the same actor under current authorization; the same identity with a different actor, payload, Field, or Season returns a conflict. This is server/API idempotency only: do not persist the create attempt locally, queue it, automatically retry it, or reconcile it after connectivity returns or the app restarts.

**Rationale**: A lost response must not create duplicate historical operations. The existing observation API's exact-replay behavior is reusable at the server boundary. Its mobile durable command store, offline submission, background retry, and reconciliation behavior are not part of this feature.

**Alternatives considered**: Generate a new ID on every retry (duplicates after uncertain commits) or add a generic offline command store (out of scope and unnecessary for online capture).

### 5. Add irrigation to the Field Diary projection

**Decision**: Add an `IRRIGATION` diary event sourced from the canonical `IrrigationRecord`. Extend the existing diary query, merge, ordering, cursor, OpenAPI union, and mobile row rendering. New mobile diary reads send `includeIrrigation=true`; the query defaults to false for existing clients, and cursors bind the flag. Keep the event's identity and details on `IrrigationRecord`; do not create or alias a `FieldObservation`, pass it through observation command storage/reconciliation, or assign it observation description semantics.

**Rationale**: PRD §31 lists irrigation in the chronological Field/Season Diary. Existing diary support already merges observations, completions, and skipped tasks with a stable event cursor. An opt-in addition prevents older clients from receiving a discriminator they cannot render.

**Alternatives considered**: A separate irrigation-only history would fragment the PRD's chronological diary; returning the new kind unconditionally risks unexpected UI behavior in installed mobile versions; copying irrigation into another history table would duplicate canonical data.

### 6. Use simple, fixed SI units for optional quantities

**Decision**: Method is free text with no catalog. Optional duration is a positive whole number of minutes. Optional water volume is a positive decimal quantity in cubic metres with at most one decimal place. Treat note as optional trimmed text with the existing observation note limit. Do not add unit selection, conversions, irrigation classification, reporting, or analytics.

**Rationale**: The PRD leaves these details optional and does not prescribe units. Whole minutes are easy to enter, while cubic metres with 0.1 m³ steps keep field-scale amounts compact and use an international SI unit suitable for Türkiye-first usability without a country-specific data model. Decimal-safe persistence avoids binary floating-point drift.

The feature uses these fixed units without per-record unit selection or conversion. Both details remain optional.

### 7. Extend the shared OpenAPI client from canonical contracts

**Decision**: Add the create operation in this feature's OpenAPI contract. Amend the existing SPEC-006 diary contract with the optional query and additive `IRRIGATION` variant, then regenerate the existing diary client output and a new irrigation API output through `packages/api-client`.

**Rationale**: The generator builds independent OpenAPI surfaces and composes their path/operation types in `packages/api-client/src/index.ts`. Keeping one canonical diary contract avoids competing definitions for the same route.

**Alternatives considered**: Hand-maintain mobile/API types, publish a second divergent definition of `GET /fields/{fieldId}/diary`, or return an irrigation-only page. These break the generated-contract boundary or the PRD diary experience.

## No External Dependencies

The feature does not call weather, satellite, storage, AI, or other providers. No worker, queue, attachment service, or production agronomic content is required.

## Read Projection Boundary

The existing Field Diary is the smallest coherent historical read surface because PRD §31 calls for chronological Field/Season history. Its repository may compose a distinct `IRRIGATION` event from `IrrigationRecord`; this is read projection reuse, not domain ownership by Observations. Keep the canonical write model, UUID, and fields independent of `FieldObservation`.
