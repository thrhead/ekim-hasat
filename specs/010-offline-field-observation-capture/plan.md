# Implementation Plan: Offline Field Observation Capture

**Branch**: `work` (current worktree; no feature branch created) | **Date**: 2026-10-14 | **Spec**: [spec.md](spec.md)

**Input**: Frozen, clarified `specs/010-offline-field-observation-capture/spec.md`. Planning only; no product implementation or verification result is claimed.

## Summary

Extend the existing SPEC-006 text observation flow with an observation-specific, account-scoped durable local context and command store. A farmer may capture a new note for a previously saved Field/optional Season after an offline restart when the original account is identifiable, even if sign-in cannot refresh. Only an authenticated matching account may deliver it. Preserve the exact existing create request across retries. Current server authorization and canonical PostgreSQL acceptance remain decisive. A durable local accepted result bridges an accepted response to a later authorized diary refresh. Revocation after an uncertain send remains unconfirmed rather than definitely rejected. No general offline browsing, sync, or authorization lease is introduced.

## Technical Context

**Language/Version**: TypeScript ~5.9; Node >=22 for API. The repository pins pnpm 10.17.1; exact runtime proof is unavailable in this Cloud session.

**Primary Dependencies**: Existing Expo 54/React Native 0.81, `expo-sqlite` 16, Supabase-backed auth port, generated OpenAPI client, NestJS 11/Fastify, Prisma 7/PostgreSQL. No new provider, framework, or datastore.

**Storage**: PostgreSQL remains canonical for `FieldObservation`; existing database uniqueness/fingerprint semantics remain. A narrow mobile SQLite store holds saved observation context, a non-authoritative observation-account continuity marker, exact pending command, and durable result/status. The marker is established only by a concrete authenticated account and survives restart solely for local capture after a retryable/offline restoration failure; definitive no-session/sign-out invalidates it and another authenticated account switches the active namespace. It contains no token or authorization grant and does not hold a general Field/Season catalog.

**Boundary ownership**: The observation SQLite store owns durable marker/context/command rows, account partitioning, restart recovery, and atomic active-marker/context lifecycle updates where required. The existing auth adapter classifies provider restoration as authenticated, definitive no session, or retryable/offline unavailable; the auth port exposes that narrow outcome and coordinates marker transitions through a storage port. The observation flow consumes the outcome without a second general auth state machine. `onAuthStateChange` and the authenticated API-session boundary remain authoritative for real sign-in and delivery.

**Testing**: Focused domain/client validation, mobile storage/coordinator/screen tests (including process restart), existing API contract and guarded real-PostgreSQL authorization/idempotency integration tests, generated-client check if the wire contract changes, and device smoke evidence when a runtime is available. No tests run during planning.

**Target Platform**: Existing farmer-facing Expo mobile app and NestJS API; iOS/Android device behavior requires later runtime validation.

**Project Type**: Existing TypeScript modular monolith plus mobile client.

**Performance Goals**: Local capture confirmation follows one durable local write and does not wait for network. Reconnect processing is bounded to the observation-specific pending set and does not block diary use; no new numerical SLA is approved.

**Constraints**: Preserve SPEC-006's 1–2000 Unicode-code-point canonical text rule, unique Business-local time mapping, original `occurredAt`, server `acceptedAt`, same-Field optional Season, current tenant authorization, idempotent replay, immutable accepted history, and diary pagination/order. Never treat saved account/context as permission to read or mutate canonical data. No generic sync/lease, attachments, categories, or other excluded domains.

**Scale/Scope**: Multiple text observations may be pending for one saved Field or optional Season on one account/device; each is a separate stable command. Existing diary API and canonical record remain the only accepted-history source.

## Constitution Check

*GATE: Checked before Phase 0 and again after Phase 1.*

