# ADR-009: Business Isolation Strategy

- **Status**: Accepted
- **Date**: 2026-09-24
- **Decision owners**: Product/architecture approval recorded in SPEC-001 clarification

## Context

Every business-owned record must be isolated by business. Users may belong to multiple businesses, and client-supplied business identifiers are not proof of authorization. The application uses PostgreSQL as canonical state; database row-level security introduces connection-pooling and session-context considerations.

## Decision

Require **server-side application tenant enforcement** for every business-owned read and write. The API must authenticate the user, resolve authorized membership and role/scope, then query or mutate only within that authorized business boundary. Client-supplied `businessId` must never grant access.

PostgreSQL row-level security (RLS) is **optional defense-in-depth and is not required for MVP**. If introduced later, it must complement rather than replace application authorization and must be safe with the selected pooling/transaction model. Tenant-isolation tests are required whether or not RLS is enabled.

## Consequences

- All repositories and application use cases must receive trusted authorized scope from the server-side authorization path.
- Onboarding status and completion are authenticated and scoped server-side.
- Authorization failures must not reveal whether another business or its records exist.
- MVP delivery does not depend on RLS policies or connection session-context plumbing.
- Future use of RLS requires a separate implementation review of pooled-connection safety and tests.

## Alternatives considered

- RLS as the only enforcement layer: insufficient as a replacement for application authorization and harder to validate under pooling.
- Client-selected business access: violates the server-authority and tenant-isolation requirements.
- Duplicate owner identity on Business: creates a second source of ownership truth alongside Membership.
