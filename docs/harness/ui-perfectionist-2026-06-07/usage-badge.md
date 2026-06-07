# UI Perfectionist — Usage Metering & Public Badge

> Total: 6
> Severity: critical 0 · high 2 · medium 3 · low 1
> Scope: 2 files (Usage Metering & Public Badge)

## 1. Badge paints white text on the light L3/L4/L5 brand fills — illegible value side
- **Severity**: high
- **Category**: visual-consistency
- **File**: `src/app/api/badge/[owner]/[repo]/route.ts:153`
- **Scenario**: Every `<L4 Advanced>`/`<L5 AI-Native>` (and `gate=pass`) badge embedded in a README. The value (right) panel is filled with `LEVEL_HEX[level]` and the text group is hardcoded `fill="#fff"` (`route.ts:153`, fill applied at `route.ts:150` rect + `route.ts:155` value text).
- **Root cause**: The badge correctly *reuses* `LEVEL_HEX` (good — brand colors stay in lockstep with the app), but `LEVEL_HEX` was tuned as a *foreground* numeral color on the dark app canvas, not as a *background* fill behind white. `lib/ui.ts:28-29` explicitly documents this: "As a solid FILL behind white text — e.g. the README badge — the lighter tokens fail; that surface is out of scope for this numeral-contrast pass." So L3 yellow `#eab308`, L4 lime `#84cc16`, L5 green `#22c55e` behind `#fff` land at roughly 1.7–2.2:1 — far below the 4.5:1 AA floor.
- **Impact**: A repo's headline maturity badge — the highest-maturity, most-shareable result — is the *least* readable. White "L4 Advanced" on lime is a near-invisible smear in third-party READMEs on any background.
- **Fix sketch**: Choose the value-text color by luminance instead of a constant `#fff`. Add a small `contrastText(bgHex)` helper (return `#0f172a` for light fills L3/L4/L5, `#fff` for dark fills L1/L2/blue) and use it at `route.ts:153-155`. Keep the `LEVEL_HEX` fill so brand color mapping stays unified; only the overlaid text color adapts. shields.io does exactly this.

## 2. Value text vertical position is hardcoded for h=28 and clips in the 20px flat-square style
- **Severity**: high
- **Category**: visual-consistency
- **File**: `src/app/api/badge/[owner]/[repo]/route.ts:135`
- **Scenario**: `?style=flat-square` badges. Height drops to 20 (`route.ts:124`) but the text baseline is `ty = Math.round(h/2) + 4` (`route.ts:135`), and the logo y-offset `Math.round((h-14)/2)` (`route.ts:143`) is also height-derived.
- **Root cause**: `ty` adds a flat `+4` baseline nudge calibrated for the 28px-tall flat/for-the-badge styles. At h=20 the 12px text baseline sits at y=14, leaving only 6px below for descenders and visually pushing the glyphs toward the bottom edge — uneven optical centering and risk of clipped `g`/`y` descenders on some renderers.
- **Impact**: flat-square badges (a common README preference for square corners) look vertically misaligned and slightly cropped — the one style users pick for tidiness reads as sloppy.
- **Fix sketch**: Derive the baseline from font metrics, not a constant: `ty = Math.round((h + fontSize * 0.72) / 2)` (cap-height-aware), and verify the logo offset against the actual 14px image at each height. Add a quick visual snapshot for all three styles.

## 3. /usage chart/bar colors are raw hex literals that drift from the `--color-accent` token
- **Severity**: medium
- **Category**: design-system
- **File**: `src/app/usage/page.tsx:121`
- **Scenario**: The "Public vs private" and "By inference engine" bars (`page.tsx:120-121`, `page.tsx:134`) and the trend chart (`UsageTrend.tsx:9`, `UsageTrend.tsx:27-29`) all encode the brand azure as the literal `#3b9eff`.
- **Root cause**: `globals.css:8` defines `--color-accent: #3b9eff` exactly so this value lives in one place (Tailwind emits `bg-accent`/`text-accent`). The bars bypass the token and inline the hex because they pass `color` into a `style={{ backgroundColor }}` prop and to inline SVG, so they can't use the utility class directly — but they can read the CSS var.
- **Impact**: A future accent retune (the whole point of the token) silently skips the two most data-dense surfaces on the billing page, so /usage drifts off-brand from the rest of the app.
- **Fix sketch**: Reference the token via `var(--color-accent)` in the inline styles (e.g. `color="var(--color-accent)"` for the billable bar; `BILLABLE = "var(--color-accent)"` in `UsageTrend.tsx:9`). The "free/public" slate already uses neutral greys, but align them too (`#64748b`/`#94a3b8`/`#475569` appear across `page.tsx:120`, `UsageTrend.tsx:11`, `UsageTrend.tsx:28` for the *same* concept — pick one).

