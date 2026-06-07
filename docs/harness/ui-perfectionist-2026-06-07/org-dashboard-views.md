# UI Perfectionist — Org Dashboard & Views

> Total: 8
> Severity: critical 0 · high 3 · medium 4 · low 1
> Scope: 9 files (Org Dashboard & Views)

## 1. Four near-identical data tables hand-rolled across tabs instead of a shared component
- **Severity**: high
- **Category**: component-architecture
- **File**: `src/app/org/[slug]/repositories/page.tsx:37`
- **Scenario**: The bordered, horizontally-scrolling tables on Repositories (leaderboard), Contributors (Involvement + Concentration), and Delivery (Branch governance) — every drill-down tab with tabular data.
- **Root cause**: The wrapper + `<table>` scaffold is copy-pasted in four places: `repositories/page.tsx:37-39` (`overflow-x-auto rounded-2xl border border-slate-800` → `table w-full min-w-[640px] text-sm` → `thead bg-slate-900/60 font-mono text-[10px] uppercase tracking-widest text-slate-500`), and identically at `contributors/page.tsx:97-99`, `contributors/page.tsx:152-154`, and `delivery/page.tsx:91-93`. The min-width even drifts (`min-w-[720px]` on the Involvement table at `contributors/page.tsx:98` vs `min-w-[640px]` everywhere else) with no design reason, so a future thead tweak must be applied four times and will inevitably desync.
- **Impact**: Tabs that should feel like one dashboard are one careless edit away from mismatched header casing, row padding, or border radius; reviewers can't trust that "the table" is consistent.
- **Fix sketch**: Extract an `OrgTable` (or `DataTable`) primitive into `src/components/org/ui.tsx` alongside `Card`/`Tile` — it owns the `overflow-x-auto rounded-2xl border` wrapper, the `min-w` floor, and the shared `thead` styling, taking `columns` (label + align) and `children` rows. Each page then renders only its `<tr>` bodies. Single-sources the four copies the same way `Card` already single-sources panels (`ui.tsx:66`).

## 2. Three competing empty-state treatments across the dashboard
- **Severity**: high
- **Category**: visual-consistency
- **File**: `src/components/org/ui.tsx:137`
- **Scenario**: A user lands on each tab before scans exist. The shell shows one style, the tabs show a second, and the project's canonical component is a third.
- **Root cause**: The org shell renders `OrgEmpty` — a big centered icon + title + body + CTA (`ui.tsx:145`, used at `layout.tsx:40,57`). The sub-tabs instead render `SectionEmpty` — a small dashed grey box (`ui.tsx:137`, used at `delivery/page.tsx:35`, `practices/page.tsx:13`, `contributors/page.tsx:41`). Meanwhile the codebase already ships a canonical centered empty state, `EmptyState` (`src/components/EmptyState.tsx:17`), which `OrgEmpty` itself duplicates almost verbatim (same `flex flex-col items-center py-24`, `text-2xl font-bold`, `max-w-md`, outline-button classes) but with a hardcoded `🏔️` icon and only one action. So there are effectively two centered empty states (one canonical, one org-local clone) plus a dashed inline one, with no rule for which applies where.
- **Impact**: The dashboard's "no data" experience reads as three different products; the org clone also drifted from the canonical button token (`OrgEmpty` uses `hover:border-accent` outline only and one CTA, vs `EmptyState`'s `text-on-accent` primary support).
- **Fix sketch**: Collapse `OrgEmpty` onto the canonical `EmptyState` (pass `icon="🏔️"` and an actions array) so the shell-level empties single-source through `src/components/EmptyState.tsx`. Keep `SectionEmpty` strictly for inline within-tab sections, and document that split in the `ui.tsx` comment so the two are intentionally distinct rather than accidentally divergent.

