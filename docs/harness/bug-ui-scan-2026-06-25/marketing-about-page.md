# Marketing About Page — Bug + UI Scan
> Context: Marketing About Page (Marketing Site & Design System)
> Total: 5 findings (0 critical, 0 high, 3 medium, 2 low)

## 1. AboutAscentSteps hardcodes a 5-element layout coupled to LEVELS.length
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: edge-case (assumption landmine)
- **File**: src/components/about/AboutAscentSteps.tsx:11-13, 27, 44
- **Value**: impact 5 · effort 3 · risk 2
- **Scenario**: The staircase derives one rung per `LEVELS` entry (`LEVELS.map((l, i) => ({ ... y: YS[i]! }))`) but `YS = [300, 250, 200, 150, 100]` is a hardcoded 5-element array and `X0/STEP_W` assume 5 columns. Add a 6th maturity level to `src/lib/maturity/model.ts` (the model is the single source of truth) and `YS[5]` is `undefined`; the non-null assertion `YS[i]!` silently passes type-check, so `y` becomes `undefined` → every `cx/cy/y1/y2` for that step computes to `NaN`, producing an invisible/broken rung and `NaN` climber keyframes. The `aria-label` ("five-level ascent", line 44) and `UNLOCK` map (lines 14-20) are likewise frozen at five.
- **Root cause**: A data-driven loop fed by a fixed-length geometry table; sibling components (`ScoreGauge`, `FleetGrid`) instead derive everything from `LEVELS`, so this one is the inconsistent outlier.
- **Impact**: Latent broken render (NaN SVG coords) the moment the rubric grows, plus stale a11y/label copy — no compile error to warn you.
- **Fix sketch**: Compute `y` from index over `LEVELS.length` (e.g. interpolate `topY..bottomY` across `LEVELS.length-1`), derive the viewBox width from the count, and word the aria-label with `LEVELS.length`. Makes the whole class impossible by removing the fixed table.

## 2. FleetGrid off-segment cells stay keyboard-focusable and announced when dimmed
- **Lens**: ui-perfectionist
- **Severity**: medium
- **Category**: a11y
- **File**: src/components/about/FleetGrid.tsx:58-86 (dim at :59, button :63-84)
- **Value**: impact 5 · effort 3 · risk 2
- **Scenario**: Selecting a segment filter renders the 32 non-matching repos at `opacity: 0.1` but leaves them in the DOM as real `<button>`s with full `aria-label="{name}, maturity {score}"`. A keyboard user must Tab through 40 cells (32 of them visually "hidden"), and a screen reader announces all 40 maturity values even though only 8 are part of the active slice — the count strip says "8 repos" while AT reports 40.
- **Root cause**: Visual filtering done purely via animated opacity, with no corresponding semantic/interaction state on the dimmed cells.
- **Impact**: Confusing, noisy keyboard/SR experience that contradicts the visible filter; mild WCAG focus-order/name-role concern.
- **Fix sketch**: When `dim` is true, set `aria-hidden`, `tabIndex={-1}`, and `disabled` (or skip rendering off-slice cells), so focus/AT scope matches the visible slice.

## 3. FleetGrid pinned cell has no persistent visual indicator
- **Lens**: ui-perfectionist
- **Severity**: medium
- **Category**: loading-state (missing selected/active state)
- **File**: src/components/about/FleetGrid.tsx:63-84, 104-112
- **Value**: impact 4 · effort 3 · risk 1
- **Scenario**: Clicking a cell pins it (`setPinned(true)`), but the cell's styling is unchanged on pin — `whileHover` scale/opacity only applies while hovering, and once the pointer leaves, the pinned cell looks identical to its 39 neighbours. The only pin feedback is a text token ("· pinned") and the repo name in the strip below; in a 40-cell heatmap the user cannot locate *which* cell is currently inspected/pinned.
- **Root cause**: Pin state drives the text readout but not the grid cell's own appearance.
- **Impact**: Users lose track of their selection on a deliberately interactive diagram; clicking again to unpin becomes guesswork.
- **Fix sketch**: When `pinned && inspect?.name === r.name`, add a persistent ring/outline (e.g. `ring-2 ring-accent`) or hold the hover scale on that cell.

## 4. RemotionStage replay button overrides the user's reduced-motion preference
- **Lens**: ui-perfectionist
- **Severity**: low
- **Category**: a11y
- **File**: src/components/about/RemotionStage.tsx:39-40, 92-101
- **Value**: impact 3 · effort 2 · risk 1
- **Scenario**: For `prefers-reduced-motion` users the stage correctly seeks to the final frame and never plays (lines 39-40). But the "↻ replay" control is still rendered and, when clicked, calls `seekTo(0); play()` unconditionally — abruptly playing the full Champion/Risk animation the page otherwise suppressed for that user. The page advertises a strict reduced-motion contract, and this is the one place that breaks it.
- **Root cause**: Replay handler ignores `reduced`; the button isn't conditioned on motion preference.
- **Impact**: A reduced-motion user gets unexpected full-speed motion from a control that gives no hint it will animate.
- **Fix sketch**: When `reduced`, hide the replay button (it only ever shows the static last frame anyway) or have its handler `seekTo(durationInFrames - 1)` instead of `play()`.

## 5. Live-demo CTA hardcodes /org/vercel in two places
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: silent-failure
- **File**: src/components/about/AboutHero.tsx:58 ; src/components/about/AboutCTA.tsx:30
- **Value**: impact 4 · effort 2 · risk 3
- **Scenario**: Both the hero ("Explore the live demo →") and the closing CTA ("Explore the demo →") link to the literal slug `/org/vercel`. If the seeded demo org isn't present under that exact slug in a given environment (preview/self-host/renamed seed), the marketing page's secondary CTA dead-ends on the org route's not-found/error state — with no fallback.
- **Root cause**: The demo target is a magic string duplicated across components rather than sourced from config (e.g. `site.ts` / an env-driven demo slug).
- **Impact**: A primary marketing conversion path can silently 404 outside the canonical deployment; the duplication means it must be fixed in two files.
- **Fix sketch**: Hoist the demo slug to a single `DEMO_ORG` constant (e.g. in `src/lib/site.ts`) consumed by both CTAs, and ideally guard/hide the link when the demo org is unavailable.

---
Note: `src/components/about/AboutReveal.tsx` is listed in the dispatch scope but does not exist on disk (stale dispatch entry, not a code defect). Verified `DIMENSIONS.length === 9`, so the "nine dimensions" marketing copy in `features.ts` is accurate.
