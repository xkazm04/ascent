# Roadmap & Recommendation Tracking — bug-hunter + ui-perfectionist scan
> Total: 5 (Critical: 0, High: 2, Medium: 2, Low: 1)
> Lens split: bug-hunter 3 / ui-perfectionist 2
> Files read: 9

## 1. Any caller can mutate every "public"-org recommendation's status, assignee, due-date, and audit/event trail
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: Authorization / cross-tenant write (IDOR)
- **File**: src/app/api/recommendations/[id]/route.ts:38-41 (gate) via src/lib/authz.ts:41 (`if (slug === PUBLIC_ORG) return null;`)
- **Scenario**: Every anonymous / free-funnel scan is persisted under the shared `"public"` org (`readableOrgForOwner` returns `"public"` for any owner the session doesn't own — src/lib/auth.ts:332-336). The PATCH route resolves the owning org from the row and calls `requireOrgAccess(org)`. For `org === "public"`, `requireOrgAccess` short-circuits to `null` (allowed) at authz.ts:41. So User A scans `acme/widgets` publicly, User B (any signed-in user, or anyone at all when the Supabase wall is off) lifts/guesses the recommendation id and PATCHes its status to `dismissed`, reassigns it, or rewrites its target date — and the change is committed plus written to the recommendation's event timeline and the audit log attributed to B's login.
- **Root cause**: The write gate treats the shared `"public"` org as globally actable (intended for the free funnel's *own* scan flow), but recommendation tracking is per-scan team state. There is no per-row authorship/ownership check beyond "may act on this org," and "public" is everyone's org.
- **Impact**: Cross-user tampering of any public scan's tracked backlog and a poisoned, mis-attributed event/audit trail — exactly the integrity the in-transaction audit (scans-recommendations.ts:108-119) was added to guarantee. Reads are org-scoped, but the public org is shared, so this is a real write/integrity hole, not just noise.
- **Fix sketch**: Recommendation mutation is not part of the anonymous funnel — do not exempt `"public"` here. Either require an authenticated viewer for any PATCH regardless of org (drop the public short-circuit for this route), or gate public-org recs on the scan's creator/session identity. At minimum require a non-null `session.login` before allowing a mutation that is recorded as an actor.

## 2. A no-op status change reports success and announces a change that was never recorded
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: Event-trail integrity / silent no-op
- **File**: src/lib/db/scans-recommendations.ts:99-100 (`if (events.length === 0) return toPersistedRec(current);`) + src/app/api/recommendations/[id]/route.ts:97-98
- **Scenario**: PATCH with `status` equal to the current status (e.g. a double-click, a retry after the first attempt already landed, or two tabs racing). `updateRecommendation` finds nothing changed, writes no event and no audit row, and returns the unchanged row with HTTP 200. The tracker then runs the success branch and announces `"X" marked Done.` (RecommendationTracker.tsx:109) even though no transition or audit entry exists.
- **Root cause**: The no-op short-circuit is correct for the DB (don't write empty rows) but the route returns an indistinguishable 200, so the UI cannot tell "recorded" from "nothing happened." Combined with the optimistic update, the screen-reader announcement and progress bar imply a state transition that the timeline will not corroborate.
- **Impact**: Event-trail/UI divergence: the activity timeline silently omits transitions the user believes occurred; auditors see gaps. Low blast radius but directly undermines the "timeline can never disagree with current state" guarantee the module advertises.
- **Fix sketch**: Return a flag (e.g. `{ ...rec, changed: false }` or a 200 with `X-Rec-Changed: false`) so the client can suppress the "marked …" announcement on no-ops; or have the route detect equality and respond 200 with an explicit unchanged marker.

## 3. Retry/optimistic path can desync the `<select>` from server state on overlapping edits
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: Optimistic update / state consistency
- **File**: src/components/report/RecommendationTracker.tsx:75-120 (esp. 81-89, 104, 194)
- **Scenario**: The row-scoped rollback captures `priorStatus` at call time and, on failure, reverts only that field (good). But the controlled `<select value={item.status}>` (line 163-164) is not disabled during the brief optimistic window before `setSaving(id,true)` paints, and the Retry button (line 194) re-invokes `setStatus(id, err.status)` reading `err.status` — a value captured when the *first* attempt failed. If the user changes the select again before clicking Retry, Retry silently re-applies the stale `err.status` instead of the latest selection, and the optimistic write briefly shows the stale value, then snaps. There is no reconciliation against the server's returned row (the 200 body `updated` is discarded — line 109 ignores `res` JSON), so the displayed status is whatever the client last set, never the authoritative persisted value.
- **Root cause**: Optimistic state is the source of truth; the successful response body is never merged back, and Retry replays a captured intent rather than current intent.
- **Impact**: On overlapping edits the row can display a status the server didn't persist (or persisted a different one), with no correction until reload. Rare but reproducible; the event trail (authoritative) and the UI diverge.
- **Fix sketch**: On success, merge the returned `updated` row into `items` (`setItems(cur => cur.map(i => i.id===id ? updated : i))`). Drop the per-error captured `status` in favor of the row's current status on Retry, or disable the select while an error for that row is pending.

## 4. Drag-reorder is implied but absent; the "sandbox" can't reorder or persist roadmap order, and roadmap ordering isn't keyboard-operable
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: UX / feature-gap / a11y consistency
- **File**: src/components/report/RoadmapSandbox.tsx:3-8 & 197 (ReportView.tsx) "drag dimensions / drag-reorder" framing vs. src/components/report/RoadmapPanel.tsx:108-109 (`RoadmapSteps` sorts by a fixed `priorityScore`)
- **Scenario**: The product framing (and the harness context) promise a roadmap you can reorder/model, but `RoadmapSandbox` only drags *score sliders*; there is no item reordering anywhere, and `RoadmapSteps` renders a hard-sorted list with no user control over order. A user expecting to reprioritize/accept-and-rank items finds no affordance, and the ordering they see can't be saved or shared.
- **Root cause**: The "sandbox/reorder" mental model in the copy and comments doesn't match the implemented surface (slider what-if only). No reorder state, no persistence of order, no DnD/keyboard handles.
- **Impact**: Expectation gap and a missing core flow for the "model reordering / tracked status as teams accept" purpose; also leaves prioritization opaque (the `priorityScore` weighting at RoadmapPanel.tsx:70 is invisible to users).
- **Fix sketch**: Either correct the copy to "model score gaps" (cheap, honest) or implement an ordered, persistable roadmap with keyboard-accessible move-up/move-down controls (not pointer-only DnD) plus an order field on the rec.

## 5. Status `<select>` is the only control and lacks clear affordance for done/dismissed muting + no row-level focus/error association
- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: A11y / form semantics
- **File**: src/components/report/RecommendationTracker.tsx:162-176 (select) & 180-211 (error block)
- **Scenario**: The per-row error `role="alert"` block (line 181) is rendered after the title/select but is not programmatically associated with the `<select>` that triggered it — there is no `aria-describedby`/`aria-errormessage` linking the control to its error, and the select carries no `aria-invalid` on failure. A screen-reader user who lands on the select after a failed save gets no indication the control is in an error state; the message only reaches them via the separate polite live region (line 125), which is easy to miss on revisit. Additionally, the select's option text color is overridden via inline `style` (line 168) while individual `<option>`s force `text-slate-200` (line 171), so the closed-control color (status accent) and the open list color disagree — a minor consistency wart.
- **Root cause**: Error state is communicated only out-of-band (live region) and visually (left border), not wired into the failing control's ARIA; option styling is inconsistent with the control styling.
- **Impact**: Reduced clarity for assistive-tech users recovering from a save failure; cosmetic color inconsistency between closed and open select.
- **Fix sketch**: Add `aria-invalid={!!err}` and `aria-describedby={errId}` to the `<select>` and give the error container that `id`; reconcile the accent-color styling so the closed control and its options match (or drop the inline accent on the control).
