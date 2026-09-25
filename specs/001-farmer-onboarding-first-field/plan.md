# Implementation Plan: Self-Service Farmer Onboarding + First Field

**Branch**: `001-farmer-onboarding-first-field` | **Date**: 2026-09-24 | **Spec**: [spec.md](spec.md)

**Input**: Refreshed from the latest approved clarifications in `spec.md`.

## Summary

Deliver mobile-first first-field onboarding over an authenticated, online API command. SPEC-001 owns a minimal onboarding-status read and `POST /v1/onboarding/complete`; general field listing and subsequent-field management remain SPEC-002. Completion returns the created/current first-field summary, including `createdAt`. A durable onboarding completion record scoped to authenticated user + default business references the created Field and prevents duplicate mutation after `Idempotency-Key` expiry.

Mobile authentication follows ADR-006's Supabase Auth provider behind a narrow adapter. T051 restores and exposes an existing persisted Supabase session and supplies the generated API client with the current Bearer token; it does not select a sign-in method or add sign-in UI. T050 then consumes that client, uses the existing onboarding-status decision and loading/retry view, mounts the first-field screen for new farmers, and bypasses onboarding for returning farmers. It adds no navigation framework.

The feature uses Supabase Auth behind the auth adapter, mandatory server-side tenant enforcement, and `react-native-maps` behind the map adapter. `ApplicationUser.defaultBusinessId` selects context only; active Membership authorizes its use. If absent, completion creates a new default Business, OWNER Membership, and pointer atomically without adopting other memberships. A durable user + default-business completion record references the Field. Retained-key payload conflicts return 409; after key expiry, the durable result returns 200 without mutation. Temporary mobile recovery state stores only the entered field name and location geometry, expires after seven consecutive inactive days, and is removed on the specified lifecycle events. Accessibility requires named/role-labelled controls, system text scaling, platform-appropriate minimum targets, sufficient contrast, automated assertions, and VoiceOver/TalkBack smoke evaluation. SC-001 and SC-002 are measured through usability/pilot evaluation and are not release gates.

## Technical Context

**Language/Version**: TypeScript per repository architecture; exact runtime versions remain repository-scaffolding decisions.

**Primary Dependencies**: Expo / React Native; NestJS with Fastify adapter; Prisma; PostgreSQL/PostGIS; versioned REST/OpenAPI and generated TypeScript API client; Supabase Auth behind the auth adapter; `react-native-maps` behind the map adapter.

**Storage**: PostgreSQL is canonical application state; PostGIS stores field points and optional versioned Polygon boundaries (SPEC-001 accepts Point and Polygon only; MultiPolygon is outside this feature). ApplicationUser has a nullable, server-owned `defaultBusinessId` context pointer; it selects context but never authorizes access. Membership is the sole authorization authority. PostgreSQL stores durable onboarding completion by user + default business, referencing the Field. Temporary local onboarding draft state is UI recovery data, not an offline domain mutation or outbox entry.

**Testing**: Domain unit tests; PostgreSQL/PostGIS integration tests for transaction, uniqueness, and geometry behavior; API contract tests; permission and tenant-isolation tests; mobile E2E/accessibility evaluation for the online onboarding flow and recovery behavior.

**Target Platform**: Expo mobile on iOS/Android and the NestJS API. Web is not required for onboarding.

**Project Type**: TypeScript monorepo with modular-monolith API and mobile client.

**Performance Goals**: No numeric API latency/SLO target is approved. SC-001/SC-002 are pilot usability measures, not release thresholds.

