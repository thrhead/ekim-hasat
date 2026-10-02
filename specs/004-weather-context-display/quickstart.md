# Quickstart: Validate Weather Context and Display

This guide describes the automated validation to run once SPEC-004 is implemented. The planning phase does not create runtime code or claim these feature tests have passed.

## Prerequisites

- Node.js version in `.nvmrc` (repository requirement: Node >=22) and pnpm 10.17.1.
- Dependencies installed from the repository lockfile.
- PostgreSQL/PostGIS configured using the existing API integration-test setup for persistence, authorization, and tenant-isolation scenarios.
- Deterministic fake provider only. Invoke the refresh application use case directly from unit/integration tests; do not require live vendor credentials, a production adapter, scheduler, or operational cadence. Those remain gated on ADR-012 and release configuration.
- Test authentication identities and fields in at least two businesses, including an authorized field, an out-of-scope field, and a field whose membership can be revoked.

## Validation commands

Run from the repository root after implementation:

```bash
pnpm --filter @ekim-hasat/api-client check:generated
pnpm test:contract
pnpm --filter @ekim-hasat/api test
pnpm test:integration
pnpm test:mobile
pnpm check:diff
```

`test:integration` requires the existing PostgreSQL test database. The API/domain unit suite covers normalization and freshness; contract checks validate OpenAPI/generated-client agreement; PostgreSQL integration checks validate tenancy and persistence; mobile tests cover the farmer-facing states. Do not use a live provider response as a test oracle.

## Required scenarios and expected outcomes

1. **Current snapshot and local horizon**: Seed a deterministic normalized snapshot fetched within the configured maximum age with complete coverage for the authorized Business-local today and next two days. The authorized GET returns `CURRENT`, current condition/temperature, all three daily summaries, the Business timezone, coverage, and `fetchedAt`. Bugün renders all values, labels the field and update time, and leaves tasks and plan state unchanged.
2. **Exact age boundary**: With a fixed clock and maximum age of six hours, a snapshot at exactly six hours remains `CURRENT` only if coverage still contains the requested three local dates. A snapshot just beyond six hours is `STALE`, retaining values and update time.
3. **Coverage and timezone change**: A young snapshot that no longer contains all three requested Business-local dates, or whose saved timezone differs from the authorized current Business timezone, is `STALE`. The server derives dates from the authorized timezone and SPEC-002 fallback, regardless of device timezone.
4. **Refresh use-case outage and recovery**: Invoke `WeatherRefreshService` directly with a fake provider. Make it fail after a valid snapshot exists; the stored row remains unchanged and status stays `CURRENT` while age is within the configured maximum, location matches, timezone/date context is valid, and coverage remains valid. Then return a newer valid fixture; it replaces the prior snapshot. Invalid or older fixtures never replace it. This does not simulate or claim production scheduling.
5. **No task due / weather overview**: Give an authorized field no Today task and include it in the weather-owned overview anyway, with only field ID/name plus weather context. Include a field with no snapshot as `UNAVAILABLE`; traverse a page boundary using `nextCursor`. Out-of-scope fields never appear, and the operation does not expose general field data.
6. **No prior snapshot / unusable or changed point**: With no accepted snapshot or no usable server representative point, the field summary is `UNAVAILABLE` with no forecast values. A point-only field is eligible. When the point changes, its old snapshot is unavailable until refreshed for the new point. The refresh use case never accepts device or client coordinates.
7. **Authorization and tenant isolation**: An authorized member can read a field in scope. Cross-business, missing, out-of-scope, and revoked-membership requests use the stable privacy-safe denial. Overview and single-field reads recheck current server authorization; cached client state is not authority.
8. **No provider call on screen open**: Open Bugün and field weather context while instrumenting the fake provider. Read routes make zero provider calls, and a weather read failure does not block task loading/completion.
9. **Accessible mobile and offline states**: Requirements cover loading, current, stale, unavailable, denied, retryable failure, and retry action with readable text/accessibility semantics, accessible async status announcements, and no color-only distinction. Unavailable shows no forecast values. With network unavailable and no existing approved weather snapshot path (the current repository has none), show unavailable/access/retry, and leave cached Today task projection and completion-specific SQLite command state untouched. Do not create or imply durable weather persistence.
10. **Provider neutrality, diagnostics, and compatibility**: At least two distinct test-only provider adapters/fixtures carrying semantically equivalent input normalize to equivalent WeatherSnapshot output without production vendor selection, network access, or ADR-012 resolution. Weather read/API failure tests assert the existing correlation/request ID, stable machine-readable error code/category, and server-side authorization/privacy-safe diagnostics without access tokens, secrets, raw provider payloads, or unnecessary personal data. Generated weather types match both operations in `contracts/weather.openapi.yaml`; mobile uses generated types. Existing onboarding, season setup, Bugün task behavior, and task completion/history contract tests still pass. No physical-device or emulator result is required or claimed.

## Release gate

Keep live production provider refresh disabled until ADR-012 (or an explicitly approved equivalent) selects the provider and release configuration supplies its adapter, an operational trigger, and cadence based on provider coverage/update limits, usage terms, secret handling, and timeout behavior. The provider port and refresh use case, deterministic fake-provider behavior, persisted snapshot model, API contract, and farmer-facing display can be validated without live scheduling or a production provider.