| Principle | Pre-design | Post-design | Design response |
|---|---|---|---|
| Farmer simplicity and mobile completeness | PASS | PASS | Existing observation entry and visible pending/accepted/needs-attention wording; no sync settings. |
| Offline work survives | PASS | PASS | Exact command and result are durable before local success/settlement; restart and uncertain retry retain original intent. |
| Server authority and Business isolation | PASS | PASS | Saved context is account-local only; delivery requires matching authenticated session and current server membership, Field, and Season checks. |
| Historical integrity | PASS | PASS | Canonical observation remains immutable; local pending state never masquerades as accepted diary history. |
| Human control and risk safety | PASS | PASS | No inferred diagnosis, automatic task action, or changed farming decision. |
| Modular monolith and approved storage | PASS | PASS | Existing API/mobile areas and Expo SQLite; no service or datastore boundary. |
| API contract and compatibility | PASS | PASS | Evolve the sole SPEC-006 observation-create OpenAPI source with only the optional captured-timezone precondition; preserve route/operationId, older bodies, and the generated public client. |
| Testing according to risk | PASS | PASS | Restart, retry, lost response, account switch, revocation, tenant isolation, timezone, and reconciliation scenarios are in quickstart. |
| No fake production reality | PASS | PASS | No fake Field access, diary acceptance, provider output, or production agronomic content. |
| Small vertical delivery | PASS | PASS | Observation-specific persistence and orchestration only; no general offline framework. |

**Gate result**: PASS. The approved SPEC-010 decision advances only the offline observation boundary deferred in SPEC-006. The architecture's eventual generic sync and authorization lease describe broader future systems, not prerequisites for this slice. Saved account identification is a privacy boundary for local capture, never an authorization grant.

## Project Structure

### Documentation (this feature)

```text
specs/010-offline-field-observation-capture/
├── spec.md
├── checklists/requirements.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
└── contracts/observation-offline-command.md
```

`tasks.md` belongs to the later `$speckit-tasks` phase and is not created here.

### Source Code (repository root; proposed surfaces, not created in this phase)

```text
apps/mobile/src/
├── auth/                         # original-account identification versus valid API session
└── features/observations/        # saved context, observation-specific command store,
                                  # coordinator, create form, pending/accepted presentation
apps/mobile/test/observations/    # restart, retry, account isolation, diary reconciliation
apps/api/src/observations/        # existing authorized create/replay and diary boundaries
apps/api/test/observations/       # real-DB replay, revocation, timezone edge cases
packages/api-client/             # generated create contract for optional captured-timezone precondition
```

**Structure Decision**: Keep the persistent command path within the observation feature and reuse the existing auth session and diary interfaces. Expose the distinction between authenticated restoration, definitive no session, and retryable/offline restoration failure through the smallest adapter/auth-port change needed by this flow; do not convert the app to a generally authenticated offline mode. The active marker permits local capture only in the last state, while delivery requires a real matching authenticated session. Do not merge the observation store into the completion queue or create generic sync infrastructure. Evolve `specs/006-field-observations-basic-diary/contracts/observations-diary.openapi.yaml` as the sole observation-create OpenAPI owner with optional `capturedBusinessTimezone`, then regenerate its existing client surface. The server compares saved and authoritative Business timezone before first acceptance; accepted exact replay remains authorized and independent of later timezone changes. A first-delivery mismatch becomes local needs attention only when no prior commit is possible; otherwise the outcome remains unconfirmed. Canonical storage and diary pagination remain server-owned.

## Phase 0 and Phase 1 Artifacts

- [research.md](research.md): decisions, evidence, alternatives, and platform gaps.
- [data-model.md](data-model.md): local context/command state and existing canonical observation relationship.
- [contracts/observation-offline-command.md](contracts/observation-offline-command.md): observation-specific local command and existing HTTP boundary.
- [quickstart.md](quickstart.md): later runnable acceptance guide; not a record of passes.

## Complexity Tracking

No Constitution violations or new architectural components require justification.
