# Ekim Hasat — Product Requirements Document (PRD)

**Document status:** Approved product baseline for MVP planning  
**Audience:** Product, Design, Engineering, Codex/spec-kit implementation workflow  
**Document role:** Product source of truth  
**Technical implementation:** Intentionally technology-independent; implementation details belong in `ARCHITECTURE.md`

---

## 1. Product Summary

**Ekim Hasat** is a mobile-first agricultural planning and field-work application designed primarily for farmers in Türkiye.

The product helps a farmer answer a small set of practical questions every day:

- What do I need to do today?
- Which field does it belong to?
- Has weather changed the plan?
- What did I actually do?
- Is there anything in the field that needs checking?
- What did this season cost?
- What did I harvest and sell?

The application may contain complex scheduling, weather, satellite, risk, synchronization, permissions, content/versioning, and business rules behind the scenes, but this complexity must not be pushed onto the farmer.

The product must be fully usable by a single farmer without requiring an administrator, advisor, employee, agronomist, or desktop computer.

---

# 2. Product Vision

Create a farming application that is simple enough to become part of a farmer's daily routine, while remaining structurally capable of supporting larger farms, employees, advisors, weather-aware planning, satellite signals, historical analysis, and AI-assisted workflows over time.

The intended experience is:

> Open the app → see today's work → complete the work → record what happened → continue farming.

The application should feel like a practical field tool, not an enterprise management system.

---

# 3. Product Principles

## 3.1 Farmer Simplicity Principle

A feature may be complex internally, but the farmer should only be asked for decisions that are genuinely necessary.

If the system can make a safe and reasonable default choice, it should do so.

Advanced settings must remain hidden until relevant.

---

## 3.2 Self-Service Farmer Principle

A farmer must be able to:

1. Create an account.
2. Add a field.
3. Select a crop.
4. enter a sowing/planting date.
5. Generate a season plan.
6. Start working.

No external administrator or advisor may be required.

---

## 3.3 Mobile Completeness Principle

The farmer must be able to perform all essential farming workflows on mobile.

The web application is an optional productivity surface for:

- larger-screen planning,
- bulk operations,
- analysis,
- reporting,
- administration.

Web must never be mandatory for core use.

---

## 3.4 Progressive Disclosure

The application starts simple.

Features become visible only when they become relevant.

Examples:

- No employee → no team-management complexity.
- No advisor → no advisor permission screens.
- No second business → no business switcher.
- No verified polygon → no satellite analysis controls.
- No cost records → no detailed profitability UI.
- No automation enabled → no automation tuning UI.

There is no separate “Simple Mode” and “Professional Mode”.

---

## 3.5 Graceful Degradation

External intelligence must improve the product, not become a single point of failure.

If a service is unavailable:

- AI unavailable → manual workflows continue.
- Weather unavailable → last known forecast may be shown with freshness warning.
- Satellite unavailable → last valid analysis may be shown.
- CMS unavailable → existing season and task data remain usable.
- Internet unavailable → supported offline field workflows continue.

Old or unavailable data must never be presented as current.

---

## 3.6 Human Control

The default behavior for plan-changing recommendations is:

> Recommend the change and ask the farmer to approve it.

The application may support more automation later or per user preference, but must not silently change important farming plans by default.

---

## 3.7 Trust Over Feature Volume

The system must not pretend to know more than it knows.

Examples:

- estimated crop stage must be marked as estimated;
- stale weather data must show its age;
- poor-quality satellite data must be identified;
- a risk signal is not a diagnosis;
- agronomic guidance should expose its basis when appropriate.

---

# 4. Primary Users

## 4.1 Primary Persona — Farmer / Farm Owner

The primary user manages one or more fields and performs or coordinates agricultural work.

Typical needs:

- know today's work,
- plan the crop season,
- record completed operations,
- react to weather,
- record field observations,
- track basic expenses,
- record harvest and sales,
- use the product from a phone.

The product must work even if this is the only user.

---

## 4.2 Secondary Persona — Farm Worker

A worker may receive tasks and record completion.

Depending on permission level, the worker may see:

- only assigned tasks,
- assigned fields,
- all field operations.

The worker must not automatically gain access to management or financial data.

---

## 4.3 Secondary Persona — Advisor

An advisor may be invited to specific fields or seasons.

MVP advisor access may include:

- field information,
- season information,
- field diary,
- observations,
- risks/alerts,
- comments/notes.

Advanced advisor portfolio management is not MVP.

---

## 4.4 Platform Content Administrator

This is not the farmer's manager.

The platform administrator manages centralized agricultural content and rules such as:

- crops,
- varieties,
- growth stages,
- seasonal templates,
- regional templates,
- task types,
- weather rules,
- risk rules,
- agricultural guides.

