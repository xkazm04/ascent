# Investment Simulator & Forecast — ambiguity+ui scan (2026-07-16)
> Total: 5 (Critical: 0, High: 2, Medium: 2, Low: 1)

## 1. Ranking panel is never invalidated — "Top moves" go stale when scope/target change
- **Severity**: High
- **Category**: missing-state
- **File**: `src/components/org/plan/Simulator.tsx:89-111`
- **Scenario**: `invalidate()` (called on every dimension/target/scope/extras edit) resets `result`, `goalImpacts`, `tracked`, and `trackError` — but never `setRanking(null)` (or a stale flag). A user clicks "Suggest" with scope = all repos, then narrows scope to 3 repos (or edits the target): the "Top moves by projected gain" list keeps showing gains/promotions computed for the OLD scope and OLD target, with no visual indication it no longer matches the inputs. Clicking a stale row then loads `dimId`/`target` from a recommendation that was never true for the current scope.
- **Root cause**: The projection got the input→output invalidation treatment (per the `invalidate()` comment, prior finding investment #3), but the ranking — derived from the exact same live inputs (`target`, `scope` at `Simulator.tsx:66`) — was left out of the invalidation set.
- **Impact**: Leadership reads "D2 +6 avg · 3↑" as a live recommendation for the currently-selected repo set when it was computed against a different fleet slice — the same "on-screen numbers disagree with the inputs" bug the projection invalidation was added to prevent, and this one drives the highest-stakes action on the page ("where should we invest?").
- **Fix sketch**: Either clear it (`setRanking(null); setRankError(null)` inside `invalidate()` — RankPanel already renders a "Suggest" empty state), or cheaper UX: keep the list but store the `{target, scopeSize}` the ranking was computed with and render a dimmed "computed for N repos at target T — Refresh" badge when they diverge from the live inputs.

## 2. Track-as-initiative: the handler loops over multiple legs while the button forbids multi-leg — two contradictory policies, and the loop is non-atomic
- **Severity**: High
- **Category**: trade-off-undocumented
- **File**: `src/components/org/plan/Simulator.tsx:157-188` (vs `src/components/org/plan/Simulator.ProjectionResult.tsx:54-77`)
- **Scenario**: `trackAsInitiative` carries a long comment explaining it creates "one initiative per leg" from `result.fixes` precisely so multi-leg scenarios "no longer silently drop legs". But `ProjectionResult` disables the Track button whenever `result.fixes.length > 1`, with a tooltip saying "tracking it would silently drop the extra legs. Remove the extra dimensions". Both files claim to be the fix for the same problem and they disagree: the per-leg loop is unreachable dead policy, and its documented rationale is now false. Worse, if the disable is ever removed (the loop invites it), the sequential `for (const fix of result.fixes)` has no rollback/idempotency: leg 1 POST succeeds, leg 2 fails → the error banner shows, `tracked` stays false, and a retry re-creates leg 1 as a duplicate initiative.
- **Root cause**: Two independent fixes for "multi-leg tracking drops legs" landed in two files without reconciling which policy is authoritative or recording why the button-level ban won.
- **Impact**: Future maintainers can't tell which behavior is intended (comments actively mislead); the latent partial-failure path persists duplicate initiatives server-side the moment anyone trusts the loop's comment and re-enables the button.
- **Fix sketch**: Pick one policy. If multi-leg tracking is out: reduce the handler to a single-fix POST and rewrite both comments to record the decision ("initiatives are single-dimension by design; multi-leg tracking rejected because X"). If it's in: remove the `result.fixes.length > 1` disable and make the loop safe — create sequentially but stop marking `tracked` per-leg, surface "created 1 of 2" on partial failure, and skip already-created legs on retry (e.g. track created dimIds in state).

## 3. Typed target values bypass the 0–100 bounds — and rank mode silently substitutes 70 while the button advertises the typed value
- **Severity**: Medium
- **Category**: edge-case-gap
- **File**: `src/components/org/plan/Simulator.tsx:220` (also `:255`, `Simulator.RankPanel.tsx:30`, `src/app/api/org/simulate/route.ts:34-38`)
- **Scenario**: `<input type="number" min={0} max={100}>` only constrains the spinner arrows — typing "150" or "-5" goes straight into state via `Number(e.target.value)` (and clearing the field yields `Number("") = 0`, a silent jump to target 0). Two divergent downstream behaviors: (a) Simulate returns a 400 with the server's generic "Each fix needs { dimId: D1..D9, target: a number in 0..100 }" for an input the UI itself rendered as valid; (b) Rank mode never errors — the route silently falls back to 70 for an out-of-range target, so the button reads "Suggest (→ 150)", the returned `InvestmentRank.target` is 70, and clicking a row snaps the form's target back to 70 with no explanation.
- **Root cause**: Client trusts the HTML `min`/`max` attributes to enforce bounds (they don't outside form validation), and the route's rank branch chose fallback-to-default over reject-with-400 — a divergence from the fixes branch's strict validation, with the trade-off recorded nowhere.
- **Impact**: A leader who types 85→150 by fat-finger gets either a raw validation error or, in rank mode, a recommendation list computed for a target they never asked for while the UI claims otherwise — quiet erosion of trust in the numbers.
- **Fix sketch**: Clamp on change or blur (`setTarget(Math.min(100, Math.max(0, Math.round(n))))`, keep the previous value on `NaN`/empty) so all four target inputs share one sanitizer; align the rank route with the fixes branch (400 on out-of-range instead of silent 70) or at minimum echo the effective target in the response and render it.

## 4. Saved scenarios don't record the repo scope they were simulated against — the 2-up compare can silently compare different fleets
- **Severity**: Medium
- **Category**: undocumented-assumption
- **File**: `src/components/org/plan/Simulator.tsx:40-52` (display: `Simulator.SavedScenarios.tsx:43-67`)
- **Scenario**: `saveScenario` labels a snapshot only by its legs ("D2→70 + D3→70") and stores `before/after/promotions/affected` — never the scope. Save "D2→70" across 3 selected repos, change the selection, simulate "D2→70" across all repos, save again: two identically-labeled cards with different numbers and no way to tell why. The compare view then presents them side-by-side as if they were the same experiment under two conditions, when the varying hidden variable is the repo set.
- **Root cause**: `SavedScenario` was scoped as a "client-only scratchpad" (SIM-5) and the shape captured the outputs but not all the inputs that produced them — scope is the one input that doesn't appear in the label.
- **Impact**: The one feature built explicitly for decision-making comparisons can mislead: apples-to-oranges deltas ("+7 vs +3 avg") read as scenario quality when they're scope size. `affected` hints at it but doesn't disambiguate (same count, different repos).
- **Fix sketch**: Capture scope at save time — add `scopeCount` (already on `FleetProjection`) and the selection to `SavedScenario`, and suffix the label/card: "D2→70 · 3 repos" vs "D2→70 · all (12)". One line in `saveScenario`, one span in `SavedScenarios`.

## 5. Async status and error messages are invisible to assistive tech; scope-picker disclosure lacks ARIA state
- **Severity**: Low
- **Category**: a11y
- **File**: `src/components/org/plan/Simulator.tsx:222,286` (also `Simulator.RankPanel.tsx:33`, `Simulator.ProjectionResult.tsx:78-79`, `Simulator.SavedScenarios.tsx:36`)
- **Scenario**: Every async outcome — simulate errors, rank errors, "✓ Tracked as initiative", "Added to the Initiatives panel" — is a plain `<p>`/`<span>` inserted after the fact with no `aria-live`/`role="status"`, so screen-reader users who click Simulate/Suggest/Track hear nothing when the request finishes or fails. The "all scanned repos ▾" button toggles the repo checklist but exposes no `aria-expanded`/`aria-controls`, so its disclosure state is unannounced. Minor extras: the SavedScenarios remove button's only label is `×` with a `title` (weak accessible-name source), and the SIM-2 extras rows use array index as React key, which can mis-associate row state after a mid-list remove.
- **Root cause**: The component grew interaction-by-interaction (SIM-2..5) with visual feedback only; no live-region or disclosure-state pass was ever made.
- **Impact**: Non-visual users cannot complete or verify the page's core flows (simulate → read result, track → confirm success); errors fail silently for them.
- **Fix sketch**: Wrap the error/success strips in `role="status" aria-live="polite"` (one shared container per async action is enough); add `aria-expanded={showRepos}` + `aria-controls` to the scope toggle; give the remove button `aria-label="Remove scenario"`; key extras rows by a stable id.
