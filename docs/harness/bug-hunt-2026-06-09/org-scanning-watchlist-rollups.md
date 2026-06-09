# Bug Hunter Scan — Organization Scanning, Watchlist & Rollups (ascent)

> Total: 7 findings (Critical: 1 | High: 3 | Medium: 2 | Low: 1)

## 1. Cron rescan has no run-level lock — overlapping invocations double-scan and double-bill every due repo
- **Severity**: Critical
- **Category**: cron-overlap / race-window
- **File**: src/app/api/cron/rescan/route.ts:48-122
- **Scenario**: If a `due` set takes longer than expected (a 40-repo fleet at `SCAN_CONCURRENCY=4` over slow LLM/GitHub latency) and the run nears the 300s ceiling, Vercel (or a manual `?key=` retry, or a re-fired cron after a transient 5xx) starts a second invocation while the first is still mid-flight. `listDueRescans()` selects rows purely by `nextScanAt <= now()`, and `advanceSchedule(...)` for each repo is only written at the *end* of that repo's lane. So both runs see the same repos as still-due, both call `consumeScanCredit` (a real debit), both call `scanRepository` + `persistScanReport`.
- **Root cause**: The endpoint assumes single-flight execution. There is no advisory lock, no "claim" column (e.g. atomically stamping `nextScanAt` forward *before* scanning), and the due-selection + schedule-advance are not transactional with the scan.
- **Impact**: Double credit spend (each repo charged twice), 2× GitHub API pressure toward a rate-limit ban, duplicate regression alerts, and wasted LLM budget. Silent — the JSON summary of each run looks normal.
- **Fix sketch**: Claim each repo atomically before scanning: `updateMany({ where: { id, nextScanAt: { lte: now } }, data: { nextScanAt: <in-progress sentinel / backoff> } })` and only proceed when `count === 1`. Or take a global Postgres advisory lock (`pg_try_advisory_lock`) at the top of the route and bail if not acquired.

## 2. Upfront credit slice is not enforced at debit time — concurrent batches over-scan beyond the paid balance for free
- **Severity**: High
- **Category**: race-window / silent-failure
- **File**: src/app/api/org/scan/route.ts:55-63,113-115 (mirror in src/app/api/org/import/route.ts:96-101,160-162)
- **Scenario**: `checkScanEntitlement` reads the balance, then `scanList = repos.slice(0, ent.balance)` caps the batch. But the actual debit is a *per-repo* `consumeScanCredit(...).catch(() => {})` inside the pool, run much later. If a second `/api/org/scan` (or `/api/org/import`, or the cron) for the same org runs concurrently, both pass the gate against the same balance and both slice optimistically. `consumeScanCredit` is atomic so the balance can't go negative — instead the conditional decrement returns `ok:false`/throws, the `.catch(() => {})` swallows it, **and the scan proceeds anyway** (the repo was already scanned/persisted before the debit).
- **Root cause**: Entitlement is gated optimistically up front but the debit is best-effort and decoupled from the decision to scan. A failed debit does not abort or skip the repo.
- **Impact**: An org with N credits can be made to run far more than N paid private scans for free under concurrency (real LLM + private-repo inference billed to the operator, not the customer). Credit ledger and actual usage silently diverge.
- **Fix sketch**: Reserve the credit *before* scanning (as cron does) and skip the repo when `ok:false`, rather than debiting after the fact and swallowing failures. At minimum, treat a failed debit on a non-mock scan as a hard skip + `notice`.

## 3. Deduped autoscan still consumes a credit (no refund path for unchanged commits)
- **Severity**: High
- **Category**: silent-failure / wrong-billing
- **File**: src/app/api/cron/rescan/route.ts:72-99
- **Scenario**: The cron reserves a credit up front (line 72), then refunds only when `report.engine.provider === "mock"` (line 99). For a repo whose HEAD commit is unchanged since the last scan, `persistScanReport` returns `{ deduped: true }` — no new `Scan` row is created (scans-persist.ts:125-129) — yet `report.engine.provider` is the real provider (gemini/bedrock), so **no refund fires**. The org is charged a credit for a rescan that produced no new scored row.
- **Root cause**: The refund condition keys off the engine provider, not off whether a new billable scan was actually persisted. `persisted.deduped` is checked for the regression alert (line 101) but not for the refund decision.
- **Impact**: Steady credit drain on stable repos: a `weekly` watched repo that doesn't change still burns one credit per cron pass forever. Customer pays for no new work; benchmarks/movers gain nothing.
- **Fix sketch**: Refund when `report.engine.provider === "mock" || persisted?.deduped`. Better: only reserve/charge after confirming a non-deduped persist.

