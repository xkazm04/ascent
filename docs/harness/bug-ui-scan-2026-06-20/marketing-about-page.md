> Total: 6 findings (0 critical, 2 high, 3 medium, 1 low)

# Marketing About Page — combined bug+ui scan

## 1. Non-transform framer animations bypass reduced-motion (scan line, climber, bars keep moving)
- **Severity**: High
- **Lens**: ui-perfectionist
- **Category**: animation / reduced-motion safety
- **File**: src/components/about/FleetGrid.tsx:85; src/components/about/AboutAscentSteps.tsx:84; src/components/about/RoiSimulator.tsx:72
- **Scenario**: A user with `prefers-reduced-motion: reduce` scrolls /about. The deck is wrapped in `MotionConfig reducedMotion="user"`, which the page comment claims "degrades entrances to fades." But `reducedMotion="user"` in framer-motion only suppresses animation of *transform/layout* values (x/y/scale/rotate). Non-transform values still animate fully: FleetGrid's scan line sweeps via `left: "-2%" → "102%"`, the AboutAscentSteps climber travels via `cx`/`cy` keyframes for 2.4s, ROI bars grow via `width`, and the distribution strip animates `flexGrow`. None are transforms, so they ignore the reduced-motion intent.
- **Root cause**: Assuming `MotionConfig reducedMotion="user"` neutralizes all motion. It only neutralizes transform/layout; position (`left`), SVG geometry (`cx`/`cy`/`pathLength`), `width` and `flexGrow` are unaffected. The global CSS reduced-motion block (globals.css:353) only disables named `.animate-*` keyframe classes, not these JS-driven animations.
- **Impact**: Motion-sensitive users still get sweeping/traveling/growing animation on a page that advertises reduced-motion degradation — an accessibility regression and a discomfort/vestibular risk.
- **Fix sketch**: Read `useReducedMotion()` (already used in RemotionStage) in FleetGrid/AboutAscentSteps/RoiSimulator and, when reduced, render the final/static state (scan line hidden, climber at its end position or hidden, bars at their target width with no transition) instead of animating non-transform properties.

## 2. ROI promotion badge is announced to screen readers for non-promoted repos
- **Severity**: High
- **Lens**: ui-perfectionist
- **Category**: a11y (screen reader)
- **File**: src/components/about/RoiSimulator.tsx:83
- **Scenario**: Each repo row renders `<span className={r.promoted ? "text-emerald-400" : "text-transparent"}>↑{r.after.id}</span>`. For repos that did NOT cross a level boundary the badge is only *visually* hidden via `text-transparent` — it remains in the accessibility tree. A screen-reader user sweeping the simulator hears "up arrow L2" on every single row, including the ones with no promotion, falsely implying every repo was promoted.
- **Root cause**: Using a transparent text color to hide content visually rather than removing it from the DOM / a11y tree; the element is still present and read.
- **Impact**: Screen-reader users get incorrect data — phantom promotions on rows that didn't move, undermining the whole "see the payoff" point of the diagram.
- **Fix sketch**: Conditionally render the badge only when `r.promoted` (or keep the layout spacer but add `aria-hidden` + empty content when not promoted). Prefer `{r.promoted && <span className="text-emerald-400">↑{r.after.id}</span>}` with a fixed-width wrapper to preserve alignment.

## 3. Interactive diagrams give no non-visual feedback (no aria-live, no aria-pressed)
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: a11y (live regions / control state)
- **File**: src/components/about/RoiSimulator.tsx:53; src/components/about/FleetGrid.tsx:60
- **Scenario**: In RoiSimulator, dragging a dimension slider recomputes the "promoted / avg gain / in scope" tiles, but those tiles are plain `<div>`s with no `aria-live`, so a screen-reader user changing the slider hears the slider value but never learns the result changed. In FleetGrid, each repo cell is a `<button>` that toggles a pinned inspect state, but it has no `aria-pressed` and the inspect readout (`{inspect.name} · …`) updates with no `aria-live`, so keyboard/AT users get no confirmation of what they selected/pinned.
- **Root cause**: Output regions and toggle state were built for sighted/mouse users; the computed result and the pressed/pinned state are conveyed only visually.
- **Impact**: The "centerpiece" interactive diagrams are effectively inert for AT users — they can operate the controls but receive none of the resulting information.
- **Fix sketch**: Wrap the RoiSimulator summary tiles (and FleetGrid inspect readout) in a container with `aria-live="polite"`; add `aria-pressed={pinned && inspect?.name === r.name}` to FleetGrid cells so the toggle state is exposed.

