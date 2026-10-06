# Product

<!-- impeccable:product-schema 1 -->

## Platform

adaptive

## Users

Farmers and farm owners in Türkiye who plan or coordinate work for one or more fields. A single farmer must be able to use the product without an administrator, advisor, employee, or desktop computer.

## Product Purpose

Ekim Hasat helps farmers plan crop seasons, see today's field work, respond to changing conditions, record completed work and observations, and keep useful season history. Success means a farmer can open the app, understand what to do today, complete the work, and record what happened.

## Positioning

A farmer-first agricultural planning and field-work product that keeps essential workflows usable on mobile for a single farmer while supporting more complex planning and intelligence behind the scenes.

## Operating Context

The primary surface is a native Expo / React Native mobile app for iOS and Android. Farmers use it as a practical field tool, including where connectivity may be weak or unavailable. A Next.js web application is a future optional productivity surface; web use is not required for core farming workflows.

## Capabilities and Constraints

- Core workflows include field and crop season planning, daily task review and completion, weather context, field observations, and preserving operational history.
- Weather-driven plan changes are proposed for farmer approval by default; important plans are not silently changed.
- Offline field workflows are a product requirement. External data must communicate freshness and quality, and risk signals are not diagnoses.
- iOS and Android interfaces should respect each platform's native interaction and accessibility conventions while serving the same product.
- Business rules belong in domain/server modules, not UI components. AI is optional and cannot be required for core workflows.

## Evidence on Hand

- `docs/PRD.md` is the approved product baseline.
- `docs/ARCHITECTURE.md` documents the recommended technical baseline and agent workflow.
- `docs/ADR/` contains approved architecture decisions.
- `specs/` contains feature specifications; feature-specific requirements remain subordinate to the PRD, architecture, and applicable ADRs.

## Product Principles

- Keep the farmer experience simple and self-service.
- Make mobile sufficient for essential farming workflows.
- Preserve farmer control over plan-changing recommendations.
- Communicate uncertainty and external-data freshness honestly.
- Preserve completed farming records and support offline work.