## 3. Tile grid column counts and gaps drift between tabs
- **Severity**: medium
- **Category**: design-system
- **File**: `src/app/org/[slug]/delivery/page.tsx:62`
- **Scenario**: Comparing the summary-tile rows at the top of Overview, Contributors, and Delivery side by side.
- **Root cause**: The same `Tile` primitive is laid out on three different grid systems: Overview uses `grid gap-4 sm:grid-cols-2 lg:grid-cols-4` (`page.tsx:111`), Contributors copies that exactly (`contributors/page.tsx:57`), but Delivery uses `grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6` for PR signals (`delivery/page.tsx:62`) and `grid grid-cols-2 gap-3 sm:grid-cols-4` for governance (`delivery/page.tsx:85`). The gap token also flips between `gap-4` and `gap-3` with no rationale, and Delivery's 6-up row forces each tile narrower so the `text-3xl` value in `Tile` (`ui.tsx:48`) sits very tight.
- **Impact**: Tiles — the most repeated element on the dashboard — have inconsistent breathing room and breakpoint behavior between tabs, undercutting the "one cohesive dashboard" feel and making the 6-up Delivery row feel cramped vs the airy Overview.
- **Fix sketch**: Add a `TileGrid` wrapper to `org/ui.tsx` (e.g. a `cols` prop mapping to a fixed set of responsive class strings) so every tile row shares one gap token and a sanctioned column ramp. At minimum standardize on `gap-4` everywhere and cap at `lg:grid-cols-4` (let a 5–6 tile row wrap to two rows rather than shrinking).

## 4. SegmentSelector placement and presence is inconsistent across the scoped tabs
- **Severity**: medium
- **Category**: visual-consistency
- **File**: `src/app/org/[slug]/contributors/page.tsx:53`
- **Scenario**: A user sets a segment scope on Overview, switches to Contributors, then to Repositories — expecting the segment control to live in the same spot.
- **Root cause**: Overview places `SegmentSelector` in a dedicated controls row paired with `TimeRangeSelector`, left-labeled "Showing · …" (`page.tsx:84-98`). Contributors instead tucks the selector inline at the end of the intro-paragraph flex row (`contributors/page.tsx:48-54`) and renders a *second, different* placement (`mb-4 flex justify-end`) only in its empty branch (`contributors/page.tsx:36-40`). Repositories tags segments through a whole separate `RepoSegmentsPanel` (`repositories/page.tsx:25`) with no inline scope selector at all, and Delivery/Practices ignore segment scope entirely.
- **Impact**: The same control jumps position (and disappears) tab to tab, so segment scope feels unreliable; users can't build muscle memory for where "scope" lives.
- **Fix sketch**: Introduce a shared `OrgControlsBar` in `org/ui.tsx` (the "Showing · {scope}" label + a right slot for `SegmentSelector`/`TimeRangeSelector`) and render it at the top of every scoped tab, so the selector always sits top-right. Pages that don't support a control simply omit the slot — the bar position stays fixed.

