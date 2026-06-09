# Bug Hunter Scan — Org Dashboard & Views (ascent)

> Total: 7 findings (Critical: 1 | High: 3 | Medium: 2 | Low: 1)

## 1. Unhandled rejection in any org server component 500s the whole tab with no boundary
- **Severity**: Critical
- **Category**: rsc-rejection
- **File**: src/app/org/[slug]/page.tsx:70 (and every sibling page + layout.tsx:75)
- **Scenario**: If a user opens any org tab while the DB is momentarily unreachable (connection pool exhausted, Aurora DSQL throttling, a transient Prisma error), then `getOrgRollup`/`getOrgMovers`/`getContributorInsights`/`getOrgPrSignals`/`Promise.all([...])` rejects. There is **no** `error.tsx`, `not-found.tsx`, or `global-error.tsx` anywhere under `src/app/org/` or `src/app/` (confirmed: both globs return "No files found").
- **Root cause**: Every page is `async` and `export const dynamic = "force-dynamic"`, so the queries run on every request, but no React error boundary wraps them. A single rejected promise bubbles to the framework's default error screen.
- **Impact**: 500 page — the entire org dashboard (header, nav, footer, every tab) is replaced by an unstyled Next.js error page on any transient DB hiccup. Users can't even navigate away because the shell is gone.
- **Fix sketch**: Add `src/app/org/[slug]/error.tsx` (a `"use client"` boundary with a "Couldn't load this view — retry" message and a `reset()` button) so a failed query degrades to one broken tab inside the persistent shell rather than a full-route 500. Optionally a `loading.tsx` too.

## 2. Overview page renders a blank screen instead of the empty state when slug→org resolution disagrees with the layout
- **Severity**: High
- **Category**: silent-failure
- **File**: src/app/org/[slug]/page.tsx:71
- **Scenario**: The layout guards on `getOrgRollup(slug)` (no window) and shows `OrgEmpty` when `!rollup || repoCount === 0`. But `page.tsx` independently calls `getOrgRollup(slug, win, segmentId)` and on `if (!rollup) return null`. `getOrgRollup` returns `null` only when the org row is missing — yet the layout already rendered its header/nav for a *resolved* org. If the org is deleted between the layout's query and the page's query (or a replica lag returns the org to layout but not to page), the page returns `null`: React renders nothing inside `<div className="mt-6 animate-fade-up">`.
- **Root cause**: `return null` from a server page is treated as "render nothing", not as an empty state; the guard duplicates the layout's resolution instead of trusting it, and the two queries can disagree.
- **Impact**: Blank screen — org header + tab bar with a completely empty body, no message, no error. Looks like a broken/hung page.
- **Fix sketch**: Replace `return null` with an explicit `<SectionEmpty>` (as the contributors/delivery tabs do), or rely on the layout's already-validated org and don't re-guard. Same pattern exists at `repositories/page.tsx:15` (`if (!rollup) return null`).

## 3. `POSTURE_LABEL[l.posture]` / `POSTURE_LABEL[p]` lookups can show a raw enum or blank for an unmapped posture
- **Severity**: Medium
- **Category**: undefined-map
- **File**: src/app/org/[slug]/repositories/page.tsx:85, src/app/org/[slug]/page.tsx:163
- **Scenario**: `POSTURE_LABEL` (ui.tsx:6) maps only `ai-native | ungoverned | manual | early`. `latest.posture` comes straight from the stored scan row (`org-rollup.ts:152`, untyped `string`). If a scan was written by a newer/older scorer with a posture value not in the map (e.g. a renamed bucket), the repositories table falls back to the raw value `?? l.posture` (acceptable), but the **overview** "Posture distribution" iterates `POSTURE_ORDER` only — a stored posture outside those four is silently **omitted from the distribution entirely**, so the counts don't sum to `scannedCount`.
- **Root cause**: The posture vocabulary is duplicated as a hardcoded `POSTURE_ORDER` constant rather than derived from the data; drift between scorer output and the UI map drops rows.
- **Impact**: Wrong numbers shown to execs — posture bars under-count the fleet (e.g. 8/10 repos shown across the four bars when 10 were scanned), with no indication some repos were dropped.
- **Fix sketch**: In the overview, compute the bar set from `Object.keys(rollup.postureCounts)` unioned with `POSTURE_ORDER`, or render an "Other (n)" row for unmapped postures so the distribution always reconciles with `scannedCount`.

