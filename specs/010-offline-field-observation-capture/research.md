# Phase 0 Research: Offline Field Observation Capture

This is a planning decision record, not evidence that implementation or tests passed.

## Decision 1 — Persist only known observation context

**Decision**: Save the minimum account-scoped Field ID, optional same-Field Season ID, and Business timezone obtained through the existing authorized observation/diary path. Persist a separate observation-specific, non-authoritative local account continuity marker only after a successfully authenticated app session yields a concrete `accountId`. A retryable/offline restoration failure may retain that marker for local pending capture in the same saved observation context. A successful no-session restoration, explicit sign-out, or authentication as a different account invalidates its active use and hides the former account's data; stored pending commands need not be deleted and can be accessed again after later matching authentication. An old account ID elsewhere in storage cannot silently select a namespace. The marker is a local privacy partition, not an authentication state, access token, Membership/Business permission, or authorization lease. Do not provide a general offline Field/Season list.

**Rationale**: SPEC-010 clarifications require new capture after restart without refreshed sign-in, while [supabase-auth.adapter.ts](../../apps/mobile/src/auth/supabase-auth.adapter.ts) currently replaces restoration errors with a generic throw and [auth-port.ts](../../apps/mobile/src/auth/auth-port.ts) maps both `restoreSession()` returning `null` and a thrown failure to signed-out. The adapter must classify retryable/unavailable restoration failures, and the auth boundary must expose authenticated, definitive no-session, and retryable/offline restoration-unavailable outcomes distinctly to the observation flow; only the last can consult a previously established active marker. Non-retryable/unknown failures cannot silently qualify. The observation SQLite store owns persistent marker/context state and its account partition; the auth port coordinates transitions through a narrow storage port rather than duplicating storage. Preserve `onAuthStateChange` and the existing authenticated API-session model. [observation-create-screen.tsx](../../apps/mobile/src/features/observations/observation-create-screen.tsx) currently fetches context on mount. Delivery still requires the matching authenticated API session and current server permission checks.

**Alternatives considered**: General Field/Season cache and authorization lease (outside frozen scope); require online session refresh before local capture (contradicts clarification); reuse device timezone (violates SPEC-006).

## Decision 2 — Observation-specific durable command and result

**Decision**: Give each confirmed note one stable `observationId`; persist the exact original create payload with its account/Field context before showing local success. Keep pending, in-flight/uncertain, accepted, and needs-attention/unconfirmed outcomes recoverable across restart. A crash after submission begins and before durable response recording is an unknown outcome; a restart retains the exact command and retries only under a matching authenticated account. Store accepted result before leaving pending status. Diary page position never restores a confirmed accepted command to pending. Use SQLite, consistent with the existing completion-specific store, but keep a separate observation boundary.

**Rationale**: [task-completion-command-store.ts](../../apps/mobile/src/features/tasks/task-completion-command-store.ts) demonstrates durable account-scoped rows. [observation-create-screen.tsx](../../apps/mobile/src/features/observations/observation-create-screen.tsx) currently retains uncertain attempts only in component memory. The current create API already uses an observation UUID for idempotency.

**Alternatives considered**: Reuse the completion command table (mixes domain lifecycles); AsyncStorage as primary domain database (prohibited by [AGENTS.md](../../AGENTS.md)); recreate payload or ID on retry (breaks idempotency); clear row on HTTP success before durable local acceptance (loses recovery).

## Decision 3 — Separate local capture from server authority

**Decision**: Local account identification permits account-scoped pending capture only. No delivery runs without a current authenticated session for that same account. The existing observation create route resolves active membership, Field, and optional Season at delivery and on replay; a 401 from missing/expired sign-in stays pending for later authentication. Known 403/404/400/409 stops automatic retry and retains the note. If a previous send may have committed without a received response, a later denial is **unconfirmed**, never definite rejection or acceptance.

**Rationale**: [observation.repository.ts](../../apps/api/src/observations/observation.repository.ts) locks active membership and scopes the Field/Season; [observation.controller.ts](../../apps/api/src/observations/observation.controller.ts) authenticates on each request. The clarified spec expressly distinguishes an uncertain prior commit from an unsent rejection.

