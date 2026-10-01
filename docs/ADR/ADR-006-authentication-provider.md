# ADR-006: Authentication Provider

- **Status**: Accepted
- **Date**: 2026-09-24
- **Decision owners**: Product/architecture approval recorded in SPEC-001 clarification

## Context

The product needs a provider-backed sign-in system while keeping identity verification, session handling, and application authorization behind an adapter. The API remains authoritative for application-user resolution, membership, and business access.

## Decision

Use **Supabase Auth** as the initial authentication provider behind the authentication adapter. Mobile and web clients may use the provider's supported sign-in flow, but provider-specific identity/session details must not become domain authority. The API verifies authenticated subjects through the adapter before application-domain reads and writes. Provider secrets do not enter client bundles.

## Consequences

- Provider changes remain isolated behind the auth adapter.
- The application maps verified provider subjects to stable application User records.
- Business permissions and tenant scope are resolved by the application API, not inferred from provider identity claims alone.
- Identity verification policy and exact sign-in methods remain separate product/operational decisions.

## Alternatives considered

- Provider-neutral with no selected initial provider: leaves implementation without the approved starting integration.
- Direct provider coupling throughout domain modules: makes replacement and domain testing harder.