## 4. OrgScanButton resets `total` to `watchedCount` on submit, so the in-flight stale-only scan shows a wrong/100%-instant progress denominator
- **Severity**: Medium
- **Category**: wrong-numbers
- **File**: src/components/org/OrgScanButton.tsx:24,54,65
- **Scenario**: If a user clicks **"Stale only"** while 10 repos are watched but only 2 are stale, then `run()` sets `total: watchedCount` (=10) immediately, and the button reads `Scanning 0/10…`. The server's first `progress` event carries the real `total` (2), but until that arrives the denominator is wrong; and if the server completes the 2 repos fast, `pct = done/total = 2/10 = 20%` is shown as "complete" before `router.refresh()`. The progress bar can also briefly read 100% then jump backward when the real total arrives.
- **Root cause**: The optimistic `total` assumes the full watched set; the stale-only scope means the actual unit count is unknown client-side until the first SSE `progress` event.
- **Impact**: UX — misleading progress (e.g. "0/10" for a 2-repo run, or a bar that snaps backward). Not a crash.
- **Fix sketch**: Initialize `total: 0` (or `null`) on submit and render an indeterminate state until the first `progress`/`total` event lands; only fall back to `watchedCount` for the full scan.

## 5. Movers list math: `m.dOverall` of exactly 0 leaks into a list it was filtered out of? No — but `Math.abs(m.dOverall)` hides direction mismatch and `levelDelta` arrows can contradict the score arrow
- **Severity**: Low
- **Category**: wrong-numbers
- **File**: src/app/org/[slug]/page.tsx:34-41
- **Scenario**: A repo can gain overall score (`dOverall > 0`, lands in "Top gainers", green ▲) while its `levelDelta` is negative (a maturity-level demotion is possible if level thresholds shifted or a re-score reclassified it). The row then shows a green ▲ next to a `levelFrom→levelTo` that reads as a downgrade — internally inconsistent to a reader. Conversely a small score drop with a level promotion shows orange ▼ beside an up-arrow level pair.
- **Root cause**: `dOverall` (continuous score) and `levelDelta` (bucketed level) are independent signals rendered with one shared tone, with no reconciliation.
- **Impact**: UX / confusing exec read — not a crash, but the visual contradicts itself on edge re-scores.
- **Fix sketch**: Color the `levelFrom→levelTo` chip by `levelDelta` sign (independent of the score arrow), or suppress the level chip when its direction disagrees with `dOverall`.

## 6. Practices "adoption %" and `strongCount/total` divide assume `total > 0` only via guard, but the meter color/exemplar logic can render "0/0 · 0%" tiles for dimensions no repo was scored on
- **Severity**: Medium
- **Category**: divide-by-zero
- **File**: src/app/org/[slug]/practices/page.tsx:48,57-60
- **Scenario**: `getOrgPractices` builds a practice for every entry in the static `PRACTICES` list, but `total` (`rows.length`) is the count of repos scored *on that dimension*. If the org's repos were scored by a scanner that emitted dimensions D1–D8 but a practice targets D9 (Security), `byDim.get("D9")` is empty → `total = 0`, `strongCount = 0`. The page guards the divide (`p.total ? … : 0`) so no NaN, **but** it still renders a full practice Card showing `0/0 repos strong · 0%` with an empty meter and "greenfield" exemplar — noise that looks like a data bug to the user.
- **Root cause**: Practices are enumerated from a static list independent of which dimensions actually have data; zero-coverage practices aren't filtered.
- **Impact**: Wrong/confusing numbers — `0/0` tiles for dimensions the fleet was never scored on. Not a crash (divide is guarded).
- **Fix sketch**: Skip rendering a practice Card when `p.total === 0` (no repo carries that dimension), or show a distinct "not yet scored for this practice" state instead of `0/0 · 0%`.

## 7. Contributors "AI champions" rank `#1 ★` can be assigned to a single trivial contributor, overstating an org of one
- **Severity**: High
- **Category**: edge-case / misleading-aggregate
- **File**: src/app/org/[slug]/contributors/page.tsx:65-88; src/lib/db/org-contributors.ts:170-173,179
- **Scenario**: If exactly one human has `commits >= 3` and `aiCommits > 0` (e.g. a solo dev who used Copilot a few times), then `champions` has one entry rendered as a celebrated "AI champion #1 ★", and `aiActiveShare` / `orgAiShare` are computed over a denominator of 1, so the dashboard proudly reports "100% AI-active" and a "#1 champion" for a team of one. For execs this is success theater — a fleet that's barely adopted AI reads as fully AI-native.
- **Root cause**: No minimum-cohort guard on champions or on the AI-share percentages; with `totalContributors === 1` every ratio is 0% or 100% with no statistical meaning, yet rendered with full confidence.
- **Impact**: Wrong numbers shown to execs — "100% AI-active", a championed solo contributor; materially misleading on tiny orgs.
- **Fix sketch**: Gate the champions section and the AI-share tiles behind a minimum contributor count (e.g. `totalContributors >= 3`), or annotate small-n percentages ("n=1") so the read isn't mistaken for a fleet signal.
