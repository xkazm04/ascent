# Organization Scanning, Watchlist & Rollups — business-visionary + bug-hunter scan (2026-06-11)
> Total: 4 findings (3 bug / 1 business)

## 1. Manual bulk-scan & import charge a credit for a deduped (unchanged-commit) scan — cron refunds, they don't
- **Type**: bug
- **Severity**: High
- **Category**: silent-failure / wrong-billing
- **File**: src/app/api/org/scan/route.ts:144 · src/app/api/org/import/route.ts:188
- **Scenario**: A metered org clicks "Scan all watched" on a 20-repo fleet. Most repos' HEAD commit is unchanged since the last scan (or a recent cron pass), so `persistScanReport` returns `{ deduped: true }` — no new `Scan` row, no new billable result. The route reserved one credit per repo up front (org/scan:119, org/import:163) and only refunds when `report.engine.provider === "mock"`. On a deduped REAL-LLM scan the provider is `gemini`/`bedrock`, so the `=== "mock"` test is false and the credit stays spent. The cron does this correctly — `cron/rescan/route.ts:133` refunds on `report.engine.provider === "mock" || persisted?.deduped` — but the two interactive paths never got the `|| persisted?.deduped` clause.
- **Root cause / Opportunity**: The refund condition keys off the engine provider, not off whether a new billable row was actually persisted. `persisted` is in scope at both sites (org/scan:135, org/import:179) but `persisted.deduped` is ignored for the refund decision. This also contradicts the module's own stated policy: `src/lib/entitlement.ts:5-6` ("a cache/dedup … run is free").
- **Impact**: Steady, customer-visible overcharge. Re-clicking "Scan all", or any bulk scan that overlaps a recent cron run, debits one credit per unchanged repo for zero new data — and behaves differently from the scheduled path, so the ledger silently disagrees with what was actually produced. Erodes trust in the prepaid-credit meter, the product's revenue spine.
- **Fix sketch**: Mirror the cron line in both routes: change the mock-only refund to `if (report.engine.provider === "mock" || persisted?.deduped) await refundCredit();` (org/scan/route.ts:144, org/import/route.ts:188). `persisted` is already the awaited `PersistResult` at both sites. Add a vitest asserting a deduped persist result triggers `grantCredits(...,1,{reason:"refund"})`.
- **Effort**: 2/10 · **Impact score**: 7/10

## 2. Public-funnel import scans with the operator's ambient PAT — anonymous caller can exfiltrate a private repo's report
- **Type**: bug
- **Severity**: High
- **Category**: authz-gap / confused-deputy / silent-leak
- **File**: src/app/api/org/import/route.ts:73,178 (via src/lib/scan.ts:127)
- **Scenario**: `POST /api/org/import { org: "public", repos: ["victim/secret"], mock: true }` with no session. `metered` is false (mock + public), so no auth/credit gate runs. No installation token is minted (the caller doesn't own `public`), so `token` stays `process.env.GITHUB_TOKEN` (import:73), and that token is passed straight into `scanRepository(r.fullName, { token, mock })` (import:178). Operators are explicitly told to set `GITHUB_TOKEN` "to avoid rate limits" (import:15) — a classic PAT carries full `repo` scope. The scan then ingests the private repo (a mock scan still fetches the real snapshot), and `persistScanReport`/`setRepoWatch` store its maturity report — dimension breakdown, recommendations, contributor logins — under the open `public` org, readable by anyone.
- **Root cause / Opportunity**: The project's own convention (closed for the README badge in the 2026-06-08 unauth-leaks wave) is "public surfaces must be token-less by construction" — `ScanOptions.noAmbientToken` exists precisely for this. The badge sets it; the import funnel never did, so the ambient PAT becomes a confused deputy for any attacker-chosen `repos[]` entry. Precondition: `GITHUB_TOKEN` has private visibility (common). The `listOrgRepos` path is safe (returns only the org's public repos); the explicit `repos[]` array is the leak vector.
- **Impact**: Cross-boundary disclosure of private-repo engineering posture for any repo the operator's PAT can see, persisted publicly and cacheable. Same severity class as the badge leak that was already prioritized.
- **Fix sketch**: In import, track whether an installation token was actually minted (`appTokenMinted`). For the scan call, when no install token was minted pass `{ token: undefined, noAmbientToken: true, mock }` so private repos 404 instead of ingesting under the operator PAT; keep the env token only for the public `listOrgRepos` listing. ~8 LOC in import/route.ts. (Public-repo scans then run token-less — acceptable; the route is already hard-throttled by `ORG_IMPORT_RATE_LIMIT`.)
- **Effort**: 3/10 · **Impact score**: 7/10

