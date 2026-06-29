# Biz+Bug Scan — Reporting & Visualization — ascent — 2026-06-29

> Combined business-visionary + bug-hunter scan over 5 contexts.
> Total: 25 findings — Critical: 0, High: 5, Medium: 17, Low: 3  (bug: 13, business: 12)

---

## PDF & LLM Export

### 1. PDF export is gated by org-read, not by plan tier — a paid feature leaks to free orgs
- **Severity**: High
- **Lens**: business-visionary
- **Category**: monetization
- **File**: src/app/api/report/pdf/route.ts:28-30
- **Scenario**: The comment calls the PDF "the 'PDF export' sold on the Private tier," but the route only runs `requireOrgRead`. Any member of any readable org (incl. free-tier, and anonymous viewers of public reports) can `GET /api/report/pdf?repo=…`.
- **Root cause / Rationale**: Entitlement is never consulted; read-access ≠ paid-access. Same gap likely on `/api/history?format=csv` and `/api/org/export?format=csv`.
- **Impact**: Direct revenue leak on the explicitly-premium feature; removes an upgrade lever.
- **Fix sketch**: Add `requirePlan(orgSlug,"private")`/credit decrement after `requireOrgRead`; 402/403 + upgrade CTA. Apply to all export routes.

### 2. Transient DB error is reported to the user as "never scanned"
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: silent-failure
- **File**: src/app/api/report/pdf/route.ts:32-40
- **Scenario**: `getScanReportByCommit(...).catch(() => null)` swallows every error; a DSQL token expiry returns `null`, rendered as 404 "No saved scan… Scan it first."
- **Root cause / Rationale**: Catch-all conflates "no row" with "lookup failed." User is told to re-scan a repo that already has a report (wasting scans/credits).
- **Impact**: Misleading UX, wasted scans, masks real infra incidents (no 500 surfaces).
- **Fix sketch**: Only map genuine not-found to 404; rethrow/log others → 503 "retry." Mirror the history route's try/catch.

### 3. `wrap={false}` dimension rows can break PDF rendering on verbose LLM output
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: edge-case
- **File**: src/lib/pdf/report-document.tsx:118-126
- **Scenario**: Each dimension row is `<View wrap={false}>`. A long LLM `d.summary` (or all 9) can exceed a page; `@react-pdf` clips or `renderToBuffer` throws → opaque 500 at route.ts:48.
- **Root cause / Rationale**: `wrap={false}` forbids cross-page flow; LLM summary length is unbounded.
- **Impact**: The paid PDF becomes permanently un-exportable for exactly the richest reports.
- **Fix sketch**: Drop `wrap={false}` on dimension rows (or apply only to the compact head and let summaries wrap); cap summary length for print.

### 4. The PDF omits the roadmap / recommendations / evidence — the actionable, paid-for part
- **Severity**: Medium
- **Lens**: business-visionary
- **Category**: differentiation
- **File**: src/lib/pdf/report-document.tsx:116-126
- **Scenario**: PDF renders score, axes, strengths/risks, per-dimension score+summary — but not roadmap, tracked recommendations, PR signals, or per-dimension evidence/gaps. A buyer sharing "the report" gets a thin scorecard, not the plan.
- **Root cause / Rationale**: Built as a headline card; the paid value (what to fix, with proof) lives only in the web UI.
- **Impact**: Weak premium artifact undermines the Private-tier sell + the QBR use case.
- **Fix sketch**: Add "Roadmap" and "Evidence & gaps" sections (reuse `report.roadmap`, `dimensions[].evidence/gaps`, already in `ScanReport`).

