# Design System: UI Primitives & Deck — ambiguity+ui scan (2026-07-16)
> Total: 5 (Critical: 0, High: 1, Medium: 3, Low: 1)

## 1. Mobile deck bottom bar occludes section content and ignores the iOS safe area
- **Severity**: High
- **Category**: missing-state
- **File**: `src/components/deck/DeckNav.tsx:73-105`
- **Scenario**: Below `lg`, DeckNav renders a `fixed inset-x-0 bottom-0` bar (~56px tall: chapter label + progress strip + `p-2` arrow targets), but nothing compensates for it. `DeckSection` gives every snapped pane only `pb-10` (`src/components/deck/DeckSection.tsx:10`), and the deck's decorative connector node/hairline sits at `bottom: 1.25rem / 1.6rem` (`globals.css` `.snap-deck section[id]::before/::after`) — both land *under* the bar on every phone/tablet. On iOS the home-indicator inset overlaps the prev/next tap targets because there is no `env(safe-area-inset-bottom)` padding.
- **Root cause**: The bar was added as an overlay affordance without updating the deck's vertical rhythm contract (section bottom padding, connector position) or accounting for notched-device insets — the layers evolved independently.
- **Impact**: The last line of tall proximity-scrolled sections (pricing tiers, dimension table — the exact sections the `proximity` snap comment says must be reachable) plus the signature connector glyph are permanently covered on mobile; prev/next arrows are partially unreachable on iPhones, degrading the only small-screen jump affordance.
- **Fix sketch**: Add `pb-[calc(0.5rem+env(safe-area-inset-bottom))]` to the bar; below `lg`, give `.snap-deck` a `scroll-padding-bottom` / bump `DeckSection`'s `pb` to clear the bar (share the bar height as a CSS var, e.g. `--deck-bar-h`), and lift or hide the `::before/::after` connector under `lg`.

## 2. Two disjoint color systems: hex-in-TS direction tones vs CSS-var brand tokens, and Stat's free-form `color` prop
- **Severity**: Medium
- **Category**: visual-inconsistency
- **File**: `src/components/ui/format.ts:22-26` (also `Stat.tsx:33`)
- **Scenario**: `DIRECTION_TONE` hardcodes `#84cc16` / `#f97316` / `#94a3b8` (Tailwind lime-500 / orange-500 / slate-400) as TS string literals, while every other primitive in this kit themes through CSS tokens (`text-accent`, `bg-surface`, `border-divider`). `Stat` additionally accepts any `color?: string` (default `"#fff"`) applied as inline style, and `goal.color` is another caller-supplied raw string.
- **Root cause**: The formatters were centralized ("keep this the only copy") but never connected to the token layer; `Stat` delegated tone selection to callers instead of a constrained variant API.
- **Impact**: A rebrand or dark/light-theme change via CSS variables silently misses every delta arrow, mover row, and stat value; nothing stops a call site passing an off-palette hex, so number tones drift per surface — exactly the hand-rolled-literal problem Kicker/Surface were built to end.
- **Fix sketch**: Move the triad to CSS vars (`--tone-rising` etc.) consumed by both CSS and `DIRECTION_TONE` (or export utility classnames); narrow `Stat`'s `color`/`goal.color` to a small union of named tones (`"default" | "rising" | "falling" | "accent"`) resolved internally, keeping one escape hatch if truly needed.

## 3. SideNav's mobile scroller drops group labels entirely and gives no overflow affordance
- **Severity**: Medium
- **Category**: a11y
- **File**: `src/components/ui/SideNav.tsx:36-38`
- **Scenario**: Below `lg`, group labels are `hidden ... lg:block` — `display:none` removes them from the accessibility tree too, so screen-reader and sighted mobile users both get one undifferentiated strip of items separated only by an `aria-hidden` 1px tick. Nothing (fade mask, snap, scroll hint) indicates that items continue past the right edge of the `overflow-x-auto` rail.
- **Root cause**: "The horizontal mobile rail stays compact" traded away group semantics wholesale instead of degrading them, and overflow discoverability was never designed for the horizontal mode.
- **Impact**: On the data-dense report surface this nav serves, mobile users can't tell which section a tab belongs to and may never discover trailing tabs at all — the exact "outgrown a horizontal tab bar" problem the component exists to solve reappears on small screens.
- **Fix sketch**: Keep labels in the a11y tree below `lg` (`sr-only lg:not-sr-only` on the Kicker text, or `aria-label` on each group wrapper via `role="group"`); add an edge fade (`mask-image` gradient) or `scroll-snap-type: x proximity` + partial-item peek so overflow is visible.

## 4. `shortDate` documented as "the viewer's locale" but the SSR pass renders the server's locale
- **Severity**: Medium
- **Category**: undocumented-assumption
- **File**: `src/components/ui/format.ts:51-53`
- **Scenario**: `shortDate` calls `toLocaleDateString(undefined, …)` and its doc promises "in the viewer's locale". Its call sites (`QuotaNotice.tsx`, `TrendChart.tsx`, `chartHover.tsx`) are `"use client"` components — which Next.js still prerenders on the server, where `undefined` resolves to the *server's* ICU locale (typically en-US). A viewer whose browser locale differs hydrates "Jun 9" into "9 juin".
- **Root cause**: The helper's contract was written from the browser's perspective; the SSR-prerender-of-client-components behavior is an unstated assumption, and no call-site guidance says "client-after-mount only".
- **Impact**: React hydration-mismatch warnings (and with React 18+ possible subtree client re-render) for any non-en-US visitor on the report page; dates flicker between two formats; the "single source for the compact date" promise quietly becomes "single source of an inconsistency".
- **Fix sketch**: Either pin the locale explicitly (`"en-US"`, matching the brand's mono/editorial voice) and update the doc, or document that callers must render it post-mount / wrap in `suppressHydrationWarning`, choosing one and recording why.

## 5. Sticky-header height is a magic number re-encoded per primitive (`scroll-mt-24`, `pt-14`)
- **Severity**: Low
- **Category**: magic-number
- **File**: `src/components/ui/Surface.tsx:23`
- **Scenario**: `Surface` compensates for "the sticky header" with a hardcoded `scroll-mt-24` (96px); `DeckSection` independently encodes the same assumption as `pt-14` (56px) (`DeckSection.tsx:10`); globals.css mentions sections "clear the sticky header with internal top padding". Three files each guess the header's height, and two of them disagree.
- **Root cause**: No shared token (CSS var or exported constant) for the app header height; each primitive baked in whatever offset looked right at authoring time.
- **Impact**: Any header redesign (taller banner, env notice, second row) silently breaks deep-link anchor alignment on every `Surface id=` panel and crowds deck-section tops — and there's no single place to fix it or test against.
- **Fix sketch**: Define `--header-h` once where the header is built, use `scroll-mt-[calc(var(--header-h)+0.5rem)]` in `Surface` and derive `DeckSection`'s top padding from it; note the contract in a one-line comment at the header component.
