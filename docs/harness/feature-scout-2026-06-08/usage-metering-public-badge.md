# Feature Scout — Usage Metering & Public Badge

> Total: 6
> Critical: 0 | High: 3 | Medium: 2 | Low: 1

## 1. Per-repo usage breakdown (which repos are burning the bill)
- **Severity**: High
- **Category**: functionality
- **File**: src/lib/db/usage.ts:79 (host: `getUsageSummary` Promise.all aggregate block); surfaced in src/app/usage/page.tsx:119
- **Gap**: `UsageSummary` (usage.ts:21-40) exposes `distinctRepos` (a single count) and a provider mix, but never a per-repo scan breakdown. The `/usage` page shows org-level totals and a "Repos scanned" stat (page.tsx:123) with no way to see *which* repos drove the billable volume. The data is one `groupBy(["repoId"])` away — the same query shape already used for `byProvider` (usage.ts:85) — and `Repository.fullName` is right there in the schema (schema.prisma:75).
- **User value**: A finance/eng-lead reconciling the bill needs to know the top private repos by metered scans (e.g. "a misconfigured CI loop on `acme/api` ran 400 scans"). Today the dashboard can show the total is high but offers zero attribution to act on.
- **Implementation sketch**: Add a `byRepo: { fullName; scans; billable }[]` field populated by a `scan.groupBy({ by: ["repoId"], where: periodWhere })` joined to `Repository.fullName`/`isPrivate` (mirror the existing `fetchDailySeries` raw-SQL pattern), then render a sorted "Top repos" table beside the existing provider card in page.tsx.
- **Effort**: M

## 2. Estimated cost / spend, not just scan counts
- **Severity**: High
- **Category**: user_benefit
- **File**: src/app/usage/page.tsx:99 (`const billable = usage.privateScans`); src/app/usage/page.tsx:156
- **Gap**: The whole surface is sold as a "billing/usage view" (usage.md:1) and the pricing page promises "pay only for what you scan" (page.tsx:146), yet the dashboard literally tells the user "Per-scan rate is TBD" (usage.page.tsx:156) and renders raw counts only. There is no rate config, no dollar estimate, no projected month-end spend anywhere (`grep` for `pricePerScan`/`estimatedCost` → none). A usage-based product whose usage view shows no money is the central value gap.
- **User value**: The buyer signing off on a usage-based plan wants "you're on track for ~$X this month" — counts alone don't answer "what will this cost me?". This is the difference between a metering toy and a billing dashboard.
- **Implementation sketch**: Introduce a `PRIVATE_SCAN_RATE_CENTS` env (or per-plan rate on `Organization.plan`) and derive `estimatedCostCents = privateScans * rate` plus a month-to-date projection from the `daily` series slope; surface a "$ this period / projected" Stat card and add a `cost` column to the CSV export in api/usage/route.ts:14 (`toCsv`).
- **Effort**: M

## 3. Usage budget alerts (notify before the bill surprises you)
- **Severity**: High
- **Category**: automation
- **File**: src/lib/alerts.ts:1 (existing alert dispatch infra); attach via src/lib/db/usage.ts
- **Gap**: A full alert pipeline already exists — `detectRegression` + a Slack-compatible `dispatchAlert` to `ALERT_WEBHOOK_URL` (alerts.ts:1-8) — but it's wired *only* to scan-quality regressions, never to usage volume/spend. There is no threshold, no monthly-budget cap, no "you've used 80% of your budget" notification (`grep` for `quota`/`budget` in usage paths → none). Usage just accrues silently until someone opens `/usage`.
- **User value**: Orgs on metered billing get blindsided by runaway scan volume (a stuck cron, a chatty CI hook). A budget-threshold alert turns the metering data into a guardrail instead of a postmortem.
- **Implementation sketch**: Add an `Organization.usageBudget` field, then in the existing `/api/cron/rescan` (rescan/route.ts) or a new cron tick compute the period's `privateScans` via `getUsageSummary` and reuse `dispatchAlert` from alerts.ts to fire a Slack message when the org crosses 80%/100% of budget (de-dup per period).
- **Effort**: M