### 5. Ship a machine-readable LLM endpoint, not just a copy button
- **Severity**: Medium
- **Lens**: business-visionary
- **Category**: differentiation
- **File**: src/components/CopyForLlm.tsx:11-37 ; src/components/copy-for-llm.logic.ts
- **Scenario**: The LLM-consumption angle is ascent's clearest wedge vs Snyk/Scorecard, but it's a client-only clipboard button. Agents/CI/`curl` can't fetch the brief; the `onCopied` telemetry hook (CopyForLlm.tsx:31) is unused, so "who exports to LLMs" is invisible.
- **Root cause / Rationale**: Brief is generated/copied in-browser; no GET surface, no usage signal.
- **Impact**: Misses an integration/differentiation loop + an activation analytics signal.
- **Fix sketch**: Add `GET /report/{owner}/{repo}/llm.txt` (org-gated, same builder) + an "Open in Claude" deep link; wire `onCopied` to analytics/credits.

---

## Roadmap & Recommendation Tracking

### 1. 409-conflict "Retry" resubmits the same status without refetching — repeats the conflict
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: race-condition
- **File**: src/components/report/RecommendationTracker.tsx:186-192 ; src/app/api/recommendations/[id]/route.ts:115-120
- **Scenario**: Two members edit a row; the loser gets a 409. Retry calls `setStatus(item.id, err.status)` with the same captured status against the unchanged local row — the optimistic-lock pre-image still mismatches, so it 409s again. No in-place "reload row."
- **Root cause / Rationale**: Optimistic lock keys on the client's stale pre-image; the UI never refreshes before retry.
- **Impact**: A real collaborative-edit dead end on the multi-user backlog tracking exists for.
- **Fix sketch**: On 409, refetch the row/list and re-seed before offering Retry; or have PATCH return the current server row to rebase.

### 2. Completion % is deflated by dismissed items
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: edge-case
- **File**: src/components/report/RecommendationTracker.tsx:51-54
- **Scenario**: `pct = done/total` with `total = items.length`. Dismissed items stay in `total` but never count as `done`, so dismissing 4 of 10 caps the bar at 60% forever even after the user finishes everything in scope.
- **Root cause / Rationale**: "Dismissed" = intentionally out of scope; it should leave the denominator.
- **Impact**: The progress ring (a motivation/retention surface) reads as failure; 100% is unreachable.
- **Fix sketch**: `actionable = total - dismissed; pct = actionable ? done/actionable : 100`; keep the "· N dismissed" caption.

### 3. Wire recommendation completions into a re-engagement email
- **Severity**: High
- **Lens**: business-visionary
- **Category**: retention
- **File**: src/lib/report/compare.ts:282-288 ; src/app/api/recommendations/[id]/events/route.ts
- **Scenario**: The diff engine already computes `recsMovedToDone` and the events route records every change with an actor — none of it triggers a "you closed 3 gaps (+5 pts)" email, despite SES in the stack.
- **Root cause / Rationale**: The completion signal terminates in the UI; no outbound loop.
- **Impact**: A one-off scan never becomes a recurring habit — the biggest retention lever for a scoring product.
- **Fix sketch**: On status→done (or a re-scan detecting `recsMovedToDone`), enqueue a digest email with closed gaps + score delta + compare link.

### 4. "Create GitHub Issue / push to Projects" from a recommendation
- **Severity**: Medium
- **Lens**: business-visionary
- **Category**: differentiation
- **File**: src/components/report/RecommendationTracker.tsx:152-170
- **Scenario**: Recommendations are tracked inside ascent only; teams live in GitHub Issues/Projects and re-key the roadmap by hand, so the tracker rots.
- **Root cause / Rationale**: No write-back to the SCM where work happens.
- **Impact**: Stickiness + differentiation vs Scorecard/SonarCloud (which stop at findings).
- **Fix sketch**: "Create issue" action → opens a GitHub issue (title/rationale/explore-links), store the URL on the rec, sync status from close. Needs a write-scoped install — larger build.

