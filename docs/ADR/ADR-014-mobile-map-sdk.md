# ADR-014: Mobile Map SDK

- **Status**: Accepted
- **Date**: 2026-09-24
- **Decision owners**: Product/architecture approval recorded in SPEC-001 clarification

## Context

Mobile onboarding needs a map for point selection and polygon drawing. Maps are an external capability and must remain replaceable without leaking vendor-specific payloads into domain or API contracts.

## Decision

Use **`react-native-maps`** for the initial mobile map SDK behind a provider-neutral map adapter. Application/domain contracts use provider-independent location geometry. Map SDK types and callbacks are contained within the mobile adapter/UI boundary.

## Consequences

- The mobile adapter owns SDK integration and converts map interactions to provider-neutral point/polygon geometry.
- Core onboarding behavior and API contracts do not depend on `react-native-maps` types.
- Platform support, licensing, and configuration must be confirmed for the selected Expo/runtime versions during implementation setup.

## Alternatives considered

- Leave the mobile SDK unselected: defers a user-approved implementation dependency.
- Expose SDK-specific types to domain/API layers: increases coupling and impedes replacement.
