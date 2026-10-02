# Data Model: Weather Context and Display

Feature-level model aligned with SPEC-004 and `docs/ARCHITECTURE.md`. It describes normalized application data rather than Prisma syntax.

## WeatherSnapshot

The last accepted, normalized weather forecast for one field. It is server-owned, replaceable derived context; it is not an operational farming record.

| Attribute | Meaning / constraint |
|---|---|
| `id` | Server-generated stable identity for the persisted snapshot row. |
| `businessId` | Required tenant boundary copied from the authorized Field relation; never client-selected. |
| `fieldId` | Required field association; unique with `businessId`, FK-constrained. |
| `representativePoint` | Canonical longitude/latitude from the current server-owned Field representative point, SRID 4326. Never sourced from a request or device. |
| `locationFingerprint` | Stable hash of canonical point coordinates and applicable field-location version; used to avoid serving/persisting data for a previous location. |
| `businessTimezone` | Resolved Business timezone used for the covered local dates; `Europe/Istanbul` fallback follows SPEC-002. Not accepted from the client. |
| `coverageStart` / `coverageEnd` | Provider/application UTC range represented by the snapshot, with explicit inclusive/exclusive semantics fixed by the contract. |
| `forecastLocalDates` | Exactly three consecutive Business-local dates: today and next two days at acquisition. All three must have valid summaries. |
| `fetchedAt` | Server UTC time when the accepted provider response was acquired. Used for maximum-age status. |
| `refreshStartedAt` | Server UTC time when the request for this provider result began. Used as the deterministic ordering fallback when provider issue timestamps are unavailable. |
| `providerIssuedAt` | Optional provider forecast issue time normalized to UTC; quality/order evidence only, not freshness age authority. |
| `qualityStatus` | Application-owned accepted status; only fully validated snapshots are persisted. Rejection categories belong in correlated telemetry, not a failed snapshot row. |
| `observedAt` | UTC timestamp for the normalized current observation. |
| `conditionCode` / `conditionLabel` | Application-owned condition vocabulary and optional safe farmer-facing label for current conditions. |
| `temperatureC` | Current temperature as a finite Celsius value. |
| `createdAt` / `updatedAt` | Server UTC persistence metadata. |

## WeatherRefreshState

Persisted server-side refresh-attempt and progress state used to support bounded forward progress across eligible weather refresh targets. It is not part of a farmer-facing API entity, a mobile weather cache, or generic offline synchronization state.

| Attribute | Meaning / constraint |
|---|---|
| `businessId` | Required UUID identifying the Business boundary of the associated Field. |
| `fieldId` | Required UUID of the associated Field. Together with `businessId`, it is the composite primary key, so each field has at most one refresh-state row within its business. |
| `lastAttemptedAt` | Required `timestamptz(6)` timestamp supplied by the server when it records a refresh attempt. Updated for every attempted target before the provider request; failed or rejected refreshes remain recorded. |
| `lastAttemptOrder` | Required `bigint`, populated from the database sequence `weather_refresh_states_last_attempt_order_seq` on insert and every update. It provides a monotonic attempt-order value independent of timestamp ties. |

The composite foreign key `(fieldId, businessId)` references `Field(id, businessId)` and cascades when that Field is deleted. This enforces that the stored business matches the field's business; the model has no separate Business relation. The database index on `lastAttemptOrder` supports ordering by attempt sequence. Refresh target selection reads this value for eligible fields, treats a missing state as order zero, then sorts ascending by order with `fieldId` as a deterministic tie-breaker before applying the batch limit.

The state is upserted when a server refresh attempt begins, whether the subsequent provider call succeeds, fails, or produces rejected data. A later attempt replaces the timestamp and sequence value; it does not replace or alter the accepted `WeatherSnapshot`. This persistence is server-side only: it is not a client-owned cursor, mobile cache, farmer-facing record, offline sync mechanism, production scheduler, or worker platform.

## WeatherDailyForecast

Normalized daily record owned by one snapshot. Keeping the three days as typed rows avoids persisting provider-shaped data and permits database constraints over dates and values.

| Attribute | Meaning / constraint |
|---|---|
| `snapshotId` | Required FK to `WeatherSnapshot`; cascade with the snapshot row. |
| `localDate` | ISO date in the snapshot's businessTimezone; unique with `snapshotId`. |
| `conditionCode` / `conditionLabel` | Application-owned condition vocabulary and optional safe label. |
| `temperatureHighC` / `temperatureLowC` | Finite Celsius values; high must be greater than or equal to low. |
| `precipitationChancePercent` | Finite value from 0 through 100. |
| `windSpeedKph` | Finite non-negative speed in km/h. |

### Snapshot invariants

