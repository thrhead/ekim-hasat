# First field onboarding accessibility smoke check

**Status: NOT RUN — manual platform evidence required.**

No Android device/emulator or iOS simulator/device was available in the current
environment. This checklist is prepared for execution on real platform
accessibility services; it is not evidence that TalkBack or VoiceOver was run.

## Run record

Complete one record per platform after exercising the app:

| Field | Value |
|---|---|
| Platform and device | Not run |
| OS version | Not run |
| App build/revision | Not run |
| Tester and date | Not run |
| Accessibility service | TalkBack / VoiceOver — not run |
| Result | NOT RUN |
| Issues or evidence reference | Not run |

## Prerequisites

- Use a device with TalkBack (Android) or VoiceOver (iOS) enabled.
- Launch the production mobile app with a valid authenticated session whose
  onboarding status says a first field is needed. The test must reach onboarding
  through normal production composition.
- Have access to the onboarding API so the tester can cause a completion error
  and restore connectivity for retry.

## Manual checks

Record pass/fail and notes for each item on the platform under test.

1. **Entry and focus order**
   - While the saved session/status is resolving, confirm “Girişiniz kontrol
     ediliyor…” is announced as progress.
   - Cause a recoverable onboarding-status request failure. Confirm
     “Giriş yapılamadı. Yeniden deneyin.” is announced as an error and
     “Yeniden dene” is announced as a button. Activate it and confirm the
     progress announcement returns before the first-field screen opens.
   - Reach “İlk tarlanızı ekleyin” and confirm it is announced as a heading.
   - Move forward and backward through the screen. Confirm the order is
     understandable: field name, location choice, map and its actions, location
     selection status, then submit or any current error/retry control.
   - Confirm focus remains visible and does not become trapped in the map or
     disappear when switching location mode.
2. **Names, roles, and location choices**
   - Confirm the name input is announced as “Tarla adı (isteğe bağlı)” and can
     be focused, edited, and exited using the screen reader.
   - Confirm “Haritadan nokta seç” and “Tarla sınırı çiz” are announced as
     buttons and the currently selected mode is conveyed.
   - Confirm the map is announced as “Nokta seçmek için harita” in point mode
     and “Tarla sınırını çizmek için harita” in polygon mode.
   - Select a point and confirm the location status is announced. Switch to
     polygon mode, add the required vertices, finish drawing, and confirm the
     selected location status is announced.
   - Deny current-location permission if prompted. Confirm an alternate map
     selection remains usable and permission denial does not block onboarding.
3. **Text scaling and touch use**
   - Enable the largest practical system text size and return to onboarding.
     Confirm labels, controls, map actions, status and messages remain readable,
     reachable by scrolling, and not clipped or overlapped.
   - With touch exploration, confirm mode and submit/retry controls can be
     targeted and activated reliably without accidentally activating nearby
     controls.
4. **Submit, loading, failure, and retry**
   - Select a valid location and activate the submit button with the screen
     reader. Confirm “Tarla kaydediliyor…” is announced while the request is in
     progress and submit cannot be triggered repeatedly.
   - Cause the request to fail. Confirm “Tarla kaydedilemedi. Bağlantınızı
     kontrol edip yeniden deneyin.” is announced as an error and “Tekrar dene”
     is discoverable as a button.
   - Restore connectivity and activate retry. Confirm progress is announced
     again and no success is announced before the server accepts the request.
5. **Success**
   - Complete onboarding successfully. Confirm “Tarla kaydedildi”, the
     authoritative returned field name, and “Kaydedilme tarihi” are announced
     in a sensible order. If the field has an unverified polygon, confirm
     “Tarla sınırı henüz doğrulanmadı” is announced too.
   - Confirm focus can continue in the post-onboarding destination and the
     screen reader does not remain on the completed form.

## Evidence and completion

For each platform, replace its “Not run” values above with the actual device,
OS/build, tester/date, and observed result. Record concrete failures and the
steps needed to reproduce them. Mark T036 complete only after both VoiceOver on
iOS and TalkBack on Android have been exercised and their results recorded.

Current result: **TalkBack NOT VERIFIED; VoiceOver NOT VERIFIED; T036 remains
open.**
