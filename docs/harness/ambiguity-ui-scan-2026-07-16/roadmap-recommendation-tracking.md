# Roadmap & Recommendation Tracking — ambiguity+ui scan (2026-07-16)
> Total: 5 (Critical: 0, High: 2, Medium: 2, Low: 1)

Note: the context map lists `src/components/report/RoadmapPanel.tsx`, which does not exist. Its scope is served by `roadmapPieces.tsx` (TrustLadder / RoadmapSteps / NextLevelPath) rendered from `ReportPanels.tsx`; those were audited in its place. RecommendationTracker.tsx carries uncommitted user WIP — findings 3–5 are stated against the WIP state and flagged where WIP-dependent.

## 1. `note` has no defined contract: note-only PATCH is rejected, and a note on a no-op patch is silently discarded with a 200
- **Severity**: High
- **Category**: undocumented-assumption
- **File**: `src/app/api/recommendations/[id]/route.ts:100` (and `:107`), `src/lib/db/scans-recommendations.ts:102`
- **Scenario**: The PATCH body accepts `note`, but three behaviors are unstated anywhere: (a) a body of only `{ note }` gets 400 "Provide at least one of: status, assigneeLogin, targetDate" — you cannot comment without changing a field; (b) if the patch turns out to be a no-op (e.g. `{ status: "open", note: "blocked on infra" }` when status is already `open`), `updateRecommendation` returns at `events.length === 0` (scans-recommendations.ts:102) — the note is dropped and the client gets 200 with the row, indistinguishable from "note recorded"; (c) `body.note.slice(0, 500)` truncates silently (magic number, no error, no ellipsis), and in a multi-field patch the same note is duplicated verbatim onto every generated event (`event()` closure at scans-recommendations.ts:77-78).
- **Root cause**: `note` was bolted onto the field-change event model as a rider; nobody decided whether a note is an attribute of a change or a first-class timeline entry, and the decision-by-default (rider-only) was never recorded or surfaced to the client.
- **Impact**: Data loss users won't notice — a "successful" save that quietly ate their context note is the worst failure mode for an audit/timeline product. Duplicated notes also make the timeline read as if the user commented N times.
- **Fix sketch**: Decide and document: either support a `note`-kind RecEvent (note-only patches create one; a no-op patch with a note still writes it), or reject notes on no-op patches with a 4xx explaining why. Return 400 (or truncate with an explicit `truncated: true`) instead of silent `.slice(0, 500)`, and attach the note to the first event only (or a dedicated event).

## 2. Enabling persistence silently destroys the roadmap's prioritization and quick-win signaling
- **Severity**: High
- **Category**: visual-inconsistency
- **File**: `src/components/report/ReportPanels.tsx:89-92`, `src/components/report/roadmapPieces.tsx:126-136`, `src/lib/db/scans-read.ts:724`
- **Scenario**: The same "Gaps to explore" section renders two very different lists depending on whether recs persisted. Without a DB, `RoadmapSteps` sorts quick-wins-first (`priorityScore` = impact×10 − effort), numbers items 1..N, and badges "⚡ Quick win" with an emerald border. With tracking enabled, `RecommendationTracker` renders items in raw `createdAt: "asc"` order (whatever order the LLM emitted them), with no numbering, no quick-win badge, and no priority sort.
- **Root cause**: The tracker was built as a status editor and never inherited RoadmapSteps' presentation logic; the ordering difference is an accident of the DB read, not a recorded decision.
- **Impact**: The paying/persisted experience is *worse-prioritized* than the free/anonymous one: teams see an arbitrary order where the public report showed "do these high-impact/low-effort items first" — undermining the product's core claim of a *prioritized* roadmap.
- **Fix sketch**: Apply the same `priorityScore` sort (and the quick-win badge, both exported from roadmapPieces) in RecommendationTracker — or, if triaged/tracked items should keep stable order, sort untouched items by priority and float in-progress ones up, and record that choice in a comment.