## 5. Hardcoded hex colors bypass the design tokens and `scoreHex`/`deltaHex` helpers
- **Severity**: medium
- **Category**: design-system
- **File**: `src/app/org/[slug]/contributors/page.tsx:61`
- **Scenario**: Any threshold/warning accent on the tabs — solo-maintainer tile, high-concentration meter, bus-factor cell.
- **Root cause**: Pages embed raw hex literals instead of the established tokens. `contributors/page.tsx:61` sets `color={... ? "#f97316" : "#fff"}`; `contributors/page.tsx:178` uses `color={r.topShare >= 80 ? "#f97316" : "#3b9eff"}`; `contributors/page.tsx:182` uses `color: ... "#f97316"`. `globals.css` already defines `--color-warn: #f97316` and `--color-accent: #3b9eff` (`globals.css:11,19`) and `org/ui.tsx` exports `deltaHex`/`signedDelta` for exactly this red/orange/lime semantics (`ui.tsx:17`). The `"#fff"` default also re-implements `Tile`'s own `color ?? "#fff"` fallback (`ui.tsx:48`), so passing `"#fff"` is redundant.
- **Impact**: The warning orange and accent blue are now defined in three places (CSS token, `deltaHex`, and inline literals); retuning the brand warn color would silently miss these tabs, and the redundant `"#fff"` obscures intent.
- **Fix sketch**: Replace the literals with the tokens — use the `warn`/`accent` Tailwind utilities or import a small `WARN_HEX` constant, and drop the `"#fff"` arms entirely (let `Tile`'s default apply). Aligns these tabs with how Overview already routes everything through `scoreHex` (`page.tsx:116`).

## 6. Heatmap numerals become unreadable on low-score cells
- **Severity**: high
- **Category**: polish
- **File**: `src/app/org/[slug]/repositories/page.tsx:110`
- **Scenario**: The Repo × dimension heatmap on the Repositories tab, specifically cells with low scores (the very weaknesses the heatmap exists to surface).
- **Root cause**: Each cell paints a fixed near-black foreground `text-[#04070e]` over a score-colored fill whose opacity scales with the score: `opacity: 0.25 + (v / 100) * 0.75` (`repositories/page.tsx:111-113`). A score of 0 renders the dark `#04070e` numeral on a 0.25-opacity fill sitting on the `#080d1a` canvas — dark text on a near-dark background, far below WCAG AA. The lowest, most important cells are the hardest to read.
- **Impact**: The lowest-maturity dimensions — exactly what a fleet owner scans the heatmap for — have the least legible numbers; this is a contrast/a11y regression on the page's marquee visualization.
- **Fix sketch**: Either floor the fill opacity higher (e.g. `0.45 + (v/100)*0.55`) so the dark numeral always clears contrast, or switch the numeral color based on fill luminance (light text on dark/low-opacity cells, `#04070e` only on bright high-score cells). Keep the score color logic single-sourced via `scoreHex` as it already is.

## 7. Inconsistent vertical rhythm and section-spacing approach between tabs
- **Severity**: medium
- **Category**: visual-consistency
- **File**: `src/app/org/[slug]/delivery/page.tsx:42`
- **Scenario**: Scrolling between tabs — the gap between major sections visibly changes.
- **Root cause**: Section stacks use different spacing tokens: Delivery wraps in `space-y-8` (`delivery/page.tsx:42`), while Overview, Practices, and Repositories use `space-y-6` (`page.tsx:82`, `practices/page.tsx:17`, `repositories/page.tsx:24`). Contributors uses neither — it forgoes a `space-y` wrapper and hand-spaces each block with `mt-6`/`mt-8` (`contributors/page.tsx:57,66,92,142`), a third pattern. So three tabs agree on 6, one uses 8, one uses ad-hoc margins.
- **Impact**: The rhythm of the dashboard subtly shifts per tab; the Contributors hand-margin approach is also fragile (reorder a block and spacing breaks).
- **Fix sketch**: Standardize every tab root on one token — `space-y-6` to match the majority and the shell's `mt-6` content offset (`layout.tsx:83`) — and convert Contributors to a `space-y-*` wrapper so blocks self-space. Consider hoisting a `<TabSection>`/page wrapper into `org/ui.tsx` to enforce it.

## 8. Table rows have no hover affordance despite containing links
- **Severity**: low
- **Category**: polish
- **File**: `src/app/org/[slug]/repositories/page.tsx:55`
- **Scenario**: Hovering rows in the Repositories leaderboard and Contributors tables, each of which contains a clickable repo/report link.
- **Root cause**: Rows are static `<tr className="text-slate-300">` with no `hover:` state (`repositories/page.tsx:55`, `contributors/page.tsx:111`, `contributors/page.tsx:165`, `delivery/page.tsx:107`). Only the inner link text changes color on hover (`hover:text-accent`), so the row itself gives no feedback even though Delivery's commit-activity bars *do* have a hover treatment (`delivery/page.tsx:15` `hover:bg-accent`) — establishing that hover feedback is an in-product expectation here.
- **Impact**: Wide rows feel inert and it's hard to track which row you're on while scanning across many columns; minor scannability/polish gap.
- **Fix sketch**: Add a subtle `hover:bg-slate-900/40 transition-colors` to row markup (ideally once, inside the extracted `OrgTable` from finding #1, so all four tables gain it together). Pairs with the brand's existing motion vocabulary in `globals.css`.