- There is at most one last-valid row for each `(businessId, fieldId)`.
- Every row is linked to a field in the same business. Database constraints backstop application scoping.
- Current conditions and all three daily dates must pass validation before persistence. Invalid, incomplete, out-of-range, or older results cannot overwrite the existing row.
- The accepted `representativePoint` and fingerprint must still match the field when persisting and serving. If the field point changes, the previous snapshot is not applicable to the field and the read is unavailable until a successful refresh.
- Provider outage/failure does not mutate the snapshot or its freshness status.
- No raw provider payload, credential, or client-supplied location/timezone is stored.

## WeatherFieldSummary (read projection)

The weather-owned authorized overview row. It is not a new persisted Field model or general field-list API.

| Attribute | Meaning / constraint |
|---|---|
| `fieldId` | Authorized field identifier. |
| `fieldName` | Current server-owned display name needed to identify the weather context. |
| projected weather fields | The same `status`, `businessTimezone`, `fetchedAt`, `coverage`, `current`, and `dailyForecasts` fields as the single-field API response. If no valid snapshot or usable point exists, status is `UNAVAILABLE` and weather values are null/empty. |

The overview resolves the caller's current Business Membership and field scope on every request. It contains no business ID, geometry, representative-point coordinates, season, crop, or task data. It includes authorized fields regardless of whether a Today task exists. Results sort by `(fieldName, fieldId)` and use a cursor page with default 50 and maximum 100 rows. An empty page is an explicit empty result, not permission to fall back to a generic field listing.

## Normalized Current Conditions

| Attribute | Meaning / constraint |
|---|---|
| `observedAt` | UTC timestamp supplied/normalized for the current condition observation. |
| `conditionCode` | Application-owned finite condition vocabulary; unknown provider conditions map to a safe `UNKNOWN` code and neutral label. |
| `conditionLabel` | Optional farmer-facing short label in the supported product language, not vendor text. |
| `temperatureC` | Finite value in Celsius. |

## Daily Forecast Summary

| Attribute | Meaning / constraint |
|---|---|
| `localDate` | ISO date in the authorized Business timezone; exactly the requested today, today + 1, or today + 2. |
| `conditionCode` / `conditionLabel` | Application-owned condition meaning and optional safe display label. |
| `temperatureHighC` / `temperatureLowC` | Finite Celsius values; high must be greater than or equal to low. |
| `precipitationChancePercent` | Finite integer/decimal normalized to 0–100 percent. |
| `windSpeedKph` | Finite non-negative speed normalized to km/h. |

## Read-time Weather View

The API response is an authorized projection, not a second persisted entity.

| Attribute | Meaning / constraint |
|---|---|
| `status` | `CURRENT`, `STALE`, or `UNAVAILABLE`; computed on every authorized read. |
| `fieldId` | The field whose weather is authorized and represented. |
| `businessTimezone` | Current authorized Business timezone used for requested dates and rendering. |
| `fetchedAt` | Last successful validated refresh time when a snapshot is present. |
| `coverage` | The period and local dates the snapshot describes. |
| `current` | Projection of the snapshot's normalized current-condition columns; present for `CURRENT` and `STALE`, absent for `UNAVAILABLE`. |
| `dailyForecasts` | Projection of its three typed child rows; retained with stale status when available, empty for unavailable. |

### State derivation

```text
UNAVAILABLE: no valid snapshot, unusable current representative point, or stored location fingerprint differs
STALE:       applicable last-valid snapshot exists, but age > configured maximum OR timezone/date context differs OR it lacks valid coverage for the requested three Business-local dates
CURRENT:     applicable last-valid snapshot exists, age <= configured maximum AND it covers all three requested Business-local dates with matching timezone/date context and representative point
```

Use `WEATHER_SNAPSHOT_MAX_AGE_HOURS` (configurable positive numeric duration; default and deterministic test value 6 hours). At exactly six hours the snapshot remains `CURRENT` if coverage, representative point, and timezone/date context are valid; older than six hours is `STALE`. A refresh failure alone does not change a valid snapshot from `CURRENT` to `STALE`. A changed Business timezone/date context or incomplete/expired requested coverage produces `STALE` until all requested dates are covered; a changed/missing representative point produces `UNAVAILABLE` with no weather values. `UNAVAILABLE` remains distinct from `STALE`; the client renders no values for unavailable and labels stale values with their update time.

## Relationships

```text
Business 1 ── * Field
Field 1 ── 0..1 current WeatherSnapshot
WeatherSnapshot 1 ── 3 WeatherDailyForecast rows
Authenticated user + current Membership/scope ── authorized WeatherView read
```

WeatherSnapshot is derived external context and does not modify Field, Season, SeasonPlan, PlannedTask, TaskCompletion, or any SPEC-001/002/003 history.
