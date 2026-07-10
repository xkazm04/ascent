# Marketing About Page — bug-hunter + ui-perfectionist scan

> Context: Marketing About Page (group: Marketing Site & Design System)
> Files scanned: 18 (one scoped file, AboutReveal.tsx, does not exist; the shared reveal lives at src/components/deck/Reveal.tsx)
> Total: 7 findings (Critical: 0, High: 0, Medium: 2, Low: 5)

Note on the brief's reduced-motion question: this context honors `prefers-reduced-motion` thoroughly and is NOT a finding. Every animated component reads `useReducedMotion()` and renders a static rest state (AboutAscentSteps, FleetGrid, RoiSimulator, RemotionStage, useCountUp), the deck is wrapped in `MotionConfig reducedMotion="user"` (AboutLanding.tsx:63), and `html.snap-deck` scroll-snap is gated behind `@media (prefers-reduced-motion: no-preference)` in globals.css. The geometry libs (graph.ts, radar.ts) are fixed, non-empty, deterministic datasets with Infinity guards — no empty-set or NaN-coordinate path exists; RoiSimulator's slider math is bounded (10–90) over a constant 8-repo array with a constant divisor, so no divide-by-zero / NaN. Those all read clean.

## 1. Segment filter strands a stale pinned inspection and kills hover
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: stale-state
- **File**: src/components/about/FleetGrid.tsx:44
- **Scenario**: User clicks a cell to pin it (`setInspect(r); setPinned(true)`), then clicks a segment filter (e.g. "Mobile") that does not contain the pinned repo. `setSeg` (line 44) never reconciles `inspect`/`pinned`.
- **Root cause**: Pin state is keyed to a specific repo object but is not re-validated against the currently-visible slice. The now-off-slice cell becomes `disabled` + `aria-hidden` + `tabIndex=-1` (line 70–72), yet still renders the accent pin ring and still reads "· pinned" in the strip (line 122).
- **Impact**: The pin can no longer be cleared by the intended toggle — the pinned cell is `disabled`, so its `onClick` (line 84) never fires. Worse, `onHoverStart` is guarded by `!pinned` (line 82), so hover-to-inspect is dead for every other cell until the user happens to switch the filter back. A stuck, unclearable UI state reachable by normal clicks.
- **Fix sketch**: In the filter handler, clear the inspector when the pinned repo leaves the slice: `onClick={() => { setSeg(s); if (pinned && inspect && s !== "All" && inspect.segment !== s) { setPinned(false); setInspect(null); } }}`.

## 2. Staircase SVG labels shrink to ~5px on mobile
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: responsive
- **File**: src/components/about/AboutAscentSteps.tsx:52
- **Scenario**: On a ~360px phone, the fixed `viewBox="0 0 960 360"` SVG (`className="h-auto w-full"`) is scaled to container width (~0.33×). The three text lines per step render at fontSize 17/13/11 in user units → ~5.6/4.3/3.6px on screen.
- **Root cause**: A wide, fixed-width staircase (5 steps × 168px) is force-fit to the viewport with no min-width/horizontal-scroll and no font floor; SVG text does not reflow.
- **Impact**: The level id, name, and unlock caption on the "Transition" section are illegible for all mobile visitors — the section's entire payload is unreadable on the most common device class.
- **Fix sketch**: Wrap the SVG in an `overflow-x-auto` container with a `min-w-[640px]`, or bump composition font sizes and reduce STEP_W at small breakpoints so downscaled text stays ≥ ~11px.

## 3. UNLOCK map is untyped and hardcoded to L1–L5, defeating the dynamic staircase
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: latent-inconsistency
- **File**: src/components/about/AboutAscentSteps.tsx:19
- **Scenario**: The component was deliberately rebuilt to derive geometry from `LEVELS.length` (comment lines 14–15) so adding a maturity level reshapes the staircase automatically. But `UNLOCK` is `Record<string, string>` (line 19) keyed to literal "L1".."L5" and read as `UNLOCK[s.id]` (line 94).
- **Root cause**: Unlike `LEVEL_HEX` (`Record<LevelId, string>` in lib/ui.ts:62, which forces a tsc error on a new level), `UNLOCK` is typed `Record<string, string>`, so a 6th level silently yields `undefined`.
- **Impact**: Add an L6 to the model and the new rung renders a blank unlock caption with zero compile-time warning — the opposite of the "adapts automatically" guarantee the file advertises.
- **Fix sketch**: Type it `Record<LevelId, string>` (import `LevelId`) so a missing entry is a compile error, or derive the caption from the level model instead of a side table.