The existence of this role must not make normal farmer usage dependent on manual administrator actions.

---

# 5. Account, Business and Role Model

## 5.1 Account Model

A user has a single account and may participate in multiple businesses.

The same user may be:

- Owner in Business A,
- Worker in Business B,
- Advisor in Business C.

Separate accounts must not be required.

---

## 5.2 Default Business Creation

The onboarding flow must not begin with:

> Create organization / Create business / Create tenant.

Instead, the farmer should see:

> Add your first field.

The system may automatically create a default business in the background.

The business concept should surface only when needed.

---

## 5.3 Business Isolation

Business data must remain isolated between businesses.

Membership in one business must not grant visibility into another.

---

## 5.4 Access Revocation

When a worker or advisor leaves:

- future access is removed,
- historical actions remain attached to the business and season,
- historical records may still identify the user who performed the action,
- access revocation must not erase past operational history.

---

## 5.5 Offline Access Lease

Offline access to business data is permission-controlled and time-limited.

Behavior:

1. A successful online authorization check renews offline access validity.
2. Different roles and data sensitivity may use different validity periods.
3. Once the offline validity window expires, sensitive business data is locked until authorization is revalidated.
4. If access has been revoked, local data for that business must be securely cleared on reconnection.

Exact durations belong in technical/security design.

---

# 6. Core Information Architecture

Recommended mobile navigation:

1. **Bugün**
2. **Takvim**
3. **Tarlalar**
4. **+**
5. **Daha Fazla**

The application's conceptual center is **Bugün**.

The product is not analytics-dashboard-first.

---

# 7. Primary User Journey

## 7.1 First-Time Experience

The first-use journey should require the least possible information.

Recommended flow:

1. Sign up / sign in.
2. Add first field.
3. Select crop.
4. Enter sowing or planting date.
5. Review generated season plan.
6. Activate season.
7. Land on Bugün.

Additional data such as:

- variety,
- exact area,
- irrigation type,
- soil details,
- field polygon,
- equipment,

may be requested contextually later.

---

# 8. Field Management

## 8.1 Field Creation

A field may initially be created using:

- current location,
- a point on the map,
- manually drawn polygon.

A verified polygon is not mandatory for basic use.

---

## 8.2 Point-Only Field

A point-only field is sufficient for:

- tasks,
- weather,
- season planning,
- regional determination,
- field diary.

A verified polygon is required for:

- satellite-derived field analysis,
- NDVI-based analysis,
- geometry-dependent spatial analytics.

The system must never fabricate an approximate polygon and treat it as a real verified boundary.

---

## 8.3 Field Sections

A field may optionally contain sub-parcels / sections.

This is an advanced capability and must not be forced on normal onboarding.

---

## 8.4 Administrative Location vs Agricultural Region

The product must treat these as separate concepts.

Examples:

- administrative location: province / district,
- agricultural region: production zone / agricultural region / basin.

Both may be automatically detected.

Manual override is allowed.

A user-selected manual region must not be silently overwritten.

---

## 8.5 Historical Field Snapshot

When a season begins, the season should retain a snapshot of relevant context, such as:

- field boundary version,
- area,
- administrative location,
- agricultural region,
- season template version,
- applicable rules.

Later edits to the current field must not rewrite history.

Historical reanalysis may be supported as a separate derived view.

---

# 9. Crop and Season Model

## 9.1 Crop Catalog

The product supports:

- centrally maintained crops,
- centrally maintained validated templates,
- custom crops entered by users.

The initial validated template catalog should be intentionally limited rather than superficial.

Candidate pilot crops:

- wheat,
- maize,
- tomato,
- olive,
- grape.

Final pilot crop set may be adjusted before release.

---

## 9.2 Unsupported Crop

If no validated central season template exists:

- the farmer may still create the crop,
- the farmer may build a personal or business season plan,
- that plan may be reused,
- it must not be labeled expert-approved unless centrally reviewed.

---

## 9.3 Season Creation

Recommended minimum inputs:

- crop,
- field or field section,
- sowing/planting date.

Planted area may be included where available.

Optional inputs:

- variety,
- planting method,
- notes,
- photo.

---

## 9.4 Pre-Sowing Planning

The application may support a planned season before actual sowing.

It may show:

- recommended sowing window,
- preparation tasks,
- pre-sowing activities.

Once the actual sowing date is recorded, stage and task dates are recalculated.

A recommended window must not be presented as a mandatory agronomic command.

---

## 9.5 Seasonal and Perennial Crops

The data model must support:

### Seasonal crop
One crop cycle represented as a season.

### Perennial crop
The crop persists between years while production / maintenance seasons repeat.

Examples:

- olive,
- grape,
- orchard crops.

