# SPEC-013 Research Decisions

Research used the clarified [feature specification](./spec.md) as product authority and checked repository architecture, SPEC-006/011/012 design artifacts, the current Season model, generated OpenAPI setup, and existing API/domain boundaries. No external provider or product clarification is needed.

## 1. Harvest owns the canonical record

**Decision:** Add Harvest validation and types under `packages/domain/src/harvest/` and the create/repository module under `apps/api/src/harvest/`. The existing Observations/Diary repository uses a bounded, tenant-scoped query of canonical Harvest records to compose diary pages.

**Evidence:** `docs/ARCHITECTURE.md` §8.14 assigns harvest records to Harvest & Sales; §8.9 assigns chronological projection to Observations & Diary. The neighboring SPEC-012 design similarly keeps Expense writes in Finance while composing the existing Diary. `apps/api/src/main.ts` composes domain modules in the existing modular monolith.

**Rationale:** This keeps Harvest record identity and rules in its existing domain boundary, while reusing only the shared history projection. The feature implements no Sales, disposition, inventory, or quality behavior.

**Alternatives considered:** Treat Harvest as an Observation, IrrigationRecord, or Expense (wrong identity and domain semantics); create a generic historical-record/event framework (not supported by architecture and explicitly out of scope); create a service boundary (unnecessary and contrary to the modular-monolith architecture).

## 2. Use the canonical Harvest ID as durable online retry identity

**Decision:** The create request supplies a stable client-generated `harvestId`, used as the canonical Harvest ID. Persist a composite `(businessId, id)` identity. Under current authorization, an exact same-actor/same-payload/same-Field/same-Season replay returns the original record; changed actor, canonical payload, Field, or Season context for that identity returns `409 IDEMPOTENCY_KEY_REUSED`. A collision in another Business is independent. The transaction locks the Business row before the identity lookup, serializing same-Business requests; the composite unique key also protects identity.

**Evidence:** Canonical FieldObservation, IrrigationRecord, and Expense records use durable business-scoped identities and compare stored actor, payload, and associations on retry. SPEC-012 documents why a TTL-based `BusinessCommandIdempotencyRecord` is insufficient for an immutable fact whose lifetime exceeds the command key. Current irrigation and expense repositories handle unique-key races by resolving the stored row within authorized scope.

**Rationale:** The permanent record itself proves whether an uncertain create committed. Revalidating current membership and role before lookup/replay preserves revocation behavior. A business-scoped unique key lets concurrent exact submissions converge without a general idempotency service.

**Alternatives considered:** Generate a new ID per retry (can duplicate history); rely only on an expiring generic command-idempotency row (the key can expire while the Harvest remains); use global UUID identity (unnecessary cross-Business coupling); add a general idempotency platform (out of scope).

**Replay ordering detail:** Re-resolve the active authorized Membership/role and authorized Field before any ID lookup. Resolve a supplied Season under that same Business and Field so foreign or missing targets remain private. For an already accepted matching identity, compare context and payload and replay the original even if the Season later leaves ACTIVE status; ACTIVE is required for first acceptance, not retroactively for an already accepted record. For a new identity, require ACTIVE and validate date/quantity before insert.

## 3. Preserve exact quantity values with a bounded decimal string

**Decision:** REST and domain represent `quantity` as an exact decimal string; its selected unit is `KG` or `METRIC_TONNE`. Accept values greater than zero with at most 11 integer digits and 3 fractional digits. Persist with exact PostgreSQL `NUMERIC`/Prisma Decimal semantics and database checks for `quantity > 0`, `quantity < 100000000000`, and `scale(quantity) <= 3`. Reject invalid syntax, excess precision, nonpositive values, and out-of-range values before persistence; never pass through binary `Number`, round, or convert units.

**Evidence:** `docs/ARCHITECTURE.md` requires decimal-safe money values; `apps/api/prisma/schema.prisma` uses `Decimal @db.Decimal` for irrigation volume. SPEC-011's irrigation input allows up to 11 integer digits, while SPEC-012 uses an unconstrained PostgreSQL `NUMERIC` plus explicit checks to prevent a `NUMERIC(p,s)` column from silently coercing excess scale before validation.

**Rationale:** Eleven integer digits reuse an existing measurement range as a conservative technical safety ceiling; three decimal digits match the approved quantity precision. Unconstrained exact NUMERIC plus checks prevents database coercion from becoming silent rounding. This is a technical validity bound, not an agronomic/business maximum.

**Alternatives considered:** JSON numeric values or JS `Number` (binary precision loss); unconstrained scale or unbounded magnitude (no defensive boundary); `NUMERIC(p,3)` as the only scale enforcement (may coerce before checks); unit conversion (explicitly excluded); 18 integer digits from expense money (needlessly broad for physical harvest measurements).

## 4. Keep harvest and acceptance dates separate

**Decision:** `harvestDate` is a validated `YYYY-MM-DD` LocalDate and PostgreSQL `DATE`, never a timestamp or UTC-midnight instant. Determine the current date using the authorized Business timezone through existing timezone helpers (including the established `Europe/Istanbul` fallback); reject dates after that local date and dates before the Season's `actualPlantingDate`, while accepting equality. Store a distinct UTC server `recordedAt` and actor user/membership provenance. Use parameterized DATE binding/read-as-text at the persistence boundary so the value is never converted through JavaScript `Date`.

**Evidence:** SPEC-012's DATE-only Expense design reuses `packages/domain/src/seasons/local-date.ts` and avoids inventing a timestamp; Season `actualPlantingDate` is a required PostgreSQL DATE and activation snapshots retain it. Existing timezone helpers provide the authorized Business-local day and fallback.