**Constraints**: Authentication precedes the database command. Server-side application tenant enforcement is mandatory for reads and writes; PostgreSQL RLS is optional defense-in-depth and not required for MVP. One database transaction ensures User, default Business context, OWNER Membership, `defaultBusinessId`, Field, durable completion record, and idempotency outcome. A present default pointer is used only with active Membership; a missing pointer causes creation of a new default Business and OWNER Membership, while an invalid/unauthorized pointer fails without fallback. Durable completion scoped to user + default business prevents duplicate first-field mutation beyond key retention: retained same-key/different-payload returns 409; post-expiry completed requests return the existing summary with 200 and no mutation. Retention duration is operational configuration. Initial onboarding is online-only. If field `name` is omitted or empty after trimming leading and trailing whitespace, the server assigns exactly “Tarla 1”; otherwise it stores the trimmed value. SPEC-001 accepts Point and Polygon geometry only; Polygon boundaries are versioned and unverified unless a real verification process occurs. Draft stores only name and location geometry, expires after 7 consecutive inactive days (activity resets expiry), and is purged after save, cancellation, sign-out, or account switch; it never stores credentials/tokens. Mobile accessibility requirements are defined in FR-026 and its automated/manual evaluation acceptance.

**Scale/Scope**: One farmer's first field and minimum scaffolding for that vertical slice. No general field listing, subsequent-field management, business administration, team, crop, season, weather, satellite, finance, AI, or unrelated modules.

## Constitution Check

- Farmer simplicity/defaults: PASS. Business and membership setup are invisible; a default first-field name is provided.
- Mobile completeness and accessibility: PASS. Core flow is mobile; controls require accessible names/roles, system text scaling, platform minimum touch targets, sufficient text/control contrast, automated assertions, and manual VoiceOver/TalkBack smoke evaluation.
- Offline correctness: PASS. First-time completion is online-only; temporary form recovery is scoped, expires, and is not queued as a domain mutation.
- Server security/business isolation: PASS. API derives and validates authorized membership/scope server-side. PostgreSQL RLS is not required for MVP.
- Historical integrity: PASS. Optional polygon is a versioned boundary; onboarding does not rewrite historical season context.
- Modular monolith/approved stack: PASS. No new service or datastore; adapters isolate auth and map provider details.
- Risk-based testing/observability: PASS as defined in the spec and quickstart.
- Other principles (CMS immutability, weather/task precedence, AI safety): N/A.

The PRD's broad decomposition assigns general field creation to SPEC-002; SPEC-001's first-field creation and minimal onboarding-status read are explicitly approved exceptions. General field listing remains SPEC-002. No architecture conflict remains.

## API and read surface

- `GET /v1/onboarding/status` — authenticated endpoint returning only the minimum onboarding status. Missing or invalid authentication returns HTTP 401. When `defaultBusinessId` exists but its active Membership/context is unusable, return HTTP 403 using the privacy-safe error response; do not disclose whether another business exists and do not fall back to another Membership/business. No field list or general field data is returned.
- `POST /v1/onboarding/complete` — authenticated, online-only command with `Idempotency-Key`; accepts optional name and Point or Polygon location only, with no client-selected business/membership. Returns the created/current `FirstFieldSummary`, used for post-save confirmation/current first-field state.

No general field-list endpoint is part of SPEC-001; general field listing remains SPEC-002.

## Transaction, authorization, and concurrency model

The auth adapter verifies the provider subject before opening a database transaction. Provider network calls never occur inside the transaction. The API resolves/creates the application User, then applies this context rule:

1. If `defaultBusinessId` exists, treat it only as a context pointer and verify that the authenticated user has an active Membership in that Business. If the pointer is invalid or no longer authorized, fail safely; do not select another membership/business.
2. If `defaultBusinessId` is absent, do not infer or adopt any existing business membership. In the completion transaction, create a new default Business, the authenticated user's OWNER Membership, and set `defaultBusinessId` atomically. Existing memberships remain untouched.
3. Membership is the sole authorization authority for every business-owned read or write. The pointer never grants permission, and no client-supplied business or membership identifier selects the write scope.

For an authorized default business, the transaction checks the durable onboarding completion record scoped to `(user_id, default_business_id)`. If one exists, return its referenced Field summary, including `createdAt`, without a new domain mutation. Otherwise create the first Field, its required representative point and optional versioned unverified boundary, then insert the completion record referencing that Field. Persist the retained idempotency result in the same transaction. The atomic boundary covers all newly created User/Business/Membership/default pointer/Field/boundary/completion/idempotency records; they commit together or roll back together. Authentication verification occurs before this boundary.

