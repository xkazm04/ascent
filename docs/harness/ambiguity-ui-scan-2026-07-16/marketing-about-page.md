# Marketing About Page — ambiguity+ui scan (2026-07-16)
> Total: 5 (Critical: 0, High: 2, Medium: 3, Low: 0)

## 1. Remotion diagrams expose unlabeled, mid-animation DOM to screen readers with no accessible alternative
- **Severity**: High
- **Category**: a11y
- **File**: `src/components/about/RemotionStage.tsx:69`
- **Scenario**: The adoption and risk sections' centerpiece diagrams mount `@remotion/player` with no `role`, `aria-label`, or `aria-hidden` anywhere on the stage. The Remotion Player renders the composition as real DOM (divs/SVG), so a screen reader walks straight into it: raw text like "Practices spreading", "weak links 9", "adoption 43%", "Gate Fail" — values frozen at whatever frame playback happens to be on (or the final frame under reduced motion), with no framing that this is an animated illustration. The static diagrams handled this (`FleetGrid` per-cell `aria-label`s, `AboutAscentSteps` `role="img"` + label on both the SVG and the mobile list), but the two heaviest diagrams did not.
- **Root cause**: RemotionStage was built around the visual playback contract (play-once, hold last frame, reduced-motion static frame, replay) and the accessibility contract was never decided — neither "hide it, the adjacent `AboutFeature` copy is the accessible narrative" nor "label it as an image with a one-line summary".
- **Impact**: SR users on 2 of the 8 deck sections hear disembodied, possibly mid-count numbers and a "Gate Fail" status with no context — noise at best, misleading at worst (announcing FAIL on a page selling governance). WCAG 1.1.1 gap on flagship marketing content.
- **Fix sketch**: In RemotionStage, wrap the Player box with `role="img"` + an `ariaLabel` prop (each of `ChampionNetwork`/`RiskRadar` passes a one-sentence summary next to its existing `legend`), and put `aria-hidden` on the Player container so its internal frame-state DOM is not walked. Keep the replay button and legend outside the hidden region.

## 2. Fixed mobile deck bar overlaps the CTA footer and every section's bottom edge below `lg`
- **Severity**: High
- **Category**: missing-state
- **File**: `src/components/deck/DeckNav.tsx:74`
- **Scenario**: Below `lg`, DeckNav renders a `fixed inset-x-0 bottom-0 z-30` bar (~52px: chapter label + progress strip + prev/next, `py-2`). Nothing on the page reserves space for it: `DeckSection` panes end at `pb-10` (`src/components/deck/DeckSection.tsx:10`), the decorative snap connector sits at `bottom: 1.25–1.6rem` (under the bar), and the last section's inline footer (`src/components/about/AboutCTA.tsx:41`, `py-8` = 32px bottom padding) puts its Pricing/Connect/Home link row directly beneath the bar — partially covered and hard to tap on exactly the audience (phones) the bar was added for. The bar also uses plain `py-2` with no `env(safe-area-inset-bottom)`, so on notched iPhones it sits in the home-indicator gesture zone.
- **Root cause**: The bar was added as an overlay affordance without updating the deck's bottom rhythm; each section's `min-h-screen` + padding still assumes the viewport bottom is free.
- **Impact**: On mobile, the closing section's footer links (and the tail of any section that fills its pane) are obstructed by a z-30 bar; footer taps hit prev/next instead. The final CTA screen — the conversion moment — is the worst-affected one.
- **Fix sketch**: Add compensating space below `lg` (e.g. `pb-24 lg:pb-10` on `SECTION_CLASS` and extra bottom padding on the AboutCTA footer), and give the bar `pb-[max(0.5rem,env(safe-area-inset-bottom))]`. Alternatively hide the bar when the last section is active (it already knows `activeIndex`).

