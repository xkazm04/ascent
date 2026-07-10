# Roadmap & Recommendation Tracking — bug-hunter + ui-perfectionist scan

> Context: Roadmap & Recommendation Tracking (group: Reporting & Visualization)
> Files scanned: 8 (scoped `RoadmapPanel.tsx` does not exist in the tree; the sandbox lives in RoadmapSandbox.tsx / RoadmapSandboxParts.tsx)
> Total: 6 findings (Critical: 0, High: 1, Medium: 1, Low: 4)
>
> VERIFIED-CORRECT (brief asked me to confirm): (1) the `[id]` PATCH **IDOR is closed** — the owning org is resolved from the row (`getRecommendationOrgSlug`, scans-recommendations.ts:152) and gated by `requireOrgAccess` on the ACTIVE path (`authGateEnabled`→`viewerOrgRole`), plus a PUBLIC_ORG 403 (route.ts:44). (2) The `/events` GET IDOR is likewise closed via `requireOrgRead`→`canReadOrg` (events/route.ts:25-28). (3) The 409/`REC_CONFLICT` optimistic lock is real and per-field-scoped (scans-recommendations.ts:102-124), holds under Read-Committed, and the UI recovers cleanly from a 409 (rollback→`refreshRow`→Retry rebases on fresh state). Concurrent edits to *different* fields correctly don't conflict → no lost update.

## 1. Timeline + audit actor is resolved from the DORMANT session, stamping every human edit as "system"
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: silent-failure
- **File**: src/app/api/recommendations/[id]/route.ts:53
- **Scenario**: Any signed-in member changes a recommendation's status/assignee/due-date under the Supabase login wall (the active auth mode). Line 53 does `const session = isAuthConfigured() ? await getSession() : null;` then passes `actor: session?.login ?? null` (line 107).
- **Root cause**: `getSession()`/`isAuthConfigured()` are the DORMANT custom-GitHub-OAuth stack — the `ascent_session` cookie is never minted by the Supabase flow, so `getSession()` returns null. The false assumption is "the signed-in user is reachable via getSession()." The tenant GATE correctly uses the active wall, but actor resolution does not.
- **Impact**: Every `RecommendationEvent.actor` and every `auditLog` "recommendation.updated" row (scans-recommendations.ts:76,133) is written with `actor: null`, rendering as "system" in the timeline. The compliance/audit product — the exact reason the audit row was moved in-transaction — records no human attribution for any change. Silent, always-on, affects all real users.
- **Fix sketch**: Use the cross-stack resolver the sibling routes already use: `import { resolveViewerLogin } from "@/lib/access"` and `const actor = await resolveViewerLogin();` (see org/memory + org/decision routes). Drop the `isAuthConfigured()`/`getSession()` line.

## 2. Status `<select>` is disabled while focused on every save, dropping keyboard/SR focus to `<body>`
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: focus-management
- **File**: src/components/report/RecommendationTracker.tsx:189
- **Scenario**: A keyboard or screen-reader user changes a row's status. `onChange`→`setStatus` runs `setSaving(id, true)` (line 101) synchronously, re-rendering the same `<select>` with `disabled={saving}` (line 189). A focused element that becomes `disabled` is blurred by the browser; when the PATCH resolves, `setSaving(id, false)` (line 143) re-enables it but never restores focus.
- **Root cause**: Disabling the focused control is used as the double-submit guard. Rows are keyed by stable `id` so they do NOT remount (that part is correct), but disable-while-focused produces the same "lost my place" symptom the brief flags.
- **Impact**: After every status edit the user's focus jumps to the page top; keyboard users must re-navigate the list, SR users lose context. Recurs on 100% of edits.
- **Fix sketch**: Keep the select enabled and ignore changes while `saving` (early-return in `setStatus` if `savingIds.has(id)`), relying on the existing `aria-busy` row + spinner; or capture the active element and `.focus()` it in the `finally` after re-enable.