**Repository completion seam (T029):** `OnboardingRepository.persistFirstFieldOnboardingCompletion` is the single callable persistence operation for this command. It accepts the verified identity (provider and subject), the already normalized field name and validated Point or Polygon, and the idempotency key and payload fingerprint. It derives the application User and default Business context server-side, authorizes that context through active Membership, and returns a committed `FirstFieldSummary` plus whether the outcome was created, a retained-key replay, or an existing durable completion; retained-key fingerprint mismatch produces a conflict for the upper layer to map to HTTP 409. It applies the retained-key and durable-completion precedence above; the domain/application command (T030) owns input validation, normalization, and mapping repository outcomes to command responses. No client-supplied business or membership identifier is accepted. This operation uses one PostgreSQL transaction for context resolution and all required Field, optional boundary, durable completion, and retained idempotency writes; failure rolls back all new state. T024 calls this operation directly against PostgreSQL/PostGIS. Its rollback test uses deterministic test-only database-side failure injection after persistence begins or at commit, with no production failure hook or separate public write methods.

### Uniqueness and concurrency invariants

- At most one default Business can be created by concurrent first-time completions for one authenticated ApplicationUser; when no pointer exists, competing commands converge on a single selected default context, OWNER Membership, and pointer.
- A non-null `defaultBusinessId` is usable only when an active Membership for `(user_id, business_id)` exists. Invalid or unauthorized pointers fail without fallback.
- At most one durable onboarding completion exists for `(user_id, default_business_id)` and it references exactly one first Field. A database uniqueness invariant plus transaction serialization/locking makes concurrent submissions converge on that completion and Field.
- A retained idempotency identity is unique within the authenticated user's scope and stores a payload fingerprint/result. Same key and same payload replays its result; same retained key with a different payload returns HTTP 409.
- Idempotency retention duration is operational configuration. Once the key expires, durable completion takes precedence: return the existing summary with HTTP 200 and perform no mutation, including when the request uses a new key.
- No uniqueness rule or resolution path may silently adopt another existing Membership as the default. Existing memberships in other businesses remain unchanged.

The exact PostgreSQL/Prisma constraint and lock implementation remains open, but it must enforce these invariants against real PostgreSQL concurrency, not only application-level prechecks.

PostGIS derives an interior representative point with `ST_PointOnSurface` when input is polygon-only. Submitted polygons remain unverified unless a real verification process occurs.

## Approved Architecture Decisions

- [ADR-006 Authentication Provider](../../docs/ADR/ADR-006-authentication-provider.md): Supabase Auth behind the auth adapter.
- [ADR-009 Business Isolation Strategy](../../docs/ADR/ADR-009-business-isolation-strategy.md): mandatory server-side application tenant enforcement; PostgreSQL RLS is optional defense-in-depth and not required for MVP.
- [ADR-014 Mobile Map SDK](../../docs/ADR/ADR-014-mobile-map-sdk.md): `react-native-maps` behind the map adapter.

## Remaining Technical Decisions

- Exact package/runtime versions and repository scaffold details.
- Idempotency-key record retention duration (operational configuration; expiry behavior is fixed by the approved domain semantics).
- API latency/SLO and rate-limit values.
- Exact database locking/unique-constraint implementation for default-business pointer initialization, active Membership validation, idempotency-key uniqueness, and completion uniqueness; it must preserve the stated invariants under real PostgreSQL concurrency.
- Exact platform-specific touch-target dimensions; must meet applicable iOS/Android minimum guidance and the named automated/manual accessibility checks.

These decisions do not change the approved API surface or farmer-facing scope.

## Project Structure

The repository currently has no application source tree. SPEC-001 tasks may add only minimum vertical-slice scaffolding, for example:

```text
apps/
├── api/                         # NestJS/Fastify host and onboarding route
└── mobile/                      # Expo onboarding and temporary draft state
packages/
├── api-client/                  # Generated client from OpenAPI
├── contracts/                   # OpenAPI source
└── domain/                      # Required identity/membership and field slices
```

This is a bounded initial slice, not a mandate to scaffold unrelated products or services. Mobile calls the API for authoritative reads and mutations.

## Complexity Tracking

No constitution violations or new architecture boundaries are proposed.