## 4. Cron credit reserved before token resolution — a revoked-install org refunds, but partial-batch token failure silently scans nothing while advancing schedules
- **Severity**: Medium
- **Category**: partial-batch-failure / silent-failure
- **File**: src/app/api/cron/rescan/route.ts:54-59,83-89
- **Scenario**: Token minting is pre-resolved per org into `tokenByOrg`; a mint failure stores `undefined`. For a private repo, `scanRepository(fullName, { token: undefined })` then 404s in the GitHub source, lands in the `catch`, refunds, advances-with-backoff, and records an error outcome — so far so good. But the *backoff* is only 6h (`FAILED_RESCAN_BACKOFF_MS`), and the daily cron runs every 24h, so a permanently-revoked installation's entire watched fleet is re-attempted *every single cron run*, indefinitely, each time minting (failing), 404-ing every repo, and re-writing error rows.
- **Root cause**: There is no "give up after K consecutive failures" or escalating backoff. A whole-org auth failure (revoked install) is treated as a per-repo transient and retried at the same 6h floor forever.
- **Impact**: Daily wasted GitHub App JWT mints + per-repo 404 round-trips for dead installations, and the dashboard permanently shows the fleet as "error". Slow rate-limit pressure on `/app/installations/.../access_tokens`.
- **Fix sketch**: Escalating backoff (track consecutive failures, e.g. `nextScanAt = now + min(cap, base * 2^failures)`), and short-circuit a whole org when its token mint returns `undefined` (mark the install suspended, skip its repos this run).

## 5. Movers "windowed" baseline silently vanishes when no scan exists at-or-before the window start
- **Severity**: Medium
- **Category**: empty-set / wrong-rollup
- **File**: src/lib/db/org-insights.ts:79-107
- **Scenario**: With a `window.start`, each repo's baseline is `arr.find((s) => s.scannedAt <= start)`. If a repo's *first ever* scan happened *after* `start` (a repo onboarded mid-period — the common case for a growing fleet), there is no row `<= start`, so `prev` is undefined and the repo is `continue`d. The repo contributes **nothing** to `gainers`/`regressers`/`comparedRepos`, even though it went from "unscored" to a real score during the window.
- **Root cause**: The window-delta model assumes every repo has a pre-window baseline. Newly-onboarded repos (no baseline) are dropped rather than surfaced as new entrants, so a period that onboarded the most repos can show the fewest movers.
- **Impact**: Wrong/under-counted "what moved this period" — the most active onboarding periods look quietest; `comparedRepos` understates fleet coverage; leadership view misleads. Not a crash, but a quietly wrong rollup.
- **Fix sketch**: Treat a missing pre-window baseline as a distinct "new this period" bucket (baseline 0 / level "unscored"), or at minimum return a `newRepos` count so the UI can distinguish "no movement" from "no baseline".

## 6. Org-scope filters on `repos` but the SSE `total` and `index` can disagree under partial credit/skip, and a credit-starved batch reports the wrong scope on empty result
- **Severity**: Medium
- **Category**: silent-failure / UX
- **File**: src/app/api/org/scan/route.ts:76-91,99-133
- **Scenario**: After applying `repos:[]` / `staleOnlyDays` filters, the empty-set branch (line 76) checks `repos.length === 0` and reports the "no watched repos / fresh" message. But the credit slice happens earlier into `scanList`; if the watchlist is non-empty yet the prepaid balance is 0 on a metered org, `checkScanEntitlement` already returned `paymentRequired` at line 57 — fine. However, when `ent.balance` is e.g. 0 but the plan is flagged `allowed` via `unlimited` edge, `scanList` could be `repos.slice(0,0)` = empty while `repos.length > 0`, so the empty-set guard never fires, the pool runs over zero items, and the client gets `result {scanned:0, total:0, skippedForCredits: <all>}` with no actionable error event — a silent "nothing happened" with no notice (the `notice` only sends when `skippedForCredits > 0`, which it is, but there's no `error`/guidance and the progress bar shows 0/0).
- **Root cause**: Two different "empty" conditions (no watched repos vs. nothing left after credit slicing) are conflated; only one emits a user-facing message, and `total` reflects `scanList`, not the watched count the user expects.
- **Impact**: A war-room that imported repos but lacks credits sees a blank, successful-looking 0/0 run with no clear "out of credits" stop. Confusing, looks like success theater.
- **Fix sketch**: Emit an explicit terminal `error`/`notice` when `scanList.length === 0 && repos.length > 0`, distinguishing "out of credits" from "no watched repos", before opening the pool.

## 7. Installation-token cache TTL guard uses `Date.now() + 60_000`, but a long bulk scan can still hand a near-expired token to late lanes
- **Severity**: Low
- **Category**: race-window / token-expiry
- **File**: src/lib/github/app.ts:126-152 (used by org/scan:85, org/import:84, cron:57)
- **Scenario**: All fleet paths mint the installation token *once* before the pool and pass the same string to every lane. `getInstallationToken` only re-mints if the cached token expires within 60s. With `maxDuration=300` and a 4-lane pool, a repo scanned at second ~290 of the run uses a token that was fresh at second 0. Installation tokens last ~1h, so a single 300s run is safe — but `scanRepository` itself never re-mints on a 401 mid-scan (unlike `listInstallationRepos`, which self-heals). If the operator ever raises `maxDuration` or the cache happens to hold a token already ~59min old at run start, late repos in the batch get a token that expires mid-scan and 401 with no retry — surfaced as a generic per-repo "scan failed".
- **Root cause**: Token is captured once and never refreshed across a long batch; the 401-retry self-heal exists only in `listInstallationRepos`, not in the per-repo scan ingest path the fleet uses.
- **Impact**: Sporadic, hard-to-diagnose tail-of-batch failures on large fleets / raised duration limits; the repo is marked "error" though the cause is a transient token expiry.
- **Fix sketch**: Either re-fetch the token inside each lane via the cache (cheap — `getInstallationToken` returns the cached value until <60s remain) instead of capturing one string, or add the 401 → invalidate + re-mint + retry-once self-heal to the per-repo scan ingest.