## 3. Regression alerts & the weekly digest fire into ONE global webhook — multi-tenant customers can't receive their own fleet intelligence
- **Type**: business
- **Severity**: High
- **Category**: retention / monetization / differentiation
- **File**: src/lib/alerts.ts:200-211 · src/lib/scan-alerts.ts:57 · src/app/api/cron/digest/route.ts:39,73
- **Scenario (job-to-be-done)**: An engineering leader for org `acme` wants "tell my team's Slack when a watched repo regresses, and push us a weekly fleet digest." Today `dispatchAlert` (alerts.ts:210) and `isAlertConfigured` (alerts.ts:201) read a single process-wide `ALERT_WEBHOOK_URL`. Both the per-repo regression path (scan-alerts.ts) and the weekly digest (cron/digest) POST every org's intelligence to that one operator-owned sink. In a multi-tenant deploy, customer `acme`'s regressions and digest land in the platform operator's channel — `acme` gets nothing, and two tenants sharing the instance cross-pollute.
- **Root cause / Opportunity**: The alert layer was built single-tenant (env-configured). The push loop — "your fleet this week" + live regression alerts — is exactly the habit/retention mechanic org-analytics products live on, and all the data (rollup, movers, top recommendation, percentile, trajectory) is already assembled in cron/digest:58-72. It just can't reach the customer. Per-org routing turns a dormant operator-only feature into a per-tenant retention surface and a clean upsell (alerting as a paid tier).
- **Impact**: Unlocks the retention loop for every paying org instead of the operator alone; removes a correctness/privacy footgun (cross-tenant alert bleed); enables "Slack/Teams alerting" as a plan differentiator. Without it, the digest/alert investment delivers near-zero customer-facing value in the multi-tenant model the product targets.
- **Fix sketch**: Add an additive nullable `alertWebhookUrl String?` to `Organization` (schema.prisma + init.sql — the established additive-column pattern, verified via `prisma generate` + tsc + build, DB-less). Thread an optional `webhookUrl` override through `dispatchAlert(message, { signal, webhookUrl })` (falls back to env), have `checkAndAlertRegression` and cron/digest read the org's URL (one `select`), and add a small `requireOrgRole(org,"admin")`-gated `POST /api/org/alerts` to set it. ~110 LOC, no new deps; pure message builders stay unit-tested.
- **Effort**: 5/10 · **Impact score**: 8/10

## 4. Benchmark corpus percentile has no minimum-sample floor — its own cohort path does
- **Type**: bug
- **Severity**: Medium
- **Category**: edge-case / wrong-rollup
- **File**: src/lib/db/org-insights.ts:535,556-558
- **Scenario**: On a young deployment where only 1–4 repos outside the org have ever been scored, `getOrgBenchmark` returns `overallPercentile: pctile(corpus.map(c=>c.overall), myAvgOverall)`. `pctile` (org-insights.ts:535) only guards `xs.length === 0`, so a corpus of one yields a hard 0 or 100 — surfaced verbatim in the dashboard and the weekly digest (cron/digest:70) as "you beat 100% of orgs." The same function's cohort path already knows better: it gates its percentiles behind `COHORT_MIN = 5` (org-insights.ts:487,545) and returns `null` below it. The headline corpus percentile was left without the matching floor.
- **Root cause / Opportunity**: An aggregate computed on whatever data exists, with no "insufficient sample" state for the whole-corpus comparison — even though the cohort branch demonstrates the team's own intended discipline. The inconsistency is in current source.
- **Impact**: A confidently-wrong percentile for exactly the new/small tenants forming their first impression of the product (and it ships into their digest), eroding trust in the benchmark — a core differentiator. Low blast radius, but cheap to make honest.
- **Fix sketch**: Add `const CORPUS_MIN = 5;` and return `overallPercentile: corpus.length >= CORPUS_MIN ? pctile(corpus.map(c=>c.overall), myAvgOverall) : null` (org-insights.ts:558); the UI/digest already treat `null` as "no percentile yet" (cron/digest:70, `??  null`). Unit-test `pctile` floor behavior.
- **Effort**: 2/10 · **Impact score**: 5/10
