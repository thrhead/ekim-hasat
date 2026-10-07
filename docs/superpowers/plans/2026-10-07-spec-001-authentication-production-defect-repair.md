# SPEC-001 Authentication Production Defect Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a signed-out mobile farmer a safe Supabase email/password sign-in and account-creation path that reaches the existing authenticated SPEC-001 flow only through the current session observer.

**Architecture:** Extend the provider-neutral mobile auth port/controller with narrow email/password operations and safe result types, then implement them inside the existing Supabase adapter. Render a focused signed-out screen and pass its callbacks through app composition; leave `MobileAuthState`, persisted-session restoration, `onAuthStateChange`, and authenticated routing as the single authority for session state.

**Tech Stack:** TypeScript, Expo / React Native, Supabase JS v2 (`@supabase/supabase-js` 2.117.1), Jest with `react-test-renderer`, current mobile auth/controller and app-composition seams, Impeccable.

**Spec:** [Approved production-defect repair design](../specs/2026-10-07-spec-001-authentication-production-defect-repair-design.md); [SPEC-001 feature specification](../../../specs/001-farmer-onboarding-first-field/spec.md).

## Global Constraints

- V1 authentication uses Supabase Auth with email and password for sign-in and account creation.
- Existing session restoration remains; existing `onAuthStateChange` remains authoritative for authenticated state.
- Signup with a session follows existing authenticated routing; signup without a session presents email-confirmation-required state.
- Add no second authentication state machine.
- Do not add forgot/reset password, magic link, phone/SMS OTP, OAuth/social auth, MFA, passkeys, invites, anonymous auth, admin-created-account workflow, web auth, or generic profile/account management.
- Mobile uses only the approved public Supabase URL and publishable/anon credential; never expose service-role or Supabase secret credentials, log passwords, or fabricate production sessions.
- Server remains authoritative for ApplicationUser resolution, Membership, Business scope, and domain access; a Supabase session grants no business permission.
- Do not change existing session restoration, observer, refresh, sign-out, onboarding-status, or authenticated API-client behavior except to connect the new signed-out actions through existing boundaries.
- UI copy and validation follow the approved Turkish farmer-facing flow: required email/password, basic email format, email trim only, password passed unchanged, no password confirmation or reveal.
- For UI work, follow behavior/UI foundation → Impeccable shape/craft → critique/audit → polish → whole-repair review; preserve the current native Ekim Hasat surface and approved scope.
- Record real Supabase/device runtime evidence only when observed; if unavailable, state the exact blocker. Codespaces networking is a separate runtime/environment concern.

## Review Focus

- Provider may reject credentials or be unreachable: auth result and UI show safe recoverable feedback without rendering provider messages/codes; pin in Tasks 2–4.
- A Supabase session event may arrive before or after the sign-in/signup promise resolves: only the existing observer changes `MobileAuthState` and triggers routing; pin in Tasks 2 and 5.
- Signup may return a user without a session: show confirmation-required, clear password, keep the app signed out, and return to sign-in without implying authentication; pin in Tasks 3–5.
- Repeated taps while an operation is pending, malformed email, blank password, and password whitespace: prevent duplicate provider calls, locally reject malformed/blank input, and pass nonblank password bytes exactly as typed; pin in Tasks 2–4.
- Compact screen with keyboard open and accessibility focus/status: labels, roles, pending/error/confirmation announcements, password return-key submission/focus progression, scroll reachability, and minimum touch targets remain usable; pin in Task 4 and critique/audit in Task 5.

---

## File Map

