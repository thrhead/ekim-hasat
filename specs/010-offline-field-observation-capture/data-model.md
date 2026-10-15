# Data Model: Offline Field Observation Capture

This plan adds local observation state. The existing PostgreSQL `FieldObservation` remains the only canonical accepted record. Names below describe intended responsibilities, not a migration or implementation.

## SavedObservationContext (device-local)

| Field | Meaning / constraint |
|---|---|
| `accountId` | Original app account identity; part of local partition key, never proof of API authorization. |
| `fieldId` | Previously authorized Field identity. |
| `seasonId` | Optional previously authorized Season identity for this Field; absence is meaningful. |
| `businessTimezone` | Previously supplied Business timezone used to compose a unique local time and absolute instant. |
| `establishedAt` | Local record of when this context was last obtained through the authorized observation flow; display need not imply current access. |

Unique local context key: account + Field + optional Season. Context is written only after a successful authorized server read. New offline capture also requires that same locally active account namespace, not merely a stale stored account ID. Explicit sign-out or account switch invalidates use of the former namespace's saved context for new capture and hides its data. No general Field/Season projection, membership cache, or lease is created.

## ObservationAccountContinuityMarker (device-local)

The observation-specific SQLite store owns this marker, account-scoped saved context, and atomic lifecycle updates where required. The marker identifies one active local observation namespace by `accountId`; it is separate from saved contexts and pending commands. Establish or update it only from a successfully authenticated app session with a concrete account ID. Persist it across restart only so a retryable/offline session-restoration failure can select that same namespace for local pending capture. A successful no-session restoration or explicit sign-out clears/inactivates the active marker; authentication as another account replaces its active namespace. Commands and saved contexts belonging to the former account may remain stored but are hidden until a later authenticated session for that account. The marker never contains an access token and never grants API access, Membership/Business permission, or an authorization lease. An account ID in a command or context row alone is insufficient to recreate an active marker.

## ObservationCreateCommand (device-local)

| Field | Meaning / constraint |
|---|---|
| `accountId`, `fieldId`, optional `seasonId` | Original context and local privacy partition. |
| `observationId` | Stable UUID and local unique command key; never regenerated for exact retry. |
| `description` | SPEC-006 canonical trimmed text, 1–2000 Unicode code points. |
| `occurredAtLocal` | Original Business-local wall time submitted by the farmer. |
| `occurredAt` | Matching absolute instant; never replaced with delivery/acceptance time. |
| `capturedBusinessTimezone` | Saved authoritative Business timezone used when the command was created; submitted as an optional first-acceptance precondition for this offline command. |
| `state` | `PENDING`, `ACCEPTED`, `NEEDS_ATTENTION`, or `UNCONFIRMED`. |
| `attemptMayHaveCommitted` | Durable uncertainty indicator set before a network submission and retained if its result is lost. A definitive response for the first attempt resolves that attempt; an earlier unresolved attempt remains possible. Conservative uncertainty is preferred to a false rejection. |
| `acceptedResult` | Canonical observation representation from 201/200, if accepted; stored before settling pending status. |
| `failureCode` | Safe local classification for a definitive denial or validation conflict; no provider secret or foreign resource details. |

The exact create body is reconstructed only from retained original fields; it is never silently rebased or assigned a new ID. Local insert and local success confirmation are ordered so a failed write cannot show success. The local state transition and result write are atomic. `RETRYING` is transient UI status and restores to pending/uncertain after process death.

### State transitions

```text
new valid note → PENDING (durably saved)
PENDING → PENDING                 connectivity/transport/5xx/401 uncertainty or no valid sign-in
PENDING → ACCEPTED                201 create or 200 exact replay; result durably stored
PENDING → NEEDS_ATTENTION         definitive unsent/known nonaccepted 400/403/404/409
PENDING → UNCONFIRMED             possible earlier commit + later denial without proof
UNCONFIRMED → ACCEPTED            later authorized exact replay or canonical evidence
UNCONFIRMED → NEEDS_ATTENTION     later authorized evidence establishes nonacceptance
ACCEPTED → reconciled presentation after authorized diary confirms same observationId; never back to pending due to page position
```

Do not automatically retry a definitive unauthorized/conflicted state. A first-attempt definitive denial with no earlier uncertain attempt is `NEEDS_ATTENTION`; a denial after a prior send with an unknown outcome is `UNCONFIRMED`. A process crash after the durable send marker but before a response is treated as uncertain and preserves the unchanged command for eligible exact retry. An authenticated matching account is required for any later delivery or canonical diary read. `UNCONFIRMED` retains the original note without claiming acceptance. Any correction to text, Field/Season, or temporal inputs requires an explicit farmer decision and new logical observation ID; the original command is not mutated.

## Existing FieldObservation (canonical PostgreSQL)

The current model in `apps/api/prisma/schema.prisma` already stores UUID identity, Business/Field/optional Season, actor identity/membership, canonical text, absolute `occurredAt`, server `acceptedAt`, and payload fingerprint. Its immutable record and unique identity remain the canonical source. No generic sync row, global cursor, or duplicate local history table is proposed. A narrow server replay-path correction may be needed for a previously accepted exact command after a Business timezone change, with no change to the canonical observation's text/time/association.

## Diary presentation

The existing authorized diary remains a paginated canonical projection of accepted observations, completions, and skips. Local observation command status is presented separately or overlaid by `observationId`; it does not become a server diary event. The UI de-duplicates a command's accepted result and a canonical row with the same ID. A first page lacking the ID is not treated as canonical absence. Existing cursor order and other event kinds are unchanged.

## Validation invariants

- A `seasonId`, if present, must be for the same Field and authorized Business at server acceptance; local saved context cannot guarantee current eligibility.
- `occurredAtLocal` and `occurredAt` must uniquely correspond under the saved timezone at local capture. At first acceptance, the saved timezone must equal the authoritative Business timezone and current server text/time rules must pass. A mismatch retains the original note and inputs in needs attention when no earlier attempt may have committed; if an earlier send has an unknown outcome, a later mismatch leaves the outcome unconfirmed. Neither response rewrites the original command. A corrected submission is a new logical observation. DST gap/fold and future instants fail.
- Accepted/replayed result is scoped by current actor and Business; another actor's ID is not a replay grant.
- Account switch or unidentified original account prevents display/submission of that account's local state.
- A definitive no-session restoration cannot be treated as a retryable/offline restoration failure. Unknown or non-retryable restoration errors do not activate offline capture. Only a matching authenticated API session can deliver or replay a command.
- Sign-in restoration alone does not imply Membership restoration; every delivery and diary read rechecks the API boundary.
