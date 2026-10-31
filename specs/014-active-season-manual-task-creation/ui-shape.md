# SPEC-014 UI Shape — Approved

**Status:** Approved by user. Scope and behavior remain governed by the SPEC-014 specification and plan.

## Entry and context

The primary **Görev ekle** action appears in the selected Field / eligible ACTIVE Season context, for OWNER only. A secondary convenience entry from **Bugün** may be offered only when the target Field and Season are already explicit. SPEC-014 adds no Calendar creation entry and does not redesign navigation. Keep the selected Field and Season visible throughout the flow.

## Creation

Use the existing mobile visual language and native interaction conventions. Present **Görev adı** and **Görev tarihi** as required, with an optional **Açıklama**. Keep the action focused and show validation next to the relevant field. A date before planting shows “Görev tarihi ekim tarihinden önce olamaz.” After authoritative acceptance, show “Görev eklendi”; the accepted task follows existing Bugün, Calendar and task-action rules.

## Pending and recovery

Show locally saved pending submissions in their Field/Season context, visually and textually distinct from accepted tasks. After restart, the original account can see the retained record. “Cihazda kaydedildi, gönderilmeyi bekliyor” describes pending; an uncertain network result says “Gönderim sonucu henüz doğrulanamadı” and never implies acceptance or definitive rejection.

A definitive rejection remains visible with an understandable reason and explicit options to retry unchanged, create a corrected new submission, or remove only the rejected local record after confirmation. Clearly label local removal so it cannot be mistaken for deleting an accepted task. An unconfirmed or in-flight outcome cannot use rejected-only removal. If the season becomes ineligible before first acceptance, explain that the task could not be added and preserve the rejected record only when rejection is definitive. If an earlier delivery may have committed, retain the unconfirmed state until authoritative evidence resolves it; do not offer rejected-only removal. The existing authorization and account-isolation rules apply.

## Accessibility and reuse

Reuse the task inputs and validation language in the season setup flow, the local-save/status patterns in offline observations, and Bugün’s retry/status affordances. Announce status changes accessibly; use text as well as color, accessible control labels, comfortable touch targets, scalable type and native back/keyboard behavior. Do not expose sync or authorization implementation terms to farmers. No accepted-task title/description editing, accepted-task deletion, generic sync UI, or broader navigation redesign is introduced.
