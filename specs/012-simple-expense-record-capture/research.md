# SPEC-012 Research Decisions

Research was derived from the clarified specification and targeted repository evidence. Existing SPEC-012 downstream documents were treated as provisional and were not used to justify decisions.

## 1. Expense ownership belongs to Finance

**Decision:** Add Expense validation, write persistence, and the Expense diary-source reader under a Finance API/domain boundary. Keep the canonical Expense row and public Finance create endpoint distinct from Diary and irrigation records. Let the existing Diary projection compose Expense candidates through a Finance-specific read port.

**Evidence:** `docs/ARCHITECTURE.md` §8.13 assigns expenses and cost categories to Finance; §8.9 assigns chronological projection to Observations/Diary. `apps/api/src/observations/observation-diary.repository.ts` already composes canonical sources while returning distinct event kinds; `apps/api/src/operations/irrigation-records.repository.ts` shows that projection reuse does not make an event an Observation. `apps/api/src/main.ts` composes domain repositories in the existing modular monolith.

**Rationale:** This keeps Finance responsible for financial truth while reusing only the existing Diary projection, pagination, and mobile entry point. It avoids putting Expense under FieldObservation/Operations and avoids a new generic event abstraction.

**Alternatives considered:** Store Expense as an observation or irrigation row (violates domain identity); add a generic operational-event table (no repository evidence); add a microservice (violates the modular-monolith baseline).

## 2. Use the canonical Expense ID as durable online retry identity

**Decision:** Accept a client-generated `expenseId` and use composite `(businessId, id)` as the Expense primary identity. Exact same-actor/same-context/same-payload retry returns the existing row; changed actor, payload, Field, or Season for that ID returns `409 IDEMPOTENCY_KEY_REUSED`. Same UUID in another Business is independent.

**Evidence:** `FieldObservation` and `IrrigationRecord` use composite Business-scoped IDs in `apps/api/prisma/schema.prisma`; `ObservationCreateRepository` and `IrrigationRecordsRepository` create under a transaction, compare existing canonical values, and resolve unique-key races by re-reading within authorized scope. `BusinessCommandIdempotencyRecord` has an expiration timestamp and stores a generic result; it is not suitable as the only duplicate guard for an immutable historical fact.

**Rationale:** The Expense row remains the permanent receipt, so expiry cannot make a later retry duplicate history. Revalidating membership/role before replay prevents a formerly authorized identity from bypassing current access. A unique key provides the concurrency arbiter.

**Alternatives considered:** A standalone idempotency row with TTL (can expire while the Expense remains); global UUID uniqueness (unnecessary cross-Business collision and privacy coupling); retry with a new ID after uncertainty (can duplicate a committed expense).

## 3. Carry money as exact decimal strings and persist exact NUMERIC

**Decision:** REST uses a decimal string with at most 18 integer digits and 6 fractional digits. Domain keeps a validated decimal string; Prisma maps to PostgreSQL exact `NUMERIC` (unconstrained), with database checks for positive value, `< 10^18`, and scale `<= 6`. Reject excess scale/range before persistence; never round. Currency is an uppercase three-letter string checked against a repository-pinned, versioned ISO 4217 code set, updated through normal application releases.

**Evidence:** `docs/ARCHITECTURE.md` §9.5 says currency is decimal amount plus ISO code and explicitly rejects binary floating point. `apps/api/prisma/schema.prisma` uses Prisma `Decimal` backed by PostgreSQL `DECIMAL` for irrigation volume. Existing OpenAPI contracts carry decimal measurements as strings. No shared ISO currency validator or finance money model was found in current domain/API source.

**Rationale:** Eighteen integer digits and six fractional digits create a broad technical ceiling for ordinary farm expenses and common currency subunits while preserving exact representation. Using unconstrained NUMERIC plus checks avoids PostgreSQL `NUMERIC(p,s)` silently coercing excess fractional digits before a check. The API pattern/validator and DB checks enforce the same accepted range; this is an engineering limit, not product policy. A versioned repository code set makes validity deterministic across server deployments and avoids trusting client or locale-library currency acceptance. It is not a product concept of active currencies and requires no runtime service or management subsystem.

**Alternatives considered:** JSON number / JavaScript `Number` (binary floating-point loss); `NUMERIC(24,6)` alone (can round on coercion); arbitrary per-currency rounding (not approved); add a full money/ledger dependency (not needed for storage-only scope); runtime `Intl` acceptance or an external currency service (not a repository-pinned validation set).

## 4. Keep Expense occurrence as a calendar date

**Decision:** API/domain use validated `YYYY-MM-DD` (`LocalDate`); PostgreSQL stores `DATE`. Expense repository binds the string as SQL `DATE` and reads it as `to_char(..., 'YYYY-MM-DD')`; it does not create a JavaScript `Date`, UTC midnight, or timestamp.

**Evidence:** SPEC-012 §FR-006 is date-only. `packages/domain/src/seasons/local-date.ts` documents and implements validation without `Date` parsing or UTC conversion. PostgreSQL `DATE` is already used by Prisma models such as `Season.actualPlantingDate` and task local dates.

**Rationale:** The chosen shape preserves the user's occurrence day exactly. Prisma's `DateTime @db.Date` adapter surface is a JavaScript `Date`, which invites converting a date to an instant; use parameterized raw SQL at this narrow persistence boundary rather than manufacturing a time.

