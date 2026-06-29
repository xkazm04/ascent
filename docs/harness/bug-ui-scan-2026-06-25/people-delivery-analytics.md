# People & Delivery Analytics — Bug + UI Scan
> Context: People & Delivery Analytics (Org Dashboard & Analytics)
> Total: 5 findings (0 critical, 0 high, 3 medium, 2 low)

These three pages are thin, well-guarded server components rendering data from the org-rollup layer (`getContributorInsights`, `getOrgTeamRollup`, `getOrgPrSignals`/`Governance`/`Activity`). No crash / data-loss / auth defects were found in scope; the findings are correctness-of-presentation and UI-polish issues, concentrated in the delivery activity chart and the teams view.

## 1. Activity chart axis labels are wrong ("this week" stale + off-by-one)
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: edge-case
- **File**: src/app/org/[slug]/delivery/page.tsx:23-26 (data: src/lib/db/org-signals.ts:165-216)
- **Value**: impact 6 · effort 2 · risk 2
- **Scenario**: `getOrgActivity` builds `series` oldest→newest over a *contiguous, zero-filled* week grid from `minWk` to `maxWk`, where `maxWk = weekIndex(latest scan time)`. The chart labels the right edge `this week` and the left edge `{series.length} weeks ago`. (a) If the fleet hasn't been re-scanned in N weeks, the rightmost bar is N weeks stale but still reads "this week". (b) The leftmost bar is `series.length − 1` weeks before the right edge, so "{series.length} weeks ago" is always off by one. (c) With heterogeneous scan cadence the grid zero-fills long gaps, so `series.length` (e.g. 70) wildly overstates the real lookback.
- **Root cause**: The component assumes `series` is a fixed trailing window ending on the current calendar week; the rollup actually emits an absolute-week grid anchored to the most recent *scan*, of variable length.
- **Impact**: A delivery/throughput timeline mislabels recency and span — users read commit activity against a wrong time axis and may think "this week" reflects current state when it's weeks old.
- **Fix sketch**: Derive labels from the rollup's actual week math: return `latestWeekIso`/`oldestWeekIso` (or relative offsets) from `getOrgActivity` and render those, or label left as `${series.length - 1} weeks ago` and right as the real most-recent week date instead of the literal "this week".

## 2. Commit-activity chart has no accessible / keyboard representation
- **Lens**: ui-perfectionist
- **Severity**: medium
- **Category**: a11y
- **File**: src/app/org/[slug]/delivery/page.tsx:9-29
- **Value**: impact 5 · effort 3 · risk 1
- **Scenario**: `ActivityChart` renders each week as a bare `<div>` whose only data is a `title` (hover tooltip) and whose magnitude is carried purely by `bg-accent` fill height. Title tooltips are not reliably exposed to screen readers and never to keyboard users; the chart has no `role`, `aria-label`, caption, or text/table fallback. A screen-reader user reaching the "Commit activity" card hears the heading and nothing about the actual series.
- **Root cause**: The viz was built as presentation-only divs with no parallel accessible summary — unlike the data tables on the same pages, which use `OrgTable` with `<caption className="sr-only">`.
- **Impact**: Non-visual / keyboard users are excluded from the delivery throughput data; fails WCAG non-text-content / info-and-relationships.
- **Fix sketch**: Give the chart container an `aria-label` summarizing the series (e.g. `${activity.total} commits over ${activity.weeks} weeks, peak N`), or render a visually-hidden table of week→count, and add `role="img"`. Reuse the existing `sr-only` caption pattern from `OrgTable`.

## 3. "Knowledge leader" tile shows AI-share but is colored by a different metric
- **Lens**: ui-perfectionist
- **Severity**: medium
- **Category**: visual-consistency
- **File**: src/app/org/[slug]/teams/page.tsx:176-181
- **Value**: impact 5 · effort 2 · risk 2
- **Scenario**: The headline tile sets `value={knowledgeLeader.aiCommitShare}%` but `color={scoreHex(knowledgeLeader.knowledgeScore)}`, where `knowledgeScore = aiCommitShare*0.5 + avgAdoption*0.5` (org-teams.ts:225). A team with 30% AI share but high adoption renders the number "30%" tinted green. The same metric inside each `TeamCard` (line 68) is colored by `scoreHex(team.aiCommitShare)` — so the headline tile's color disagrees with both the number it sits on and the per-team cards below it.
- **Root cause**: Tile color was wired to the ranking score rather than to the displayed value, breaking the "color encodes the number shown" convention that `scoreHex` is meant to uphold (lib/ui.ts:100-107).
- **Impact**: Misleading at-a-glance read — the color implies the shown percentage is healthier (or worse) than it is, and is inconsistent with the detail cards.
- **Fix sketch**: Color the tile by the metric it displays — `scoreHex(knowledgeLeader.aiCommitShare)` — or change the tile value to show `knowledgeScore` so number and color agree.

## 4. Teams page hardcodes warn/neutral hex instead of the design token used elsewhere
- **Lens**: ui-perfectionist
- **Severity**: low
- **Category**: visual-consistency
- **File**: src/app/org/[slug]/teams/page.tsx:174,180-181
- **Value**: impact 3 · effort 1 · risk 1
- **Scenario**: The "Unowned repos" and "Knowledge leader" tiles use literal `color={... ? "#f97316" : "#fff"}`, while the sibling Contributors page expresses the identical "warning" state via the token `var(--color-warn)` (contributors/page.tsx:214, and the concentration table) and `#fff`-equivalent defaults via omitting `color`. The two people tabs render the same semantic states with different color sources.
- **Root cause**: Inline hex literals predate / bypass the `--color-warn` CSS token the rest of the org tabs adopted.
- **Impact**: Design-system drift — if `--color-warn` is retuned, the teams tiles silently won't follow, and the orange differs subtly from the contributors orange.
- **Fix sketch**: Replace `"#f97316"` with `"var(--color-warn)"` and drop the `"#fff"` literal (omit `color` to fall back to the default), matching the Contributors tab.

## 5. Per-team "owned repos" pill list is uncapped
- **Lens**: ui-perfectionist
- **Severity**: low
- **Category**: loading-state
- **File**: src/app/org/[slug]/teams/page.tsx:103-114
- **Value**: impact 3 · effort 2 · risk 1
- **Scenario**: `team.repos.map(...)` renders one pill per owned+scanned repo with no limit. A team that owns many repos via a broad CODEOWNERS `*` rule produces a wall of dozens/hundreds of pills inside its card, dwarfing the metrics above it. The Contributors tab deliberately caps its analogous list at 50 with a "Showing top 50 of N" note (contributors/page.tsx:89,113-115); the teams card has no equivalent guard.
- **Root cause**: No truncation/overflow handling on a list whose length is driven by org-controlled CODEOWNERS scope.
- **Impact**: Large teams get an unbalanced, very tall card that buries the headline numbers; degraded scannability, not a crash.
- **Fix sketch**: Slice to the top ~12 repos (already sorted by overall) and append a `+N more` pill, mirroring the contributors `+{c.repos - 3}` and "top 50 of N" patterns.
