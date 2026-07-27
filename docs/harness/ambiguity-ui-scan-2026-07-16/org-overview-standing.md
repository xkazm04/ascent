# Org Overview & Standing — ambiguity+ui scan (2026-07-16)
> Total: 5 (Critical: 0, High: 1, Medium: 3, Low: 1)

Note: the context-map file list is stale. `OrgStanding.tsx`, `OrgGapsSection.tsx`, `PeriodSummary.tsx`, `CollapsibleSection.tsx` no longer exist; the landing view is now `RepoCategoryRollup` + `RepoDimensionHeatmap`, and `OrgNav`/`ui.tsx`/`TimeRangeSelector`/`Trajectory` live under `shared/` / `overview/`. This scan audits the current working-tree equivalents.

## 1. FilterMenu announces listbox semantics it doesn't implement — no keyboard model, no focus management
- **Severity**: High
- **Category**: a11y
- **File**: `src/components/org/overview/FilterMenu.tsx:59-95`
- **Scenario**: The trigger declares `aria-haspopup="listbox"` and the popup renders `role="listbox"` with `role="option"` children — but the options are plain `<button>`s reached only by Tab. Opening the menu does not move focus into it, there is no ArrowUp/ArrowDown/Home/End navigation, Escape closes without returning focus to the trigger, and the multi-select listbox lacks `aria-multiselectable="true"`. A screen reader hears "listbox" and expects arrow-key selection that does nothing.
- **Root cause**: ARIA roles were added for the visual pattern ("looks like a dropdown") without the keyboard contract those roles promise (WAI-ARIA listbox/menu pattern).
- **Impact**: Keyboard and SR users on the org landing page (the three Type/Stack/Level filters gate the whole Fleet view) get a broken interaction model: focus stays behind the popup, Escape strands focus, and AT users are told the wrong widget type. This is the primary filtering control of the dashboard.
- **Fix sketch**: Either (a) drop the listbox roles and treat it as a disclosure of toggle buttons (`aria-expanded` + `aria-pressed` per option — smallest honest fix), or (b) implement the pattern: on open, focus the first option; Arrow keys cycle via `roving tabindex`; Escape/close returns focus to the trigger; add `aria-multiselectable="true"`. Mirror whatever `SegmentSelector`/`ScheduleSelect` already do so the org dropdowns share one keyboard model.

## 2. "The layout already ran the same query" is false — getOrgHeaderSummary is not deduplicated, so every org page pays it twice
- **Severity**: Medium
- **Category**: undocumented-assumption
- **File**: `src/app/org/[slug]/page.tsx:49-50` (and `src/app/org/[slug]/layout.tsx:117`, `src/lib/db/org-rollup.ts:614`)
- **Scenario**: The overview page calls `getOrgHeaderSummary(slug)` to branch personal-vs-org, with the comment "One cheap read; the layout already ran the same query for the shell" — implying the second call is free. `getOrgHeaderSummary` is a plain async Prisma function, not wrapped in React `cache()` (unlike `getViewer` in `lib/access.ts:43` and `getOrgFindings` in `lib/org/nav-counts.ts:95`), and the route is `force-dynamic`, so layout and page each issue their own DB round-trip on every navigation.
- **Root cause**: The comment records an assumption (request-scoped dedupe) that the code never established; the repo's own convention for "shell + page both need it" reads is `cache()` (see nav-counts), and this one missed it.
- **Impact**: One extra multi-aggregate query per org page view (the shell wraps EVERY tab, and other tabs that branch on personal-kind repeat it too). Worse, the comment teaches the next reader that duplicate calls are free, inviting more of them.
- **Fix sketch**: Wrap the export in React `cache()` (`export const getOrgHeaderSummary = cache(async (orgSlug) => …)`) as `getOrgFindings` does, or thread the layout's summary down via a cached helper in `lib/org/`. Then the comment becomes true instead of aspirational.