### 5. Position the tracked roadmap + audit timeline as the paid "governance" tier
- **Severity**: Medium
- **Lens**: business-visionary
- **Category**: monetization
- **File**: src/lib/db/scans-recommendations.ts:102-140 ; src/app/api/recommendations/[id]/route.ts:44-49
- **Scenario**: Tracking is restricted to non-public orgs, writes an in-transaction `auditLog` row, and keeps a per-item event timeline — compliance-grade work given away undifferentiated.
- **Root cause / Rationale**: The audit/timeline is built but not packaged as a value tier.
- **Impact**: Untapped enterprise upsell ("who changed what, when, immutable trail").
- **Fix sketch**: Surface an exportable audit timeline + assignee/SLA views as a Governance add-on; gate the events/audit export behind it.

---

## Trends & Comparison

### 1. `LevelBadge` can crash the trends page on a drifted/empty stored level
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: state-corruption
- **File**: src/components/LevelBadge.tsx:10 ; src/app/trends/page.tsx:130
- **Scenario**: Trends renders `<LevelBadge id={latest.level as LevelId}>` from persisted history. `LevelBadge` does `const lc = LEVEL_CLASSES[id]` with no fallback then reads `lc.border`. A drifted/empty stored `level` (e.g. `""`, which `parseRepositoryHistory` even emits at validate.ts:135) → `lc` undefined → TypeError → the trends page errors.
- **Root cause / Rationale**: Sibling visuals were hardened (`QUAD_TINT[id] ?? …`); `LevelBadge` is the un-guarded outlier on an untrusted DB string cast to `LevelId`.
- **Impact**: One bad row white-screens trends (the first thing a returning user hits).
- **Fix sketch**: `const lc = LEVEL_CLASSES[id] ?? LEVEL_CLASSES.L1;` and guard `LEVEL_GLYPH[id]`; or validate `level` to L1–L5.

### 2. Lazy dimension fetch has no abort/active guard — stale-repo data race
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: race-condition
- **File**: src/components/report/DimensionTrends.tsx:35-52
- **Scenario**: `loadDimensions` fetches with no `AbortController`/`active` flag. Across a repo change (or unmount), a slow response for repo A can resolve after repo B mounts and `setFull(...)`, painting A's series under B's header.
- **Root cause / Rationale**: Effects elsewhere use an `active` latch; this fetch doesn't.
- **Impact**: Wrong-repo dimension charts + a set-state-on-unmounted warning.
- **Fix sketch**: Capture `fullName` and ignore the response if it changed; or `AbortController` in cleanup.

### 3. `recsMovedToDone` counts a born-done recommendation as a fresh completion
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: edge-case
- **File**: src/lib/report/compare.ts:282-288
- **Scenario**: For each `after` rec with `status==="done"`, if `m == null` (no `before` match) it's pushed to `recsMovedToDone`. A rec the later scan authored already-done is celebrated in "What changed" as newly completed.
- **Root cause / Rationale**: "Unmatched + done" is treated as "moved to done," but unmatched may be new-and-already-done.
- **Impact**: Inflated "N done" badge + false entries in the completion-email trigger; erodes diff trust.
- **Fix sketch**: Count only `m != null && before[m].status !== "done"`; treat brand-new done items as a separate labeled category.

### 4. Ship an embeddable README maturity badge (the missing adoption loop)
- **Severity**: High
- **Lens**: business-visionary
- **Category**: growth
- **File**: src/app/api/history/route.ts ; src/app/report/[owner]/[repo]/opengraph-image.tsx
- **Scenario**: ascent renders a rich OG card + CSV history but has no `…/badge.svg` for a README — the exact viral mechanic behind OpenSSF Scorecard, Codecov, Snyk.
- **Root cause / Rationale**: All ingredients exist (score, level, `scoreHex`, SVG infra) but no shields-style endpoint.
- **Impact**: Every badged repo = a free permanent backlink + social proof + re-scan trigger — the cheapest growth loop left on the table.
- **Fix sketch**: `GET /report/{owner}/{repo}/badge.svg` returning a small cached SVG; offer copy-paste markdown on the report.