**Rationale:** A Harvest is a calendar-day fact, so neither the device timezone nor a fabricated time can move it. Business-local `today` supplies the required validation boundary without converting the occurrence date to an instant.

**Alternatives considered:** UTC midnight or `TIMESTAMPTZ` (fabricates an occurrence instant); device-local future check (wrong Business boundary); JS Date conversion for PostgreSQL DATE (timezone-shift risk); use of `recordedAt` as the harvest date (confuses occurrence and acceptance).

## 5. Enforce same-context ACTIVE Season and preserve accepted facts

**Decision:** Every new Harvest requires a Season belonging to the authorized Business and path Field, and that Season must be ACTIVE at acceptance. Add composite tenant-safe foreign keys for `(businessId, fieldId)`, `(seasonId, businessId, fieldId)`, and actor membership/user context. Keep the accepted row append-only, with restrictive relations and a database update/delete guard.

**Evidence:** SPEC-013 FR-002 is stricter than the optional Season behavior in earlier operation records. The repository's observation, irrigation, and expense models use composite Business/Field/Season relations and actor provenance; SPEC-011/012 use append-only database guards. The current `Season` model requires `actualPlantingDate`.

**Rationale:** The active-state check is performed in the create transaction and backed by a Season row lock where needed to avoid accepting against a concurrently changed state. The immutable row preserves its original IDs, date, quantity, and unit after later current-context changes.

**Alternatives considered:** Allow Field-only Harvests or DRAFT Seasons (violates FR-002); trust a client Season ID (breaks tenancy); allow ordinary update/delete (breaks historical integrity); add a copied Field/Season snapshot framework (not required to retain the accepted associations and outside this feature).

## 6. Add Harvest through the existing Diary and date-only V2 cursor

**Decision:** Add `includeHarvests=false` to the existing `GET /fields/{fieldId}/diary` contract. When opted in, return a distinct `HARVEST` union entry sourced from the canonical Harvest row; no second Diary endpoint or copied diary record. New mobile diary reads set `includeHarvests=true`. Harvest entries use `harvestDate` without `occurredAt` or `recordedAt`. Keep the current default projection and V1 cursor unchanged. Any DATE-only projection (`includeExpenses` or `includeHarvests`) uses the existing V2 day/precision cursor, now bound to both inclusion flags as well as Field, Season, irrigation inclusion, and resolved Business timezone. Existing V2 cursors without `includeHarvests` decode it as false. Within a Business-local day, timestamped events keep their existing actual-instant ordering; DATE-only events follow them and sort by kind ascending, then source UUID descending.

**Evidence:** `specs/006-field-observations-basic-diary/contracts/observations-diary.openapi.yaml` owns the Diary operation. SPEC-012 established opt-in `includeExpenses`, V1 compatibility, and V2 DATE-only ordering. `apps/api/src/observations/diary-query.ts` already models V2 cursor precision and binding; `observation-diary.repository.ts` composes source candidates; generated types come from the SPEC-006 contract.

**Rationale:** The new mobile client can render Harvest distinctly while older installed clients retain their existing event set by default. The already-supported DATE-only cursor avoids inventing a time for Harvest and gives mixed timed/date-only records stable, bounded pagination. Ordinary Diary read authorization remains unchanged; Harvest inclusion adds no OWNER-only gate.

**Alternatives considered:** Define a second Harvest history endpoint (fragments Diary and creates a competing contract); return HARVEST unconditionally (may break older clients' event unions); make Harvest read finance-role gated (contradicts ordinary Diary authorization); sort by `recordedAt` or synthetic midnight (misstates occurrence); merge history only on mobile (unstable pagination).

## 7. Keep mobile create online and preserve the active logical submission

**Decision:** The mobile form submits online, holds the same `harvestId` and immutable request payload in the active create flow until the server resolves it, and allows a user-initiated exact retry after an uncertain response. It does not write a Harvest locally, add an outbox, automatically reconcile after app restart, or show success before an HTTP 201/200 accepted result. Offline, authorization, conflict, validation, and server errors remain distinct truthful states.

**Evidence:** SPEC-013 FR-006/012/013 expressly excludes offline Harvest creation. SPEC-011 demonstrates server-side exact retries limited to an active online flow; its persistent offline observation machinery is not reused. Existing Field Diary supplies the mobile entry point and read states.

**Rationale:** Reusing the same identity resolves an uncertain response without creating another historical fact, while no local pending record can be mistaken for accepted server history.

**Alternatives considered:** Generate a new identity on retry (duplicates); queue locally or retry after restart (out-of-scope offline capability); claim acceptance optimistically (not server-authoritative).

## 8. Keep the canonical OpenAPI client generated

**Decision:** Add `harvests.openapi.yaml` to SPEC-013 for the create operation and document the additive `HARVEST` amendment in `contracts/diary-extension.md`. During implementation, update the existing SPEC-006 Diary source and `packages/api-client/openapi-generator.config.ts`, then regenerate the `harvests` and Diary client surfaces.

**Evidence:** `packages/api-client/openapi-generator.config.ts` generates per-contract types and composes them in the shared client. SPEC-011/012 own their create contracts but leave the Diary operation/schema with SPEC-006.

**Rationale:** One source owns each operation, and mobile/API consumers share generated types. No generated code is produced or changed in this planning stage.

**Alternatives considered:** Hand-maintain mobile/API request types (contract drift); make a second Diary operation/schema in SPEC-013 (competing source of truth); change the generator or introduce a new contract tooling boundary.

## No External Dependencies

Harvest capture uses no external provider, job, worker, queue, attachment storage, or CMS content. PostgreSQL, the existing API, and current mobile app are sufficient.
