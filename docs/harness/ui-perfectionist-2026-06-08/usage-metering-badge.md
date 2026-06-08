# UI Perfectionist — Usage Metering & Public Badge

> Total: 7 findings (1 critical, 2 high, 3 medium, 1 low)
> Context: Usage Metering & Public Badge | Files audited: 6

## 1. Badge label half vanishes on dark READMEs (no border / no surface contrast)
- **Severity**: Critical
- **Category**: visual-consistency
- **File**: src/app/api/badge/[owner]/[repo]/route.ts:169
- **Scenario**: The badge is a self-contained SVG embedded into GitHub READMEs that render on BOTH a white (light mode, `#ffffff`) and a near-black (dark mode, `#0d1117`) page. The label side is filled with `fill="#0f172a"` (slate-900) — a near-black with no stroke/border anywhere on the SVG. On a GitHub dark README that `#0f172a` label sits at ~1.04:1 against `#0d1117`: the left half of the badge effectively disappears, leaving a floating colored chip with no visible "Ascent" container and no edge.
- **Root cause**: The badge was designed assuming a light page (shields.io's legacy assumption). It hardcodes a single dark label fill and emits no outline, so it has zero separation from a dark backdrop. The lib/ui.ts header comment even flags that "solid FILL behind white text … is out of scope" — meaning the dark-background case was never reconciled for this surface.
- **Impact**: The brand mark and label are unreadable on the most common README rendering context (dark mode is GitHub's default for a large share of developers). The artifact that is supposed to advertise the product looks broken exactly where it's most seen.
- **Fix sketch**: Add a hairline outline that works on both backdrops — e.g. a `<rect ... fill="none" stroke="rgba(148,163,184,0.35)" stroke-width="1"/>` over the full badge (inset 0.5px), and/or lighten the label fill toward `#1e293b` so it reads against pure black. Optionally honor `prefers-color-scheme` via an embedded `<style>` media query so the label fill adapts. Verify the final label fill against both `#ffffff` and `#0d1117`.

## 2. New-org usage page shows a wall of zeros instead of an onboarding empty state
- **Severity**: High
- **Category**: states
- **File**: src/app/usage/page.tsx:101
- **Scenario**: A freshly-onboarded org (DB reachable, but no scans yet) does NOT hit any of the `Notice` early returns — those only fire for sign-in, missing DB, or a transient DB error. So the user lands on the full dashboard: a trend chart that renders its own "No scans recorded in this period" line (UsageTrend.tsx:62), four Stat cards all reading `0`, two empty bar panels, and a footer reading "no scans recorded." It looks like a populated billing page that happens to be empty, not a deliberate "you haven't scanned anything yet" moment.
- **Root cause**: There's no zero-state branch. The page assumes a non-null `usage` always implies data worth charting, so it skips the canonical `EmptyState` component that every other empty surface in the app routes through (per EmptyState.tsx docstring).
- **Impact**: First impression of the metering/ROI surface is a grid of zeros with no call to action — no "Scan your first repo" path. Weak onboarding for a billing view that should motivate usage.
- **Fix sketch**: When `usage.totalScans === 0`, render the page `EmptyState` (icon "📊", title "No scans metered yet", body explaining public-free/private-billable, and a primary action `{ label: "Scan a repo", href: "/", primary: true }`). Keep the full dashboard for any org with ≥1 scan.

## 3. Badge drops the app's mandated non-color (CVD) redundant encoding
- **Severity**: High
- **Category**: accessibility
- **File**: src/app/api/badge/[owner]/[repo]/route.ts:285
- **Scenario**: The badge value renders as `${report.level.id} ${report.level.name}` on a red→green brand fill (e.g. red "L1 Manual" vs green "L5 Autonomous"). Across the app, lib/ui.ts is emphatic that hue must never be the sole signal — `LEVEL_GLYPH` (○ ◔ ◑ ◕ ●) is rendered everywhere a level color appears, and the usage page even stipples the free-vs-billable bar (page.tsx:193) for the same CVD reason. The badge, the most public surface, omits the glyph entirely.
- **Root cause**: The badge value string is assembled ad hoc from id + name and never consults `LEVEL_GLYPH`/`scoreGlyph`. The redundant-encoding convention wasn't carried into this route.
- **Impact**: For red-green CVD viewers (~8% of men, the exact audience cited in ui.ts), a green "pass" L5 badge and a red "fail"/L1 badge differ only by the small L-id and word — the dominant signal (fill color) collapses. The gate badge ("pass"/"fail") is worse: it's pure color + a generic word, no level id at all.
- **Fix sketch**: Import `LEVEL_GLYPH` and prepend the glyph to the value, e.g. `value: \`${LEVEL_GLYPH[report.level.id]} ${report.level.id} ${report.level.name}\``. For the gate badge, add the level glyph or a ✓/✗ mark alongside pass/fail so the verdict survives without color. The `readableOn` ink choice already makes glyphs legible on every fill.

## 4. Badge width estimation is brittle for proportional fonts (clipping/overflow risk)
- **Severity**: Medium
- **Category**: polish
- **File**: src/app/api/badge/[owner]/[repo]/route.ts:151
- **Scenario**: Badge width is computed from a single average char width (`charW = 6.7`, or `7.2` for-the-badge) times character count. Verdana is proportional — "L5 Autonomous" (wide caps + lowercase) vs the for-the-badge UPPERCASE + `letter-spacing="1"` variant won't match a flat 6.7px/char estimate. The text is left-anchored at a fixed `x`, so an under-estimate clips the right edge of the value text against the fill boundary; an over-estimate leaves lopsided padding.
- **Root cause**: A constant-width approximation for a variable-width font, compounded by `letter-spacing` in the for-the-badge style not being added into the width math.
- **Impact**: Longest labels ("L5 Autonomous", "Ascent gate" + "pass") risk visibly clipped or off-center text in the for-the-badge style — a polish failure on a pixel-precise artifact embedded in READMEs.
- **Fix sketch**: Widen the per-char estimate for the uppercase/letter-spaced variant (account for `letter-spacing` × charCount), or switch to `textLength` + `lengthAdjust="spacingAndGlyphs"` on each `<text>` so the renderer fits the text to the computed box instead of guessing. At minimum bump `charW` for the for-the-badge case and add the letter-spacing contribution to `lw`/`vw`.

## 5. Inline `Stat` and `Bar` components are page-local; duplicated card chrome invites drift
- **Severity**: Medium
- **Category**: component-architecture
- **File**: src/app/usage/page.tsx:29
- **Scenario**: `Stat` (line 29) and `Bar` (line 163) are defined inline in the page, and the two side-by-side panels (lines 127, 137) repeat the same `rounded-xl border border-slate-800 bg-slate-900/40 p-5` card chrome by hand. Meanwhile UsageTrend.tsx uses a *different* card radius/padding (`rounded-2xl … p-6`) for an adjacent panel on the same page.
- **Root cause**: No shared card/stat primitive. Each surface hand-rolls its container, so radius (`xl` vs `2xl`) and padding (`p-5` vs `p-6`) have already diverged within one screen.
- **Impact**: Inconsistent corner radius and padding between vertically-stacked cards reads as visual jitter; the `Bar` (with its CVD stipple logic) and `Stat` aren't reusable elsewhere, so future metering surfaces will re-implement them and drift further.
- **Fix sketch**: Extract a `<StatCard>` and `<MeterBar>` into `src/components/usage/` and standardize the card chrome token (pick one radius/padding, e.g. `rounded-2xl p-6` to match UsageTrend). Reuse across the four stats and both ratio panels.

## 6. Provider/usage numbers lack thousands grouping — large counts get hard to read
- **Severity**: Medium
- **Category**: polish
- **File**: src/app/usage/page.tsx:33
- **Scenario**: Stat values render the raw number (`{value}`) in a 3xl tabular-nums font, and the `Bar` shows `{value} · {pct}%`. A billing/ROI surface will surface counts like `12480` scans, which print with no thousands separator. The page is explicitly framed as a finance reconciliation view (CSV/JSON export "for finance reconciliation", UsageTrend.tsx:4).
- **Root cause**: Numbers are interpolated directly with no `toLocaleString()` / `Intl.NumberFormat` formatting, despite the tabular-nums styling signaling an intent for clean numeric legibility.
- **Impact**: Four- and five-digit scan totals are harder to scan and compare at a glance on the exact surface where number legibility is the whole point; tabular-nums alone doesn't add grouping.
- **Fix sketch**: Format counts with `value.toLocaleString()` (or a shared `fmtCount` helper) in `Stat` and `Bar`. Keeps `tabular-nums` for column alignment and makes "12,480" instantly legible.

## 7. Export buttons have a focus ring + hover, but the bar chart's hover affordance is title-only
- **Severity**: Low
- **Category**: polish
- **File**: src/components/usage/UsageTrend.tsx:74
- **Scenario**: Each day's stacked bar exposes its breakdown only via a native `title` attribute (`title={\`${d.date}: …\`}`) and a `group` class that's never used for any visible hover treatment. There's no cursor change, no hover highlight, and no keyboard/touch path to the per-day numbers — the data is reachable only by hovering a mouse and waiting for the OS tooltip.
- **Root cause**: The bar relies entirely on the browser's `title` tooltip; the `group` utility was added (presumably for a hover popover) but no `group-hover:` styling followed.
- **Impact**: Per-day figures are effectively invisible on touch devices and to keyboard users, and the lack of any hover feedback makes the chart feel inert. Minor, but it's the only interactive read-path for the lead visualization.
- **Fix sketch**: Add a lightweight `group-hover:` tooltip (an absolutely-positioned div with date + billable/free counts) or at least a `hover:` brightness/opacity bump on the bar and `cursor-default`→`cursor-help`. For a fuller fix, render an off-screen but focusable summary, or a small data table toggle, so the numbers aren't mouse-only.
