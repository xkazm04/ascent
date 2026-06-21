> Total: 6 findings (0 critical, 1 high, 4 medium, 1 low)

# Landing Page Prototypes — combined bug+ui scan

## 1. DimensionMatrix bars animate `width` and bypass reduced-motion
- **Severity**: High
- **Lens**: ui-perfectionist
- **Category**: accessibility / reduced-motion
- **File**: src/components/landing/prototypes/index/DimensionMatrix.tsx:20
- **Scenario**: A user with `prefers-reduced-motion: reduce` snaps to the Dimensions section. Every weight bar still sweeps from 0% to its value (and re-runs on each re-entry because `viewport={{ once: false }}`).
- **Root cause**: The page-wide `MotionConfig reducedMotion="user"` (IndexLanding.tsx:31) only neutralizes transform/layout animations and keeps `opacity`; it does NOT strip direct value animations of non-transform CSS properties like `width`. `CellBar` animates `initial={{ width: 0 }} whileInView={{ width: "…%" }}` with no `usePrefersReducedMotion()` guard — unlike ScoreGauge and TrajectoryChart, which both gate explicitly. So motion-sensitive users get the one section that ignores their preference, ~27 bars animating at once.
- **Impact**: WCAG 2.3.3 (Animation from Interactions) reduced-motion violation on the flagship homepage; vestibular-discomfort trigger.
- **Fix sketch**: Read `usePrefersReducedMotion()` in `CellBar` (or `DimensionMatrix`) and, when reduced, render the bar at its final width with no `motion` animation (`initial={false}` + static width), matching the pattern already used in the sibling charts.

## 2. Scroll-snap deck is active on mobile but tall sections clip and have no nav
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: responsive / mobile
- **File**: src/components/landing/prototypes/index/IndexHero.tsx:25
- **Scenario**: On a phone (or short laptop) the hero's headline + ScanForm + QuotaMeter + free-scan copy + 3-up stat ledger exceeds the viewport height. The section is `min-h-screen ... items-center overflow-hidden`, and `html.snap-deck { scroll-snap-type: y proximity }` plus `section[id] { scroll-snap-stop: always }` apply at ALL widths (globals.css has no width gate). The section centers its overflowing content and clips the top; snap-stop pins the section so the clipped headline/CTA can be hard to reach.
- **Root cause**: Snap behavior was designed for desktop full-viewport sections, but the DeckNav (the orientation affordance) is `hidden lg:flex` while the snap CSS is unconditional. Mobile gets snapping + clipping with no section nav.
- **Impact**: Hero CTA/headline partially cut off on small/short screens; disorienting jump-scroll with no way to orient. Affects the primary conversion surface.
- **Fix sketch**: Gate the snap rule to `lg` (e.g. wrap `scroll-snap-type` in a `min-width` media query, matching DeckNav's `lg:flex`), or switch tall sections to `items-start` with top padding and allow vertical overflow on small screens so no content is clipped.

## 3. Index sections drift off the divider/surface design tokens
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: token discipline / visual consistency
- **File**: src/components/landing/prototypes/index/IndexGallery.tsx:16
- **Scenario**: The hero (IndexHero.tsx:80) correctly uses the canonical `border-divider`/`divide-divider` tokens, but its sibling sections (IndexGallery, IndexLevels, EditorialSteps, DimensionMatrix, IndexVariant, PricingCards) use raw `border-slate-800`, `divide-slate-800`, `border-slate-700`, and `bg-slate-950/40` (12 occurrences across 6 files).
- **Root cause**: `--color-divider` (#1e293b = slate-800) and the surface tokens were introduced as the single source of truth for hairlines/cards (globals.css:21-26), but the prototype sections hardcode slate values, so any future token change (e.g. divider hue) updates the hero but silently leaves the rest of the page inconsistent.
- **Impact**: Future visual drift between hero and body; defeats the centralized token system; harder theming/white-label.
- **Fix sketch**: Replace raw `slate-700/800` hairlines with `border-divider`/`divide-divider` and `bg-slate-950/40` cards with `bg-surface`/`bg-surface-strong`, mirroring the hero and SectionHeading conventions.

## 4. ScoreGauge calibration tick uses CSS transform-origin on an SVG group without `transformBox`
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: cross-browser visual / animation polish
- **File**: src/components/landing/prototypes/index/ScoreGauge.tsx:50
- **Scenario**: The hero's index-ring indicator (`<motion.g style={{ originX: "50%", originY: "50%" }}>`) sweeps from `rotate: -210` to `0`. In Firefox the rotation pivots around the wrong point, so the tick orbits from the corner instead of spinning about the ring center.
- **Root cause**: For an SVG `<g>`, CSS `transform-origin: 50% 50%` resolves against `transform-box: view-box` by default in Firefox (the SVG viewport), not the group's own box; Chrome/Safari happen to land near center here only because the viewBox center coincides with the ring center. The arcs above use SVG-attribute rotation with an explicit center (`rotate(-90 ${cx} ${cx})`), but the indicator relies on CSS origin without `transformBox: "fill-box"`. This is the only `originX/originY` usage in the codebase.
- **Impact**: Broken/janky entrance animation of the hero's focal element on Firefox.
- **Fix sketch**: Add `transformBox: "fill-box"` to the `<motion.g>` style (with `originX/originY: "50%"`), or rotate via the SVG attribute form around `(cx, cx)` as the arcs already do.

## 5. The register can overflow its centered full-viewport section
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: layout / empty-data scaling
- **File**: src/components/landing/prototypes/index/IndexGallery.tsx:26
- **Scenario**: When no repo is "AI-native" (`topAiNative.length === 0`), the board falls back to `recent`, which getPublicScanGallery returns up to 12 of (scans-read.ts:442). 12 rows at `py-4` (~72px each) plus the header is ~950px, rendered inside a `min-h-screen ... justify-center` section. On a ~800px-tall laptop the first/last rows are clipped, and there's no internal scroll.
- **Root cause**: The board renders `board.map(...)` with no cap, assuming the list is short, while the section is fixed to one centered viewport. The top board (`topAiNative`) is capped at 8 so it usually fits, but the fallback path (12) and short viewports break the assumption.
- **Impact**: Discovery rows clipped/unreachable; the "X public repos rated" header or top entries can sit off-screen.
- **Fix sketch**: Cap the rendered board (e.g. `board.slice(0, 8)`) and/or change the section to `justify-start` with top padding (and allow vertical overflow) so all rows are reachable regardless of count.

## 6. `useCountUp` is assigned to this context but unused by any landing prototype
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: dead code / context drift
- **File**: src/components/landing/prototypes/shared/useCountUp.ts:10
- **Scenario**: The shared hook lives under `landing/prototypes/shared/` and is listed as part of this context, but no prototype component imports it — its only consumer is `src/components/about/AboutHero.tsx` (a different context). The Index hero shows a static "0–100" gauge, not a counted-up number.
- **Root cause**: Leftover from an earlier prototype iteration; the shared folder retained a helper after the variant that used it was dropped.
- **Impact**: Misleading context boundary and dead surface under `prototypes/shared`; minor maintenance noise.
- **Fix sketch**: Either move `useCountUp` next to its real consumer (about/) or wire it into a prototype stat; if kept shared, document the cross-context use so it isn't read as landing-prototype code.
