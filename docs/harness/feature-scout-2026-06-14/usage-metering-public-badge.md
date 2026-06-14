# Feature Scout — Usage Metering & Public Badge (ascent, 2026-06-14)
> Total: 6
> Severity: 0C / 4H / 2M / 0L

## 1. Badge funnel is unmeasured — no impression/click analytics or acquisition tag
- **Severity**: High
- **Category**: feature
- **File**: src/app/api/badge/[owner]/[repo]/route.ts:280-282, src/components/badge/BadgeGenerator.tsx:54
- **Scenario**: The team bets on the README badge as the primary virality loop (the page copy literally says "It links back to the full report, so a reader can click through and scan their own repo"). But nobody can answer "how many README impressions did the badge get, and how many converted to a scan?"
- **Gap**: Confirmed via grep — `impression`, `referer`/`referrer`, `recordBadge`/`trackBadge`, `badge.*view`, and `utm_`/`?ref=badge` all return ZERO matches anywhere in `src`. The badge route serves the SVG and the click-through href is a bare `${origin}/report/${ownerN}/${repoN}` (route.ts:282) with no campaign/source param, so even server logs can't attribute a report visit to a badge. There is a `byProvider`/`byRepo` analytics muscle in `usage.ts` but nothing for the growth surface.
- **Impact**: Growth/PMM + founders. Without impression and click-through counts, the badge loop can't be optimized (which style/repo converts, what the impression→scan rate is) and its ROI is invisible to the business — the single highest-leverage growth instrument flies blind.
- **Fix sketch**: (a) Add `?ref=badge&style=…` to the click-through href in route.ts and the generator snippet so report visits are attributable in existing analytics. (b) Add a lightweight `BadgeImpression` counter — increment a per-repo Redis/DB tally (or fire-and-forget log line) on each badge GET keyed by `Referer` host, exposed on `/usage` as a "Badge reach" panel (impressions, top embedding repos, click-through rate). ~1 day; reuse the in-memory `hits` map pattern already in route.ts for the DB-less path.