### 5. Scheduled trend-digest email using existing SES + history
- **Severity**: Medium
- **Lens**: business-visionary
- **Category**: retention
- **File**: src/app/trends/page.tsx:115-117 ; src/app/api/history/route.ts
- **Scenario**: History + `forecastTrajectory` already power a trajectory, but the user must remember to return. No periodic "moved +4 this month, on track to L4 by Sept" email.
- **Root cause / Rationale**: Trends are pull-only.
- **Impact**: Recurring re-engagement + a natural upgrade/PDF CTA surface.
- **Fix sketch**: A weekly/monthly cron diffing the latest two history points per watched repo → digest with the forecast.

---

## Score Charts & Visuals

### 1. Chart deep-links are pointer-only — keyboard/SR users can't reach per-scan reports
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: accessibility
- **File**: src/components/report/TrendChart.tsx:145-148, 251-274 ; src/components/report/DimLine.tsx:91-94
- **Scenario**: Clicking a point navigates to that scan's report (shift-click → commit). The loop is mouse/touch-only: the SVG isn't focusable, no `onKeyDown`, and the sr-only `<table>` mirror lists scores but has no links.
- **Root cause / Rationale**: Navigation is bolted onto `onPointerMove` hover state; the accessible mirror conveys values, not links.
- **Impact**: Keyboard/SR users lose a core navigation feature (WCAG 2.1.1 gap).
- **Fix sketch**: Make sr-only table rows real `<a href={point.href}>`, and/or focusable `<a>` overlays per point.

### 2. ScoreRing's fill transition ignores prefers-reduced-motion
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: accessibility
- **File**: src/components/report/ScoreRing.tsx:55
- **Scenario**: Unconditional `style={{ transition: "stroke-dashoffset 0.8s ease" }}`. Every sibling chart gates motion on `usePrefersReducedMotion()`; the headline ring animates regardless.
- **Root cause / Rationale**: Transition hard-coded inline, not gated.
- **Impact**: Motion-sensitive users get an unwanted sweep on the most prominent element.
- **Fix sketch**: Drop the transition (or duration 0) when `usePrefersReducedMotion()`.

### 3. A NaN/undefined score prints "NaN" while geometry silently clamps to 0
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: silent-failure
- **File**: src/components/report/ScoreRing.tsx:43-58 ; src/components/report/DimensionExplorer.tsx:122-125
- **Scenario**: `chartScale` clamps NaN→0 for geometry, so a corrupt score draws a plausible empty ring, but the numeral is raw (`{score}`) → a clean ring labeled "NaN", and `scoreHex(NaN)`→L1-red implies a real low score.
- **Root cause / Rationale**: Geometry hardened against bad numbers; displayed text/colour weren't, disguising corruption.
- **Impact**: A drifted DB-rebuilt report (bypasses `parseScanReport`) shows confident wrong values.
- **Fix sketch**: Render `Number.isFinite(score) ? score : "—"` + neutral colour for non-finite scores.

### 4. Productize the score visuals as a downloadable share card
- **Severity**: High
- **Lens**: business-visionary
- **Category**: growth
- **File**: src/components/report/ScoreRing.tsx ; src/components/report/RadarChart.tsx
- **Scenario**: The radar + ring are the most screenshot-worthy assets, but there's no "Download/Share scorecard" — users screenshot manually (cropped, unbranded) or not at all.
- **Root cause / Rationale**: The SVGs are display-only; nothing renders them to a branded PNG.
- **Impact**: Misses organic social distribution at the peak-pride moment; each share is branded reach.
- **Fix sketch**: "Share score" → render ring/radar to a branded PNG (reuse the OG `ImageResponse`) with the permalink baked in.

### 5. Use Remotion (already in the stack) for a "maturity recap" share clip
- **Severity**: Medium
- **Lens**: business-visionary
- **Category**: differentiation
- **File**: src/components/report/PassportHero.tsx ; src/components/report/TrendChart.tsx
- **Scenario**: Remotion is a dependency but unused here. A 6-second animated recap (score climbing, gaps closing, trajectory) is a uniquely shareable artifact no competitor offers.
- **Root cause / Rationale**: The animated visual language exists but isn't packaged for export.
- **Impact**: Standout differentiation + a viral social object for end-of-quarter "progress" posts.
- **Fix sketch**: A Remotion composition fed by `report` + history; render server-side to MP4/GIF behind a "Share recap" button (premium flourish).

