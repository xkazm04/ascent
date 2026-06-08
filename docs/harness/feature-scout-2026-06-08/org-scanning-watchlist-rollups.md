# Feature Scout — Organization Scanning, Watchlist & Rollups

> Total: 6
> Critical: 1 | High: 3 | Medium: 2 | Low: 0

## 1. Cron rescan starves large fleets and silently advances past failures
- **Severity**: Critical
- **Category**: functionality
- **File**: src/app/api/cron/rescan/route.ts:39 (and src/lib/db/org.ts:145)
- **Gap**: `GET /api/cron/rescan` calls `listDueRescans()` with the default `limit = 50` (org.ts:145) and scans them **sequentially** in one Vercel invocation bounded by `maxDuration = 300` (route.ts:24). There is no cursor/continuation and no per-org fairness: `listDueRescans` orders strictly by `nextScanAt asc` across ALL orgs (org.ts:148-153). So with >50 repos due fleet-wide, the same earliest-due repos win every daily run and later repos are perpetually starved — and a real LLM scan that takes several seconds each can blow the 300s budget well before 50 finish, with no record of what got skipped. Worse, the schedule is only advanced *after* a successful scan (`advanceSchedule` at route.ts:70, inside the try); on persistent failure the repo stays due and re-fails every single cron run, crowding out healthy repos.
- **User value**: Any org past ~50 watched repos (the target enterprise customer) gets a dashboard that quietly goes stale for the back half of its fleet — the core "fleet stays fresh automatically" promise breaks exactly at the scale that justifies the product.
- **Implementation sketch**: Raise/scope the batch with round-robin fairness (e.g. order by `(nextScanAt, orgId)` and cap per-org per run), add a `cursor`/`continueToken` so a long backlog drains over successive cron ticks, and run scans with a small concurrency pool (see sketch in #2). Always advance `nextScanAt` even on failure (with backoff) so one broken repo can't permanently block the queue.
- **Effort**: M

## 2. Bulk scans run strictly serially — no concurrency on the slowest operation
- **Severity**: High
- **Category**: automation
- **File**: src/app/api/org/scan/route.ts:48 (mirrored in src/app/api/org/import/route.ts:114 and src/app/api/cron/rescan/route.ts:44)
- **Gap**: All three bulk paths iterate `for (const repo of repos) { await scanRepository(...) }` — one repo at a time. A grep for `Promise.all|concurrency|p-limit|parallel` in `org/scan/route.ts` returns **no matches**. With per-repo scans dominated by network/LLM latency, a 40-repo "Scan all" serializes into minutes of wall-clock time, and the SSE war-room (`/org/[slug]/live`, live/page.tsx) trickles results one-by-one while the 300s `maxDuration` ceiling looms.
- **User value**: Faster "Scan all" and import for everyone; more importantly it lets a realistic fleet finish inside the function timeout instead of truncating mid-run. The SSE wall fills in a fraction of the time, making the live dashboard feel responsive.
- **Implementation sketch**: Introduce a small fixed-size worker pool (3–5) that pulls from the repo queue and `send`s each `repo` event as it resolves — the existing `send(event, data)` SSE emitter already tolerates out-of-order completion since each message carries its own `repo`/`index`. Reuse the same pool helper in import and cron to bound GitHub/LLM concurrency centrally.
- **Effort**: M

## 3. Scan failures are invisible — no per-repo error state on the watchlist
- **Severity**: High
- **Category**: user_benefit
- **File**: src/lib/db/org.ts:393 (OrgRepoRow) and prisma/schema.prisma:71 (Repository model)
- **Gap**: The `Repository` model has `watched`, `scanSchedule`, `lastScanAt`, `nextScanAt` but **no `lastScanError`/`lastScanStatus`** (schema.prisma:87-90 — confirmed, no error column). When a scan throws, every path only `console.warn`/`console.error`s and moves on (scan/route.ts:69, import/route.ts:138, cron/rescan/route.ts:72-74). `OrgRepoRow` (org.ts:393-410) carries `latest` or `null` but no failure reason, so a repo that's been failing for weeks looks identical to one that's simply never been scanned. The cron returns an `errors[]` array (route.ts:77) but it's thrown away after the HTTP response — nobody sees it.
- **User value**: A fleet owner can finally tell "never scanned" apart from "scanning is broken" (revoked token, deleted repo, rate-limited, private-repo permission lost) and act on it. Today these failures are completely silent to the user.
- **Implementation sketch**: Add `lastScanError String?` + `lastScanStatus String?` + `lastScanAttemptAt` to `Repository`, write them in the catch blocks of the three bulk paths, surface them in `OrgRepoRow`/`getOrgRollup`, and render a "needs attention" affordance on the repositories view. The cron's existing `errors[]` already has the data to persist.
- **Effort**: M

## 4. No scheduled fleet digest — alerts only fire on per-repo regression
- **Severity**: High
- **Category**: integration
- **File**: src/lib/scan-alerts.ts:32 and src/app/api/cron/rescan/route.ts:65-69
- **Gap**: The only outbound notification is `checkAndAlertRegression` (scan-alerts.ts), fired per-repo inside the cron/webhook *only when a repo regresses* (rescan/route.ts:66-69). A grep for `digest|weekly.*summary|sendDigest` across `src` returns nothing org-facing. There is no positive/periodic rollup push: the rich aggregates already computed in org.ts (`getOrgRollup` deltas/forecast, `getOrgMovers` gainers, `getOrgRecommendations` leverage, `getOrgBenchmark` percentile) are only ever pulled by a human visiting the dashboard. A leader who doesn't open the app sees nothing unless something breaks.
- **User value**: Engineering leaders get a weekly "your fleet this week" Slack/email — top movers, new level promotions, the highest-leverage org recommendation, percentile vs corpus — turning the dashboard into a push channel. This is the retention/habit loop org analytics products live on, and the data + Slack-block builder (alerts.ts:`buildRegressionMessage`) already exist.
- **Implementation sketch**: Add a `GET /api/cron/digest` (register it in vercel.json with a weekly cron) that loops watched orgs, calls the existing rollup/movers/recommendations queries, formats a Block-Kit summary via a sibling of `buildRegressionMessage`, and POSTs via the existing `dispatchAlert` sink. Cadence reuses the per-org schedule concept.
- **Effort**: M

## 5. Retention purge cron is implemented but never registered to run
- **Severity**: Medium
- **Category**: automation
- **File**: vercel.json:3 (and src/app/api/cron/purge/route.ts:1)
- **Gap**: `vercel.json` registers exactly one cron — `/api/cron/rescan` (vercel.json:5). The fully-built `GET /api/cron/purge` (purge/route.ts) that enforces per-org scan/audit retention is **not in the crons array**, so on Vercel it never fires unless someone curls it manually. A grep for `cron/purge` across all JSON returns no match. Org scan history therefore grows unbounded in production despite the retention feature existing and being documented.
- **User value**: Enterprise tenants with retention policies (a compliance/cost expectation) actually get them enforced; storage doesn't quietly balloon. This is a one-line config fix that activates already-shipped code.
- **Implementation sketch**: Add a second entry to `vercel.json`'s `crons` array pointing at `/api/cron/purge` on a daily/weekly schedule (it already self-guards with `CRON_SECRET` and `maxDuration`). No code change needed.
- **Effort**: S

## 6. Watchlist has no per-repo override of an org-wide cadence (schedule is set one repo at a time)
- **Severity**: Medium
- **Category**: feature
- **File**: src/app/api/org/schedule/route.ts:14 and src/app/api/org/watch/route.ts:13
- **Gap**: `setRepoSchedule` (org.ts:87) and `POST /api/org/schedule` operate on a single `fullName` per call, and `POST /api/org/watch` toggles one repo at a time. There is no "set cadence for the whole watchlist" or "set cadence for this segment" operation, and no bulk watch/unwatch. The `segmentScope` filter (org.ts:27) already exists for *reads* but isn't wired to any *write* over the watched set. Onboarding a 50-repo org means 50 schedule calls (the import route papers over this by defaulting all repos to one cadence at import.ts:56, but post-import there's no fleet-level knob).
- **User value**: A fleet owner can say "rescan the whole `platform` segment weekly, everything else monthly" in one action instead of clicking every repo. Makes cadence a managed policy rather than per-repo busywork.
- **Implementation sketch**: Add a bulk variant — `POST /api/org/schedule { org, schedule, segmentId? }` that runs `repository.updateMany` over `{ orgId, watched: true, ...segmentScope(segmentId) }` (the exact where-fragment org.ts:27 already builds), plus a bulk watch toggle on the same shape. Reuse `nextScanFor` (org.ts:16) for the `nextScanAt` recompute.
- **Effort**: S