**Alternatives considered**: Trust saved membership (unsafe); lookup canonical ID with unauthorized access (privacy breach); always call 403 a rejected observation (false if an earlier request committed).

## Decision 4 — Preserve SPEC-006 time and replay semantics

**Decision**: Capture and persist `occurredAtLocal`, absolute `occurredAt`, and saved Business timezone, with SPEC-006 uniqueness/non-future rules. Add only the optional `capturedBusinessTimezone` precondition to the existing observation create request in the canonical SPEC-006 OpenAPI source; older online clients may omit it. Keep its one route, `createFieldObservation` operationId, and generated public client ownership. On first delivery, the server compares that value with its authoritative timezone in the acceptance transaction before creating a row, even if the old local/instant pair would still map. A mismatch leaves the original command in needs attention without changing occurrence when no earlier commit is possible; otherwise a later mismatch cannot erase an unknown prior outcome, which remains unconfirmed. For an *already accepted* ID, exact replay is checked after current authorization and canonical payload/context comparison before applying the first-create timezone precondition; later timezone changes cannot rewrite accepted time. Preserve the existing 201/200/409 behavior and privacy boundaries.

**Rationale**: [business-timezone.ts](../../apps/api/src/seasons/business-timezone.ts) validates against the current Business timezone. [observation.repository.ts](../../apps/api/src/observations/observation.repository.ts) performs that validation before its duplicate-row path, so a Business timezone edit after a lost 201 can currently make an exact retry return 400. The fingerprint already covers Business, Field, Season, actor, canonical text, and absolute occurredAt, excluding local wall-time text. A narrowly adjusted authorized replay path is needed to make SPEC-010's exact retry true in this case; it must not bypass current membership/Field/Season checks or allow changed identity/payload.

**Alternatives considered**: Client-only preflight diary read (race with timezone update before acceptance); rewrite pending instant for the new timezone (violates original occurrence); accept a new ID without farmer decision (duplicate history); globally version timezone or redesign observation history (outside scope). Existing accepted rows store UTC `occurredAt` but no historical timezone snapshot. Canonical diary display continues SPEC-006's existing Business-timezone conversion; conversion never changes stored historical UTC instant.

## Decision 5 — Reconcile with the canonical diary by identity

**Decision**: Keep local unresolved/accepted outcomes distinct from canonical diary rows. After accepted 201 or exact 200, durably persist the result and immediately leave pending status, independent of diary refresh or page position. Match observation by `observationId`; if local accepted representation and canonical row are both visible, present one observation. A first diary page lacking that ID neither downgrades acceptance nor proves absence. Retain the accepted result until the canonical row with that ID has been observed through an authorized read; diary pagination remains unchanged.

**Rationale**: [field-diary-screen.tsx](../../apps/mobile/src/features/observations/field-diary-screen.tsx) reads canonical pages and clears protected data on 401/403/404. [observation-diary.repository.ts](../../apps/api/src/observations/observation-diary.repository.ts) merges canonical sources with existing ordering. The new local status is a presentation of command state, not a new diary source.

**Alternatives considered**: Insert pending rows into canonical diary data (false acceptance); alter diary cursor semantics (unnecessary); discard accepted local result immediately (cannot recover from diary refresh failure).

## Decision 6 — Verification and Cloud exception

**Decision**: Later implementation verification should cover local persistence/restart, uncertain retry, account switch, sign-in restoration, revoked membership, cross-Business privacy, exact replay, timezone change, and diary de-duplication. Real PostgreSQL integration uses the repository's disposable `ekim_hasat_test` guard. Device/emulator behavior is separately labelled if unavailable. Graft and exact pnpm 10.17.1 are platform-exception gaps until actually run/proven; do not substitute pnpm 11.

**Rationale**: [constitution.md](../../.specify/memory/constitution.md) and [AGENTS.md](../../AGENTS.md) require risk-appropriate offline, tenancy, and contract tests. The planning phase runs none of these checks.

**Alternatives considered**: Mock-only proof for database replay and membership races (insufficient); counting authored tests or static spec checks as device evidence (invalid).