- Modify `apps/mobile/src/auth/auth-port.ts`: provider-neutral operation/result types and controller delegation; keep `MobileAuthState` unchanged.
- Modify `apps/mobile/src/auth/supabase-auth.adapter.ts`: injected Supabase client typing, password calls, signup outcome mapping, and safe error normalization.
- Modify `apps/mobile/src/app-composition.ts`: expose sign-in/sign-up delegates to the signed-out screen without assigning auth state.
- Create `apps/mobile/src/features/auth/auth-screen.tsx`: sign-in, signup, pending/error/confirmation presentation and local validation.
- Modify `apps/mobile/App.tsx`: mount the auth screen only in the existing signed-out branch and pass composition callbacks.
- Modify `apps/mobile/test/auth/mobile-auth.test.ts`, `apps/mobile/test/auth/supabase-auth.adapter.test.ts`, and `apps/mobile/test/app-composition.test.ts`: strict RED/GREEN coverage at current seams.
- Create `apps/mobile/test/app-auth.test.tsx`: verify `App.tsx` mounts the auth screen only after signed-out resolution.
- Create `apps/mobile/test/features/auth/auth-screen.test.tsx`: screen interaction, validation, error/confirmation, and accessibility coverage.
- Reconcile `specs/001-farmer-onboarding-first-field/spec.md`, `plan.md`, `tasks.md`, and `quickstart.md`; record the selected V1 method in `docs/ADR/ADR-006-authentication-provider.md`; update the approved design status in `docs/superpowers/specs/2026-10-07-spec-001-authentication-production-defect-repair-design.md` to reflect the user's approval.
- Add/modify only the relevant mobile Maestro flow and its recorded evidence if a flow is needed to prove the signed-out runtime acceptance; keep physical runtime evidence in `specs/001-farmer-onboarding-first-field/quickstart.md`.

## Task 1: Reconcile the Approved SPEC-001 Artifacts

**Files:**
- Modify: `docs/superpowers/specs/2026-10-07-spec-001-authentication-production-defect-repair-design.md`
- Modify: `docs/ADR/ADR-006-authentication-provider.md`
- Modify: `specs/001-farmer-onboarding-first-field/spec.md`
- Modify: `specs/001-farmer-onboarding-first-field/plan.md`
- Modify: `specs/001-farmer-onboarding-first-field/tasks.md`
- Modify: `specs/001-farmer-onboarding-first-field/quickstart.md`

**Interfaces:**
- Consumes: User-approved design at the path above; existing SPEC-001 FR-001/FR-012, sign-in failure state, onboarding assumptions, PRD’s first-time journey and SPEC-001 account-creation scope, ADR-006.
- Produces: Explicit SPEC-001 V1 email/password requirement and signup session/confirmation outcomes; transparent correction of plan/T051 wording; bounded unchecked tasks T052–T056; quickstart acceptance/evidence rows for signed-out authentication.

- [ ] **Step 1: Record the failing artifact checks.** Inspect the current requirement, plan summary, T051 text, tasks numbering, quickstart auth scenario, and design status. Record the contradiction to be corrected: the spec/PRD promises sign-in and account creation, while plan/T051 prohibit sign-in UI/method selection; T051’s session bootstrap itself is already complete.
- [ ] **Step 2: Confirm the baseline contradiction.** Expected: SPEC-001 has no frozen email/password acceptance or signup-with/without-session result; `plan.md` excludes sign-in UI; T051 contains the exclusion; quickstart assumes a signed-in user; design header still says written design awaits review.
- [ ] **Step 3: Make the minimal transparent documentation correction.** Add one clarification and the smallest necessary acceptance language to `spec.md` for Supabase email/password, observer-driven session success, and null-session confirmation-required. Correct `plan.md` to state that the prior exclusion was erroneous and is superseded by the approved repair. Keep T051 checked and preserve its completed restore/observer/refresh/API-client/sign-out scope; remove its prohibition and append a history note stating that the original prohibition was contradictory. Add T052 (auth port/controller), T053 (Supabase adapter), T054 (signed-out screen), T055 (composition/routing/accessibility/runtime integration), and T056 (final runtime/evidence/review) as bounded unchecked tasks. Update `quickstart.md` with fresh signed-out sign-in/signup paths and separate outcomes for session issued vs confirmation required; distinguish automated tests from actual Supabase/device evidence. Add one ADR-006 consequence that records email/password as the SPEC-001 V1 method without changing the Supabase provider decision. Set the design status and lifecycle text to approved, without changing its approved behavior or decision.
- [ ] **Step 4: Review the artifact diff.** Run `git diff --check` and inspect the six changed documents. Expected: no unrelated SPEC-001 history is rewritten, T051 remains completed, its actual implementation is retained, ADR-006 records only the V1 method choice, and no physical runtime result is claimed.
- [ ] **Step 5: Commit the artifact reconciliation.** `git add docs/superpowers/specs/2026-10-07-spec-001-authentication-production-defect-repair-design.md docs/ADR/ADR-006-authentication-provider.md specs/001-farmer-onboarding-first-field/spec.md specs/001-farmer-onboarding-first-field/plan.md specs/001-farmer-onboarding-first-field/tasks.md specs/001-farmer-onboarding-first-field/quickstart.md && git commit -m "docs: reconcile SPEC-001 authentication repair"`.