## 3. Sandbox live region re-announces the projected score on every slider step, flooding assistive tech
- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: accessibility
- **File**: src/components/report/RoadmapSandbox.tsx:92
- **Scenario**: A screen-reader user arrows a dimension slider from 40→80. Each integer step fires `onChange`→`setOverrides`→re-render, changing the `role="status" aria-live="polite"` string (line 93) 40 times. The native `<input type=range>` already announces its own value via `aria-valuetext` (RoadmapSandboxParts.tsx:77), so the user hears the slider value AND a full "Projected score N of 100, level …" sentence on every step.
- **Root cause**: The polite region mirrors continuously-changing derived state with no debounce/throttle, assuming announcements are occasional.
- **Impact**: AT users get a flood of duplicated queued announcements during normal exploration, drowning the signal.
- **Fix sketch**: Debounce the announcement string (e.g. update it ~500ms after the last change) or only announce on slider change-end (`onPointerUp`/`onBlur`), not on every `onChange`.

## 4. Long recommendation title has neither `truncate` nor `min-w-0`
- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: visual-consistency
- **File**: src/components/report/RecommendationTracker.tsx:180
- **Scenario**: A recommendation with a very long or unbroken title renders in an `<h3>` that sits in a `flex flex-wrap items-center justify-between` row beside the status control, with no `min-w-0`/`truncate`/`max-w` constraint. The title grows and reflows the status `<select>` onto its own line (and an unbroken token can overflow), unlike the sandbox's own sliders/simulators which DO pair `min-w-0` + `truncate` (RoadmapSandboxParts.tsx:44,46,263).
- **Root cause**: Assumption that titles are short; the row's truncation contract is inconsistent with the sibling components.
- **Impact**: Crowded/ragged rows on narrow viewports for long titles; minor.
- **Fix sketch**: Wrap the title in a `min-w-0` flex child and add `truncate` (with a `title={item.title}` tooltip), matching RoadmapSimulators.

## 5. `refreshRow` re-seeds from the LATEST scan, silently no-op'ing when viewing a historical report
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: edge-case
- **File**: src/components/report/RecommendationTracker.tsx:80
- **Scenario**: After a 409, `refreshRow` GETs `/api/recommendations?repo=…` (line 82), which returns the repo's **most recent** scan, then `data.items.find(i => i.id === id)` (line 85). Recommendation ids are per-scan, so when the report being viewed is not the newest scan (or a re-scan landed since load), `fresh` is `undefined` and the row is never re-seeded.
- **Root cause**: Assumes the displayed report is always the latest scan; the list endpoint is scan-latest, not id-addressable.
- **Impact**: On those reports the post-409 re-seed silently does nothing; the row keeps its rolled-back value and Retry re-submits the same stale pre-image (which just conflicts again). Narrow (needs a stale-scan view + a concurrent status edit).
- **Fix sketch**: Add a `GET /api/recommendations/[id]` single-row endpoint (org-gated like the PATCH) and have `refreshRow` read that, or key the list refetch by `scanId`.

## 6. Roadmap "Applied ✓" tracks the dimension, not the item — false positives + coupled items
- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: state-modeling
- **File**: src/components/report/RoadmapSandboxParts.tsx:251
- **Scenario**: `const applied = (overrides[item.dimension] ?? -1) === 100;` derives the button state purely from the dimension's slider value. Dragging any dimension's slider to exactly 100 by hand flips its roadmap item(s) to "Applied ✓" though the user never clicked "Try it"; and if two roadmap items share a dimension, clicking "Try it" on one marks BOTH applied (and `onTry` couples them, line 181/273).
- **Root cause**: Per-item intent is inferred from shared per-dimension state; assumes one item per dimension and that reaching 100 implies "I tried this item."
- **Impact**: Misleading affordance state; minor confusion in the what-if sandbox.
- **Fix sketch**: Track which items were explicitly "tried" in a `Set<itemIndex>` separate from the slider override, and derive `applied` from that.
