# Data Model: Self-Service Farmer Onboarding + First Field

Feature-level model aligned with SPEC-001 and `docs/ARCHITECTURE.md`. It does not prescribe Prisma syntax or migrations.

## Application User

Represents the authenticated person in application-domain data.

| Attribute | Meaning / constraint |
|---|---|
| `id` | Stable application identity resolved from the verified auth-provider subject. |
| auth subject reference | Provider-neutral reference owned behind the auth adapter; never supplied as proof by an unauthenticated client. |
| `default_business_id` | Nullable, server-owned context pointer to the user's selected default Business. It selects context only and does not authorize access; active Membership is required. A missing pointer is set atomically when onboarding creates a new default Business and OWNER Membership. |
| `created_at` | Server UTC timestamp. |

The completion command resolves or creates this application record after authentication has succeeded.

All business-owned reads, including onboarding status, and writes are authorized and tenant-scoped server-side after auth-adapter verification. PostgreSQL RLS is optional defense-in-depth and is not required for MVP.

## Business

Represents the default farm workspace.

| Attribute | Meaning / constraint |
|---|---|
| `id` | Server-generated business identity. |
| `created_at` | Server UTC timestamp. |

Business ownership is represented only by Membership. There is no `owner_user_id` or parallel owner authority on Business.

## Membership

Authorizes an application user in a business and is the sole business ownership authority.

| Attribute | Meaning / constraint |
|---|---|
| `id` | Server-generated membership identity. |
| `business_id` | Business boundary for this membership. |
| `user_id` | Application User. |
| `role` | `OWNER` for this self-service first-use flow; no role choice is shown to the farmer. |
| `status` | Active before the first field is created. |

Membership resolution/creation occurs in the same database transaction as default Business and first Field resolution/creation.

## Field

Represents the first farmer-entered farm location within the authorized default business.

| Attribute | Meaning / constraint |
|---|---|
| `id` | Stable server-generated identity returned after transaction commit. |
| `business_id` | Required business boundary derived through the authenticated user's OWNER Membership. |
| `name` | Optional farmer input. Omitted input or input empty after trimming leading and trailing whitespace becomes exactly “Tarla 1”; otherwise the trimmed input is stored. General subsequent-field numbering/collision rules are SPEC-002 scope. |
| `representative_point` | Required canonical point in PostGIS SRID 4326. If input is polygon-only, derive a representative point inside that polygon with `ST_PointOnSurface`. |
| `boundary_versions` | Zero or more versioned Polygon boundaries. SPEC-001 accepts Point and Polygon only; MultiPolygon is outside this feature. A submitted Polygon is stored as unverified unless an actual verification process has occurred. Point-only fields have no fabricated boundary. |
| `created_at` | Server UTC timestamp. |
| `version` | Versioning for mutable field updates follows the application field-domain contract. |

Fields & Geography owns the Field and boundary versions. PostgreSQL/PostGIS is canonical.

## Onboarding completion

Durable domain record for the user's completed first-field onboarding.

| Attribute | Meaning / constraint |
|---|---|
| `user_id` | Authenticated ApplicationUser. |
| `default_business_id` | Business selected by the server-owned default context pointer and authorized through active Membership. |
| `field_id` | The created first Field whose summary is returned for subsequent completion commands. |
| scope uniqueness | One completion per `(user_id, default_business_id)`; concurrent commands converge on the same record and Field. |

## Idempotency record

Tracks one logical completion command so repeated requests cannot duplicate the business, membership, or field.

| Attribute | Meaning / constraint |
|---|---|
| `key` | Stable client-supplied request identity for retries of one logical command. |
| `user_id` | Authenticated application User; key scope is at least per user. |
| payload fingerprint | Detects reuse of the same key with a different logical command. |
| result reference | Identifies the originally committed Field/result returned on retry. |
| outcome | Idempotency record commits atomically with the ensured User, Business, Membership, and Field. |

Exact storage representation and retention duration remain operational configuration. While a key record is retained, same-key/same-payload retries return the original logical result and same-key/different-payload reuse returns HTTP 409. After expiry, the durable completion record takes precedence: return its existing first-field summary with HTTP 200 and perform no mutation. No duplicate guarantee depends on key retention.

## Onboarding status

Minimal authenticated read model used only to decide whether first-field onboarding is needed.

| Attribute | Meaning / constraint |
|---|---|
| `firstFieldOnboardingNeeded` | Boolean derived from the authenticated user's authorized default-business/first-field state. |

The read model exposes no general field list or unrelated field details. General field listing belongs to SPEC-002. After successful `POST /v1/onboarding/complete`, the returned `FirstFieldSummary` supplies post-save confirmation/current first-field state.

## Temporary onboarding form draft

Temporary mobile UI recovery state only; not a canonical Field, offline mutation, or outbox entry.

| Attribute | Meaning / constraint |
|---|---|
| entered name | Optional first-field name. |
| location input | Farmer-entered point or polygon geometry; persisted locally once any location geometry is entered. |
| authenticated account scope | Draft must not cross accounts. |
| storage and recovery | Durable app-local storage. On the same device/account, recovery is guaranteed across connectivity loss, app restart, and app process termination/crash. |
| recovery limits | No guarantee after app uninstall, explicit app-data/storage deletion, device loss, local-storage corruption, or unavailable platform storage; the farmer may re-enter information. |
| expiry | Purge after 7 consecutive days without draft activity. |
| lifecycle | Purge after successful save, explicit cancellation, sign-out, or account switch. |
| excluded data | Credentials and tokens are never persisted in the draft. |

Persist the draft once either field name or location geometry is entered. The draft never implies that a field has been saved. No authentication credentials or tokens are part of this draft.

## Relationships and atomic lifecycle

```text
Verified auth subject → Application User
Application User 1 ── * Membership * ── 1 Business
Business 1 ── * Field
Onboarding completion (user + default business) ── one durable completed first-field result
Idempotency record ── one logical request identity and its committed result while retained
Temporary mobile draft ── local form input until commit, then purged
```

The authenticated onboarding-status read returns only whether first-field onboarding is needed; it is not a field-list query contract. The completion result exposes `FirstFieldSummary.createdAt` alongside the Field identity, name, and representative point. A `default_business_id` pointer selects context but never grants access. If present, the server must verify active Membership; if invalid or unauthorized, fail without fallback. If absent, onboarding creates a new default Business, OWNER Membership, and pointer atomically and leaves other memberships untouched. The single completion command runs inside one PostgreSQL transaction: resolve/create Application User → resolve or create and authorize default context → check durable completion by user + default business → create Field and optional boundary only if incomplete → persist the completion record and retained idempotency result → commit. Concurrent requests converge on the same completion/Field. While a key is retained, same-key/different-payload returns HTTP 409; after expiry, return the existing completion summary with HTTP 200 and make no mutation. Failure before commit leaves none of the new domain records committed. Auth-provider verification is outside this database transaction.