## Task 2: Extend the Auth Port and Controller with Strict Results

**Files:**
- Modify: `apps/mobile/src/auth/auth-port.ts`
- Test: `apps/mobile/test/auth/mobile-auth.test.ts`

**Interfaces:**
- Consumes: Existing `AuthSession`, `MobileAuthPort`, `MobileAuthState`, `createMobileAuthController`.
- Produces: `AuthOperationErrorCode = "INVALID_CREDENTIALS" | "UNAVAILABLE" | "UNKNOWN"`; `AuthOperationResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: AuthOperationErrorCode }`; `SignupOutcome = "session-issued" | "confirmation-required"`; `MobileAuthPort.signIn(email: string, password: string): Promise<AuthOperationResult<void>>`; `MobileAuthPort.signUp(email: string, password: string): Promise<AuthOperationResult<SignupOutcome>>`; matching `MobileAuthController` methods.

- [ ] **Step 1: Write failing controller tests.** Add cases that `signIn` and `signUp` delegate exact email/password values and return the narrow result; emit authentication only when the fake `onSessionChange` listener publishes a session; return `confirmation-required` without publishing an authenticated session; and keep restore/sign-out tests passing unchanged.
- [ ] **Step 2: Run the focused test to verify RED.** Run: `pnpm --filter @ekim-hasat/mobile exec jest --runInBand test/auth/mobile-auth.test.ts`. Expected: TypeScript/Jest reports the missing port/controller methods and new fake-port members; no test may fail because a second state authority was introduced.
- [ ] **Step 3: Implement only the port/controller signatures and delegation.** Add the types and delegate methods. Do not call `updateSession` from either operation; do not expose tokens/provider metadata in operation results; retain existing restore observer ordering and sign-out semantics.
- [ ] **Step 4: Run the focused test to verify GREEN.** Run the same Jest command. Expected: new delegation and observer-authority cases pass, along with existing restore, refreshed-token, account-switch, sign-out invalidation, and metadata-isolation cases.
- [ ] **Step 5: Commit the auth boundary.** `git add apps/mobile/src/auth/auth-port.ts apps/mobile/test/auth/mobile-auth.test.ts && git commit -m "feat(mobile): add password auth operations"`.

## Task 3: Implement Email/Password Operations in the Supabase Adapter

**Files:**
- Modify: `apps/mobile/src/auth/supabase-auth.adapter.ts`
- Test: `apps/mobile/test/auth/supabase-auth.adapter.test.ts`

**Interfaces:**
- Consumes: Task 2 `AuthOperationResult`, `AuthOperationErrorCode`, and `SignupOutcome`.
- Produces: Existing `createSupabaseAuthPort(config, createSupabaseClient?)` implementing `signIn(email, password)` with `client.auth.signInWithPassword({ email, password })` and `signUp(email, password)` with `client.auth.signUp({ email, password })`. Successful sign-in returns `{ ok: true, value: undefined }`; successful signup returns `{ ok: true, value: data.session ? "session-issued" : "confirmation-required" }`.