## 4. FleetGrid pinned cell cannot be unpinned by keyboard, and pinned cells trap the inspector
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: interaction / keyboard
- **File**: src/components/about/FleetGrid.tsx:69
- **Scenario**: Hover and click on a cell are wired, but the only way to clear a pinned selection is to re-click the *same* cell. With a mouse this works; with hover, once a cell is pinned `onHoverStart`/`onHoverEnd` no-op (`!pinned` guard), so the readout is frozen on the pinned repo until that exact cell is clicked again. A keyboard user who Tabs to a different cell and presses Enter just re-pins to the new cell — there is no Escape handler and no obvious "clear" affordance, and hovering other cells silently does nothing because pinned is sticky.
- **Root cause**: Pin state is global to the grid and only the originating cell can release it; there is no keyboard escape or visible "pinned — click to clear" hint near the readout (the "· pinned" text is far from the cell).
- **Impact**: Users (especially keyboard users) can get stuck with a stale/pinned inspector and no discoverable way to return to hover-to-inspect, making the headline interactive diagram feel broken.
- **Fix sketch**: Add an `onKeyDown` Escape handler (and/or a small "clear" button) that resets `pinned`/`inspect`; allow clicking any cell while pinned to move the pin (set inspect to the new cell) rather than only toggling the same one.

## 5. About diagram legends and trend duplicate brand colors as raw hex instead of tokens
- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: token discipline / visual consistency
- **File**: src/components/about/ChampionNetwork.tsx:22; src/components/about/RiskRadar.tsx:21; src/components/about/AboutCost.tsx:16; src/components/about/RoiSimulator.tsx:60
- **Scenario**: The HTML legends and small SVGs hardcode `#3b9eff` (accent), `#f87171` (danger), `#ef4444`, `#22c55e` and `accent-[#3b9eff]` directly, while the rest of the codebase exposes `--color-accent`, `--color-danger`/`--color-danger-soft`, etc. as tokens. The legend swatches therefore can drift from the actual Remotion composition colors and from the brand palette if a token is retuned (e.g. the accent shifts but these swatches don't).
- **Root cause**: Decorative legend/strip colors were inlined rather than read from the design tokens that the project established for exactly this (Kicker/Surface refactor consolidated ~86/46 hand-rolled treatments).
- **Impact**: Cosmetic-but-systemic: a future palette change updates the charts (which pull from `scoreHex`/`LEVEL_HEX`) but leaves these legend dots/sliders on stale hex — silent visual inconsistency on a flagship marketing page.
- **Fix sketch**: Use the CSS-variable tokens (e.g. `var(--color-accent)`, `var(--color-danger)`) or the existing `LEVEL_HEX`/shared color constants for legend swatches, and `accent-[var(--color-accent)]` for the range input, so legends track the palette.

## 6. "Nine dimensions" hardcoded in about copy can drift from the canonical model
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: content drift
- **File**: src/components/about/features.ts:21
- **Scenario**: The xray feature body/points hardcode "nine dimensions" / "Nine scored dimensions". This currently matches `DIMENSIONS.length` (9, D1–D9), but layout.tsx:27 documents a prior bug where copy hardcoded "7 dimensions" while the model defined 9, and the page description was switched to derive the count from the rubric to prevent exactly this. The /about hero already counts dynamically (`DIMENSIONS.length`), so the same page mixes a live count with prose that says "nine."
- **Root cause**: Prose constant duplicates a value that the rubric owns; if a dimension is added/removed the model + hero update but this string silently goes stale.
- **Impact**: Future rubric change produces a marketing page that contradicts itself (hero shows the real count, body says "nine") — the exact drift the codebase already fixed once.
- **Impact severity is low because it is currently correct.**
- **Fix sketch**: Render the count from `DIMENSIONS.length` where this copy is consumed (or document the coupling), e.g. build the body string with the live count rather than the literal "nine."
