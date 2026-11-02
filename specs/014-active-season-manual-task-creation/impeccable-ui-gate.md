# SPEC-014 Impeccable UI gate

- Invoked repository Impeccable v4.5.0 context for `apps/mobile/src/features/tasks/manual-task-create-screen.tsx` and read critique, audit, native audit, polish and craft-floor guidance.
- Critique: inline and single-context because the user explicitly prohibited subagents; this is a degraded critique, not the independent two-assessment workflow. Source inspection and a targeted `impeccable detect --json` scan were used; the detector reported `[]`.
- Native audit: source-level review of the Field/Season entry and task form, states, recovery and accessibility. Today has no creation shortcut, which the approved shape makes optional. No Calendar creation entry was introduced.
- Polish: applied the narrow recovery fix below. Native rendering and interaction verification could not be performed: neither `adb` nor `xcrun` is available. Consequently full native audit/polish verification remains incomplete.
- Findings: one important recovery issue fixed: a context-load error instructed retry but offered no retry action. A retry control now reloads context; focused screen test observed RED then GREEN (8/8). No critical findings. No additional confirmed minor findings; native keyboard, screen-reader, contrast, and device-size behavior remain unverified rather than assumed passing.
