# People & Delivery Analytics — bug-hunter + ui-perfectionist scan
> Total: 5 (Critical: 0, High: 2, Medium: 3, Low: 0)
> Lens split: bug-hunter 2 / ui-perfectionist 3
> Files read: 6

## 1. `Promise.all` makes the whole Delivery page throw if any one rollup query errors
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: error handling / data fetch resilience
- **File**: src/app/org/[slug]/delivery/page.tsx:46-50
- **Scenario**: The three rollups are fetched with `await Promise.all([getOrgPrSignals, getOrgGovernance, getOrgActivity])` and no try/catch. The data functions swallow *per-row JSON* parse errors internally, but any Prisma/connection error (or a throw outside their inner try, e.g. `org.findUnique` failing, a pool timeout) rejects the promise. `Promise.all` rejects on the first rejection, so the entire page render throws — there is no page-local error boundary shown here. A transient DB hiccup affecting only one of the three queries takes down all three sections, including the two that would have rendered fine.
- **Root cause**: Fail-together aggregation: one rejected promise discards the other two resolved results; no `Promise.allSettled` and no try/catch fallback.
- **Impact**: Delivery tab shows the framework error page (or a blank/500) on any DB blip, even when 2 of 3 sections have valid data. Contrast with Contributors/Teams, which each issue a single query whose failure is at least scoped to that page.
- **Fix sketch**: Use `Promise.allSettled` and treat a rejected settle as `null` (same as the existing empty path), so a single failing rollup degrades to that section's empty state instead of crashing the page. Optionally log the rejection reason for observability.

## 2. ActivityChart axis labels mislead for a 1-week (or very short) series
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: empty/edge-data rendering
- **File**: src/app/org/[slug]/delivery/page.tsx:22-25
- **Scenario**: The chart footer always renders `{series.length} weeks ago` on the left and `this week` on the right. For a freshly-scanned repo with a single week of `commitActivity` (`getOrgActivity` returns `weeks: 1, series: [n]`), this reads "**1 weeks ago** → this week" — both grammatically wrong and semantically false (a single bar is not a span). The series also has no guard for an all-zero week set, where every bar collapses to the 2% `Math.max(2, …)` floor with no indication the data is empty-but-present.
- **Root cause**: Static "X weeks ago / this week" labels assume a multi-week series; `series.length` is interpolated raw with a hardcoded plural "weeks".
- **Impact**: New/low-activity orgs (exactly the cohort most likely to be evaluating the product) see a broken-looking, ungrammatical axis on their first visit — undermines trust in the analytics.
- **Fix sketch**: Pluralize via the same pattern already used at line 181 (`repo{activity.repos > 1 ? "s" : ""}`), and when `series.length <= 1` render a single centered "this week" label (or "past week") instead of the two-ended span.

## 3. Teams page is the only one of the three with no Export CSV (cross-page inconsistency)
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: cross-page consistency / feature parity
- **File**: src/app/org/[slug]/teams/page.tsx:133-137 (segment bar) vs contributors/page.tsx:55-60 and delivery/page.tsx:55-60
- **Scenario**: Contributors and Delivery both render an "Export CSV" link beside the SegmentSelector. Teams renders only the SegmentSelector — no export. A user moving across the three sibling analytics tabs hits an unexplained capability gap on Teams, and the export API (`src/app/api/org/export/route.ts:38`) only accepts `kind=contributors|delivery`, so teams data is genuinely unexportable. Additionally the header layout differs: Contributors puts the intro paragraph and the segment/export controls on one flex row (justify-between); Delivery right-aligns a controls-only bar above the content; Teams right-aligns a segment-only bar — three different header treatments for three sibling pages.
- **Root cause**: Export was wired per-page rather than as a shared analytics-header component; teams kind was never added to the export route.
- **Impact**: Inconsistent affordances across a tightly-related tab group; team leads can export contributor and delivery rollups but not the team rollup they're looking at.
- **Fix sketch**: Add a `kind=teams` branch to the export route (flatten `rollup.teams` to rows) and render the same Export CSV link on the Teams page; factor the segment+export header into one shared component so all three tabs share layout and capability.