- [ ] **Step 1: Write failing adapter tests.** Extend the injected fake client to assert exact provider arguments, provider session internals do not escape, signup maps non-null and null session correctly, invalid-credential/unavailable/unknown errors normalize to the three safe codes without exposing provider messages, and existing persistence/refresh/observer/unsubscribe/sign-out/disposal assertions remain intact.
- [ ] **Step 2: Run the focused test to verify RED.** Run: `pnpm --filter @ekim-hasat/mobile exec jest --runInBand test/auth/supabase-auth.adapter.test.ts`. Expected: current injected-client shape lacks password methods and adapter operations; the test must not call hosted Supabase.
- [ ] **Step 3: Implement the minimal adapter calls and normalization.** Extend only the injected client type for the installed Supabase JS v2 API; map signup by actual `data.session`; normalize known credential and retryable transport failures to safe codes and all other provider failures to `UNKNOWN`. Never return provider errors, raw messages, user objects, or sessions. Preserve `getSession`, `onAuthStateChange`, AsyncStorage persistence, `detectSessionInUrl: false`, app-state refresh, sign-out, and disposal.
- [ ] **Step 4: Run the focused test to verify GREEN.** Run the same Jest command. Expected: all new argument/outcome/error tests and the existing adapter lifecycle test pass.
- [ ] **Step 5: Commit the adapter.** `git add apps/mobile/src/auth/supabase-auth.adapter.ts apps/mobile/test/auth/supabase-auth.adapter.test.ts && git commit -m "feat(mobile): add Supabase password auth"`.

## Task 4: Build the Signed-Out Auth Screen Test-First

**Files:**
- Create: `apps/mobile/src/features/auth/auth-screen.tsx`
- Create: `apps/mobile/test/features/auth/auth-screen.test.tsx`

**Interfaces:**
- Consumes: Task 2 result types. Props: `onSignIn(email: string, password: string): Promise<AuthOperationResult<void>>`; `onSignUp(email: string, password: string): Promise<AuthOperationResult<SignupOutcome>>`.
- Produces: `AuthScreen` with local `mode: "sign-in" | "sign-up"`, field values, pending/error state, and confirmation-required presentation only. It never reads or writes `MobileAuthState`.

- [ ] **Step 1: Write failing screen behavior and accessibility tests.** Cover default Turkish “Giriş yap” view; labelled email/password fields; sign-in submit; switch to “Hesap oluştur” and submit; required and basic email validation before callback; trim email but preserve password exactly (including surrounding whitespace), rejecting only an empty password; pending disabled button and duplicate-submit guard; generic invalid-credential and safe unavailable messages without provider text; retained email after retryable failure; identical non-enumerating signup copy for existing-account/provider failures; confirmation-required message after null-session signup and password clearing; clear password after successful operation/unmount; accessible return-to-sign-in action; roles/names, alert/status announcement, busy state, email keyboard/no autocapitalize, password return-key submission, focus progression where testable, keyboard-safe scroll container, and font-scaling/touch-target props.
- [ ] **Step 2: Run the focused test to verify RED.** Run: `pnpm --filter @ekim-hasat/mobile exec jest --runInBand test/features/auth/auth-screen.test.tsx`. Expected: module/component is missing; no callback or accessibility behavior is yet implemented.
- [ ] **Step 3: Implement the minimal native screen.** Use platform-native `TextInput`, `Pressable`, `ScrollView`/keyboard avoidance, visible Turkish labels and one primary action. Validate only required fields and basic email format; do not add password confirmation, reveal, strength policy, reset, deep-link, profile, or alternate provider flow. Use both a ref-based in-flight guard and disabled/busy affordance. Keep raw provider error data out of UI. Clear the password on successful operation, confirmation-required, and screen unmount; keep email for retry.
- [ ] **Step 4: Run the focused test to verify GREEN.** Run the same Jest command. Expected: behavior and accessibility contract cases pass, including pending/double-submit, error/status announcement, keyboard submit/focus callback, and confirmation-to-sign-in transition.
- [ ] **Step 5: Run Impeccable shape/craft against the implemented screen.** Use the approved design as the confirmed product brief and preserve the incumbent native Ekim Hasat visual language. Apply only Operate-mode hierarchy/layout/type/interaction refinements within the stated auth scope; do not introduce a new auth route or product behavior.
- [ ] **Step 6: Run focused screen tests after craft changes.** Run the same Jest command. Expected: all auth behavior/accessibility tests remain green.
- [ ] **Step 7: Commit the screen foundation and craft.** `git add apps/mobile/src/features/auth/auth-screen.tsx apps/mobile/test/features/auth/auth-screen.test.tsx && git commit -m "feat(mobile): add signed-out authentication screen"`.

