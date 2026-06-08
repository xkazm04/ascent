# Feature Scout — Org Dashboard & Views

> Total: 6
> Critical: 0 | High: 3 | Medium: 2 | Low: 1

## 1. Per-repo autoscan scheduling has no UI anywhere in the org views
- **Severity**: High
- **Category**: feature
- **File**: src/components/org/OrgScanButton.tsx:46 (host), src/app/org/[slug]/repositories/page.tsx:51 (where it would attach)
- **Gap**: The backend for scheduled rescans is fully built — `POST /api/org/schedule` accepts `off|daily|weekly|monthly` (src/app/api/org/schedule/route.ts:12), `setRepoSchedule`/`advanceSchedule`/`listDueRescans` persist a per-repo `nextScanAt`, and `GET /api/cron/rescan` (src/app/api/cron/rescan/route.ts) drains it. But grepping `src/components/org` for `schedule`/`autoscan` returns **zero** hits: no org view ever calls the schedule endpoint. The only thing in the dashboard is the one-shot "Scan all watched" button. Users can never set a cadence from the fleet UI they spend time in — the live-intelligence loop is invisible and unconfigurable here.
- **User value**: Org admins get "set it and forget it" continuous maturity tracking (the core value of the watchlist + cron infrastructure) without re-clicking a manual scan; surfaces the regression-alert loop that already exists.
- **Implementation sketch**: Add a schedule `<select>` column to the repositories leaderboard table (src/app/org/[slug]/repositories/page.tsx) that POSTs to the existing `/api/org/schedule`; read each repo's current `scanSchedule` from the rollup (already loaded) and show the next-due timestamp. No new backend needed.
- **Effort**: S

## 2. No CSV / data export from any org fleet view
- **Severity**: High
- **Category**: functionality
- **File**: src/app/org/[slug]/repositories/page.tsx:37 (leaderboard), src/app/org/[slug]/contributors/page.tsx:97 (involvement table), src/app/org/[slug]/delivery/page.tsx:91 (governance table)
- **Gap**: CSV/JSON export exists for exactly one surface — usage metering — via `toCsv` + `content-disposition: attachment` in src/app/api/usage/route.ts:14,75. A grep for `text/csv`/`Content-Disposition` across `src` shows that route as the *only* hit. The org leaderboard, repo×dimension heatmap, contributor involvement/bus-factor tables, and branch-governance matrix are rich tabular data with no way to extract them. Power users running board reviews or compliance reports must screenshot or retype.
- **User value**: Engineering leaders / EM / compliance can pull fleet maturity, governance, and contributor data into spreadsheets, board decks, and audits — the standard "I need this in Excel" workflow that gates SaaS adoption in larger orgs.
- **Implementation sketch**: Add `GET /api/org/[slug]/export?view=repositories|contributors|delivery&format=csv` reusing the `toCsv` + safe-filename pattern from src/app/api/usage/route.ts, sourcing rows from the same `getOrgRollup`/`getContributorInsights`/`getOrgGovernance` calls the pages already use; drop a small "Export CSV" link into each tab's `SectionHeader` `right` slot.
- **Effort**: M

## 3. "Scan all watched" is all-or-nothing — no scope, stale-only, or single-repo trigger
- **Severity**: Medium
- **Category**: automation
- **File**: src/components/org/OrgScanButton.tsx:19, src/app/api/org/scan/route.ts:48
- **Gap**: The button always rescans **every** watched repo (`listWatchedRepos(org)` → loop over all, src/app/api/org/scan/route.ts:27,48). A grep of the scan route for `stale|onlyStale|incremental|scope` returns nothing — there's no way to rescan just the stale repos, just one segment, or a single repo from the leaderboard. For a 50-repo org this burns the org's token budget (a concern the code itself flags at route.ts:23) re-scanning repos scanned yesterday, and there's no per-row "rescan this one" action despite each leaderboard row showing its last-scan date.
- **User value**: Avoids needless LLM spend and long waits; lets a user refresh just the one repo they care about, or only the N repos that have drifted past a freshness threshold — directly addresses the token-cost concern baked into the bulk-scan design.
- **Implementation sketch**: Extend `POST /api/org/scan` body with optional `repos?: string[]` / `staleOnlyDays?: number` (filter `listWatchedRepos` by `latest.scannedAt`); add a "Rescan" affordance per leaderboard row and a "Scan stale (>Nd)" variant of OrgScanButton that passes the filtered set. SSE/progress plumbing is unchanged.
- **Effort**: M

