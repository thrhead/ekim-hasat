# SPEC-012 Implementation-Conformance Review

**Review date:** 2026-10-16  
**Scope:** Implementation conformance for T027 against `spec.md`, `plan.md`, `data-model.md`, the canonical Expense contract, and the canonical SPEC-006 Diary contract. This is separate from `checklists/finance.md`, which remains a requirements-quality checklist.

## Review method

- Inspected current Git state and the implementation ledger; T001–T026 were already recorded complete. No implementation was repeated.
- Compared the approved requirements and technical plan with the persistence model/migration, domain validation, API create and Diary paths, generated client source, and mobile create/Diary behavior.
- Checked contract and generated-client evidence with `pnpm --filter @ekim-hasat/api test:contract` and `pnpm --filter @ekim-hasat/api-client check:generated`.
- Read the focused implementation spans for current membership and OWNER enforcement, exact retry behavior, Business-local date validation, optional Season association, V1/V2 Diary cursor behavior, and mobile 403 fallback.

## Findings

| Severity | Finding | Evidence | Disposition |
|---|---|---|---|
| Critical / Important | None confirmed in this review. | API contract suite passed (78 tests); generated-client consistency check passed. Source review found implementation paths for server-side OWNER authorization, exact decimal validation/storage, date-only persistence and ordering, same-Field Season validation, and retry conflict/replay handling. | No implementation change indicated. |
| Informational | Requirements-quality checklist is not an implementation status artifact. | `tasks.md` explicitly assigns this review separately and says to leave `checklists/finance.md` closed as requirements-quality evidence. | Checklist left unchanged. |

## Conformance assessment

- **Create contract:** `POST /v1/fields/{fieldId}/expenses` matches the canonical request and response shape, with server-derived Business scope and 201/200 acceptance/replay behavior.
- **Historical record and data model:** Expense is a distinct immutable canonical record with exact `NUMERIC`, `DATE`, actor and membership provenance, optional Season association, restrictive relations, range/scale checks, and history indexes.
- **Authorization and tenancy:** The create path resolves current membership, requires OWNER, rechecks the locked membership in the write transaction, scopes Field/Season lookup to the authorized Business, and rechecks authorization before retry replay.
- **Date, amount, and currency:** Domain/controller boundaries validate exact positive decimal strings, pinned ISO 4217 codes and valid date-only values. The repository rejects future dates using the resolved Business timezone. No time or timezone conversion is introduced for stored Expense dates.
- **Diary contract and compatibility:** Expense projection is opt-in (`includeExpenses=false` by default); the existing V1 projection/cursor remains separate from V2. V2 binds the requested scope/modes/timezone and orders date-only Expenses without assigning them a timestamp. Season filtering uses only explicit matching associations.
- **Mobile behavior:** Capture remains online-only; acceptance follows server confirmation; uncertain retries retain the same request in active form state. Expense rows render as date-only. A V2 403 abandons Expense mode and retries V1 from its first page without reusing the V2 cursor.
- **Generated API client:** Both canonical contracts remain generator inputs; generated consistency check passed.

## Validation evidence

- `pnpm --filter @ekim-hasat/api test:unit` with the disposable database URL: passed, 192 tests.
- `pnpm --filter @ekim-hasat/api test:integration` with the disposable database URL: passed, 200 tests. The command also ran the repository SQL schema invariant checks.
- `pnpm --filter @ekim-hasat/api test:contract`: passed, 78 tests.
- `pnpm --filter @ekim-hasat/api-client generate`: completed; generated consistency and `test:contract` passed, including API-client build and contract type checks.
- `pnpm --filter @ekim-hasat/domain test`: passed, 116 tests.
- Focused mobile Expense form and Field Diary tests: passed, 33 tests in 2 suites when run in isolation. The initial concurrent run exceeded Jest's timeout on two tests; isolated rerun passed.
- Disposable PostGIS database safety: `current_database()` was confirmed as `ekim_hasat_test` before migrations, before the test run, and after validation. Repository migrations applied successfully; Prisma schema validation passed. The database ran in a temporary container without a persistent volume.

## T027 disposition

No confirmed Critical or Important implementation-conformance gap was found, so no RED→GREEN implementation fix was required by this review. T027 and T028 are complete.