## Task 5: Wire the Existing Observer-Driven App Composition and Review the UI

**Files:**
- Modify: `apps/mobile/src/app-composition.ts`
- Modify: `apps/mobile/App.tsx`
- Test: `apps/mobile/test/app-composition.test.ts`
- Review: `apps/mobile/src/features/auth/auth-screen.tsx`
- Review: `apps/mobile/test/features/auth/auth-screen.test.tsx`

**Interfaces:**
- Consumes: Task 2 controller operations and Task 4 `AuthScreen`.
- Produces: `createAppComposition(controller)` forwards `signIn(email, password)` and `signUp(email, password)` to the controller without publishing authenticated state; `App.tsx` renders `AuthScreen` only for `state.auth.status === "signed-out"` and supplies those composition callbacks.

- [ ] **Step 1: Write failing composition, App render, and routing tests.** Extend the current fake auth port and composition tests to prove callback delegation; observer event before or after operation completion is the only route to authenticated state; a session-issued signup reaches the existing `GET /v1/onboarding/status` flow only after observed session; a no-session signup remains signed out and performs no API request; restored sessions still skip the auth screen; existing authenticated new/returning status routes remain unchanged. Add `apps/mobile/test/app-auth.test.tsx` with injected/mocked bootstrap and composition seams to assert startup loading remains visible and resolved signed-out state renders `AuthScreen` with delegated actions.
- [ ] **Step 2: Run the focused tests to verify RED.** Run: `pnpm --filter @ekim-hasat/mobile exec jest --runInBand test/app-composition.test.ts test/app-auth.test.tsx`. Expected: missing composition delegates or fixture methods and missing signed-out App rendering cause failure; a response-only session must not change `MobileAuthState` or trigger status.
- [ ] **Step 3: Implement composition delegation and the signed-out render branch.** Forward operations without setting state; replace the signed-out `AppShell` with `AuthScreen` callbacks; preserve startup loading, session restoration, observer subscription, status resolution, and all existing authenticated routes.
- [ ] **Step 4: Run the focused tests to verify GREEN.** Run the same Jest command. Expected: observed sign-in and immediate-session signup use the existing route path; null-session signup remains signed out; the app mounts the auth screen only after signed-out resolution; prior composition and onboarding tests pass.
- [ ] **Step 5: Run Impeccable critique and native accessibility audit.** Review the complete auth surface for Operate-mode clarity, Turkish copy, loading/error/confirmation states, iOS and Android native behavior, compact-screen keyboard reachability, scalable text, contrast, focus/order, and at least 48 dp Android touch targets. Fix only defects within approved scope and pin every testable finding in `auth-screen.test.tsx`.
- [ ] **Step 6: Run Impeccable polish.** Apply the bounded final visual/interaction pass after critique/audit; retain product copy and operation behavior unless the approved design explicitly allows a correction.
- [ ] **Step 7: Run focused verification after UI review.** Run: `pnpm --filter @ekim-hasat/mobile exec jest --runInBand test/features/auth/auth-screen.test.tsx test/auth/mobile-auth.test.ts test/auth/supabase-auth.adapter.test.ts test/app-composition.test.ts test/app-auth.test.tsx` and `pnpm --filter @ekim-hasat/mobile typecheck`. Expected: all focused suites and TypeScript checks pass.
- [ ] **Step 8: Commit composition and verified polish.** `git add apps/mobile/src/app-composition.ts apps/mobile/App.tsx apps/mobile/src/features/auth/auth-screen.tsx apps/mobile/test/app-composition.test.ts apps/mobile/test/app-auth.test.tsx apps/mobile/test/features/auth/auth-screen.test.tsx && git commit -m "feat(mobile): connect signed-out auth flow"`.