Greenhouse production may support multiple cycles per year, but advanced greenhouse management is not MVP.

---

## 9.6 Intercropping

The data model may support:

- primary crop,
- optional secondary crop,

within the same physical area.

Each crop may maintain separate:

- stages,
- tasks,
- harvest records.

Shared operations may reference both.

Automatic cost allocation across crops is not MVP.

---

# 10. Season Plan Generation

## 10.1 Plan Inputs

A generated plan may use:

1. base crop template,
2. agricultural region,
3. variety when available,
4. sowing/planting date,
5. current weather conditions,
6. actual or estimated crop stage.

---

## 10.2 Plan Preview

Before activation, the farmer must be able to review the proposed season plan.

The farmer may:

- remove tasks,
- edit tasks,
- change dates,
- approve the plan.

---

## 10.3 Previous Season Reuse

When creating a new season, the system may compare:

- current central template,
- user's previous season plan.

The farmer may choose to:

- use current template,
- copy previous plan,
- combine them.

Completed historical operations must not be copied as completed records.

Only planning logic is reused.

---

## 10.4 Learned Personal Preferences

The system may later learn repeated planning preferences.

Personal adaptations must remain separate from the central template.

At season creation, the system may offer:

- apply,
- review,
- skip.

Personal adaptations must never silently alter the central template or other farmers' plans.

---

# 11. Growth Stage Model

The system uses a hybrid model:

- estimated dates,
- phenological stages.

The system may estimate current stage.

The farmer may correct the stage.

Later, weather and satellite signals may improve estimation.

If stage changes materially affect the plan, the system should propose affected task changes for review.

---

# 12. Task Model

## 12.1 Task Sources

Tasks may originate from:

- central season template,
- user's manual entry,
- copied personal plan,
- system-generated suggestion,
- field observation,
- risk signal.

System detections should normally become **suggestions** before becoming confirmed tasks.

---

## 12.2 Task Completion

A task must support one-tap completion.

Optional completion details may include:

- actual date/time,
- note,
- photo,
- material/input,
- amount.

The basic completion action must remain fast.

---

## 12.3 Overdue Tasks

An overdue task remains visible.

Recommended actions:

- Do today,
- Postpone,
- Skip.

The application should retain:

- planned date,
- actual date.

---

## 12.4 Recurring Tasks

Recurring tasks may support adaptive recurrence.

Repeat schedules may be influenced by:

- weather,
- crop stage,
- field conditions.

The same approval/automation policy applies.

---

## 12.5 Task Policy Types

Each task may have a policy:

- **Flexible**
- **Weather-sensitive**
- **Fixed deadline**
- **Emergency**

Template defaults may define the initial policy.

The farmer may change it where permitted.

Fixed-deadline and emergency tasks must not be silently auto-rescheduled.

---

# 13. Plan Change Decision Engine

All task-changing signals must pass through a centralized evaluation model.

Potential inputs:

- weather,
- crop stage,
- recurring schedule,
- confirmed risk,
- manual user decision,
- central template,
- personal preference.

---

## 13.1 Precedence

The precedence hierarchy is:

1. Critical safety / fixed deadline
2. Explicit user decision for current season
3. Current season conditions  
   - weather  
   - confirmed risk  
   - actual growth stage
4. Central / regional season template
5. Learned personal preferences
6. General defaults

Lower-priority rules must not silently override higher-priority decisions.

---

## 13.2 Default Weather Behavior

Default for a new user:

> Recommend and ask for approval.

Example:

> Rain is expected tomorrow.  
> We suggest moving spraying to Thursday.  
> **[Move] [Keep plan]**

The product may support:

- warn only,
- ask approval,
- auto-reschedule,

but advanced automation controls should remain hidden unless needed.

All automatic changes must be:

- visible,
- logged,
- reversible.

---

# 14. Bugün Screen

Bugün is the default daily operating surface.

It should prioritize action, not analytics.

Possible content:

- today's tasks,
- overdue tasks,
- critical weather alerts,
- field checks requested by risk signals,
- pending approvals,
- concise daily summary.

The screen may support configurable cards, but must begin with a strong default layout.

Users may later reorder or hide optional cards.

---

# 15. Calendar

The calendar must support:

- agenda/list view as default,
- monthly calendar view as secondary.

The agenda view should remain optimized for real work.

---

# 16. Quick Add

The `+` action should offer a small set of high-frequency actions.

Examples:

- add task,
- add field observation,
- add cost,
- add harvest,
- add irrigation,
- add note.

Natural-language entry may be added as a convenience layer.

Classic UI must remain available.

---

# 17. Natural Language and AI — MVP

AI is assistive, not foundational.

MVP AI may support:

- natural-language quick record,
- task summary,
- season summary,
- simple question answering from app data,
- controlled confirmation flows.