**Alternatives considered:** `TIMESTAMPTZ` at UTC midnight (invents an instant); local date/time converted to UTC (changes date semantics); relying on Prisma `DateTime` conversion without an explicit boundary (timezone-shift risk).

## 5. Extend Diary with an opt-in date-only Expense variant

**Decision:** Add `includeExpenses=false` to the existing Diary query and add an `EXPENSE` union variant with `expenseDate`, never `occurredAt`. Keep the SPEC-006 OpenAPI contract as the canonical owner of the existing Diary operation. Introduce a v2 cursor only for the opted-in projection, retaining v1/default behavior for existing clients. Bind each cursor to its projection mode and reject reuse across `includeExpenses=true` and `false`.

**Evidence:** `specs/006-field-observations-basic-diary/contracts/observations-diary.openapi.yaml` owns `GET /fields/{fieldId}/diary`; `packages/api-client/openapi-generator.config.ts` generates its shared types. `apps/api/src/observations/diary-query.ts` currently orders timestamp events by instant DESC, kind ASC, source UUID DESC and encodes v1 cursors with event time. Diary query and contract tests establish bounded keyset pagination and `includeIrrigation=false` as an additive opt-in. `apps/mobile/src/features/observations/field-diary-screen.tsx` currently formats each row from a timestamp and sorts by it.

**Rationale:** A distinct `expenseDate` contract makes the precision difference explicit. Day groups preserve chronological ordering between dates. Inside a day, known-time records remain ordered by actual instant; date-only expenses occupy a visibly separate subsection and are ordered by stable ID, so their row position does not claim a time. Filter-bound keyset cursors prevent duplicates for an unchanged dataset. The opt-in keeps old clients' response and cursor behavior intact.

**Alternatives considered:** Manufacture midnight for Expense (false precision); sort by `recordedAt` (confuses entry time with occurrence date); put expenses in a separate unpaginated client merge (unstable cross-source pagination); change default Diary output for all clients (unnecessary compatibility break).

## 6. Resolve authorization before access or replay

**Decision:** Use the verified subject and current default Business Membership; require active OWNER role. Lock/revalidate user and Membership inside the create transaction. Resolve Field under that Business and Season under the same Business+Field. Return the existing privacy-safe generic forbidden/not-found outcomes for inaccessible or foreign resources. Expense Diary candidates are available only under current OWNER scope.

**Evidence:** ADR-009 requires server-side membership and Business enforcement and privacy-safe failures. `MembershipScopeService` resolves Business and role from server-owned identity; `IrrigationRecordsRepository.create` locks current membership/user and scopes Field/Season queries before mutation. Architecture §43 requires active owner permission for expense recording.

**Rationale:** It preserves the existing trust boundary and ensures idempotent replay cannot bypass revoked or changed access.

**Alternatives considered:** Trust client Business/role IDs (prohibited); global lookup by expense ID before authorization (can leak foreign existence); allow Worker/Advisor because they can read a Field (violates finance boundary).

## 7. Keep categories fixed in domain/API, localized in mobile

**Decision:** Persist the seven approved stable codes (`SEED_SEEDLING`, `FERTILIZER`, `PESTICIDE`, `FUEL`, `LABOR`, `IRRIGATION`, `OTHER`) and map them to Turkish labels in mobile. Enforce the finite set in the domain, OpenAPI enum, and database check. Do not create category rows/CMS editing.

**Evidence:** Approved SPEC-012 clarification fixes the V1 set. Architecture §8.13 assigns categories to Finance; PRD §28 supplies the seven category concepts.

**Rationale:** Stable IDs keep historical facts compatible if labels change and avoid exposing translated labels as stored domain identity.

**Alternatives considered:** Store Turkish labels (localization becomes data identity); add custom category/CMS table (out of scope); use arbitrary text (not the approved fixed V1 set).

## 8. Keep API contracts owned and generated once

**Decision:** SPEC-012 owns `expenses.openapi.yaml` for the Finance create operation. SPEC-006 remains the canonical Diary OpenAPI owner and receives the additive query/union/cursor contract amendment during implementation. The existing `openapi-generator.config.ts` generates both into separate `packages/api-client` files.

**Evidence:** Existing API contract tests read feature-owned YAML directly; `packages/api-client/openapi-generator.config.ts` lists each canonical contract source and generated target. The generated TypeScript files are not hand-maintained.

**Rationale:** This adds no duplicate Diary operation or hand-maintained mobile contract. The additive default-off query preserves older response behavior.

**Alternatives considered:** Define a second Diary endpoint in SPEC-012 (duplicate ownership); manually patch generated types (drift); make the SPEC-012 diary note a second OpenAPI source (not generator-backed).

## 9. Use the Field Diary as the smallest mobile read surface

**Decision:** OWNER starts a create form from Field Diary context, submits online, receives accepted/replayed result, then returns to the same Field/Season filter and refreshes the Diary. Non-OWNER Diary usage and existing loading/empty/error behavior remain available without Expense data.

**Evidence:** PRD §§2, 3.2, 31 require mobile-complete workflows and chronological Field/Season history. Existing `field-diary-screen.tsx` and `diary-client.ts` provide context, pagination, and error-state patterns. Irrigation has a separate focused create screen without becoming a Diary record's domain owner.

**Rationale:** This is the smallest contextual flow and avoids a finance dashboard, totals, or a new navigation hierarchy.

**Alternatives considered:** Separate finance dashboard or standalone global Expense form (adds navigation/business/Field selection complexity); offline form/outbox (outside approved scope).
