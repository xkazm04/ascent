# UI Perfectionist — Org Dashboard & Views

> Total: 9 findings (0 critical, 3 high, 5 medium, 1 low)
> Context: Org Dashboard & Views | Files audited: 9

## 1. D9 Security is silently dropped from every fleet view
- **Severity**: High
- **Category**: visual-consistency
- **File**: src/components/org/ui.tsx:11
- **Scenario**: `DIMS = ["D1"…"D8"]` drives the repositories heatmap columns (`repositories/page.tsx:89`, `:104`) and is the canonical dimension order, yet `DIMENSION_SHORT` in `src/lib/ui.ts:8-18` defines nine dimensions including `D9: "Security"`. The repo×dimension heatmap and the overview "Dimension averages" therefore present an 8-column story while the rubric scores 9. A security-weak repo looks complete because its weakest axis is never rendered.
- **Root cause**: `DIMS` was hand-frozen at 8 and never re-synced when D9 Security was added to the model. The two sources of truth (`DIMS` vs `DIMENSION_SHORT`) have drifted.
- **Impact**: A whole maturity dimension — Security, arguably the highest-stakes one for a SaaS audience — is invisible in the densest comparison surface. Users draw conclusions from an incomplete heatmap.
- **Fix sketch**: Derive `DIMS` from the canonical dimension list (`Object.keys(DIMENSION_SHORT)` or the model's `DIMENSIONS`) rather than a frozen literal, so adding a dimension automatically widens the heatmap. Confirm the overview `rollup.dimAverages` source also emits D9. If the 8-wide layout is deliberate, the heatmap needs a visible "+ Security tracked separately" affordance rather than a silent omission.

## 2. OrgNav is a faux tab bar with no ARIA and a hidden-overflow scroll trap
- **Severity**: High
- **Category**: accessibility
- **File**: src/components/org/OrgNav.tsx:23-40
- **Scenario**: 11 tabs render as plain `<Link>`s inside `<nav className="… overflow-x-auto …">`. There is no `role="tablist"`/`role="tab"`, no `aria-current="page"` on the active link, and on a narrow viewport the 11 tabs overflow horizontally with no scroll affordance (no fade/shadow edge, no arrows). A screen-reader user hears 11 undifferentiated links with no "selected" state; a touch user may not realize tabs continue past "Plan".
- **Root cause**: Active state is conveyed purely visually (`border-accent text-white`) with no semantic/ARIA equivalent, and the overflow container has no edge cue.
- **Impact**: Keyboard and SR users can't tell which org view they're on; mobile users silently lose access to the last 4-5 tabs (Plan, Backlog, Audit).
- **Fix sketch**: Add `aria-current="page"` to the active `<Link>` (cheapest correct fix; tablist semantics are wrong here since each tab is a route, not a panel toggle). Add a right-edge mask (`[mask-image:linear-gradient(...)]` or a gradient overlay) that appears when content overflows so the cut-off is visible, and ensure the active tab scrolls into view on mount.

## 3. OrgScanButton bypasses design tokens and re-implements the Meter primitive
- **Severity**: Medium
- **Category**: design-system
- **File**: src/components/org/OrgScanButton.tsx:52, :58-59, :64
- **Scenario**: The button hardcodes `text-[#04070e]` and the error uses `text-red-400`, while `globals.css:11-17` explicitly introduced `--color-on-accent` (text-on-accent) and `--color-danger` (text-danger) *specifically to replace these literals* across connect/onboarding/auth. The inline progress bar (`h-1.5 overflow-hidden rounded-full bg-slate-800` + `bg-accent` fill, lines 58-59) is a hand-rolled duplicate of the shared `Meter` component in ui.tsx:140.
- **Root cause**: This client island predates (or skipped) the token migration and the `Meter` extraction; it never adopted either.
- **Impact**: The scan button — the org dashboard's single primary action — is the one element still off-token, so a future accent/danger retune misses it. The duplicated bar can drift from `Meter`'s radius/height/animation.
- **Fix sketch**: Swap `text-[#04070e]`→`text-on-accent`, `text-red-400`→`text-danger`. Replace the inline bar markup with `<Meter value={pct} size="sm" />` (it already clamps and animates). Reuses the strata/meter language for free.

## 4. Hand-rolled tile cards duplicate `Card` with a drifted radius across three pages
- **Severity**: Medium
- **Category**: component-architecture
- **File**: src/app/org/[slug]/page.tsx:304, src/app/org/[slug]/contributors/page.tsx:73
- **Scenario**: The org-recommendations rows (`page.tsx:304`: `rounded-xl border border-slate-800 bg-slate-900/40 p-4`), the gap-list items (`page.tsx:194`: `rounded-lg …`), and the AI-champion cards (`contributors/page.tsx:73`: `rounded-xl border border-slate-800 bg-slate-900/40 p-4`) all reproduce the `Card` look by hand — but `Card` (ui.tsx:69) is `rounded-2xl … p-6`. So three different corner radii (`rounded-lg` / `rounded-xl` / `rounded-2xl`) and paddings sit on visually-equivalent boxed content within the same scroll.
- **Root cause**: `Card` was extracted for panel-scale sections but no sub-card primitive exists for list-row / mini-card content, so each page improvised.
- **Impact**: Inconsistent corner rounding and inset are exactly the kind of "almost-aligned" drift that reads as unpolished on a dense dashboard.
- **Fix sketch**: Introduce a small `Tile`-sibling primitive (e.g. `Panel`/`SubCard` with `rounded-xl border border-slate-800 bg-slate-900/40 p-4`) in ui.tsx and route the recommendation rows, champion cards, and movers rows through it. Standardize on one radius for inset list items (recommend `rounded-xl`).

## 5. The repo×dimension heatmap ignores OrgTable chrome and table a11y
- **Severity**: Medium
- **Category**: component-architecture
- **File**: src/app/org/[slug]/repositories/page.tsx:84-124
- **Scenario**: Directly above a leaderboard that uses the shared `OrgTable` (consistent `rounded-2xl` wrapper, header styling, row dividers, hover), the heatmap is a fully hand-rolled `<table className="min-w-[640px]">` inside a `rounded-2xl border … p-4` wrapper. It has no row hover, different padding, and its header/row-label `<th>`/`<td>` cells carry no `scope`. The repo-name cells are `<td>` (not `<th scope="row">`), so a screen reader reading a heat cell can't announce which repo+dimension it belongs to — the numeric value alone is meaningless.
- **Root cause**: `OrgTable` assumes a single `<tbody>` row model with right/left-aligned text cells; the heatmap's matrix layout didn't fit, so it forked instead of extending the primitive.
- **Impact**: Visual inconsistency with the adjacent leaderboard, plus the heatmap is the least screen-reader-navigable surface in the app (a grid of context-free numbers).
- **Fix sketch**: Mark the leftmost cells `<th scope="row">` and the dimension headers `<th scope="col">`; the `title={\`${d}: ${v}\`}` already exists — promote it to an `aria-label` on the cell. Consider a `matrix` variant of `OrgTable` (or a thin `HeatTable`) so the wrapper/border/hover tokens match the leaderboard.

## 6. Inner-section empties are ad-hoc `<p>` text instead of the shared empty primitive
- **Severity**: Medium
- **Category**: states
- **File**: src/app/org/[slug]/page.tsx:24, :158, :189, :219, :290
- **Scenario**: The page/section-level empties correctly route through `SectionEmpty`/`OrgEmpty`→`EmptyState`, but the *in-card* empties are bare paragraphs: movers "None this period." (`page.tsx:24`), Standing "Benchmark fills in once other orgs are scanned." (`:158`), common-gaps / repo-specific "No fleet-wide gaps…" (`:189`, `:219`). Each is a slightly different size/color (`text-xs text-slate-500` here, `text-xs text-slate-500` there) with no shared treatment, so a freshly-scanned org with sparse data sees a patchwork of differently-styled "nothing here" messages.
- **Root cause**: `EmptyState`'s `section` variant is dashed-box scale and feels too heavy for a one-line in-card empty, so call sites improvised inline text instead.
- **Impact**: A new/low-data fleet — the exact moment first impressions form — sees inconsistent empty messaging across cards, undermining the otherwise-cohesive system.
- **Fix sketch**: Add a lightweight `InlineEmpty` (or an `EmptyState` `variant="inline"`) — one muted, centered line with consistent `text-xs text-slate-500` — and route these five call sites through it so every "no data yet" string shares one look.

## 7. `AiBar` is defined once but the identical bar is re-inlined in the same file
- **Severity**: Medium
- **Category**: component-architecture
- **File**: src/app/org/[slug]/contributors/page.tsx:8-15, :175-179
- **Scenario**: `AiBar` (`Meter w-24 size="sm"` + a `w-9` % label) is extracted at the top of the file and used for champions and the involvement table, but the concentration table's "Top share" cell (lines 175-179) re-implements the exact same `flex items-center gap-2` + `Meter w-24 size="sm"` + `w-9` label inline — just with a conditional warn color.
- **Root cause**: `AiBar` doesn't accept a `color`/`warn` prop, so the one cell that needs the orange-at-≥80% threshold forked rather than extended the component.
- **Impact**: Two copies of the same bar that can drift in width/spacing; the warn-threshold logic lives outside the reusable component.
- **Fix sketch**: Add an optional `color?: string` prop to `AiBar` and call `<AiBar pct={r.topShare} color={r.topShare >= 80 ? "var(--color-warn)" : undefined} />`, deleting the inline copy.

## 8. OrgScanButton's disabled empty-fleet state gives no explanation
- **Severity**: Medium
- **Category**: states
- **File**: src/components/org/OrgScanButton.tsx:51-54
- **Scenario**: When `watchedCount === 0` the primary "Scan all watched (0)" button renders disabled (`disabled:opacity-50 disabled:cursor-not-allowed`) with no tooltip, helper text, or path forward. A user landing on an org whose repos aren't watched yet sees a greyed-out primary action and a "(0)" with no instruction to go watch repos first.
- **Root cause**: The disabled branch only handles the visual state; it never communicates *why* it's disabled or how to enable it.
- **Impact**: Dead-end primary CTA on the org header — the user can't tell whether the feature is broken or just unconfigured. (Note the org *layout* empty already points to /connect, but once an org has any data the header shows this disabled button with no such hint.)
- **Fix sketch**: When `watchedCount === 0`, render `title="Watch repositories on Connect to enable scanning"` on the button and a small `font-mono text-[11px] text-slate-500` helper link to `/connect` beneath it, mirroring the layout's empty-state CTA.

## 9. Org header secondary stats vanish on mobile with no replacement
- **Severity**: Low
- **Category**: responsive
- **File**: src/app/org/[slug]/layout.tsx:76-78
- **Scenario**: The "X/Y scanned · N watched" line is `hidden … sm:inline`, so below the `sm` breakpoint it disappears entirely rather than wrapping or relocating. On a phone the org header shows only the slug + level chip; the scan/watch context — which directly explains the adjacent scan button's "(N)" count — is gone with no fallback.
- **Root cause**: The line was hidden on mobile to avoid header crowding, but no compact/wrapped alternative was provided.
- **Impact**: Minor, but on mobile the "Scan all watched (N)" button's number loses its supporting context, and the header feels truncated.
- **Fix sketch**: Allow the stats to wrap to a second line on mobile (drop `hidden sm:inline`, the header is already `flex-wrap`) or surface a condensed `N watched` chip next to the level chip at all breakpoints.