Low-risk records may be saved quickly.

Critical actions such as:

- spraying records,
- cost records,
- harvest records,
- schedule changes,

should use preview/confirmation where appropriate.

---

# 18. AI — Later Phases

Later capabilities may include:

- proactive assistant,
- agronomic explanations,
- broader knowledge retrieval,
- source-aware guidance,
- personalized insights,
- voice capture.

Long-term AI knowledge priority:

1. approved central content,
2. user's own farm history,
3. trusted external sources where necessary.

External guidance should expose:

- source,
- freshness,
- regional applicability,

when relevant.

The AI must not provide unsupported definitive disease diagnosis or autonomous chemical dosage prescription.

---

# 19. Voice

Voice entry is not required for MVP.

Phase 2 may add voice for:

- tasks,
- observations,
- costs,
- notes.

The product must remain fully usable without voice.

---

# 20. Field Observation

The farmer may create a structured field observation.

Possible fields:

- field / section,
- date,
- category,
- note,
- photo,
- severity or confidence where appropriate.

Later AI/photo analysis may assist.

Photo analysis must not be represented as definitive diagnosis.

---

# 21. Observation → Risk → Action

Field observations may contribute to risk evaluation together with:

- weather,
- crop stage,
- satellite signal.

Risk follow-up states may include:

- Confirmed,
- No issue,
- Check later.

A risk may generate:

- field-check task,
- follow-up task,
- linked observation.

The system should preserve the chain:

> Alert → Field check → Real finding → Action

---

# 22. Tarla Sağlığı / Risk — MVP

MVP field health is intentionally limited.

Inputs may include:

- weather risk,
- farmer observation,
- crop stage,
- limited Sentinel-2 NDVI change where a verified polygon exists.

Examples of weather risks:

- frost,
- heat,
- wind,
- heavy rain.

The system may generate a message such as:

> This field should be checked.

It must not present a risk signal as a confirmed disease diagnosis.

---

## 22.1 Satellite Quality

Satellite-derived analysis must account for:

- cloud coverage,
- invalid imagery,
- crop stage,
- freshness,
- field geometry.

If data quality is poor, the result must be withheld or clearly labeled.

---

## 22.2 Advanced Satellite Analytics — Post-MVP

Post-MVP may include:

- additional vegetation/spectral indices,
- grid anomaly analysis,
- detailed anomaly maps,
- time-series analysis,
- phenology benchmarking,
- advanced disease/pest risk models.

These should not clutter the farmer's primary mobile experience.

---

# 23. Weather

Weather should influence planning without silently taking control.

The system may:

- warn,
- recommend date changes,
- affect task suggestions,
- support irrigation decisions.

Weather data must display freshness when relevant.

A stale forecast must not appear current.

---

# 24. Irrigation

Irrigation should be modeled as a first-class operation.

Optional fields:

- irrigation method,
- duration,
- water volume,
- note.

Irrigation may participate in recurring plans.

Weather, rain, crop stage, and observations may influence irrigation suggestions.

IoT automation is not MVP.

---

# 25. Soil and Water Analysis

MVP may support optional structured records for soil or water analysis.

Users may also attach:

- report,
- image,
- document.

These values may later contribute to recommendations.

The system must not generate autonomous exact fertilizer or chemical prescriptions from these records in MVP.

---

# 26. Inputs

The product may contain:

- centralized input catalog,
- user-created custom inputs.

The catalog exists for consistent recording.

Being listed in the catalog must not imply recommendation.

MVP does not attempt to become full inventory management software.

---

# 27. Equipment

MVP may include a lightweight equipment list.

Examples:

- tractor,
- seeder,
- sprayer,
- irrigation equipment.

Equipment may be associated with tasks.

Maintenance, repair, depreciation, and full equipment fleet management are not MVP.

---

# 28. Costs

MVP includes simple cost tracking.

Suggested cost categories:

- seed / seedling,
- fertilizer,
- pesticide,
- fuel,
- labor,
- irrigation,
- other.

The product is not accounting software.

Out of scope for MVP:

- VAT accounting,
- invoicing,
- receivables,
- debt management,
- cash flow accounting.

---

# 29. Harvest and Sales

A season may contain multiple harvest records.

Each harvest may include:

- date,
- quantity,
- optional quality information.

A season may contain multiple sales records.

Each sale may include:

- buyer,
- quantity,
- unit price,
- total revenue where derivable.

---

## 29.1 Post-Harvest Status — MVP

Simple quantity/status tracking may include:

- stored,
- sold,
- internal use,
- waste,
- other.

A simple warehouse/storage name may be captured.

Advanced lot, batch movement, warehouse slip, shipment, and traceability workflows are post-MVP.

---

# 30. Profitability

MVP may calculate simple season profitability:

- total expense,
- total revenue,
- profit/loss,
- cost per decare,
- revenue per decare.

This is a farm-management summary, not an accounting statement.

---

# 31. Field Diary

The application should maintain a chronological field/season diary containing relevant events such as:

- completed tasks,
- observations,
- irrigation,
- costs,
- harvest,
- sales,
- alerts,
- comments,
- changes.

The diary should support understanding what actually happened during a season.

---

# 32. Historical Comparison

When at least two relevant seasons exist, the product may show basic comparisons such as:

- yield,
- cost per decare,
- revenue,
- irrigation frequency,
- task delays,
- harvest timing.

Advanced AI-driven multi-year interpretation is Phase 2+.

---

# 33. Rotation and Fallow

The system should retain crop rotation and fallow history.

MVP may record and display it.

Advanced rotation recommendations based on expert rules may come later.

---

# 34. Historical Data Entry

MVP:

- manual entry of previous seasons.

Phase 2:

- Excel/CSV import,
- column mapping,
- preview,
- unit validation,
- duplicate detection.

Complex import workflows should not burden initial onboarding.

---

# 35. Team

MVP supports a lightweight team model.

The owner may:

- invite a worker,
- assign tasks,
- control simple permission scope.

Suggested permission levels:

1. Assigned tasks only
2. Assigned fields
3. All field operations

Detailed enterprise RBAC is not required for MVP.

---

# 36. Completion Approval

Approval requirements may be enabled for selected task types.

A critical task may require:

- photo,
- note,
- supervisor approval.

Approval must be optional and contextual.

Single-farmer use must not require approvals.

---

# 37. Advisor

MVP advisor scope:

- invitation to specific field or season,
- read relevant history,
- view observations and risk,
- leave comments/notes.

Post-MVP:

- advisor task proposals,
- multi-farm advisor portfolio,
- advisor analytics dashboard.

---

# 38. Notifications

Notification quality is more important than notification quantity.

Default model:

### Daily summary
Example:

> Good morning — 4 tasks today  
> 1 overdue task • No rain risk

### Immediate push
Reserved for time-sensitive or high-importance events.

Example:

> Frost risk — Central Field  
> -2°C expected between 03:00–06:00.

The system should avoid repeated pushes for the same unchanged event.

A notification may repeat when:

- severity increases,
- conditions materially change,
- user action is now required.

Users may later adjust notification preferences.

---

# 39. Offline Operation

Core field workflows must continue offline.

Expected offline-capable operations:

- view synchronized tasks,
- complete tasks,
- add notes,
- capture photos for later upload,
- add manual tasks,
- view essential field/season data,
- add supported records.

Internet-dependent information should clearly display the last update time.

---

# 40. Offline Sync

Default policy:

> Auto-merge when safe, ask the user only when a real conflict exists.

Non-conflicting changes should merge automatically.

Conflicting edits should remain separately recoverable until resolved.

The system must never silently discard:

- completed operations,
- captured photos,
- field notes.

Detailed merge algorithms belong in `ARCHITECTURE.md`.

---

# 41. Auditability and Historical Integrity

Historical operational data must not be casually overwritten.

For important records such as:

- completed tasks,
- expenses,
- harvest,
- sales,
- observations,

the system should retain sufficient audit history when edited.

Possible audit attributes:

- previous value,
- new value,
- who changed it,
- when,
- optional reason.

---

# 42. Deletion

Deletion policy varies by record type.

### Draft / unlinked data
May be permanently deleted where appropriate.

### Realized operational records
Examples:

- completed operation,
- approved task,
- expense,
- harvest,
- sale.

These should normally be:

- cancelled,
- archived,
- voided,

rather than silently erased.

Reason may be stored.

Legal retention requirements are separate from product behavior and must be reviewed before production.

---

# 43. CMS / Central Content Management

A centralized content and rule management layer is required.

The PRD does not mandate a specific CMS implementation.

It must be able to manage:

- crops,
- varieties,
- crop growth stages,
- season templates,
- regional templates,
- task types,
- weather rules,
- risk rules,
- agricultural guides.

---

## 43.1 Versioning

Central templates and rules must be versioned.

An active season retains the version it started with.

If a new template version becomes available:

- normal changes may be offered as optional updates,
- critical safety information may be surfaced to current seasons.

User-customized tasks must not be silently overwritten.

---

## 43.2 Publishing Workflow — MVP

MVP may use a single administrator approval workflow.

However, content metadata should support:

- source,
- expert validation status,
- version,
- publication state.

Content must not be labeled validated if it was not validated.

---

# 44. Explainability

Recommendations should provide a short explanation by default.

A deeper “Why?” view may show contributing factors such as:

- weather,
- crop stage,
- regional rule,
- observation,
- satellite/risk signal,
- rule source/version.

The farmer should not need to inspect technical data to use the product.

---

# 45. Localization

Initial product focus:

- Türkiye,
- Turkish language,
- local agricultural context.

Architecture must remain capable of supporting:

- additional countries,
- languages,
- locale-specific date/time,
- currency,
- area units,
- yield units.

---

# 46. Authentication

The product should prioritize low-friction access.

Preferred identity options may include:

- phone number,
- email,
- Google,
- Apple where applicable.

The same account must work across mobile and web.

Exact authentication provider belongs in technical architecture.

---

# 47. Data Portability

Users must be able to export their data using reasonable standard formats.

The product should also support a full-account data export request.

Data portability must not be treated as a premium-only capability.

Deletion/export rules must distinguish:

- personal data,
- shared business records,
- historical operational records owned by a business.

---

# 48. Freemium Product Model

The product is intended to support a freemium model.

The free tier must remain genuinely useful.

Possible premium differentiators:

- advanced satellite analytics,
- high AI usage,
- larger teams,
- advanced reports,
- advisor/professional capabilities.

Exact commercial limits and pricing are outside this PRD.

Product architecture should support entitlement-based feature access.

---

# 49. Reporting — MVP

MVP includes standard reports with basic filters.

Possible filters:

- field,
- crop,
- season,
- date,
- task type.

Exports may include:

- PDF,
- Excel/CSV where appropriate.

A custom report designer is post-MVP.

---

# 50. Web vs Mobile

## Mobile
Primary operational tool.

Optimized for:

- field work,
- offline operation,
- quick completion,
- observations,
- photos,
- quick records,
- daily tasks.

## Web
Optional management surface.

Optimized for:

- planning,
- multi-field review,
- bulk editing,
- deeper reports,
- analysis,
- administration.

The two clients share the same business data but do not need identical screen designs.

---

# 51. MVP Scope

The MVP is a balanced operational release, not a prototype-only shell.

## 51.1 MVP Must Include

### Account and onboarding
- authentication,
- self-service onboarding,
- default business creation,
- first field creation.

### Fields
- field creation,
- point-based field,
- optional polygon,
- region detection,
- manual region override,
- field sections support at basic level.

### Crops and seasons
- crop catalog,
- custom crops,
- validated templates for selected pilot crops,
- season creation,
- pre-season planning,
- season plan preview,
- stage estimation/correction.

### Tasks
- generated tasks,
- manual tasks,
- quick completion,
- overdue handling,
- task policy types,
- recurring tasks at practical MVP level.

### Today and calendar
- Bugün screen,
- agenda calendar,
- monthly view.

### Weather
- weather display,
- weather-sensitive recommendations,
- default approval-based rescheduling,
- critical weather alerts.

### Offline
- offline task/field access,
- offline completion and notes,
- deferred photo upload,
- conflict-safe synchronization.

### Observations and risk
- field observation,
- simple risk cards,
- basic field-check workflow,
- weather risk,
- limited NDVI-change signal for verified polygon fields.

### Team
- worker invitation,
- basic assignment,
- simple permission scope,
- optional approval flow.

### Advisor
- basic field/season sharing,
- read-only operational context,
- comments/notes.

### Inputs and operations
- simple input catalog,
- irrigation records,
- lightweight equipment association,
- optional soil/water record.

### Finance and harvest
- simple cost tracking,
- multiple harvest entries,
- multiple sales,
- basic post-harvest quantity statuses,
- season profitability.

### History and reporting
- field diary,
- basic multi-season comparison,
- standard reports,
- PDF / suitable spreadsheet exports.

### Central content
- crop/template/rule CMS,
- versioned content,
- single-admin publishing workflow,
- source/validation metadata.

### Basic AI
- natural-language quick entry,
- basic summaries,
- simple Q&A over app data,
- confirmation for critical records.

---

# 52. Phase 2

Likely Phase 2 capabilities:

- voice-based data entry,
- Excel/CSV historical import,
- advanced satellite indices,
- detailed anomaly mapping,
- stronger multi-year analytics,
- personalized planning adaptations,
- more capable agronomic AI assistant,
- advanced risk explanations,
- advisor workspace,
- deeper soil/water interpretation,
- more greenhouse workflows,
- more intercropping workflows,
- richer report configuration.

---

# 53. Later / Out of Scope

Unless separately approved, the following are outside MVP:

- full accounting,
- invoicing/VAT,
- debt/receivable management,
- full warehouse management,
- lot/batch logistics,
- shipment management,
- full equipment maintenance system,
- IoT sensor automation,
- automated irrigation control,
- autonomous agronomic prescriptions,
- definitive disease diagnosis,
- chemical dose prescription,
- enterprise-level RBAC,
- advanced advisor portfolio management,
- custom report designer,
- high-complexity greenhouse ERP,
- autonomous replacement of farmer decisions.