---

## Repo Report Shell & Tabs

### 1. Permalink page runs 5 sequential awaits — avoidable cold TTFB
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: performance
- **File**: src/app/report/[owner]/[repo]/page.tsx:54-62
- **Scenario**: A `force-dynamic` permalink awaits `readableOrgForOwner` → `getScanReportByCommit` → `getSkillHistory` → `getRepoPassport` → `hasOrgRole` in series. `getSkillHistory`/`getRepoPassport` are independent of each other yet serialized on the share-link hot path.
- **Root cause / Rationale**: Sequential `await`s with no data dependency.
- **Impact**: Slower TTFB on the most-shared URL (where unfurl/first-paint matters most).
- **Fix sketch**: `Promise.all([getSkillHistory(ref), getRepoPassport(...)])` after `pinned`, then `canEditPassport`.

### 2. After an in-place Re-test, history/recs panels keep showing pre-rescan data
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: stale-data
- **File**: src/components/report/ReportView.tsx:70-98
- **Scenario**: The history+recommendations effect is keyed on `[repo.owner, repo.name]`. `onRetest` swaps in a new `report` but owner/name are unchanged, so it never refires — `RecommendationTracker` items and the "N scans tracked" count go stale until reload.
- **Root cause / Rationale**: Deps omit a re-test/scan identity (e.g. `report.scannedAt`).
- **Impact**: Re-testing shows an outdated roadmap/trend right after the action meant to refresh it.
- **Fix sketch**: Add `report.scannedAt` (or an attempt counter) to the effect deps.

### 3. ReportConversionCta fires an uncached `/api/auth/viewer` on every report mount
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: performance
- **File**: src/components/report/ReportConversionCta.tsx:19-30
- **Scenario**: Renders nothing until `/api/auth/viewer` resolves, refetched every report view with no cache/dedupe → extra round-trip + a late footer insertion (CLS).
- **Root cause / Rationale**: Viewer state fetched per-component instead of shared/SSR-provided.
- **Impact**: Minor perf + a jump at the report footer.
- **Fix sketch**: Lift viewer state to shared context/SWR, or pass `signedIn` from the server page.

### 4. Add "Watch this repo — email me when the score moves"
- **Severity**: High
- **Lens**: business-visionary
- **Category**: retention
- **File**: src/components/report/ReportView.tsx:298-300 ; src/components/report/ReportConversionCta.tsx
- **Scenario**: The report is the peak-engagement moment, the score delta is already computed (`overallDelta`), and SES is wired — yet the only nudge is a generic "scan your org." No per-repo subscribe-to-changes.
- **Root cause / Rationale**: Nothing converts a one-off scan into an ongoing relationship with this repo.
- **Impact**: The strongest retention loop (alerts pull users back; regression alerts are urgent) is absent.
- **Fix sketch**: A "Watch" button storing repo+email+org; the trend cron emails on a threshold move. Natural account-creation driver for signed-out viewers.

### 5. Turn ColdScanGate into a converting teaser, not a bare empty state
- **Severity**: Medium
- **Lens**: business-visionary
- **Category**: activation
- **File**: src/components/report/ColdScanGate.tsx:29-44
- **Scenario**: A shared/"see an example" permalink for an unscanned repo shows only "No report yet … Scan now" — a dead end with no sense of the payoff.
- **Root cause / Rationale**: Correctly avoids auto-scanning but under-sells; no preview.
- **Impact**: Shared links (the viral surface) convert poorly.
- **Fix sketch**: Show a teaser (sample radar/score skeleton or blurred example: "Scan to reveal {owner}/{repo}'s maturity across 9 dimensions"), keeping the explicit Scan action.