## 3. Fleet masthead hand-picks ▲/▼ hex colors, violating the module's own "never hand-picked ad hoc" rule
- **Severity**: Medium
- **Category**: visual-inconsistency
- **File**: `src/components/org/overview/RepoCategoryRollup.tsx:239-241`
- **Scenario**: The masthead renders improving/slipping/holding counts with inline literals `style={{ color: "#84cc16" }}` and `"#f97316"` (and `dot()` at line 41 inlines the `#64748b` unknown fallback). Yet `repoTrajectory.ts:4-5` — the module this component is built on — states "Colors/tones come from the brand helpers + canonical enums, never hand-picked ad hoc", and the same file computes each repo's `tone` from `DIRECTION_TONE`, whose `rising`/`falling` colors are exactly what these counts summarize.
- **Root cause**: The masthead was typeset directly instead of reading `DIRECTION_TONE.rising.color` / `.falling.color` (already imported into the trajectory model) — a shortcut past the documented single source.
- **Impact**: A brand-tone change (or an accessibility-driven recolor of the rising/falling pair) updates the per-row deltas, the Trajectory card, and every other consumer via `DIRECTION_TONE`, but the fleet masthead silently keeps the old greens/oranges — the exact drift the module header warns against, on the org landing view.
- **Fix sketch**: `import { DIRECTION_TONE } from "@/components/ui/format"` (already transitively used) and render `▲` with `DIRECTION_TONE.rising.color`, `▼` with `DIRECTION_TONE.falling.color`; move the `#64748b` fallback into `POSTURE_DOT` as an exported `POSTURE_DOT_FALLBACK` or default entry.

## 4. A custom range displays as the literal "Custom range" — the active period's dates are invisible everywhere the title is used
- **Severity**: Medium
- **Category**: missing-state
- **File**: `src/lib/window.ts:149` (surfaces at `src/app/org/[slug]/page.tsx:105` and `RepoCategoryRollup.tsx:209`)
- **Scenario**: `resolveWindow` gives the custom case the fixed `title: "Custom range"`. The overview header then reads "Showing · Custom range" and the Fleet card's description echoes the same string. Once the date inputs collapse (or the period came from the remembered cookie / a shared `?range=custom&from=…` link), nothing on the page states WHICH dates are in effect — unlike every preset ("Last 90 days", "This quarter"). The silent from/to swap for reversed ranges (`window.ts:139-142`) compounds it: the window the user typed is corrected without any visible confirmation of the final bounds.
- **Root cause**: The preset titles were written as static strings and the custom branch followed suit, even though it alone has parameters worth echoing back.
- **Impact**: A shared custom-range link or a returning visitor with a remembered custom cookie sees deltas, movers, and averages scoped to an unknowable window — the one piece of context every number on the page depends on. Misreading "avg move +4" against the wrong assumed period is a wrong conclusion, not a cosmetic gap.
- **Fix sketch**: In the custom branch, build the title from the resolved bounds: `` title: start ? `${from} → ${to ?? "now"}` : "Custom range" `` (or a friendlier `fmtDay(start) – fmtDay(end)`), and derive `reviewTitle`/`comparisonLabel` similarly. One change in `resolveWindow` fixes every org tab at once, since they all consume `period.title`.

## 5. Filtering everything down to zero repos shows "0 repos · avg 0" in danger-red instead of an empty summary
- **Severity**: Low
- **Category**: edge-case-gap
- **File**: `src/components/org/overview/RepoCategoryRollup.tsx:232-255` (with `repoTrajectory.ts:192-195`)
- **Scenario**: `summarize()` returns `avgOverall: 0` for an empty set (its `avg` helper defaults to 0), and the masthead renders unconditionally above the "No repositories match these filters" message. Selecting filters with no intersection therefore shows "0 repos · avg **0**" with `scoreHex(0)` — the lowest-score alarm color — plus "▲ 0 ▼ 0 → 0", as if the fleet scored zero.
- **Root cause**: `summarize`'s 0-default was written for the division guard, not as a displayable value, and the masthead has no `filtered.length === 0` branch; the happy path (some rows always match) was the only one styled.
- **Impact**: A transient but genuinely misleading state on the landing view — a red "avg 0" reads as a catastrophic fleet score, and the alarm color is exactly what draws the eye first.
- **Fix sketch**: Skip the masthead (or render "no matching repos" muted placeholders) when `filtered.length === 0`; alternatively make `FleetSummary.avgOverall` nullable for the empty set and render "—" uncolored, matching how `avgMove: null` is already handled two spans later.