---

# 54. UX Acceptance Principles

A feature is not complete merely because its backend exists.

Farmer-facing functionality must satisfy the following:

1. It has a sensible default.
2. It does not require unnecessary setup.
3. It can be understood without technical/agronomic software jargon.
4. It does not expose configuration that is irrelevant to the user.
5. It communicates uncertainty where present.
6. It does not silently modify critical user decisions.
7. It remains usable on mobile.
8. Core workflows remain usable under weak connectivity.

---

# 55. Core End-to-End Acceptance Scenario

The first vertical slice must prove the following flow:

1. User signs up.
2. System creates default business transparently.
3. User adds first field.
4. User selects crop.
5. User enters sowing/planting date.
6. System generates season plan.
7. User reviews and approves plan.
8. At least one task appears in Bugün.
9. User completes the task.
10. Completion appears in field/season history.

This flow must work before broad secondary features are considered mature.

---

# 56. Key Acceptance Criteria by Domain

## 56.1 Onboarding
- A first-time farmer can reach a usable season without configuring organization structure.
- Advanced settings are not shown during normal onboarding.
- The product can be used by one person indefinitely.

## 56.2 Field
- A field can be created without drawing a polygon.
- Satellite features remain unavailable until geometry requirements are satisfied.
- Manual region overrides persist.

## 56.3 Season
- The system shows a plan before activation.
- The farmer can edit the plan.
- Unsupported crops can still be used without pretending that a validated template exists.

## 56.4 Tasks
- Completing a normal task requires no more than a minimal action.
- Planned date and actual date remain distinguishable.
- Weather recommendations do not silently move tasks by default.

## 56.5 Offline
- Previously synchronized daily tasks remain available without internet.
- Offline completion is not lost.
- Conflicting changes are not silently overwritten.

## 56.6 Risk
- Risk messaging uses “check / possible risk / attention needed” language, not confirmed diagnosis language.
- A farmer can close the loop by recording what was actually found.

## 56.7 Finance
- A farmer can record a cost without using accounting concepts.
- Season expense, revenue, and simple profit/loss can be calculated.

## 56.8 Team
- A single farmer never needs to configure roles.
- A worker cannot automatically see financial/admin data.
- Historical contributions remain after membership ends.

---

# 57. Product Success Metrics

Early pilot success should focus on behavior rather than feature count.

Recommended metrics:

- time to first field,
- time to first active season,
- plan acceptance rate,
- plan modification rate,
- task completion rate,
- weekly return rate,
- percentage of active users using Bugün,
- weather recommendation usefulness,
- risk alert usefulness,
- onboarding drop-off point,
- percentage of users completing first season workflow,
- qualitative farmer feedback.

---

# 58. Pilot Strategy

Recommended staged pilot:

### Stage 1
5–10 farmers with different operating styles.

Goal:
- onboarding usability,
- daily task usability,
- field use,
- offline reliability,
- terminology validation.

### Stage 2
Broader real-season pilot.

Goal:
- sustained use,
- weather adaptation value,
- season completion,
- cost/harvest recording,
- risk usefulness,
- retention.

---

# 59. Feedback Model

The product should support:

- general feedback,
- contextual feedback on a task,
- recommendation feedback,
- weather recommendation feedback,
- risk alert feedback.

Feedback may have a visible status where appropriate.

Farmer feedback must not automatically rewrite central agronomic rules without review.

---

# 60. Suggested Feature Decomposition for spec-kit

The PRD should not be implemented as one giant specification.

Recommended feature boundaries:

## SPEC-001 — Authentication and Self-Service Onboarding
Includes:
- account creation,
- default business,
- first-run flow.

## SPEC-002 — Fields and Region Resolution
Includes:
- field creation,
- point/polygon,
- region detection,
- manual override,
- field sections.

## SPEC-003 — Crop Catalog and Season Creation
Includes:
- crops,
- custom crops,
- season creation,
- pre-sowing plan.

## SPEC-004 — Season Plan Engine
Includes:
- template resolution,
- plan preview,
- template versions,
- previous-plan reuse.

## SPEC-005 — Tasks, Today and Calendar
Includes:
- task lifecycle,
- completion,
- overdue,
- Bugün,
- agenda/month view.

## SPEC-006 — Weather-Aware Task Adjustment
Includes:
- weather rules,
- recommendations,
- approval flow,
- precedence.

## SPEC-007 — Offline Operation and Sync
Includes:
- local data,
- offline mutations,
- conflict handling,
- authorization lease.

## SPEC-008 — Field Observation and Diary
Includes:
- structured observations,
- photos,
- diary timeline.

