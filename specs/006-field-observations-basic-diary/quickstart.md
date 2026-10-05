# Quickstart: Field Observations and Basic Diary Validation

This is a planned implementation validation guide. It does not add implementation code or prescribe a generic offline workflow.

## Prerequisites

- Run the repository's existing local PostgreSQL/PostGIS development service and apply Prisma migrations to the test database using the repository's established workflow.
- Generate the API client from the OpenAPI source mapped for SPEC-006.
- Use authorized test users in at least two Businesses, with Fields and Seasons in each; seed accepted TaskCompletion records through existing SPEC-003 paths/fixtures.

## Scenarios

1. **Create and read**: As a currently authorized member, post a non-empty Unicode description, stable observation UUID, and current/past RFC 3339 `occurredAt`; read the Field diary and find the committed observation with the same occurrence instant.
2. **Retry after uncertain response**: Submit a create, discard the response, and retry the exact observationId/payload while online. Confirm only one accepted row exists and the original committed result is returned. Reuse that identity with altered content and confirm a conflict with no mutation.
3. **Validation and association**: Reject whitespace-only and over-2,000-character descriptions, future occurrence instants, and a Season belonging to another Field or Business. Accept a null Season and a valid same-Field Season.
4. **Field and Season projection**: Read a Field diary containing observations with null and non-null seasons plus accepted TaskCompletion rows. Confirm each canonical source appears once. Read a Season diary and confirm only that Season's observations and completions appear.
5. **Mixed pagination/order**: Create equal-time records across both kinds and enough rows to cross a page boundary. Traverse using the diary cursor and confirm descending occurrence order, stable kind/UUID tie-break, and no duplicate or skipped records. Confirm the existing SPEC-003 history contract/order still behaves as before.
6. **Authorization/privacy**: Revoke membership or request another Business's Field/Season/observation. Confirm current authorization is rechecked, no foreign content is returned, and safe missing/out-of-scope behavior does not reveal existence.
7. **Historical integrity**: After acceptance, update current Field and Season context. Confirm the stored observation text, occurrence instant, and original Field/Season association remain intact. There is no edit/delete route; corrections are a new observation.
8. **Mobile states/accessibility**: From Field detail, create with only description and default time; verify loading, validation, pending-save, accepted, retryable error, empty diary, pagination, and screen-reader state announcements at supported text scale. Simulate a lost create response online and confirm exact retry; with connectivity absent, do not represent a save as accepted.

## Expected outcomes

- Prisma migration adds only observation persistence and needed indexes/constraints.
- Generated API client contains observation create and unified diary read operations.
- `TaskCompletion` stays canonical and SPEC-003 completion-specific offline behavior remains unchanged.
- No generic event table, observation outbox, attachment flow, category taxonomy, or risk action is introduced.