## 4. Primary CTAs skip the branded focus ring every other control uses
- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: focus-state
- **File**: src/components/about/AboutHero.tsx:65
- **Scenario**: The "Scan your org" / "Explore the live demo" links in the hero (lines 65–76) and the identical pair in AboutCTA.tsx:28–33 carry only `transition hover:…` classes — no `focus-ring`.
- **Root cause**: The design system ships one focus token (`.focus-ring` → accent outline, globals.css:197) and every other interactive element opts in (FleetGrid cells, RemotionStage replay, the AboutCTA footer links). The four primary CTAs don't, so keyboard focus falls back to the browser's default UA outline.
- **Impact**: Inconsistent, off-brand (square, non-accent) focus indicator on the page's highest-intent conversion buttons; keyboard users get a jarring mismatch versus the rest of the deck.
- **Fix sketch**: Add `focus-ring` to each of the four CTA `<Link>` classNames.

## 5. ROI sliders hardcode the accent hex instead of the token
- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: token-adherence
- **File**: src/components/about/RoiSimulator.tsx:63
- **Scenario**: The range inputs set `accent-[#3b9eff]` as a literal arbitrary value, while the surrounding DOM uses semantic tokens (`text-accent`, `bg-accent`, `border-divider`).
- **Root cause**: `#3b9eff` is the raw value behind `--color-accent`; hardcoding it forks the accent color out of the token system (legitimate inside the Remotion/SVG canvases, but this is a plain HTML input that can use the token).
- **Impact**: A future accent re-theme updates every control except these sliders, which silently keep the old blue. Minor, but it's exactly the drift the token layer exists to prevent.
- **Fix sketch**: Use the token-backed utility (`accent-accent`) or `style={{ accentColor: "var(--color-accent)" }}`.

## 6. Dynamic-diagram loading placeholder under-reserves height → layout shift
- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: loading-state
- **File**: src/components/about/AboutLanding.tsx:27
- **Scenario**: `ChampionNetwork` and `RiskRadar` are `dynamic(… { ssr:false, loading: DiagramPlaceholder })`. `DiagramPlaceholder` (lines 27–31) renders only the `aspect-video` box, but the real `RemotionStage` always also renders a legend/replay row below it (RemotionStage.tsx:90–107).
- **Root cause**: The placeholder mirrors the video box but not the ~28px legend row that RemotionStage unconditionally paints, so the diagram column grows taller when the client chunk resolves.
- **Impact**: A small vertical jump on the Adoption and Risk sections as the chunk streams in — contradicting the comment on lines 24–26 that promises "no layout shift." Felt on slow connections / first visit.
- **Fix sketch**: Add a matching fixed-height empty row (`<div className="mt-3 h-5" />`) beneath the box in `DiagramPlaceholder`.

## 7. Duplicated CTA button pair drifts in padding and label
- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: component-extraction
- **File**: src/components/about/AboutHero.tsx:64
- **Scenario**: The same two-button CTA (→ `/connect` and `demoOrgHref()`) appears in the hero (lines 64–77) and the closing CTA (AboutCTA.tsx:27–34), but with different paddings (`px-5 py-2.5` vs `px-6 py-3`) and different labels ("Explore the live demo →" vs "Explore the demo →").
- **Root cause**: The pair was copy-pasted rather than extracted, so the two instances silently diverged.
- **Impact**: The identical action reads at two visual weights and two labels on one page — the kind of inconsistency the design system is meant to eliminate; also duplicated maintenance surface.
- **Fix sketch**: Extract an `<AboutCtaButtons size="sm"|"lg" />` component with one canonical label and reuse it in both sections.
