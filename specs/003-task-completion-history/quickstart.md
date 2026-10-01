# Quickstart: Task Completion and History Validation

This is an implementation-time validation guide, not evidence that the feature has been implemented or that any commands have run. Use isolated development/test data only; do not seed production agronomic data.

## Prerequisites

- Node.js `>=22` and pnpm `10.17.1`; workspace dependencies installed.
- PostgreSQL with the API test database and all Prisma migrations applied. Concurrency, unique-constraint, transaction, and tenant-isolation scenarios require real PostgreSQL.
- Authenticated OWNER/MEMBER fixtures, multiple Businesses, ACTIVE and DRAFT seasons, APPROVED plans, and planned tasks. Fixtures are test-only.
- Generated OpenAPI client regenerated from the committed contract sources; no handwritten mobile/API payload types.
- Expo SQLite tests use an isolated test database/file and injectable storage. Android/iOS device or emulator is not a prerequisite for automated coverage.

## Validation scenarios

1. **One-tap online completion**: Load an ACTIVE/APPROVED task in Bugün, persist a completion command locally with a generated ID, `occurredAt`, and base task version, submit it, and confirm the server record has distinct `occurredAt`/`recordedAt`. Confirm the planned task row, planned local date, source provenance, and activation snapshot remain unchanged.
2. **Bugün integration**: Confirm initial `/today` returns only due tasks for the authorized Business-local date with additive task version and resolved Business timezone. After the completion commits, the same query excludes it. Confirm device timezone and server UTC do not redefine local date.
3. **Field and season history**: Read a field completion page and the same field filtered to one season. Confirm only accepted records are returned, stable cursor ordering is `occurredAt` descending then ID, planned date and actual occurrence differ where appropriate, and Business timezone is used to render `occurredAt`. The normal farmer-facing row need not show `recordedAt` or actor identity; those remain persisted audit metadata.
4. **Offline completion and process restart**: Cache a server-authorized actionable Today task, turn off connectivity, complete it, and restart the app. Confirm the SQLite command and exact ID, occurrence instant, task version, and task context survive; Bugün shows it as pending rather than an actionable duplicate or accepted server history.
5. **Successful retry and lost response**: Synchronize the pending command; simulate server commit followed by response loss; retry the exact same ID, task, timestamp, and version. Confirm one PostgreSQL completion row and one history item. Confirm the mobile row is settled as accepted only after the response is durably recorded locally.
6. **Changed payload or actor under same ID**: Replay an accepted completion ID with a different task, occurrence, or base version and confirm a stable conflict with no second write. Submit the same ID/payload as a different authenticated actor and confirm it is not treated as the original actor's replay; if that task is already completed, return the competing-completion conflict without exposing the completion as the caller's success.
7. **Concurrent same-task attempts**: Race distinct completion IDs against one planned task. Confirm exactly one transaction inserts the accepted completion; the loser receives `TASK_ALREADY_COMPLETED` and can load the canonical accepted history row. Race exact same-ID retries and confirm both converge on the same committed record.
8. **Version/state conflicts**: Submit a stale task version, a DRAFT-season task, an inactive/non-APPROVED task, and a task whose season changed before sync. Confirm stable conflict outcomes, no completion write for rejected intent, retained local `CONFLICTED` state, and no automatic rebase/overwrite. Explicit re-review creates a new command identity only if still authorized and actionable.
9. **Membership and tenant isolation**: Revoke membership after the offline command is created but before synchronization. Confirm server denial using the normal privacy-safe response, no completion write or history disclosure, and durable local conflict state. Attempt cross-business task completion and field/season history reads; confirm no existence leakage. Never send a client business ID as authority.
10. **Crash and partial-local-write recovery**: Simulate app termination before request submission, during network wait, after server commit but before local accepted-result write, and after accepted result write. Confirm the same pending ID is retried until accepted result is durable; no state is silently lost or falsely displayed as accepted.
11. **Accessibility and farmer states**: Cover loading, saving, pending, accepted, conflict, retry, empty history, and history error views with accessible labels/state announcements, scalable text, non-color-only status, and touch-usable controls.
12. **Backward compatibility**: Regenerate and type-check the client with additive Today metadata and a new completion contract. Confirm SPEC-001 onboarding paths and existing SPEC-002 required response fields/operations remain present; old clients can ignore the added Today fields.

## Automated commands

Run after implementation from the repository root with required services configured:

```bash
pnpm --filter @ekim-hasat/api-client generate
pnpm --filter @ekim-hasat/api-client check:generated
pnpm test
pnpm test:contract
pnpm test:mobile
pnpm typecheck
pnpm lint
pnpm check:diff
```

Run the SPEC-003 PostgreSQL scenarios separately against the migrated disposable `ekim_hasat_test` database. The repository-wide `pnpm test:integration` includes legacy integration files that do not all enforce the disposable-database name themselves, so do not use it for this focused closure check. This command selects the completion, Today, and History integration coverage and the existing database guard:

```bash
DATABASE_URL=postgresql://ekim_hasat:ekim_hasat_local@localhost:5432/ekim_hasat_test pnpm --filter @ekim-hasat/api exec node --import tsx --test --test-concurrency=1 \
  test/tasks/disposable-database.test.ts \
  test/tasks/task-completion.schema.integration.spec.ts \
  test/tasks/task-completion.integration.spec.ts \
  test/tasks/task-completion.idempotency.integration.spec.ts \
  test/tasks/task-completion.authorization.integration.spec.ts \
  test/tasks/task-history.integration.spec.ts \
  test/seasons/today-completion.integration.spec.ts \
  test/seasons/today.integration.spec.ts
```

Apply all Prisma migrations to `ekim_hasat_test` before running this command. Never point it at the shared `ekim_hasat` database. These real PostgreSQL scenarios cover transaction, uniqueness, concurrency, and tenant-isolation behavior; mocks are insufficient for those guarantees.

## Expected results

- Every accepted completion is a separate immutable operational record; planned intent and activation provenance are unchanged.
- Exact retries replay one result, competing IDs cannot complete one task twice, and stale/unauthorized commands remain explicit conflicts rather than silent overwrites.
- Bugün excludes accepted server completions; the device-local screen distinguishes pending/conflicted intent from accepted history.
- Field and season views show accepted completions only, ordered by actual occurrence and rendered using Business timezone.
- Mobile storage survives process restart and never settles a pending command before persisting the committed server result.
- Generated clients remain aligned with OpenAPI; SPEC-001 and existing SPEC-002 behavior remain backward compatible.
- No general calendar, diary, offline sync engine, or task-management feature is introduced.

## Deferred manual evidence

Physical Android/iOS device and emulator execution remains deferred because those runtimes are unavailable in the current environment. No device result is claimed. Automated domain, API/PostgreSQL, generated-contract, and mobile Jest/Jest Expo results must be captured separately from this guide; running the commands above does not itself provide physical-device or emulator evidence.
