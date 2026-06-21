> Total: 4 findings (0 critical, 0 high, 2 medium, 2 low)

# People & Delivery Analytics — combined bug+ui scan

## 1. Bus-factor table has a misleading screen-reader caption
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: accessibility
- **File**: src/app/org/[slug]/contributors/page.tsx:181
- **Scenario**: A screen-reader user navigates the "Concentration & bus factor" table. The accessible `<caption>` announced is "AI-commit adoption by repository", but the table's columns are Repo / Contributors / Top contributor / Top share / Bus factor — it is about commit concentration and key-person risk, not AI-commit adoption.
- **Root cause**: The `caption` prop looks copy-pasted from a different (AI-adoption) table; it was never updated to describe the concentration/bus-factor data it now labels. The repo hardened `caption` accessibility broadly, so a wrong caption is worse than none — it actively mislabels.
- **Impact**: Assistive-tech users get a wrong mental model of the table; the caption contradicts every visible column. Sighted users are unaffected (caption is `sr-only`), so it escapes visual review.
- **Fix sketch**: Change the caption to match the data, e.g. `caption="Commit concentration and bus factor by repository"`.

## 2. Partial delivery data makes whole sections vanish with no notice
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: silent-failure
- **File**: src/app/org/[slug]/delivery/page.tsx:64
- **Scenario**: A segment (or org) has commit activity but no analyzable PRs (`getOrgPrSignals` returns null) — or governance is unreadable. The page-level empty guard is `if (!pr && !gov && !activity)`, so it only shows the "no signals" message when ALL three are null. With one or two present, the missing section(s) are rendered as `{pr && ...}` and simply disappear, leaving no explanation of why "Pull request signals" / "Branch governance" is gone.
- **Root cause**: Empty-state handling is all-or-nothing at the page level; individual sections have no per-section empty/“no data” fallback. The page assumes the three signals are present-or-absent together, but each comes from an independent query that can null out on its own.
- **Impact**: A leader reading delivery for a business unit sees an inconsistent, silently-truncated view and may conclude the data is broken or that the repos have no PRs at all, with no signal distinguishing "no data captured" from "genuinely zero".
- **Fix sketch**: Render a small per-section empty notice when a given signal is null (e.g. a `SectionEmpty` under each `SectionHeader`), or at minimum a one-line "PR signals need a GitHub token / no human-merged PRs in this scope" stub so the missing section is explained rather than absent.

## 3. ActivityChart x-axis label is off by one and mis-pluralizes
- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: chart-correctness
- **File**: src/app/org/[slug]/delivery/page.tsx:23
- **Scenario**: For a 12-week series the leftmost bar (index 0) is labeled "12 weeks ago" while the rightmost is "this week"; the oldest bar is actually 11 weeks before "this week", so the label overstates the age by one. With a 1-week series it reads "1 weeks ago" (bad plural) and both endpoint labels sit over the same single bar.
- **Root cause**: The label uses `series.length` as the age of the first bar instead of `series.length - 1`, and has no singular/plural handling; it assumes count-of-weeks equals weeks-ago.
- **Impact**: Cosmetic but a data-viz axis inaccuracy on a "real, from GitHub" chart that the copy explicitly markets as accurate; minor grammar glitch at length 1.
- **Fix sketch**: Label the oldest bar `${series.length - 1}w ago` (or "~N weeks ago"), pluralize via `series.length - 1 === 1 ? "week" : "weeks"`, and guard the degenerate length-1 case.

## 4. Commit-activity bars are not accessible (title-only, no chart label)
- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: accessibility
- **File**: src/app/org/[slug]/delivery/page.tsx:8
- **Scenario**: The weekly-commit bar chart conveys its values only through a hover `title` on each `<div>` bar. Keyboard and screen-reader users get no per-bar value and the chart container has no role/accessible name, so the data is unreachable without a mouse.
- **Root cause**: The chart is built from bare styled `<div>`s with `title` tooltips and no `role="img"`/`aria-label` summary or text alternative — the same gap the repo's other charts were hardened against (role=img + SR text).
- **Impact**: Non-pointer users cannot read commit-activity values; inconsistent with the accessibility treatment applied to other report/org charts.
- **Fix sketch**: Wrap the chart in `role="img"` with an `aria-label` summarizing the trend (e.g. total commits over N weeks, peak week), or render a visually-hidden data table / per-bar `aria-label`, matching the hardened chart pattern used elsewhere.
