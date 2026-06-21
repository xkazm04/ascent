> Total: 6 findings (0 critical, 1 high, 3 medium, 2 low)

# Design System: UI Primitives & Deck — combined bug+ui scan

## 1. DeckNav section dots have no visible keyboard focus indicator and their labels are invisible until hover
- **Severity**: High
- **Lens**: ui-perfectionist
- **Category**: accessibility
- **File**: src/components/deck/DeckNav.tsx:36-41
- **Scenario**: A keyboard user tabs through the right-edge section nav. Each dot is an `<a>` with no `focus-ring` class. The label `<span>` is `opacity-0 group-hover:opacity-100` and only forced visible for the *active* section. So when a non-active dot receives keyboard focus, the user sees neither a focus outline (the dot relies on the UA default, which is suppressed on most dark themes / can be `outline:none` globally) nor the destination label — they cannot tell which section the focused dot jumps to.
- **Root cause**: Focus visibility was modeled only via `:hover` (a pointer affordance); `:focus-visible` was never wired. The rest of the design system uses the shared `.focus-ring` utility (see SideNav `itemClass` line 29), but DeckNav predates / skips it.
- **Impact**: Keyboard and screen-magnifier users get an unlabeled, unfocused-looking control — a WCAG 2.4.7 (focus visible) and effectively 2.4.4 (link purpose) gap on a primary nav primitive.
- **Fix sketch**: Add `focus-ring` (or `focus-visible:outline`) to the anchor, and reveal the label on focus too: `group-hover:opacity-100 group-focus-within:opacity-100` / `focus-visible:opacity-100`. Reuse the established `.focus-ring` class for consistency with SideNav.

## 2. Reveal defaults to `once: false`, so content fades back to opacity 0 every time it leaves the viewport — even outside a snap deck
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: motion-design
- **File**: src/components/deck/Reveal.tsx:26
- **Scenario**: `Reveal` is consumed in `IndexVariant` to wrap free-flowing blocks (`IndexLevels`, `EditorialSteps`, `DimensionMatrix`, `PricingCards`) that are NOT `snap-start` full-viewport sections. With `viewport={{ once: false }}`, every block re-runs its entrance (opacity 0 → 1, y 22 → 0) each time the user scrolls it out and back. On a normal-scrolling marketing page this reads as content repeatedly flickering/blanking on up-scroll, not the intended one-shot reveal-per-snap.
- **Root cause**: `once: false` is correct only for the snap-deck use case (re-reveal when you snap *back* to a section). It was baked in as the component default, so every reuse inherits deck-specific behavior. There is no prop to opt into `once: true`.
- **Impact**: Distracting/janky entrances and content momentarily disappearing on a flagship marketing surface; also extra animation work on every scroll.
- **Fix sketch**: Expose an `once?: boolean` prop (default `true` for general reuse) and have the deck pass `once={false}` explicitly; or default `once: true` and let `AboutLanding`/snap consumers opt out.

## 3. Stat hardcodes `#fff` and format.ts hardcodes delta hex values, bypassing the token-over-hex convention
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: design-tokens
- **File**: src/components/ui/Stat.tsx:20; src/components/ui/format.ts:11
- **Scenario**: `Stat` defaults `color = "#fff"` and applies it via inline `style`. `format.ts` `deltaHex` returns literal `#94a3b8` / `#84cc16` / `#f97316`. The repo enforces token-over-hex (`@theme` exposes `--color-warn: #f97316` and the slate palette); the orange `#f97316` here is literally the value of `--color-warn` re-typed by hand, and `#fff` duplicates the default text color. These are the canonical number/delta primitives, so the drift is high-leverage.
- **Root cause**: Delta/value coloring is done through inline `style={{ color }}` (needed for the data-driven up/down/noise cases), and the constants were inlined as raw hex instead of reading the CSS custom properties (`var(--color-warn)`, etc.).
- **Impact**: A future palette change to `--color-warn`/accent leaves Stat deltas stale; the down/orange delta and a `warn` badge elsewhere can silently diverge. Inconsistent with the hardened token system the rest of the deck honors (`text-accent`, `bg-divider`).
- **Fix sketch**: Have `deltaHex` return `var(--color-...)` strings (down → `var(--color-warn)`; flat/noise → a slate token var; up → a lime token, adding `--color-success` if absent) and default `Stat` color to `var(--color-fg, #fff)` / `text-white` via class rather than `#fff`.

## 4. DeckNav active state is never cleared when no section sits in the middle band
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: state-management
- **File**: src/components/deck/DeckNav.tsx:18-23
- **Scenario**: The IntersectionObserver uses `rootMargin: "-45% 0px -45% 0px"`, leaving only a ~10% center band as the trigger zone, and the callback only ever calls `setActive(e.target.id)` for `isIntersecting` entries — it never reacts to a section *leaving* the band. At the very top/bottom of the page, during fast scrolls, or in the gaps between non-full-height sections, no section is in the band, so the dot stays lit on whichever section was last centered, which may not be the one filling the viewport. Initial `active` is also hardcoded to `sections[0]` regardless of a deep-link hash on load.
- **Root cause**: Active-section detection assumes exactly one section always occupies the narrow center band; the "no current intersection" case isn't handled, and there's no fallback to the most-visible section.
- **Impact**: The nav indicator can point at the wrong section (stale highlight), undermining the deck's wayfinding affordance. Cosmetic but on a primary nav primitive.
- **Fix sketch**: Track `intersectionRatio` across entries and pick the max-visible section, or widen the band and clear/recompute when entries report `isIntersecting === false`; initialize `active` from `location.hash` when present.

## 5. Dateline drops the `right` metadata entirely below the `sm` breakpoint
- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: responsive
- **File**: src/components/ui/Dateline.tsx:19
- **Scenario**: The `right` slot renders inside `className="hidden sm:inline"`, so on phones the right-hand masthead metadata (e.g. a date, edition label, or scan freshness passed by report/org headers) silently vanishes rather than wrapping below the left text. Callers passing meaningful info there lose it on the most common viewport.
- **Root cause**: The masthead was designed as a single non-wrapping row; the mobile fallback chosen was "hide" instead of "stack".
- **Impact**: Information loss on mobile for any surface that puts non-decorative content in `right` (the doc lists report header / org overview as consumers).
- **Fix sketch**: Allow wrapping (`flex-wrap` + drop `hidden sm:inline`, let `right` move to a second line) or stack on small screens, so the metadata degrades gracefully instead of disappearing.

## 6. SideNav uses array index as React key for groups and items, breaking identity on reorder/filter
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: render-correctness
- **File**: src/components/ui/SideNav.tsx:77,85
- **Scenario**: Groups are keyed `key={gi}` and items `key={i}` (array index). If a consumer conditionally inserts/removes a group or item (e.g. a hint count appears, a tab is gated by plan/role), React reconciles by position, not identity, so focus state and the active `before:` accent-bar marker can attach to the wrong row during the transition, and DOM nodes are reused across semantically different items.
- **Root cause**: No stable identifier on `SideNavItem`/`SideNavGroup`, so index was used as a fallback key.
- **Impact**: Subtle mis-highlighting / focus jumps when the nav set changes; minor but it's the shared nav primitive for org dashboards and report tabs.
- **Fix sketch**: Derive a stable key from `item.href` (or add an optional `key`/`id` field to `SideNavItem`/`SideNavGroup`) and a stable `g.label`-based key for groups, falling back to index only when none exists.
