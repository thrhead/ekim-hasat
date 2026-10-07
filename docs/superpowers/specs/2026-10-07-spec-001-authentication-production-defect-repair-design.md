# SPEC-001 Authentication Production Defect Repair

**Status:** Approved
**Date:** 2026-10-07
**Scope:** Repair the missing farmer-accessible V1 authentication journey in SPEC-001
**Implementation status:** Not started

## 1. Defect statement and evidence

The signed-out production mobile app has no control for a farmer to sign in or create an account. **apps/mobile/App.tsx** renders **AppShell** for the **signed-out** state; that shell contains only the Ekim Hasat title. The mobile **AuthPort** supports restoring a persisted session, observing session changes, and signing out, but exposes no sign-in or sign-up operation. The Supabase adapter configures persistent native sessions and refresh, then wraps **getSession**, **onAuthStateChange**, and **signOut**; it does not call the provider's password-auth methods.

This conflicts with the approved product requirements:

- The PRD's first-time journey begins with “Sign up / sign in,” and SPEC-001 scope includes account creation.
- SPEC-001's P1 user story is “Sign in and start farming.” FR-001 permits entry after successful sign-in; FR-012 requires Supabase Auth; the failure-state requirements cover sign-in failure; and the mobile smoke requirement calls for sign-in and first-field creation without a desktop.
- The SPEC-001 plan and T051 instead say not to add sign-in UI or choose a method. The implementation followed that lower-level exclusion. This design records that conflict; it does not rewrite the record as if it never existed.

Evidence:

- [PRD first-time journey](../../../docs/PRD.md#71-first-time-experience) and [PRD SPEC-001 scope](../../../docs/PRD.md#spec-001--authentication-and-self-service-onboarding)
- [SPEC-001 user story and functional requirements](../../../specs/001-farmer-onboarding-first-field/spec.md)
- [conflicting plan wording](../../../specs/001-farmer-onboarding-first-field/plan.md)
- [conflicting completed task wording](../../../specs/001-farmer-onboarding-first-field/tasks.md)
- [signed-out app rendering](../../../apps/mobile/App.tsx)
- [mobile auth port](../../../apps/mobile/src/auth/auth-port.ts)
- [Supabase mobile adapter](../../../apps/mobile/src/auth/supabase-auth.adapter.ts)

## 2. Why this is a SPEC-001 repair

This repair makes the already-promised first step of SPEC-001 usable. It enables account creation and sign-in, then hands a valid Supabase session to the existing first-field onboarding and returning-user routes. It adds no farming workflow, account-management area, provider, or onboarding step. It is a correction to SPEC-001, not a new numbered feature and not SPEC-008.

## 3. Frozen product decision

- **V1 method:** Email and password for sign-in and account creation.
- **Provider:** Existing Supabase Auth.
- **Mobile credentials:** Existing public Supabase URL and publishable/anon key only.
- **Session authority:** Existing Supabase session observation remains the sole source of authenticated state.
- **Account confirmation:** Signup with no returned session enters an explicit email-confirmation-required presentation. The app does not claim the farmer is signed in.
- **Authorization:** Authentication does not create or imply Business, Membership, or domain permissions. The application API remains authoritative.

This settles the method choice left open by ADR-006. It adds none of the excluded authentication methods.

## 4. Existing auth architecture

**App.tsx** creates the mobile auth bootstrap and **createAppComposition**. The composition subscribes to the **MobileAuthController**, starts it, and handles auth-state changes. When authenticated, the composition obtains the generated API client and resolves onboarding status. Existing routing sends a farmer with no first field to first-field onboarding and a returning farmer to the existing app destination.

**MobileAuthPort** is provider-neutral. The controller owns **MobileAuthState**, creates an authenticated API client using the current bearer token, subscribes to auth events, restores persisted session state, and clears the session on sign-out. **createSupabaseAuthPort** owns the Supabase SDK client, AsyncStorage-backed session persistence, auto-refresh lifecycle, and translation of provider sessions to the provider-neutral account/token shape.

Existing tests cover restore, signed-out startup, refreshed-token use, account switching, sign-out invalidation, metadata isolation, persistent storage configuration, auth-event observation, and refresh lifecycle:

- [controller tests](../../../apps/mobile/test/auth/mobile-auth.test.ts)
- [Supabase adapter tests](../../../apps/mobile/test/auth/supabase-auth.adapter.test.ts)
- [app composition tests](../../../apps/mobile/test/app-composition.test.ts)

The installed mobile dependency is **@supabase/supabase-js 2.117.1**. No additional auth package or auth state container is proposed.

## 5. Chosen approach and alternatives

### Chosen: extend the existing auth boundary and render an auth surface when signed out

Add email/password actions to the existing provider-neutral auth port and controller. Implement them in the existing Supabase adapter. Add a focused native auth screen and wire it into the current signed-out branch. The existing observer and composition continue to own authentication transitions and authenticated routing.

This repairs the missing capability at its existing boundary, keeps provider SDK details out of UI, and preserves tested session restoration and sign-out behavior.

### Rejected: a second auth coordinator or state machine

A separate coordinator could isolate form logic, but would duplicate session ownership and require synchronizing another authenticated/signed-out state with the current controller and composition.

### Rejected: hosted/browser auth or a new auth UI package

A hosted flow would require redirect and deep-link behavior beyond the frozen email/password repair. A third-party UI package adds dependency and platform integration surface when the app already has a provider-neutral port and native form patterns. Neither is needed here.

## 6. Signed-out user flow

1. Startup continues to show the existing loading state while persisted-session restoration runs.
2. A restored session follows the current authenticated composition and routing without showing the auth form.
3. With no restored session, render a usable Turkish auth surface. Default to sign-in and provide an obvious action to switch to account creation.
4. Do not show authenticated navigation or farm data until the session observer reports an authenticated user.
5. If the auth service is unavailable, keep the farmer on the form, show safe retryable feedback, and retain the entered email.

## 7. Sign-in flow

Collect email and password. Validate required values locally, then call the controller's email/password sign-in operation. While pending, prevent repeated submissions and expose a busy state to assistive technology. On success, do not set authenticated state from the form response; wait for the existing Supabase auth observer. The composition then performs the normal onboarding-status request and opens first-field onboarding or the returning-user route.

Invalid credentials produce a generic, recoverable message that does not disclose whether the email is registered. Other provider or network failures produce safe retry guidance. Keep the email available for correction and retry.

## 8. Sign-up flow

Collect email and password. Do not ask for password confirmation. Perform only required-field and basic email-format validation; the provider remains authoritative for password acceptance. Call account creation through the existing adapter.

If the operation returns a session, Supabase session observation updates the existing controller and composition. Do not route based solely on the returned user object or fabricate a domain profile or membership.

## 9. Confirmation-required flow

Supabase signup behavior depends on project email-confirmation configuration. The JavaScript API documents that with email confirmation enabled, signup returns a user but a null session; when confirmation is disabled, it returns a session. Inspect the actual response rather than assume a dashboard setting. [Supabase JavaScript signUp](https://supabase.com/docs/reference/javascript/auth-signup), [Supabase password authentication](https://supabase.com/docs/guides/auth/passwords).

When signup returns no session, show a distinct confirmation-required state: tell the farmer to check the email and confirm the address, and offer a clear way back to sign-in. Do not enter the authenticated app. The email confirmation link is account verification, not a separate passwordless sign-in feature. After confirmation, the farmer can return to the app and sign in with email and password; no deep-link callback is added here.

Use generic copy that does not reveal whether an address already belongs to an account. Clear the password when moving to the confirmation-required state.

## 10. AuthPort, controller, and adapter changes

Extend, rather than replace, the current provider-neutral boundary:

- **MobileAuthPort** gains email/password sign-in and sign-up operations.
- Sign-up returns a narrow provider-neutral outcome indicating whether a session was returned or confirmation is required. It must not return provider SDK objects or tokens to the UI.
- **MobileAuthController** exposes those actions while continuing to own existing session and API-client behavior.
- **createSupabaseAuthPort** implements them with Supabase **signInWithPassword** and **signUp**, maps provider results to the narrow contract, and normalizes errors into safe app-level categories.
- The signed-out UI receives callbacks through current app composition. It does not import or instantiate Supabase directly.

Exact exported type names can be settled during implementation without changing these behavioral boundaries.

## 11. Observer-driven state transition model

The existing **MobileAuthState** remains the only application-level authentication state:

- Startup begins in **loading**.
- A restored or newly observed Supabase session produces **authenticated**.
- No restored session, sign-out, or observed session loss produces **signed-out**.
- Sign-in/signup operation success does not manually assign this state.

The auth screen may hold form-local presentation state—mode, field values, submission, validation/error feedback, and confirmation-required presentation. This is not an alternate session model. When **onAuthStateChange** publishes an authenticated state, the existing composition takes over and the normal app render removes the signed-out screen.

## 12. UI/UX structure

This is an Operate surface: the farmer needs to enter credentials and continue. Keep the native screen quiet, task-focused, and consistent with existing Ekim Hasat forms. Use a single-column, scrollable form with the product name, a clear mode heading, labelled email and password inputs, one primary submit action, and one low-emphasis action to switch modes. Confirmation-required is a simple status view, not a marketing or onboarding page.

Existing screens use React Native **TextInput**, **Pressable**, inline status/error text, and a restrained green primary action. Use platform-native controls and preserve the established Turkish farmer-facing voice. Do not add a password reveal control or navigation framework in this repair.

## 13. Validation and error model

- Email is required, outer whitespace may be trimmed, and plainly malformed input is rejected before provider calls.
- Password is required and passed exactly as entered; do not trim or persist it.
- Do not add password-strength rules, password confirmation, a password reveal control, or account/profile fields.
- Guard submission with both a disabled/busy control and an in-flight check.
- Map known invalid-credential outcomes to generic “check your email or password” copy. Map network/provider failures to safe retry messages. Never render raw provider messages, codes, stack traces, or token data.
- Preserve email across retryable errors. Clear password after success/unmount and when entering confirmation-required state.
- Signup without a session is a confirmation outcome, not authenticated success.

## 14. Accessibility requirements

- Give email, password, mode-switch actions, and submit controls meaningful Turkish labels and roles.
- Use the email keyboard and disable email auto-capitalization. Set useful focus progression and submit from the password keyboard.
- Keep the form keyboard-safe and scrollable so controls remain reachable on compact screens with the keyboard open.
- Announce submission progress politely and errors/confirmation as accessible status or alert content; do not rely on color alone.
- Expose disabled/busy state and prevent duplicate taps.
- Preserve scalable text, sufficient contrast, platform-native focus behavior, and touch targets of at least 48 dp on Android.

## 15. Security boundary

- Mobile uses only the existing public Supabase URL and publishable/anon key. No service-role or server-only credential enters the client bundle.
- Email/password is sent to Supabase Auth through the adapter; never send passwords to the Ekim Hasat API or write them to storage/logs.
- Existing Supabase session persistence and token refresh remain. API requests continue using the current bearer token.
- The API verifies the token and remains authoritative for ApplicationUser resolution, Membership, Business scope, and domain access.
- A Supabase user/session alone does not imply OWNER membership or any business permission. No client-selected Business or Membership is introduced.

## 16. Supabase signup/session semantics

Use the installed Supabase JS v2 API and branch on the actual signup response. A returned session means the observer should transition the controller to authenticated. A null session means the app remains signed out and presents confirmation-required feedback. Do not infer confirmation state from deployment configuration or user metadata.

Email confirmation handling requires no magic-link sign-in, OAuth callback, or URL session detection. The adapter's existing **detectSessionInUrl: false** behavior remains unchanged. After confirming the address, the farmer returns to the app and uses email/password sign-in.

## 17. Test strategy

The later implementation plan must require strict TDD: write a failing behavior test, verify the expected failure, implement the smallest passing change, then refactor only when justified.

Extend current auth tests instead of replacing them:

- Controller tests: sign-in/signup delegation, observer-driven authenticated state, no direct state mutation from actions, and preservation of restore/sign-out behavior.
- Supabase adapter tests: correct **signInWithPassword**/**signUp** arguments, safe mapping for signup with a session and without a session, error normalization, and unchanged persistence/refresh/observer/disposal behavior. Use the existing injected-client seam to test the adapter contract; do not treat a fake SDK call as hosted Supabase runtime proof.
- Auth-screen tests: signed-out actions, validation, pending/double-submit guard, safe errors, retained email, confirmation-required state and return-to-sign-in, and accessibility roles/status.
- App/composition tests: observed sign-in and immediate-session signup follow existing status routing; no-session signup stays signed out.
- Preserve existing API auth and tenant/business-authorization coverage. Authentication must not weaken server authority.
- Runtime acceptance requires a real configured Supabase account and physical Android/Expo flow when available. Record whether the tested project returns a session or requires confirmation. Component tests alone are not runtime PASS.

## 18. Runtime acceptance target

The repair is operationally proven only when a fresh signed-out mobile install can:

1. Open the auth screen.
2. Sign in with an existing email/password account or create one.
3. Establish a real Supabase session, or show confirmation-required when signup returns no session.
4. On authenticated session, enter the existing onboarding-status flow.
5. Reach first-field onboarding for a new application user.

If runtime networking, confirmation email delivery, platform configuration, or device availability blocks this sequence, report the exact blocker and leave the affected step unverified.

## 19. Artifact reconciliation strategy

The repair must reconcile lower-level implementation artifacts transparently:

1. Keep the PRD and existing SPEC-001 sign-up/sign-in requirements authoritative; do not weaken them.
2. Clarify the frozen email/password V1 method and both signup session outcomes in the relevant SPEC-001 authentication requirement/acceptance text.
3. Correct the SPEC-001 plan's claim that T051 excludes sign-in UI/method selection.
4. Preserve T051's completed session-bootstrap work, remove its erroneous prohibition, and append a bounded unchecked repair task for sign-in/sign-up actions, UI, and coverage.
5. Update the SPEC-001 quickstart with user-accessible sign-up/sign-in, email-confirmation scenarios, and runtime evidence.
6. Record the selected V1 method against ADR-006's existing Supabase decision without revisiting provider choice or unrelated identity options.

The implementation phase should make only those relevant artifact edits. It must not rewrite unrelated historical SPEC-001 decisions. This design records that the lower-level conflict existed and that implementation followed it; it does not conceal or retroactively alter that history.

## 20. Explicit exclusions

This repair does not add password reset/forgot password, magic-link sign-in, phone/SMS OTP, OAuth/social login, MFA, passkeys, invitations, anonymous auth, admin-created accounts, web auth, provider migration, a custom auth backend, generic account/profile management, or new onboarding scope.

## 21. Design-to-implementation lifecycle

The user approved this written design on 2026-10-07. The separate implementation plan has been reviewed and approved; implementation follows that plan with strict TDD, Impeccable shape/craft, critique/audit/polish, whole-repair review, and SPEC-001 convergence. This status correction records approval and does not change the design decisions.