## 4. "Free" series color is inconsistent between the legend, the trend bars, and the totals copy
- **Severity**: medium
- **Category**: visual-consistency
- **File**: `src/components/usage/UsageTrend.tsx:11`
- **Scenario**: Within the single UsageTrend card, the "free (public)" concept is drawn with three different greys: the legend swatch and stacked bars use `FREE = "#475569"` (`UsageTrend.tsx:11`, applied `UsageTrend.tsx:57`/`:79`), but the summary line beneath the title colors the "free" number with `#94a3b8` (`UsageTrend.tsx:28`). On the page below, the "Public (free)" bar uses yet another grey `#64748b` (`page.tsx:120`).
- **Root cause**: Each surface hardcoded its own slate independently; no shared "free series" token.
- **Impact**: The eye can't lock "free = this grey" because the grey shifts between the legend, the bars, the count, and the page bar — undermining the legend's whole job and making the public/private split harder to parse at a glance.
- **Fix sketch**: Single-source the two series colors (e.g. `SERIES = { billable: "var(--color-accent)", free: "#475569" }`) and use them for the swatch, bars, the totals number, and the page-level "Public (free)" `Bar` so the same hue means the same thing everywhere.

## 5. "By inference engine" provider bars are visually undifferentiated and render raw provider ids
- **Severity**: medium
- **Category**: visual-consistency
- **File**: `src/app/usage/page.tsx:134`
- **Scenario**: The provider-mix card maps every provider to the *same* azure bar (`color="#3b9eff"` for all rows, `page.tsx:134`) and prints `p.provider` verbatim as the label.
- **Root cause**: The map reuses one constant color and the un-normalized DB string. With identical hue per row the only differentiator is bar length, and a raw id like `anthropic`/`openai` shows lowercase/unbranded.
- **Impact**: A "provider mix" visualization where every provider is the same color reads as a single stack, defeating the "mix" framing; raw ids look unpolished next to the rest of the typographically-tuned page.
- **Fix sketch**: Either give providers a stable categorical palette (a small ordered hue ramp keyed by index) or keep one accent but lead each row with a provider chip/label-cased name. Route the label through a `providerLabel()` formatter so `anthropic` → `Anthropic`. Keep length+percent as the quantitative encoding.

## 6. The two metric-summary cards are a re-implemented Stat/Bar pair, not shared components, and the Notice empty path lacks a "View usage docs" affordance
- **Severity**: low
- **Category**: component-architecture
- **File**: `src/app/usage/page.tsx:113`
- **Scenario**: `Stat` (`page.tsx:29`) and `Bar` (`page.tsx:150`) are defined inline in the page, and the two card wrappers at `page.tsx:114` and `page.tsx:124` repeat the exact same `rounded-xl border border-slate-800 bg-slate-900/40 p-5` shell verbatim. The empty/notice states (`page.tsx:24`) correctly route through the canonical `EmptyState`, but offer only a single "← Home" action.
- **Root cause**: The card chrome is copy-pasted rather than extracted into a `Card`/`Panel`; `Bar` is page-local even though the chart card (UsageTrend) already owns a near-identical legend+bar pattern.
- **Impact**: Minor drift risk (a tweak to one card's padding/border won't propagate to the other) and a slightly dead-end empty state on a billing page.
- **Fix sketch**: Extract the repeated `rounded-xl border border-slate-800 bg-slate-900/40 p-5` shell into a tiny `Panel` wrapper used by both cards (and reusable elsewhere), and consider promoting `Bar` next to `UsageTrend` so the two surfaces share one bar primitive. Add a secondary action to the `Notice` `EmptyState` (e.g. a docs/setup link) so the DB-unconfigured path isn't a single back-button.
