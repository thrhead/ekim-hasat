# Quickstart: First Season Setup Validation

This guide defines the implementation-time validation path for the SPEC-002 vertical slice. It is not evidence that tests or device checks have already run.

## Prerequisites

- Node.js version allowed by the root package (`>=22`) and pnpm `10.17.1`.
- Workspace dependencies installed.
- PostgreSQL with the repository test schema/migrations configured for API integration tests.
- Auth test fixtures and approved central crop/template runtime fixtures available only in test configuration. Do not seed fake production agronomic content.

## Validation Scenarios

1. **Validated template path**: Authenticate an owner with a point-only field; read season setup options; select a central crop with an applicable published template; create a draft with an actual local sowing/planting date; confirm the draft identifies the immutable template version and contains copied tasks; edit/remove/change task dates; activate; confirm the approved plan is available in Bugün.
2. **Empty published template**: Provide an applicable published template fixture with zero definitions; confirm setup options report it as unavailable and diagnostics record the content-quality issue. Confirm no empty `VALIDATED_TEMPLATE` draft is created; the UI explains unavailability and requires an explicit `MANUAL` choice before creating the manual draft, with source provenance retained and no placeholder task.
3. **Unsupported/custom crop path**: Select a central crop with no applicable template or submit a farmer-entered crop; confirm the season draft uses a manual source and does not claim central/expert validation; add, edit, remove, and date tasks; activate after at least one valid task exists.
4. **Zero-task activation for both sources**: Remove every copied task from a template-backed draft and separately save a zero-task manual draft; activation returns the clear minimum-task validation response, inserts no task, and leaves each draft editable. Add one valid task to each and retry activation successfully.
5. **Actual and planned date rules**: Confirm actual sowing/planting dates today and arbitrarily far in the past are accepted as local dates while future dates are rejected. Confirm planned task dates before actual planting are rejected, equality is allowed, and task date order is not a domain constraint.
6. **Logical season identity and create recovery**: Create a season then simulate a lost response/app restart before persisting its ID; confirm the mobile client retained the exact request/key, retries that same command, receives the original result/same ID, durably stores it, then clears the unresolved command. Concurrent different-key requests for the same authorized business/field/crop/date return the unchanged same season; same-key/different-payload conflicts. Confirm no general offline queue is involved.
7. **Draft recovery and version/history integrity**: Leave review or simulate activation failure/app restart; reload a known season through its scoped read and confirm task edits, source, and DRAFT state remain intact. Change/publish a newer template after draft generation; confirm the draft/active plan retains its pinned version and copied task edits.
8. **Strict activation and active read-only behavior**: Confirm exact same-key/same-command activation retry replays original success; same-key changed payload/version and stale DRAFT version return 409. Race different-key activation requests and confirm exactly one DRAFT→ACTIVE transition while the loser gets 409. A different-key request against ACTIVE and add/edit/remove against ACTIVE also return 409; the client re-reads after activation conflict and active UI has no draft-edit controls.
9. **Business-local Bugün boundary**: With a fixed business IANA timezone, confirm all fields in that business use the same local date for inclusion. At business-local midnight, task inclusion changes with the business date, independent of device timezone and server UTC.
10. **Authorization/tenant isolation**: Attempt setup-options, draft creation/read, task mutation, activation, and Bugün reads with another business's field/season/task identifiers; requests fail without revealing whether the records exist.
11. **Mobile journey**: Complete first-field creation, move into crop/date setup, review/edit a template or manual plan, choose manual explicitly when an empty published template makes validated planning unavailable, activate, and land on business-timezone Bugün. Confirm retries do not claim success before durable API-result recording and planned work remains read-only in this slice.

## Cloud Shell Commands

Run after implementation with required environment services configured:

```bash
pnpm test
pnpm test:integration
pnpm test:contract
pnpm test:mobile
pnpm typecheck
pnpm lint
pnpm check:diff
```

`pnpm test:integration` requires PostgreSQL. The mobile unit/component suite is included; Bugün date-boundary coverage uses a fixed business IANA timezone fixture and must not depend on the device or Cloud Shell/server timezone. Android builds, emulator use, Expo Android export, and device runtime work are not part of this plan.

## Expected Results

- Domain and API tests enforce template provenance and empty-template fallback, manual-plan distinction, local dates and bounds, one-task activation for both sources, logical season identity, exact create/activation idempotency and concurrency outcomes, draft-only mutations, atomicity, and tenant boundaries.
- Generated OpenAPI client types match `contracts/seasons.openapi.yaml`; clients do not maintain separate handwritten transport types.
- Mobile tests prove first-field-to-season and activation-to-Bugün state transitions, durable create retry recovery, explicit manual fallback, retry/error/empty states, business-local date behavior, and active-plan read-only controls.
- No test path completes a task or introduces recurrence, weather rescheduling, offline sync, or placeholder task generation.
