# Bug Hunter — Organization Scanning, Watchlist & Rollups (ascent)

> Total: 7 findings (Critical: 1, High: 2, Medium: 3, Low: 1)
> Files read: 11
> Scope: /api/org/*, /api/cron/rescan, lib/db/org

## 1. Cron rescan is fully unauthenticated when CRON_SECRET is unset/empty
- **Severity**: Critical
- **Category**: functionality
- **File**: src/app/api/cron/rescan/route.ts:30-37
- **Scenario**: `CRON_SECRET` is not configured (or set to empty string) in the deployment. Any anonymous client `GET /api/cron/rescan` runs the entire fleet rescan — minting every org's installation token, hitting GitHub, and spending LLM budget on up to 100 repos. The auth block is `if (secret) { … }`, so a missing/empty secret skips the check entirely and returns 200. `vercel.json` registers the cron path with no `?key=`, so the only real auth path is the `Authorization: Bearer` header Vercel injects — which only exists when the secret is set. There is no fail-closed default.
- **Root cause**: Authentication is opt-in (guarded by the presence of the secret) instead of fail-closed; a missing env var silently disables the gate on an expensive, token-minting, money-spending endpoint.
- **Impact**: unauthorized/expensive ops — anyone can repeatedly trigger full-fleet rescans (DoS on GitHub rate limits + LLM cost), and a forgotten env var on a new deploy leaves it wide open with no error.
- **Fix sketch**: Fail closed — if `!secret`, return 503/401 (never run unauthenticated). Require the header/key unconditionally and refuse to execute when the secret is absent.

## 2. Cross-instance overlap of cron + manual bulk scan inserts duplicate Scan rows on a new commit
- **Severity**: High
- **Category**: functionality
- **File**: src/app/api/cron/rescan/route.ts:60-84; src/app/api/org/scan/route.ts:75-103; src/lib/db/scans.ts:248-262,343-356
- **Scenario**: A user clicks "Scan all" (`/api/org/scan`) at ~06:00 while the Vercel cron (`/api/cron/rescan`) fires for the same org. Both scan the same watched repo at the same HEAD `sha`. Dedup (`findScanByCommit` on `repo.id + headSha`) catches that case only when the first scan has *committed* before the second reads. `withRepoLock` serializes this — but it is a **process-local** in-memory promise queue (`repoPersistQueue` Map). Cron and the manual route run in **separate Vercel lambda instances**, so the lock does not span them. Both read "no existing scan for sha", both pass dedup, both insert a Scan row for the identical commit.
- **Root cause**: The only cross-instance guard is the `headSha` dedup *read-then-write*, which is not atomic across processes; the serialization (`withRepoLock`) is single-process. There is no DB-level unique constraint on `(repoId, headSha)`.
- **Impact**: inconsistent state / wrong aggregates — two Scan rows for one commit double-count that repo in trend per-day averages, movers "since last scan" (now/prev become the two duplicates → 0 delta hiding a real move), and inflate metered scan counts.
- **Fix sketch**: Add a unique index on `Scan(repoId, headSha)` and upsert/`ON CONFLICT DO NOTHING`, so a duplicate commit can never produce two rows regardless of instance.

## 3. Cron reports success (200) while scanning nothing when an org's installation token mint fails
- **Severity**: High
- **Category**: functionality
- **File**: src/app/api/cron/rescan/route.ts:46-53,60-68
- **Scenario**: An org's GitHub App install is suspended/revoked, or `getInstallationToken` throws (rate-limited JWT, network). The pre-resolve step does `.catch(() => undefined)` and stores `undefined` in `tokenByOrg`. Every due repo for that org then scans with `token = undefined`. For private/org repos the GitHub source 404s, each repo throws, each goes to the catch → `advanceScheduleAfterFailure` + `recordScanOutcome(error)`. The run still returns HTTP 200 `{ due, scanned, errors }`. If *every* due repo belongs to that broken org, `scanned` is 0 but the endpoint looks healthy.
- **Root cause**: A failed token mint is swallowed to `undefined` and treated as "scan anyway tokenless" rather than "skip this org and surface the auth failure"; the per-repo loop can't distinguish "repo broken" from "org's token is dead".
- **Impact**: silent failure — a whole org's autoscans fail every cron run with only a buried `errors[]` entry; the dashboard flags each repo as individually broken, masking the single root cause (dead installation). No alerting fires.
- **Fix sketch**: When `tokenByOrg.get(slug)` is `undefined` for an org that has private/watched repos, skip its repos with an explicit `org_auth_failed` outcome (don't burn a scan attempt) and emit a distinct top-level error so it's not mistaken for healthy.

## 4. Cron retry (Vercel/GitHub at-least-once) re-scans already-scanned-but-not-yet-advanced repos, burning LLM budget
- **Severity**: Medium
- **Category**: functionality
- **File**: src/app/api/cron/rescan/route.ts:42,60-84; src/lib/db/org.ts:177-220
- **Scenario**: The cron run is retried (Vercel re-invokes on a 5xx/timeout, or the function exceeds `maxDuration=300` partway through a large fleet). `listDueRescans` is re-evaluated at retry time. Repos that finished scanning *and* had `advanceSchedule` applied are no longer due — fine. But there is no per-run idempotency key, and any repo whose scan completed while the lambda was killed *before* `advanceSchedule` committed is still due → it is scanned again. On a new HEAD between attempts, dedup won't catch it, so a fresh (metered) LLM scan runs again.
- **Root cause**: No idempotency token per cron invocation and the "mark done" (`advanceSchedule`) is a separate write after the expensive scan, so a crash in the gap re-queues real work; retries are assumed to be free.
- **Impact**: expensive ops / wrong aggregates — duplicated LLM spend on retries; combined with finding #2, possible duplicate rows for repos whose commit advanced between attempts.
- **Fix sketch**: Advance `nextScanAt` (claim the repo) *before* scanning, or stamp an idempotency/lease token per repo per run so a retry skips repos already claimed in the current window.

## 5. Benchmark percentile and movers are statistically meaningless with one data point (no minimum-sample guard)
- **Severity**: Medium
- **Category**: functionality
- **File**: src/lib/db/org.ts:1180-1203 (benchmark); 808-826 (movers no-window path)
- **Scenario**: A fresh deployment where exactly one *other* repo (one corpus repo) has ever been scanned: `getOrgBenchmark` computes `overallPercentile = Math.round((below/1)*100)` → 0 or 100, presented as a real percentile ("you beat 100% of orgs") off a sample of one. Separately, `getOrgMovers` no-window path requires `r.scans.length >= 2`; a fleet where every repo has been scanned exactly once returns `comparedRepos: 0` with empty gainers/regressers — the "what moved" view is silently blank rather than "not enough history", indistinguishable from "nothing moved".
- **Root cause**: Aggregates compute on whatever data exists with no minimum-sample threshold; corpus size and per-repo scan count of 1 are not treated as "insufficient data" states.
- **Impact**: wrong aggregates — misleading single-sample percentiles and a "nothing moved" UI that actually means "no second scan yet", eroding trust in the dashboard for new/small orgs.
- **Fix sketch**: Return `overallPercentile: null` (and a `sample` count) below a corpus floor (e.g. `< 5`); have movers distinguish `comparedRepos: 0` due to insufficient history with an explicit flag the UI can render.

## 6. /api/org/import silently truncates large orgs and never records outcomes on the public (watch=false) path
- **Severity**: Medium
- **Category**: functionality
- **File**: src/app/api/org/import/route.ts:55,102-106,131-148; src/lib/github/list.ts:45-55
- **Scenario**: (a) A user imports a 500-repo org. `count` is clamped to `Math.min(100, …)` and `listOrgRepos` fetches a single page (`per_page` ≤ 100, no pagination loop), so only the 100 most-recently-pushed repos are scanned. The `result` event reports `total: <=100` as if that were the whole org — the other 400 are silently dropped, no warning. (b) On the public funnel (`watch=false`), `recordScanOutcome` and `setRepoWatch` are skipped, so a per-repo scan failure is sent over SSE but leaves no durable trace; the `console.warn` for partial persist failures (audit/contributors) is the only record and vanishes.
- **Root cause**: Single-page listing with a hard 100 cap presented as the full org; outcome bookkeeping is gated on `watch`, so the funnel path has no durable failure record.
- **Impact**: silent failure / inconsistent state — users believe their whole org was imported when it was truncated; funnel-path failures are unobservable after the stream closes.
- **Fix sketch**: Paginate `listOrgRepos` (or surface `truncated: true` + total available in the `found`/`result` events); record scan outcomes even on the unwatched path (or explicitly document it's a preview, not a full import).

## 7. recordScanOutcome timestamp lies under bounded-concurrency staleness skip
- **Severity**: Low
- **Category**: code_quality
- **File**: src/lib/db/org.ts:229-246; src/app/api/org/scan/route.ts:41-44
- **Scenario**: `/api/org/scan` with `staleOnlyDays:N` filters out repos whose `lastScanAt` is recent, so they are never scanned this run. That's correct — but a repo that *is* scanned writes `lastScanAttemptAt = new Date()` while `lastScanAt` (the actual scan time) is only updated inside `persistScanReport`. If a scan dedups (unchanged commit), `lastScanAttemptAt` advances but the report's `scannedAt` may differ from `lastScanAt`, so the two timestamps drift; a subsequent `staleOnlyDays` filter keys on `lastScanAt` (correct) while the UI's "needs attention" affordance keys on `lastScanStatus`/`lastScanAttemptAt`. The fields can disagree on what "last scanned" means.
- **Root cause**: Two separate "last scan" timestamps (`lastScanAt` vs `lastScanAttemptAt`) updated by different code paths with no single source of truth; dedup advances attempt time without a new scan.
- **Impact**: inconsistent state — minor UI/staleness ambiguity (a deduped repo can read as both "fresh" and "just attempted"), no data loss.
- **Fix sketch**: Define one canonical "last successful scan" timestamp and derive staleness/UI from it; only advance attempt time alongside a recorded outcome status the UI already reads.