## SPEC-009 — Field Health and Risk
Includes:
- weather risk,
- limited satellite signal,
- risk cards,
- field-check flow.

## SPEC-010 — Irrigation, Inputs and Equipment
Includes:
- irrigation,
- input records,
- lightweight equipment.

## SPEC-011 — Costs and Profitability
Includes:
- expense records,
- categories,
- profitability summary.

## SPEC-012 — Harvest, Sales and Post-Harvest
Includes:
- multiple harvests,
- sales,
- quantity disposition.

## SPEC-013 — Team and Permissions
Includes:
- invitations,
- assignments,
- basic role scope,
- access revocation.

## SPEC-014 — Advisor Sharing
Includes:
- scoped access,
- comments,
- history visibility.

## SPEC-015 — Notifications
Includes:
- daily summary,
- critical pushes,
- deduplication.

## SPEC-016 — CMS and Content Versioning
Includes:
- crop content,
- templates,
- rules,
- versions,
- publishing.

## SPEC-017 — Reporting and Data Export
Includes:
- standard reports,
- filters,
- PDF/spreadsheet export,
- full data export requirement.

## SPEC-018 — Basic AI Assistance
Includes:
- quick natural-language entry,
- summary,
- app-data Q&A,
- confirmation safety.

---

# 61. Recommended Initial Implementation Order

The first milestone should prove value end-to-end rather than complete horizontal infrastructure in isolation.

Recommended order:

1. Authentication + default business
2. Field creation
3. Crop selection
4. Season creation
5. Basic template-driven plan
6. Bugün
7. Task completion
8. Field diary
9. Weather display
10. Weather-based recommendation
11. Offline support for the core flow
12. Observations
13. Basic risk
14. Costs
15. Harvest/sales
16. Team
17. Reports
18. Advanced integrations

---

# 62. First Vertical Slice

The first production-quality vertical slice is:

> Sign up → Add field → Select crop → Enter sowing date → Generate plan → Approve plan → See task in Bugün → Complete task → See completion in history.

The first slice should include the real data model and real persistence boundaries required for future growth.

It should not be a disposable mock prototype.

---

# 63. Codex / spec-kit Implementation Guardrails

These are product constraints that later belong in `AGENTS.md` and feature specifications.

Codex must not:

- invent features outside approved scope,
- expose internal technical concepts in farmer UI,
- make desktop mandatory,
- make AI mandatory,
- silently overwrite farmer decisions,
- represent risk as confirmed diagnosis,
- present stale external data as current,
- silently lose offline actions,
- bypass business isolation,
- silently overwrite user-edited season tasks,
- treat unvalidated content as expert-approved,
- convert cancelled historical operations into deletion without explicit policy,
- add advanced configuration to onboarding without product approval.

A feature is complete only when:

- acceptance criteria pass,
- mobile flow is usable,
- failure/offline behavior is defined,
- data ownership is respected,
- history/audit expectations are met where relevant.

---

# 64. Source of Truth Hierarchy

For implementation work, use this hierarchy:

1. **PRD.md** — what the product must do
2. **ARCHITECTURE.md** — how the system is structured technically
3. **Feature spec** — detailed behavior and acceptance criteria for one feature
4. **Implementation plan/tasks** — engineering execution steps
5. **Code/tests** — implementation

If lower-level artifacts conflict with PRD, the conflict must be surfaced rather than silently resolved.

---

# 65. Open Technical Decisions for ARCHITECTURE.md

The following are intentionally not resolved in this PRD:

- exact web framework,
- exact mobile framework,
- database technology,
- authentication provider,
- CMS product,
- offline database,
- synchronization protocol,
- notification provider,
- satellite provider,
- weather provider,
- AI provider/model,
- background job infrastructure,
- file/object storage,
- observability stack,
- hosting/deployment platform,
- backup strategy,
- encryption implementation,
- exact offline authorization durations.

These will be decided in `ARCHITECTURE.md` while preserving this PRD's product behavior.

---

# 66. Definition of MVP Product

The MVP is successful when a real farmer can use the application for a real crop season without an administrator and without a desktop computer, and can reliably answer:

> What do I need to do today?  
> What changed?  
> What did I actually do?  
> Is there anything I need to check?  
> What did this season cost and produce?

Everything else exists to support those questions.

---

# 67. Final Product Statement

Ekim Hasat should hide technical and organizational complexity behind a simple field-first experience.

The farmer should not feel that they are operating:

- a workflow engine,
- a rules engine,
- a CMS,
- a GIS platform,
- a weather engine,
- a satellite analytics stack,
- an offline synchronization system,
- a multi-tenant SaaS product.

They should feel that they are using:

> **a farming assistant that tells them what needs attention and lets them record what they actually did.**