## 4. Regressions are alerted to Slack but barely surfaced inside the dashboard
- **Severity**: High
- **Category**: user_benefit
- **File**: src/app/org/[slug]/page.tsx:165 (the one-line "Standing" banner), src/app/org/[slug]/audit/page.tsx:13
- **Gap**: The regression engine (src/lib/scan-alerts.ts, src/lib/alerts.ts) detects level demotions, ungoverned slides, and score/dimension drops and records a `scan.regression` audit entry + optional Slack post. But in the dashboard the only first-class surface is a single pill on the overview — "⚠ N repos regressed this period" (src/app/org/[slug]/page.tsx:166) — with no drill-down to *which* repos, *which* dimension dropped, or *how far*. The structured `verdict.reasons`/`from→to` data is written to the audit log but never rendered as a dedicated, scannable "Regressions" view. Teams without a Slack sink effectively can't see regressions at all without grepping the audit tab.
- **User value**: A lead opening the dashboard immediately sees what regressed and why (the "live intelligence" the product promises), with a link straight to the offending report — no Slack required.
- **Implementation sketch**: Make the overview regression pill link to a filtered view (reuse `getAuditLog` filtered to `scan.regression`, or the existing `getOrgMovers` regressers) rendering repo · `from→to` level · reason codes; the data shape already exists in the audit payload (src/lib/scan-alerts.ts:44) and in `movers.regressers`.
- **Effort**: M

## 5. Contributor view is a snapshot — no per-person AI-adoption trend over time
- **Severity**: Medium
- **Category**: feature
- **File**: src/app/org/[slug]/contributors/page.tsx:194
- **Gap**: The page itself documents the gap: "Per-person trend over time, 'who introduced CLAUDE.md/evals', and GitHub Teams (GraphQL) attribution are still on the roadmap" (contributors/page.tsx:197). Today every metric (`aiShare`, commits, bus factor) is a single point computed from the latest scan window (src/lib/db/org.ts:328). There's no way to see whether a contributor's AI adoption is *rising or falling*, even though the org overview already has a full time-series/window engine (`resolveWindow`, `TimeRangeSelector`, `rollup.trend`, `deltas`). The dashboard can trend the whole fleet but not a person.
- **User value**: Managers see momentum, not just status — who's *adopting* AI vs. who plateaued — turning the "inputs to explore" framing into something coaching-actionable across review cycles.
- **Implementation sketch**: Add a windowed variant of `getContributorInsights(slug, segmentId, window)` that buckets AI-commit share per scan period (the contributor data is already captured per scan), then render sparklines in the involvement table and reuse the overview's `TimeRangeSelector` on this tab.
- **Effort**: L

## 6. OrgNav tab list is hardcoded with no overflow/active-section affordance
- **Severity**: Low
- **Category**: functionality
- **File**: src/components/org/OrgNav.tsx:10
- **Gap**: The nav hardcodes 11 tabs (Overview, Live, Repositories, Segments, Contributors, Teams, Delivery, Practices, Plan, Backlog, Audit) in a single `overflow-x-auto` row (OrgNav.tsx:10-22). The doc comment is even stale ("Overview · Repositories · Contributors · Delivery"). On narrow viewports tabs silently scroll off-edge with no scroll hint, no grouping, and the active state is exact-match only (`path === t.href`, line 26) — a deep route under a section won't highlight its parent tab. As the fleet UI keeps growing tabs, discoverability degrades.
- **User value**: Users on laptops/tablets can find every fleet view; sub-routes correctly highlight their owning tab — basic navigability of a now-crowded tab bar.
- **Implementation sketch**: Drive the tab list from a shared config array, switch active detection to `path === href || path.startsWith(href + "/")`, and add a scroll-fade/overflow "More" affordance (or group into primary vs. secondary sections); update the stale JSDoc.
- **Effort**: S