## 2. No numeric-score or per-dimension badge variant
- **Severity**: High
- **Category**: functionality
- **File**: src/app/api/badge/[owner]/[repo]/route.ts:343-356, src/components/badge/BadgeGenerator.tsx:23-37
- **Scenario**: A maintainer wants a badge that reads `ascent 87/100` (like Codecov's `coverage 92%`) or a per-dimension badge (`testing A`, `security B`) to surface a specific strength — the number is more shareable and more competitive-looking than a level glyph.
- **Gap**: Confirmed via grep — the badge only emits `level` (`○ L3 Defined`) or `gate` (`✓ pass`). Searching the badge route for `overallScore`, `score-number`, `/100`, `value:.*overall` returns NO matches; the only two `kind` values in BadgeGenerator are `"level" | "gate"`. The `report` object already carries `overall.score` (0..100) and per-dimension scores (see types.ts) — they're computed and discarded for the badge.
- **Impact**: Maintainers + growth. A score number is the most-copied badge format in the ecosystem (coverage %, build status). Offering `?metric=score` and `?dimension=testing` multiplies badge variety → more READMEs adopt it → more impressions for the loop in finding #1. Near-zero marginal scan cost (same cached report).
- **Fix sketch**: In route.ts add a `metric` param (`level`|`score`|`dimension`); for `score` render `value = `${report.overall.score}/100`` with the level color; for `dimension` read the named dimension's score/grade. Add the two chips to BadgeGenerator's `Kind`. Color mapping already exists via `resolveColor`/`LEVEL_HEX`. ~0.5 day.

## 3. No usage-spend budget or anomaly alert (alerts are maturity-only)
- **Severity**: High
- **Category**: user_benefit
- **File**: src/lib/alerts.ts:210-261, src/app/api/cron/digest/route.ts:75-94
- **Scenario**: An org's token spend triples overnight (a misconfigured autoscan loop, a model-failover to an expensive engine, a runaway CI gate). They want to be paged BEFORE the bill — a "usage spiked 3× vs your 7-day baseline" Slack alert, or a monthly spend budget that warns at 80%.
- **Gap**: Confirmed via grep — `alerts.ts` has exactly three alert types: regression (`detectRegression`), low-credits crossing (`isLowCreditsCrossing`), and the weekly fleet *maturity* digest. NONE watch token/cost volume. The digest (digest/route.ts) pulls `rollup`/`movers`/`recs`/`credit` — never `getUsageSummary`, so spend/anomaly never enters any push. There is no `budget`/`anomaly` logic tied to usage despite both words appearing only in unrelated files.
- **Impact**: Finance/eng-leads on the metered plan. Spend surprises are the #1 churn/trust risk for usage-based billing; a proactive budget+anomaly alert is table-stakes for any metered SaaS and reuses the entire `dispatchAlert`/per-org-webhook pipe that already exists. Directly protects revenue (fewer disputed bills) and retention.
- **Fix sketch**: Add `buildUsageAnomalyMessage`/`buildBudgetMessage` to alerts.ts (pure, like the others). In a cron (extend `cron/digest` or a new daily job) compute today's billable scans/cost vs the trailing-7d mean from `getUsageSummary`; if it exceeds a configurable factor (or a `USAGE_BUDGET_USD` cap), `dispatchAlert` to the org webhook. ~1 day; all plumbing (sink resolution, validation, threshold env pattern) already present.

## 4. /usage never reconciles metered scans against the credit ledger
- **Severity**: Medium
- **Category**: functionality
- **File**: src/app/usage/page.tsx:111-157, src/lib/db/credits.ts:136-157
- **Scenario**: A billing admin on the usage page sees "412 billable scans" and a credit balance, but wants the actual reconciliation: "412 private scans this period → 408 credits debited (4 refunded for unchanged-commit/degraded runs)" — the audit trail that proves the bill matches the work.
- **Gap**: The `/usage` summary is derived PURELY from `Scan` rows (`getUsageSummary` counts scans + tokens). A separate append-only `CreditLedger` exists (`getCreditLedger`, credits.ts:136) that records every `-1` debit with reason/refund and `balanceAfter`, explicitly "reconcilable against future Stripe top-ups" — but grep confirms it's surfaced ONLY via `/api/org/credits` and never joined to the usage view. The two authoritative counts (scans metered vs credits debited) are never shown side-by-side, so refunds/discrepancies are invisible on the billing page.
- **Impact**: Billing admins + trust. Reconciliation is the difference between a "usage dashboard" and an auditable billing statement; surfacing debits-vs-scans (and refund count) pre-empts billing disputes and is the natural bridge to the planned Stripe flow.
- **Fix sketch**: On `page.tsx`, when `org !== PUBLIC_ORG`, also `await getCreditLedger(org, …)` (filtered to the period) and render a "Reconciliation" panel: scans metered, credits debited, refunds (positive deltas with reason), net. Optionally add a ledger CSV to `/api/usage?format=csv`. ~0.5–1 day; both data sources already exist.

## 5. No scheduled / pushed usage statement — export is manual-only
- **Severity**: Medium
- **Category**: feature
- **File**: src/components/usage/UsageTrend.tsx:31-46, src/app/api/cron/digest/route.ts:1-8
- **Scenario**: A finance owner wants a monthly usage/cost statement to land in Slack or email automatically (for expense reconciliation / chargeback), not to remember to visit `/usage` and click "Export CSV" every month.
- **Gap**: The ONLY way to get usage out is the two manual `Export CSV`/`Export JSON` `<a download>` links in UsageTrend.tsx. The cron infrastructure clearly exists (`vercel.json` runs rescan/purge/digest crons) and the weekly digest pushes maturity data — but it carries no usage/cost figures (see finding #3) and there is no scheduled usage statement at all (grep for scheduled usage report = none).
- **Impact**: Finance/admins. A scheduled statement closes the "usage→billing" workflow loop and matches what every metered SaaS provides; turns a pull-only page into a push the buyer relies on (the same habit-loop rationale the maturity digest was built on).
- **Fix sketch**: Add a monthly `/api/cron/usage-statement` (mirror digest/route.ts structure + `CRON_SECRET` guard) that builds a per-org usage+cost summary via `getUsageSummary(org, 30)`, formats a Block-Kit card (reuse alerts.ts builders), and dispatches to the org webhook; register a `0 9 1 * *` entry in vercel.json. ~0.5 day; reuses the entire digest scaffold.

## 6. Badge click-through lands on a report, not an acquisition CTA for the visitor's OWN repo
- **Severity**: Medium
- **Category**: user_benefit
- **File**: src/app/api/badge/[owner]/[repo]/route.ts:280-282, src/components/badge/BadgeGenerator.tsx:54
- **Scenario**: A developer browsing project X's README clicks its Ascent badge. The point of the loop is to get THAT visitor to scan THEIR repo — but they land on project X's report (`/report/owner/repo`) with no prominent "scan your own repo" call-to-action tuned for a first-time, badge-referred visitor.
- **Gap**: The click-through href is hard-coded to `${origin}/report/${ownerN}/${repoN}` (route.ts:282) and the generator builds the same `reportUrl` (BadgeGenerator.tsx:54). There is no badge-referred landing variant and (per finding #1) no `?ref=badge` to even branch on. The report page has no badge-aware acquisition hook (grep for `from=badge`/`source=badge` = none).
- **Impact**: Growth/acquisition. The badge generates the impression; the landing converts it. A referred visitor seeing a "Scan your repo free →" hero (with the example report below) is the standard product-led-growth conversion step — the current dead-end report leaks the very traffic the badge worked to create.
- **Fix sketch**: Pass `?ref=badge` on the click-through (ties into #1). On `/report/[owner]/[repo]`, when `searchParams.ref === "badge"`, render a top banner / sticky CTA: "Like this? Scan your own repo free" → `/` (or `/onboarding`). No new data; ~0.5 day of UI + the one-line href change.