## Task 6: Whole-Repair Review and Real Runtime Acceptance

**Files:**
- Review: all files in Tasks 1–5.
- Modify only if needed: `apps/mobile/e2e/` auth flow and `specs/001-farmer-onboarding-first-field/quickstart.md`.

**Interfaces:**
- Consumes: Completed auth operations, signed-out screen, observer-driven composition, reconciled SPEC-001 acceptance.
- Produces: Reviewed repair, updated quickstart evidence, and an explicit result for each runtime acceptance step; no fabricated device/provider evidence.

- [ ] **Step 1: Run the whole-repair review.** Compare implementation against the approved design, security boundaries, exclusions, artifact reconciliation, all Review Focus tests, and the completed Impeccable critique/audit/polish findings. Confirm no new authentication state authority or auth method exists.
- [ ] **Step 2: Run complete mobile verification.** Run: `pnpm --filter @ekim-hasat/mobile test`, `pnpm --filter @ekim-hasat/mobile typecheck`, and `pnpm --filter @ekim-hasat/mobile lint`. Expected: all mobile tests, typecheck, and lint pass with no unreviewed regressions.
- [ ] **Step 3: Attempt the real configured runtime path when credentials/device are available.** On a fresh signed-out Expo mobile app, use a real configured Supabase test account to sign in or create an account; record whether signup returned a session or required email confirmation. For a null-session signup, confirm the email using the configured test inbox, return to the app, sign in with email/password, and verify the existing onboarding status and first-field reachability after the observer reports a real session. Do not print credentials/tokens or use a fake production session. If physical/device/provider access is unavailable, record the exact blocker and leave those steps unverified; do not use Codespaces networking failure to widen product scope.
- [ ] **Step 4: Reconcile quickstart evidence.** Record automated results separately from real provider/device execution. State any unavailable runtime checks explicitly and preserve prior SPEC-001 runtime evidence as historical evidence, not evidence for the repaired signed-out path.
- [ ] **Step 5: Inspect final diff and commit runtime/evidence follow-up.** Run `git diff --check` and review the full diff. If an E2E flow or quickstart evidence changed, stage only the exact changed paths (for example `apps/mobile/e2e/<auth-flow>.yaml` and `specs/001-farmer-onboarding-first-field/quickstart.md`) and commit with `test(mobile): record SPEC-001 auth acceptance`.

## Self-Review

- **Spec coverage:** Tasks 1–6 cover frozen method/signup outcomes, safe normalized errors, Supabase adapter calls, preserved restore/observer/refresh/sign-out, signed-out form actions and states, observer-only authenticated routing, security/authorization boundaries, documentation history, accessibility, and real-runtime acceptance.
- **Step scan:** Every task step has a checkable artifact, test, command, review outcome, or commit. RED steps precede production behavior; each expected failure names the missing method/component/route wiring. UI shaping and the critique/audit/polish cycle occur after the screen foundation and before whole-repair review.
- **Type consistency:** Task 2 defines the only operation result, error-code, and signup-outcome types; Tasks 3–5 consume the same exact names/signatures. Signup outcome communicates only whether a session was issued; no provider session/token or user object reaches the UI.
- **Review Focus coverage:** Provider failure/error leakage (Tasks 3–4); event timing and routing authority (Tasks 2 and 5); no-session confirmation (Tasks 3–5); validation/pending/password preservation (Tasks 2 and 4); keyboard/accessibility (Task 4 plus Task 5 audit). Every item has named tests.
- **Proportion:** The six tasks are bounded around docs, auth boundary, provider adapter, screen, composition/review, and runtime evidence; implementation detail is limited to exact interfaces, expected test assertions, and provider calls needed to remove ambiguity.

**Unresolved decisions:** None. Email/password, confirmation behavior, scope exclusions, provider, and state authority are frozen by the approved design and current user instruction. Physical runtime availability is an evidence constraint to report, not a product decision.