## 3. ROI simulator's model contradicts the section copy sold next to it, on an undocumented 0.16 weight
- **Severity**: Medium
- **Category**: undocumented-assumption
- **File**: `src/components/about/RoiSimulator.tsx:30`
- **Scenario**: The header comment says the diagram "Mirrors the real /org what-if simulator", and the paired copy (`src/components/about/features.ts:33-39`) promises: "shows how many repos level up, **which goals it unlocks, and when**" and "**highest-leverage moves are ranked** by how many repos they touch". The rendered widget has no goals, no ETAs, and no leverage ranking — just three sliders over a `W = 0.16` per-dimension weight annotated only "(illustrative)". Nothing records why 0.16 (the same copy says the index is "nine dimensions distilled", implying ~0.11 each), whether the demo is allowed to over/under-state real lift, or that the bullet claims are intentionally about /org rather than the demo beside them.
- **Root cause**: Copy (features.ts) and diagram (RoiSimulator) evolved as separate artifacts with no recorded contract for which claims the adjacent demo must substantiate; the weight is a feel-tuned constant with no derivation note.
- **Impact**: A prospect reading "leverage ranking… goal ETAs" then playing with the widget sees neither — the page's own centerpiece undercuts its money section's credibility; future editors have no basis to know if changing 0.16 (or the copy) breaks an intended correspondence.
- **Fix sketch**: Either trim the two unsubstantiated bullets to what the demo shows (promotions, avg gain, scope) with the richer claims moved to `body` as /org capabilities, or add a one-line ranking/ETA readout to the widget. Document `W`: derivation (≈1/9 rounded up for demo legibility) and that it is deliberately not the production weighting.

## 4. Brand palette duplicated as raw hex across compositions, legends, and inline glows — legends match by coincidence
- **Severity**: Medium
- **Category**: visual-inconsistency
- **File**: `src/components/about/ChampionNetwork.tsx:16`
- **Scenario**: `--color-accent: #3b9eff` is the tokenized brand accent (`src/app/globals.css:8`), yet the /about tree re-encodes it (and its companions) as literals: legend swatches in ChampionNetwork (`#3b9eff`, `#f87171`) and RiskRadar (`#ef4444`, `#22c55e`), composition strokes/fills in `ChampionComposition.tsx:13,65-72` and `RadarComposition.tsx:13,28`, plus inline `rgba(59,158,255,…)` glows in AboutHero:52, AboutCTA:21, AboutFeature:53 and globals.css connector rules. AboutCost even splits one semantic color two ways in the same card: title uses the `text-danger-soft` token while its `DownTrend` sparkline hard-codes `#f87171` (`AboutCost.tsx:17`). The HTML legends and the Remotion canvas colors — which MUST agree for the legend to be truthful — share no constant.
- **Root cause**: Remotion compositions can't read CSS custom properties at render time, so hex was inlined — but no shared TS palette was extracted, even though `compositionShared.tsx` already exists as the single-source module for exactly this kind of drift.
- **Impact**: Any brand-accent retune (or danger-color a11y adjustment) silently strands the /about diagrams and, worse, can desynchronize a legend swatch from the composition color it explains — a "weak link" legend chip that no longer matches any line on the canvas.
- **Fix sketch**: Export `ACCENT`, `ACCENT_SOFT`, `WEAK`/`DANGER`, `GREEN`, `INK` from `compositionShared.tsx` (with a comment pinning them to the globals.css tokens), and consume them in both compositions and both legends. Use tokens (`text-danger-soft`, `stroke-current`) for pure-DOM pieces like DownTrend.

## 5. /about ships a second, already-divergent site footer with no recorded ownership of the difference
- **Severity**: Medium
- **Category**: trade-off-undocumented
- **File**: `src/components/about/AboutCTA.tsx:41`
- **Scenario**: AboutCTA inlines its own footer because the server `SiteFooter` can't be imported into a client component (true — `Brand.tsx` pulls `@/lib/auth`/`@/lib/db` at module scope). The comment documents *that* trade-off, but not the content contract: the clone has already drifted. `SiteFooter` (`src/components/Brand.tsx:233-260`) offers Leaderboard / Badge / Connect / Usage, the Logo mark, `SITE_TAGLINE_TITLE`, and the Vercel/#H0Hackathon attribution; the /about copy offers Pricing / Connect / Home, a text-only wordmark, a re-typed tagline string, and no attribution. Nothing records which differences are curation and which are rot.
- **Root cause**: Duplication forced by the client/server boundary, with only the mechanism (why a copy exists) documented — not the intended link set, so the two footers have no shared source for tagline or nav.
- **Impact**: Visitors landing on the marketing page can't reach Leaderboard/Badge/Usage from the footer, the attribution line is dropped on exactly the public-facing page, and future footer edits (adding a legal link, changing the tagline) will be applied to one footer and missed on the other.
- **Fix sketch**: Extract the presentational footer (tagline + links, both driven by a shared const in `@/lib/site` next to `SITE_TAGLINE_TITLE`) into a client-safe component that `SiteFooter` wraps with its server chrome and AboutCTA renders directly; or, if the reduced link set is deliberate, record it in the AboutCTA comment and at least source the tagline/attribution from the shared constants.
