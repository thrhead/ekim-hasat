# Contract: Observation-Specific Offline Command

This is a planning contract for the mobile feature boundary. It does not introduce a public synchronization endpoint or a second OpenAPI source for observation creation. Evolve only the canonical `specs/006-field-observations-basic-diary/contracts/observations-diary.openapi.yaml` with the optional member below and regenerate its existing client; preserve one route, one `createFieldObservation` operation, and older request-body compatibility.

## Local capture boundary

**Input**: saved observation context for an account and Field/optional Season, valid text, farmer-selected Business-local occurrence time (default current time), and either a real authenticated matching account or its observation-specific continuity marker retained after a retryable/offline restoration failure. The marker was established only from an authenticated session with concrete `accountId`; an old account ID merely present in storage, definitive no-session restoration, or explicit sign-out is insufficient. The marker permits local pending capture only and contains no token or API authority.

**Output**: one durable `PENDING` command with stable `observationId` and exact SPEC-006 create body, or a clear validation/local-save/context-unavailable failure. Local success means *saved on device*, never server accepted. A saved context may be used after offline restart without refreshed sign-in; an unidentified original account may not use it.

**Uniqueness**: one command per `accountId` + `observationId`. Repeated UI confirmation for the same logical save cannot insert a second command. A later intentional new observation receives a new ID.

## Delivery boundary

**Precondition**: current authenticated API session for the command's original account. Local account identification or stored context alone is insufficient. No request is sent while sign-in is unavailable or for a different account.

**Request**: existing `POST /v1/fields/{fieldId}/observations` with the originally retained `observationId`, `description`, `occurredAtLocal`, `occurredAt`, and optional `seasonId`, plus a narrow optional `capturedBusinessTimezone` precondition for offline commands. Older online clients may omit the new field. No client-supplied Business ID or new sync header/path. The server compares this timezone with the current authoritative Business timezone before a first acceptance, after current authorization, within the acceptance transaction. An accepted exact replay is recognized under current authorization before this first-create precondition so a later timezone edit cannot defeat replay.

**Server outcomes**:

| Outcome | Local treatment |
|---|---|
| 201 accepted / 200 exact replay | Atomically retain canonical result and mark accepted, then refresh authorized diary. |
| Network uncertainty or 5xx | Preserve exact command for later retry; never claim accepted or rejected. |
| 401 / no usable authenticated session | Do not submit again until sign-in is restored; retain pending or uncertainty. |
| 403/404 | Stop automatic retry and retain original note. Mark not accepted only if no earlier attempt could have committed; otherwise mark unconfirmed. Never probe protected diary content. |
| 400 invalid request or captured-timezone mismatch / 409 identity reuse | For a first definitive response with no possible earlier commit, preserve original note and captured temporal inputs in needs-attention state and stop automatic retry. If an earlier send may have committed without a durable response, preserve outcome unconfirmed instead of inferring rejection from this later response. Changing payload, Field/Season, or temporal context requires an explicit farmer decision and new logical observation ID. |

Current server authentication, active Membership, Field/Season scope, canonical text/time validation, unique observation identity, and safe errors remain authoritative. A replay of an already accepted identity after a Business timezone change compares original canonical payload/context under current authorization without requiring the old local/instant pair to map under the *new* timezone. A first submission with a mismatched captured timezone fails without acceptance and remains local needs-attention; its note and temporal inputs are not rewritten. The additive request field and error classification require a matching OpenAPI/generated-client update and backward-compatibility check during implementation.

## Diary reconciliation boundary

**Read**: existing authorized `GET /v1/fields/{fieldId}/diary`, optional `seasonId`, existing cursor/limit and ordering.

**Merge rule**: Local unresolved notes remain clearly local. A command leaves pending only after its accepted result is durable; it does not return to pending because diary refresh fails or the row is beyond the first page. The retained result may be shown as accepted while diary refresh is pending, but is not counted as an extra canonical event. Match a canonical `OBSERVATION` entry by `observationId`; when both representations are visible, present one logical observation. Retire the retained accepted representation only after an authorized diary read confirms that ID. Authorization failure hides protected canonical content and leaves the original account's local state isolated.

## Compatibility

No breaking change to existing observation create/diary paths or SPEC-003/007/009 behavior is planned. The optional request precondition is additive; omitted values retain existing online-client behavior. The server replay correction retains SPEC-006 201/200/409 semantics and needs generated-contract and installed-mobile compatibility review. This contract is not a generic outbox or sync protocol.
