# T030 validation checkpoint (in progress)

- Domain tests: 18 passed, 0 failed.
- API contract: 85 passed, 0 failed outside sandbox; initial sandbox run failed on restricted local sockets.
- Focused manual task API contract/service: 5 passed, 0 failed.
- API client generated consistency and contract typecheck: passed after permitting worktree build output.
- Mobile: 72 suites, 463 tests passed.
- Android export: initially failed on Metro resolving a .js import to TypeScript; after resolver fix passed, 731 modules.
- No database connection or writes. Disposable PostGIS image available; initialization has not been proven to guard every writing connection against databases other than ekim_hasat_test. Database integration, migration compatibility, and broad integration runner unverified.
- Native device/emulator accessibility and restart checks remain unverified.

- Resume: no existing Docker container. Inspected the available PostGIS 16 image entrypoint without starting PostgreSQL: docker_setup_db connects to postgres and issues CREATE DATABASE without a same-connection ekim_hasat_test guard. The repository compose specifies PostGIS 17; its exact entrypoint was not inspected. No database started or written. Clean Prisma migration path and guarded focused DB tests remain unverified; T030 remains pending.

- T030 DB resume: fresh disposable postgis/postgis:17-3.5, loopback 127.0.0.1:55439, tmpfs and no persistent volume; PostgreSQL 17 / PostGIS 3.5.2. The unchanged test URL returned ekim_hasat_test immediately before migration and immediately before focused tests, under the user-approved preflight safety model.
- Normal prisma migrate deploy from clean database: 22/22 migrations applied, including SPEC-014, with Prisma-managed migration history.
- Focused schema, authorization/isolation, idempotency, approved-plan, projections and action integration: 9 passed, 0 failed. pg emitted a concurrent-query deprecation warning.
- T030 complete. Broad integration runner remains unverified by instruction; native device/emulator accessibility and restart remain unverified.
