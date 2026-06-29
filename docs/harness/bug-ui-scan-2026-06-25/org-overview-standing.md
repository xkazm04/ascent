# Org Overview & Standing — Bug + UI Scan
> Context: Org Overview & Standing (Org Dashboard & Analytics)
> Total: 5 findings (0 critical, 0 high, 3 medium, 2 low)

## 1. "Standing vs corpus" ignores the active segment / tech-stack filter
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: silent-failure / data-consistency
- **File**: src/app/org/[slug]/page.tsx:115 (call) · src/components/org/OrgStanding.tsx:25-42 (render)
- **Value**: impact 6 · effort 3 · risk 2
- **Scenario**: A user picks the "Backend services" segment (or a tech stack). The page header reads `Showing · … · Backend services segment` and every aggregate below — tiles, movers, gaps, recommendations — is re-scoped via `segmentId`/`techGroupId`. But `getOrgBenchmark(slug)` is called with the slug *only* (no segment/tech args; its signature is `getOrgBenchmark(orgSlug)`), so the Standing card's percentile + "corpus avg" line keep showing the **whole org**. Worse, the *same card's* regression badge (`regressionCount`/`comparedRepos`) IS segment-scoped (sourced from `movers`), so one card mixes a scoped badge with an unscoped percentile.
- **Root cause**: Corpus percentile is a cross-org metric that can't be sliced by an org-local segment, so it was left unscoped — but it's rendered under a scoped header with no qualifier, so it reads as filtered.
- **Impact**: Misleading standing under any filter; a viewer comparing a weak segment against "the corpus" sees the org-wide rank, not the segment's. Confusion, not a crash.
- **Fix sketch**: Label it explicitly ("whole org vs corpus") whenever `segmentId`/`techGroupId` is active, or hide the corpus comparison under a segment filter. Don't silently present an unscoped number beside scoped siblings.

## 2. Gaps + "Move to make next" silently ignore the selected time range
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: edge-case / UX-consistency
- **File**: src/app/org/[slug]/page.tsx:114 (`getOrgRecommendations`), 116 (`getOrgGapAnalysis`)
- **Value**: impact 5 · effort 4 · risk 3
- **Scenario**: Both helpers take only `(slug, …, segmentId, techGroupId)` — no `window` (confirmed in `org-insights.ts`). They render under the single `Showing · {period.title}` header next to tiles/trend/movers/PeriodSummary that DO honor the window. Switching from "All time" to "30d" visibly changes the tiles' deltas, the trend, the movers and the period banner, but the "Where the gaps live" and "The move to make next" sections do not move at all, with no on-screen signal that they're period-agnostic.
- **Root cause**: Recommendations/gaps are "current-state" reads by design, but the shared period control implies everything beneath it is scoped.
- **Impact**: A user reasonably reads these as period-specific and mistrusts the dashboard ("my filter did nothing"). No data corruption.
- **Fix sketch**: Add a small "current state — not period-scoped" caption to those two sections (cheapest), or thread the window through if a period-bounded recommendation set is intended.

## 3. Layout re-fetches the full heavy rollup on every org tab for ~4 fields
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: performance
- **File**: src/app/org/[slug]/layout.tsx:108-114 (fetch) · usage at 148-149, 181
- **Value**: impact 5 · effort 5 · risk 3
- **Scenario**: The shell calls `getOrgRollup(slug)` — the app's heaviest query (all repos + latest scan + per-dim rows + governance/passport parsing, then trend/forecast/dimAverages/postureCounts/deltas; see `org-rollup.ts:185+`). The layout consumes only `repoCount`, `repos[].watched`, `avgOverall`, `scannedCount` (header chip + guard) and discards everything else. Because the layout wraps *every* org sub-page, this full rollup runs on Repositories, Security, Plan, etc. On the Overview tab specifically `getOrgRollup` runs **twice** — unscoped in the layout, then scoped in the page (page.tsx:111).
- **Root cause**: A header chip reuses the full aggregate rather than a lightweight summary; layout/page can't dedupe (different args, no shared cache).
- **Impact**: Inflated TTFB on every dashboard view; the heaviest DB work is done largely to throw it away.
- **Fix sketch**: Add a cheap `getOrgHeaderSummary(slug)` (avgOverall, repoCount, scannedCount, watchedCount) for the layout; reserve the full rollup for pages that render trend/forecast/postures.

## 4. Trend "over time" card renders for a single data point
- **Lens**: ui-perfectionist
- **Severity**: low
- **Category**: loading-state / empty-state
- **File**: src/app/org/[slug]/page.tsx:276 (`trend.length >= 1`)
- **Value**: impact 3 · effort 2 · risk 1
- **Scenario**: A freshly-scanned org (one daily rollup point) satisfies `trend.length >= 1`, so the "Org maturity over time" card renders. `TrendChart` only draws its line at `points.length > 1` (TrendChart.tsx:179), so a single point shows a lone dot in an otherwise empty axis box — reads as a half-broken chart rather than "history is building."
- **Root cause**: Off-by-one guard; a "trend" needs at least two points to be a trend.
- **Impact**: First-run polish; momentary "is this broken?" impression.
- **Fix sketch**: Gate the card on `trend.length >= 2`, or render an `InlineEmpty` ("Not enough scan history yet — re-scan to start the trend.") for the single-point case.

## 5. `POSTURE_ORDER` is a hand-maintained duplicate of the canonical posture set
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: silent-failure / state-drift
- **File**: src/components/org/ui.tsx:13-19 (`POSTURE_LABEL`/`POSTURE_ORDER`)
- **Value**: impact 3 · effort 3 · risk 2
- **Scenario**: The Posture distribution iterates `POSTURE_ORDER` (hardcoded `["ai-native","ungoverned","manual","early"]`) and reads `rollup.postureCounts[p]`. The canonical ids live separately in `postureFor()` (maturity/model.ts:296). If a future posture id is added there, this list silently drops it from the distribution — bars no longer sum to `scannedCount`. This is the exact drift the adjacent `DIMS` constant was refactored to kill (see the comment at ui.tsx:30-33: "Was frozen at D1–D8, which silently dropped D9 Security").
- **Root cause**: Two sources of truth for the posture taxonomy; only the dimensions axis was centralized.
- **Impact**: Today low — posture is a fixed 2×2 (always 4 cells) — but the failure mode is a silent undercount with no error, identical to the D9 regression.
- **Fix sketch**: Export an ordered `POSTURE_IDS` (with labels) from maturity/model.ts and derive `POSTURE_ORDER`/`POSTURE_LABEL` from it, mirroring how `DIMS` is derived from `DIMENSION_SHORT`.
