# Design System: UI Primitives & Deck — bug-hunter + ui-perfectionist scan

> Context: Design System: UI Primitives & Deck (group: Marketing Site & Design System)
> Files scanned: 12
> Total: 7 findings (Critical: 0, High: 0, Medium: 4, Low: 3)

## 1. Reveal ships content at `opacity:0` — blank sections without JS / on hydration failure
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: latent-failure
- **File**: src/components/deck/Reveal.tsx:24
- **Scenario**: `Reveal` wraps essentially every block of the `/about` and index landings (AboutFeature.tsx:30/47, AboutCost.tsx, AboutCTA.tsx, IndexVariant.tsx). framer-motion renders the `initial={{ opacity: 0 }}` style into the SSR HTML, and the `whileInView` transition to `opacity:1` only fires client-side via its IntersectionObserver. If JS is disabled, blocked, or the client bundle fails to hydrate, every Reveal-wrapped section stays at `opacity:0`.
- **Root cause**: false assumption that the reveal animation always runs — the entrance is treated as progressive enhancement but the *hidden* start state is emitted server-side, so a no-JS render is the permanently-hidden state, not the content.
- **Impact**: the marketing landing (the app's public front door) renders visually blank for no-JS visitors and any crawler that doesn't execute JS; a partial hydration error blanks the page for real users. UX / SEO degradation.
- **Fix sketch**: gate the hidden start on client mount, or use framer-motion's SSR-safe pattern — e.g. `initial={false}` with a mounted flag, or render the content visible by default and animate via a class only after mount so the static HTML is never `opacity:0`.

## 2. Delta formatters mis-sign NaN / Infinity / non-integer inputs with no guard
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: edge-case
- **File**: src/components/ui/format.ts:42
- **Scenario**: `fmtDelta`/`deltaHex`/`signedDelta` are the shared delta primitives used across Stat, briefingShared, LiveWarRoomOpsPipeline, etc. Any caller that computes `now - prior` where `prior` is missing yields `NaN`; a ratio/percent path can yield `Infinity` or a float. `fmtDelta(NaN)` → `isWithinNoise(NaN)` is false, `NaN > 0` is false → `"▼NaN"`, and `deltaHex(NaN)` returns the orange "falling" hex. `fmtDelta(Infinity)` → `"▲+Infinity"`. `fmtDelta(1.5)` → `"≈+1.5"`.
- **Root cause**: the primitives assume a finite integer score delta; `Math.abs`/`>` comparisons silently fall through the ternary chain for `NaN`, producing a confident-but-wrong arrow + color instead of a neutral fallback.
- **Impact**: a missing-baseline metric renders as a confident orange "▼NaN" (or "+Infinity") in dashboards/PDFs — success theater that reads as a real decline. format.test.ts never exercises NaN/Infinity/float.
- **Fix sketch**: add `if (!Number.isFinite(d)) return "—"` at the top of `fmtDelta`/`signedDelta` and return the slate hex from `deltaHex`; round or reject non-integers explicitly. Add tests for NaN/Infinity/1.5.

## 3. Stat renders raw numeric values with no thousands grouping — inconsistent across the app
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: visual-consistency
- **File**: src/components/ui/Stat.tsx:30
- **Scenario**: The canonical number block prints `{value}` verbatim (only `tabular-nums`, no grouping). usageDashboard.tsx:103–104 passes `value={usage.inputTokens}` / `outputTokens` — raw numbers that can reach millions, rendering as `4823019`. Meanwhile DeliveryActivityChart.tsx:90/95 formats the same class of metric with `.toLocaleString()`, and other callers pre-stringify. So identical metrics get grouped separators in one surface and an unbroken digit run in the "canonical" one.
- **Root cause**: the design-system number primitive delegates all formatting to callers, so "the single source of truth for headline metrics" has no house number style — grouping is applied ad hoc.
- **Impact**: large token/scan counts are hard to read and visibly inconsistent between the usage dashboard and every other metric surface. Design-system-adherence / legibility.
- **Fix sketch**: when `value` is a `number`, run it through `toLocaleString()` inside Stat (or a `format?: "int" | "raw"` prop defaulting to grouped); keep string values pass-through for pre-formatted callers.

## 4. Dateline silently drops its right-hand metadata on mobile
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: responsiveness
- **File**: src/components/ui/Dateline.tsx:20
- **Scenario**: The `right` slot is wrapped `className="hidden sm:inline"`, so below the `sm` breakpoint the entire right metadata (date / status / edition — whatever the flagship masthead puts there) is `display:none` with no fallback. On a phone the masthead shows only the left kicker against an otherwise empty `justify-between` row.
- **Root cause**: the primitive assumes the right node is decorative/secondary, but callers (landing masthead, report header, org overview) use it for real metadata; hiding rather than reflowing loses information on the smallest, most common viewport.
- **Impact**: mobile visitors lose masthead metadata entirely; the border row also looks lopsided (left-aligned lone label). UX degradation on the primary device class.
- **Fix sketch**: instead of `hidden sm:inline`, reflow — e.g. stack the right node under the left on mobile (`flex-col sm:flex-row sm:justify-between`) so it's still shown, or expose a prop letting the caller opt into hiding only truly-decorative content.

## 5. useSnapDeck toggles a global `<html>` class with no refcount
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: state-corruption
- **File**: src/components/ui/../deck/useSnapDeck.ts:10
- **Scenario**: The hook does `html.classList.add("snap-deck")` on mount and `remove` on cleanup. During an overlapping route transition (the new deck page mounts before the old one unmounts) or if two deck components ever coexist, the *unmounting* instance's cleanup strips `snap-deck` even though a still-mounted deck needs it — the surviving deck loses scroll-snap until re-rendered.
- **Root cause**: a shared singleton (`documentElement`'s class) is mutated as if this hook were its sole owner; add/remove is not reference-counted.
- **Impact**: intermittent loss of scroll-snap on `/about` or the index deck during client-side navigation between deck routes. Rare, hard to reproduce, self-heals on next mount — hence Low.
- **Fix sketch**: refcount via a module-level counter (increment on mount, decrement on cleanup; add the class when count goes 0→1, remove only when it returns to 0), so the class survives as long as any deck is mounted.

## 6. Direction-color triad is duplicated inside format.ts, defeating its "one place" promise
- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: design-system-adherence
- **File**: src/components/ui/format.ts:11
- **Scenario**: `deltaHex` (line 11) hardcodes the triad `#94a3b8 / #84cc16 / #f97316` as inline ternary literals, while `DIRECTION_TONE` (lines 22–26) declares the *same three hex values* again in the object it documents as "the only copy so a glyph/color rebrand lands in one place." The two copies can drift.
- **Root cause**: the module states a single-source-of-truth guarantee but keeps two independent literal copies of the color triad instead of having `deltaHex` read from `DIRECTION_TONE`.
- **Impact**: a brand recolor of the up/down/flat palette must be edited in two spots in the same file; miss one and Stat's delta color diverges from every `DIRECTION_TONE` consumer. Maintainability foot-gun in the design system.
- **Fix sketch**: derive `deltaHex` from the object — `DIRECTION_TONE[toneFor(d)].color` — so both the arrow badge and the tone map resolve from one literal set.

## 7. HairlineGrid silently collapses to a single column when the caller omits grid-cols
- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: component-api
- **File**: src/components/ui/HairlineGrid.tsx:6
- **Scenario**: The primitive applies `grid gap-px ...` but no `grid-cols-*` — it relies entirely on the caller passing a column count via `className`. A caller that forgets gets CSS grid's implicit single column: the "cluster of cells with hairline rules between them" degrades to a vertical stack with only horizontal rules, and no error signals it.
- **Root cause**: a required layout input (column count) is undeclared in the props API and pushed into a free-form `className`, so misuse fails silently rather than at the type boundary.
- **Impact**: subtle, easy-to-ship layout regression for any new HairlineGrid usage; the failure is a plausible-looking single column, not an obvious break.
- **Fix sketch**: give HairlineGrid a `cols` prop (or a sensible default like `sm:grid-cols-2 lg:grid-cols-3`) and document that the caller-supplied grid-cols is required; optionally warn in dev if no `grid-cols` class is present.