## 4. Numeric "score" badge variant (0–100), not only level/gate
- **Severity**: Medium
- **Category**: feature
- **File**: src/app/api/badge/[owner]/[repo]/route.ts:269 (gate branch) and :283 (level branch)
- **Gap**: The badge endpoint renders exactly two value shapes — `gate` (pass/fail, route.ts:269-281) and `level` (`L3 Defined`, route.ts:283-285). The report carries a precise `overallScore` (schema.prisma:182, surfaced everywhere via `overallScore`), but there's no `?metric=score` badge showing `78/100`, nor a single-dimension badge (`?dim=D4`). Shields-style competitors expose exactly these. `BadgeGenerator.tsx` only offers `level`/`gate` toggles (BadgeGenerator.tsx:103-108), confirming the gap end-to-end.
- **User value**: README authors who want a granular signal (a number that visibly ticks up as they improve, or a single-dimension badge like "Test Rigor: 82") get a tighter feedback loop than a coarse L1–L5 bucket — and a number that moves is a stronger growth/vanity hook.
- **Implementation sketch**: Add a `metric=score|dim` branch in the badge GET that reads `report.overallScore` (or a dimension score) and renders `value="78/100"` with a color ramped from `LEVEL_HEX`; expose it as a third "metric" toggle in `BadgeGenerator.tsx` alongside level/gate.
- **Effort**: S

## 5. Badge analytics — count and surface badge impressions
- **Severity**: Medium
- **Category**: user_benefit
- **File**: src/app/api/badge/[owner]/[repo]/route.ts:200 (GET handler — every embed hit lands here)
- **Gap**: The badge endpoint is the product's only viral/distribution surface (README embeds, "growth-loop pattern" per BadgeGenerator.tsx:3), yet every request is served and forgotten — no impression counter, no per-repo view tally (the in-memory `hits` map at route.ts:43 is rate-limiting only and discarded). The `/usage` dashboard reports scan volume but has zero visibility into badge reach. There's no `AuditLog`/counter write on a badge hit (`grep` confirms none).
- **User value**: Two audiences win: (a) the repo owner sees "your badge was viewed 3.2k times this month" (a reason to keep it in the README), and (b) the Ascent operator sees which embedded badges drive report click-throughs — the core distribution metric for a freemium SaaS.
- **Implementation sketch**: On a cache-hit badge response, fire a cheap fire-and-forget counter increment (a debounced `AuditLog` row with `action: "badge.view"` keyed by `owner/repo`, or a dedicated `BadgeView` daily-bucket row), then add a "Badge reach" panel to `/usage` reading that aggregate — reuse the daily-series rendering already in `UsageTrend.tsx`.
- **Effort**: M

## 6. Period-over-period comparison + selectable date ranges on /usage
- **Severity**: Low
- **Category**: functionality
- **File**: src/app/usage/page.tsx:58 (`days` param) and src/components/usage/UsageTrend.tsx:12
- **Gap**: The window is a single trailing `?days=` count (page.tsx:58, default 30) with no UI control to change it — the user must hand-edit the URL — and there is no prior-period delta ("billable scans up 23% vs last month") and no calendar-month boundary (the natural billing period). The org-side analytics already ship a `TimeRangeSelector` component (src/components/org/TimeRangeSelector.tsx) that this page could borrow, so the inconsistency is visible.
- **User value**: Billing reconciliation is inherently month-over-month; a trailing-N-days window with no comparison and no in-page picker makes "is this month bigger than last?" — the first question any cost owner asks — impossible without manual URL math.
- **Implementation sketch**: Add a range picker (reuse `TimeRangeSelector`) plus a calendar-month preset, and extend `getUsageSummary` to also compute the prior equal-length window's `privateScans` so the Stat cards can show a ▲/▼ delta chip next to the billable figure.
- **Effort**: S