## 4. Empty-state coverage is uneven across the three pages (sections silently vanish)
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: empty/loading states
- **File**: src/app/org/[slug]/delivery/page.tsx:81,121,173 and contributors/page.tsx:75,173
- **Scenario**: Each page guards the *whole-page* empty case, but individual sub-sections just collapse when their data is thin, with no inline note. On Delivery, if `pr` is null but `gov`/`activity` exist, the "Pull request signals" block disappears entirely with no "no PR data" line — the page silently shrinks. On Contributors, the "AI champions" block is hidden whenever `totalContributors < 3` (line 75) with no explanation, and the Concentration table renders an empty `<tbody>` (header row with zero rows) if `insights.concentration` is empty while `contributors` is non-empty — a bare header with no "no data" row. The Teams page handles its single empty path cleanly but has no per-card empties to compare. The result is three pages with three different philosophies on "what does a partially-empty view look like".
- **Root cause**: Sections use `{data && <block/>}` / array `.map()` directly, with no `InlineEmpty` fallback (which exists in `ui.tsx:209` and is used elsewhere on the org overview) for the "section present but empty" middle state.
- **Impact**: Users can't tell "this metric is genuinely empty" from "this section doesn't exist" — sections appearing/disappearing between scans reads as flakiness. Empty `<tbody>` under a populated `<thead>` is a particularly poor table empty state (a11y readers announce a table with header and no rows).
- **Fix sketch**: For each conditionally-rendered section, render an `InlineEmpty` ("No PR signals captured yet") when the parent data exists but the section is empty; for the Concentration/Involvement tables, render a single full-width "No rows" cell when the array is empty instead of a header-only table.

## 5. Data tables lack semantic/a11y scaffolding (no scope, caption, or aria) and meters are non-textual
- **Severity**: High
- **Lens**: ui-perfectionist
- **Category**: table accessibility / responsive
- **File**: src/components/org/ui.tsx:108-129 (OrgTable) used by contributors/page.tsx:107-144,161-193 and delivery/page.tsx:133-168
- **Scenario**: Every analytics table goes through `OrgTable`, whose `<th>`s carry no `scope="col"`, the `<table>` has no `<caption>` / `aria-label`, and the horizontally-scrollable wrapper (`overflow-x-auto`, `minWidth: 720/640px`) is a plain `<div>` with no `tabindex`/`role="region"`/`aria-label`, so keyboard users can't scroll it and screen-reader users get no name for the scroll region. The `AiBar` / `Meter` components (contributors AI-share column, teams MetricBar) convey their value only visually via fill width — the `<span>{pct}%` next to `AiBar` covers the contributors table, but the teams `MetricBar` (ui.tsx-adjacent, teams/page.tsx:9-19) and the concentration `topShare` bar rely on color+width with the meter itself exposing no `role="progressbar"`/`aria-valuenow`. On small screens the 720px-min tables force horizontal scroll with no sticky first column, so the "Contributor"/"Repo" label scrolls out of view while reading right-hand metrics.
- **Root cause**: `OrgTable` is a purely visual shell; `Meter` renders two `<div>`s with no ARIA role; no responsive treatment for the label column.
- **Impact**: Screen-reader and keyboard users get unlabeled, un-scopable tables and value-less progress bars across all three analytics pages; mobile users lose row context when scrolling wide tables. This is the most pervasive UI gap because it's baked into the shared primitives every table on these pages uses.
- **Fix sketch**: In `OrgTable`, add `scope="col"` to header cells (or accept a `caption`/`aria-label` prop and set it), and make the scroll wrapper `role="region"` `tabIndex={0}` with an `aria-label`. In `Meter`, add `role="progressbar"` + `aria-valuenow/min/max` (and `aria-label` from the caller). Consider a sticky/`position: sticky` first column for the label on narrow viewports.