## 3. 409 recovery refetches the repo's *latest* scan — silent no-op when a newer scan has landed, and a whole-list fetch to reseed one row
- **Severity**: Medium
- **Category**: edge-case-gap
- **File**: `src/components/report/RecommendationTracker.tsx:66-76` (WIP-dependent)
- **Scenario**: `refreshRow` calls `GET /api/recommendations?repo=…`, which returns the recommendations of the repo's *most recent* scan (scans-read.ts `SCAN_ORDER`). The tracker's rows belong to the scan loaded with the page. If a newer scan completed since page load (common: a teammate rescans), the conflicted row's id is absent from the response → `fresh` is undefined → the row silently stays on its rolled-back value while the error banner claims "showing the latest. Retry to reapply" — and Retry deterministically 409s again, an unbreakable loop the copy explicitly promised to avoid. It also downloads the full recommendation list (plus dimension math server-side) to reseed a single row.
- **Root cause**: There is no per-row GET endpoint, so the recovery path borrowed the list endpoint and assumed "latest scan == my scan" — an undocumented happy-path assumption.
- **Impact**: The concurrency UX built for the 409 case fails exactly in the multi-user situations that produce 409s; user's edit is lost with a misleading message.
- **Fix sketch**: Detect the miss (`!fresh`) and switch the row error to a non-retryable "This report has been superseded by a newer scan — reload the page" message; longer-term, add `GET /api/recommendations/:id` (org-read-gated like the events route) for targeted reseeds.

## 4. During a save, a second status pick is silently swallowed — the select snaps back with no feedback
- **Severity**: Medium
- **Category**: missing-state
- **File**: `src/components/org/shared/recStatusUi.tsx:77-79`, `src/components/report/RecommendationTracker.tsx:83` (WIP-dependent)
- **Scenario**: The busy-but-focusable design (correctly avoiding the disabled-blur a11y trap) means that while a save is in flight the `<select>` still accepts input, but `if (!busy) onChange(...)` plus the `savingIds.has(id)` re-entrancy guard drop the change. Because the control is controlled, the picked option visually snaps back to the in-flight value on the next render — with no announcement, no error, nothing. The only cue is a 14px spinner that `aria-hidden`s itself and is invisible to AT (`aria-busy` alone is not reliably voiced by screen readers on value change).
- **Root cause**: The overlapping-save guard was designed to prevent double PATCHes, but the rejected-input case never got a user-facing state; "ignore" was chosen over "queue" or "explain" without recording the trade-off.
- **Impact**: A fast keyboard or SR user's second change vanishes; they believe they set "Done" while the row saves "In progress" — a data-integrity perception bug on the tracking surface.
- **Fix sketch**: On a swallowed change, `announce(id, "Still saving the previous change — try again in a moment.")` via the existing per-row live region (cheapest), or queue the latest requested status and submit it when the in-flight PATCH settles.

## 5. All-dismissed backlog renders "0 of 0 done" with a full green 100% bar
- **Severity**: Low
- **Category**: edge-case-gap
- **File**: `src/components/report/RecommendationTracker.tsx:61` (and `:144-151`) (WIP-dependent)
- **Scenario**: `pct = actionable ? Math.round((done / actionable) * 100) : 100` — when every item is dismissed, `actionable` is 0 and the header shows "0 of 0 done · N dismissed" beside a fully-filled accent→emerald gradient bar and "100%".
- **Root cause**: The divisor fix (excluding dismissed, documented at :57-60) picked `100` as the zero-denominator fallback to make a *mostly*-done backlog read complete, but the all-dismissed corner — where nothing was actually done — was never considered.
- **Impact**: A team that rejected every recommendation is shown a triumphant full green progress bar; "0 of 0 done" next to "100%" also reads as broken math and erodes trust in the other numbers on the report.
- **Fix sketch**: Special-case `actionable === 0 && dismissed > 0`: render a neutral "All N recommendations dismissed" state (muted bar, no percentage) instead of the success gradient; keep `100` only for the impossible empty-list case (the parent already gates on `recs.length > 0`).
