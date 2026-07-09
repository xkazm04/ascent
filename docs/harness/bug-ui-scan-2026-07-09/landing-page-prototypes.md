# Landing Page Prototypes — bug-hunter + ui-perfectionist scan

> Context: Landing Page Prototypes (group: Marketing Site & Design System)
> Files scanned: 12 (of the 15 scoped; `PricingCards.tsx`, `EditorialSteps.tsx`, `shared/content.ts` were removed from the tree — see note)
> Total: 6 findings (Critical: 0, High: 0, Medium: 1, Low: 5)

Note on scope drift: the context-map's file list is stale. `PricingCards.tsx`, `EditorialSteps.tsx`, and `shared/content.ts` no longer exist (removed in the pricing rework, commit `00fc4b2`, and the deck refactor). The tree now has `IndexOrg.tsx` + `ScanModal.*` instead (out of scope). **Pricing-drift check requested by the brief: there is NO pricing UI in these files anymore, so there is no marketing-vs-`src/lib/plans.ts` drift to report in this context.** Bug-hunter targets verified SAFE and NOT reported: `ScoreGauge`/`TrajectoryChart`/`levelRamp` derive everything from the fixed 5-element `LEVELS` constant (bands `[0,24]…[85,100]`, `LEVEL_HEX` covers L1–L5), so the divide-by-zero / empty-series / NaN-in-`d` hazards are impossible in context. `useCountUp` rAF cleanup (`controls.stop()` on unmount + correct deps) is sound; its only consumer is out-of-scope `AboutHero`.

## 1. `IndexLevels` still uses `justify-center` — missed by the scroll-snap-stranding fix

- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: responsive
- **File**: src/components/landing/prototypes/index/IndexLevels.tsx:24
- **Scenario**: On a phone / short viewport, a visitor snaps down to the Levels section (heading + a 360px chart + five stacked level cards, which together exceed 100vh). Because the section is `flex min-h-screen … flex-col justify-center`, the flex column centres its overflowing content, pushing the section heading ("Five levels, plotted as a climb") above the snap edge — the user lands mid-section with the title scrolled off-screen.
- **Root cause**: Commit `7251fb1` ("stop mandatory scroll-snap from stranding tall sections") gave the four overflow-prone siblings (`IndexOrg`, `IndexGallery`, `DimensionMatrix`, and the old Pricing) `justify-start lg:justify-center` so their content begins at the snap edge on small screens. `IndexLevels` — equally tall — was overlooked and kept the old `justify-center`.
- **Impact**: UX degradation for mobile visitors on the public first-impression page; inconsistent landing behaviour vs every other deck section.
- **Fix sketch**: Change `justify-center` to `justify-start pb-10 pt-14 lg:justify-center`, matching the four sibling sections (e.g. `IndexGallery.tsx:40`, `DimensionMatrix.tsx:44`).

## 2. Charts hardcode hex colors instead of the `divider` / `accent` design tokens

- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: token-adherence
- **File**: src/components/landing/prototypes/index/TrajectoryChart.tsx:105
- **Scenario**: The brand accent is `#3b9eff`, spelled out literally in `TrajectoryChart` (ReferenceLine stroke :105, label fill `#7bbcff` :107, cursor :109, `Waypoint` fallback :34) and the hairline greys are raw `#16233b`/`#1e293b` (:92/:93). `ScoreGauge` likewise hardcodes `#101a2e`/`#e2e8f0`/`#64748b` (:27,:56,:60,:63), and `DimensionMatrix`/`IndexGallery` use raw `slate-700`/`slate-800`. Meanwhile `IndexHero.tsx:95` uses the `divider` token (`border-divider`, `divide-divider`).
- **Root cause**: SVG/Recharts attributes can't take Tailwind classes, so the accent/divider tokens were re-typed as literals — the same value now lives in two places.
- **Impact**: A future accent or hairline-color change updates the tokenised sections but silently leaves the charts on the old blue/grey — visible palette drift on the landing page.
- **Fix sketch**: Read `accent` / divider values from a shared JS constant (or CSS var via `getComputedStyle`/`var(--accent)` where the SVG allows) so the charts follow the token.

## 3. Stale "price table" reference in the `IndexVariant` header comment

- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: documentation
- **File**: src/components/landing/prototypes/index/IndexVariant.tsx:5
- **Scenario**: The module comment says the deck renders "the org edition, a live register, the levels flight-path, the dimension scorecard, and the price table." The component renders no price table — `PricingCards` was deleted in the pricing rework. A maintainer reading the comment will look for pricing UI that no longer exists (and may wonder whether its removal was intentional).
- **Root cause**: Comment not updated when the section was removed.
- **Impact**: Misleading in-code documentation on the primary landing component; masks whether dropping the on-page pricing was deliberate.
- **Fix sketch**: Delete ", and the price table" from the comment (or re-add a pricing section if it was dropped by accident).

## 4. Register rows give almost no hover affordance

- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: hover-state
- **File**: src/components/landing/prototypes/index/IndexGallery.tsx:79
- **Scenario**: Each leaderboard row is a full-width clickable `<Link>`, but hovering it only recolors the repo name (`group-hover:text-accent`, :83). Hovering anywhere else on the row — the rank, the five dimension score cells, the average — produces no feedback, so it doesn't read as one clickable target.
- **Root cause**: Hover styling was attached to a child (repo name) rather than the row.
- **Impact**: Weak click affordance on the register, the section explicitly built as the "growth loop" entry point.
- **Fix sketch**: Add a row-level hover on the `Link` (e.g. `hover:bg-slate-900/30` + a left accent rule) so the whole row responds.

## 5. Hero stat ledger is a fixed 3-column grid that crowds on narrow phones

- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: responsive
- **File**: src/components/landing/prototypes/index/IndexHero.tsx:95
- **Scenario**: The ledger is `grid grid-cols-3 divide-x` at every breakpoint. On a ≤320px viewport each column is ~60px of content after `px-4`, but the third stat's value `"0–100"` in `font-mono text-2xl` is ~72px wide — it overflows/collides with the divider on the smallest phones.
- **Root cause**: The grid never reduces its column count on small screens; the widest value wasn't accounted for at the minimum width.
- **Impact**: Cramped/overflowing hero stats on small devices — the above-the-fold first impression.
- **Fix sketch**: Drop to `grid-cols-1 xs:grid-cols-3` (or shrink the value type on base with `text-xl sm:text-2xl`).

## 6. Two mismatched loading placeholders for the trajectory chart slot

- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: loading-state
- **File**: src/components/landing/prototypes/index/IndexLevels.tsx:19
- **Scenario**: While the Recharts chunk loads, `next/dynamic` shows a blank `<div className="h-[360px] w-full" />` (:19). Once loaded but not yet scrolled into the middle band, `TrajectoryChart` shows a *different* placeholder — `animate-pulse rounded-xl bg-slate-900/40` (`TrajectoryChart.tsx:124`). The user sees blank → pulsing skeleton → chart, a two-step flicker for one slot.
- **Root cause**: The dynamic-import `loading` state and the component's own at-rest state were authored independently and don't match.
- **Impact**: Minor visual flicker on first scroll to the Levels section.
- **Fix sketch**: Make the `dynamic(...)` `loading` return the same pulsing skeleton markup used at `TrajectoryChart.tsx:124`.
