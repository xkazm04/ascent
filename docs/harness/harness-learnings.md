# ascent — harness learnings

> Structural facts the Vibeman pipeline discovered while working this repo, so future runs start
> richer. Keep bullets under 3 lines; link `file:line` where possible.

## Structural facts
- **2026-06-02** — Scan cache keys by the **commit** sha (`resolveHead`, `application/vnd.github.sha`),
  but `fetchSnapshot` historically stamped `repoMeta.headSha = treeRes.sha` — the **tree object's** sha,
  not the commit's. Latent mismatch between the cache/persistence key and the report's recorded headSha.
  Now aligned via `ScanOptions.headSha` (scan.ts) which stamps the resolved commit sha.
- **2026-06-02** — Head-sha resolution has two flavors: **conditional + hint** (free 304s via
  `headHintGet/Set` + `If-None-Match`) in `lookupCachedScan` and `resolveHeadWithHint` (scan-cache.ts),
  vs. the old **unconditional** `resolveHeadSha` (removed — it burned a rate-limit unit per call).
- **2026-06-02** — Overall score roll-up is a **renormalized archetype-weighted mean**, single-sourced
  in `overallScoreFor` (maturity/model.ts) and used by both the engine and the MockProvider.
- **2026-06-02** — In-memory scan cache (cache.ts) is the **primary** cache tier: key
  `owner/repo@sha::{llm|mock}`, 15-min TTL. The DB tier is opt-in (`DATABASE_URL`); the MVP runs DB-less.
- **2026-06-02** — LLM-failure fallback: scan.ts degrades to `MockProvider`; `report.engine.provider==='mock'`
  while the scan requested LLM is the signal that the model didn't contribute (and the `::llm` cache must NOT store it).
- **2026-06-03** — `relationMode="prisma"` (schema.prisma) ⇒ **no DB foreign keys**: orphaning is silent (no
  error), so process-local id caches (e.g. `orgIdCache` in scans.ts) must re-verify or invalidate, not trust forever.
- **2026-06-03** — Prisma maps `DateTime` to a UTC `timestamp` (no `@db` override on `Scan.scannedAt`), so
  `date_trunc('day', "scannedAt")` yields the **UTC** day — matches the `toISOString().slice(0,10)` axis keys (usage.ts).
- **2026-06-03** — `persistScanReport` (scans.ts) now evicts the in-memory scan cache (`cacheDelete`) after a
  fresh non-deduped write, so a `fresh=1` re-test of an unchanged commit isn't shadowed by the prior report.
- **2026-06-03** — `GET /api/scan?peek=1` is a **cache-only** probe (returns cached/persisted report or 204, never
  scans); the `/report?repo=` client peeks it before opening the SSE stream so an unchanged head hydrates instantly.
- **2026-06-03** — **No Next middleware exists** (none at root / `src/middleware.ts`; `src/app/api/middleware.ts`
  does NOT exist and would not run as middleware anyway). Auth is enforced **per-handler** — see `src/lib/authz.ts`.
- **2026-06-03** — Config gates: `isAuthConfigured` = `GITHUB_OAUTH_CLIENT_ID`+`_SECRET`+`AUTH_SECRET`;
  `isAppConfigured` = `GITHUB_APP_ID`+`GITHUB_APP_PRIVATE_KEY`; `isDbConfigured` = `DATABASE_URL`. `verifyWebhook` =
  `sha256=`+HMAC-SHA256(rawBody, `GITHUB_APP_WEBHOOK_SECRET`), timing-safe.
- **2026-06-03** — Authorization model (mirrors `readableOrgForOwner`): auth-off deploys are open (local/demo); the
  shared `public` org is open (the free funnel); a real org requires a session whose `installations` include it.
  `/api/org/import` is a **deliberately anonymous public funnel** — gate only its token-minting (private) path.

## Conventions enforced
- **2026-06-02** — One canonical cache key everywhere via `makeCacheKey` (cache.ts); every reader/writer
  (scan routes, badge, gate) must resolve the sha through a `resolveHead`-based path so keys agree.
- **2026-06-02** — Signal extraction must stay a pure function of the snapshot: detectors take an injected
  `nowMs` (no `Date.now()` inside), so a snapshot re-scored later yields identical scores.
- **2026-06-02** — AI/bot commit attribution is single-sourced as `isAiCommit` (analyze/index.ts); don't
  re-inline the `AI_TRAILER` / `[bot]` regex.
- **2026-06-03** — SVG chart scale math is single-sourced in `chartScale.ts` (`vScale`/`xScale` + `LEVEL_BANDS`/
  `BAND_EDGES`); TrendChart, Sparkline, DimLine route through it — don't re-inline the 0..100 y-scale per chart.
- **2026-06-03** — Centered empty/notice states go through `components/EmptyState.tsx` (icon, title, body,
  actions[]); don't hand-roll the markup (the report/trends/usage variants had drifted on tokens + icon size).
- **2026-06-03** — Every mutating / token-minting `/api/org/*` (and `/api/app/*`) handler MUST call
  `requireOrgAccess(org)` from `src/lib/authz.ts` at the top — there is no middleware to fall back on.

## Anti-patterns to avoid
- **2026-06-02** — `clamp(Math.round(Number(x))) || 0` silently turns a missing/NaN value into a real 0.
  Use `Number.isFinite` to distinguish "absent" from "genuinely 0" (cost: it defeated the LLM coverage gate).
- **2026-06-02** — Parsing GitHub timestamps with `new Date(x).getTime()` and no NaN guard poisons medians
  (`NaN` sorts unstably, serializes as `null`). Guard at the boundary; filter non-finite before aggregating.
- **2026-06-02** — Two hand-rolled mappers over the same REST response drift. Normalize once (`mapGhRepo`).
- **2026-06-03** — A catch-all `catch { negSet() }` that negative-caches on ANY error pins valid repos to a
  failure for the whole TTL on a transient blip. Only cache GENUINE not-found (typed `GitHubError` code); serve
  a neutral result without poisoning on transient/5xx (badge route).
- **2026-06-03** — Building a day-bucketed chart axis from a LOCAL `new Date()` while keying buckets by UTC date
  drops near-midnight-UTC rows into the idx-miss gap. Anchor axis + window to the same UTC-day floor (usage.ts).
- **2026-06-03** — Deriving a cookie's `Secure` flag from `NODE_ENV` diverges from the origin/proto the request
  actually used (TLS-terminating deploy with `NODE_ENV` unset → cookie set without Secure). Derive from the request.
- **2026-06-03** — Interpolating caller-supplied input into an outbound URL with no charset validation is SSRF /
  path-injection (`../`, `@`, `%2f` rewrite path/host). Validate against the expected grammar before building the URL.
- **2026-06-03** — A verified webhook signature proves authenticity, NOT freshness/ownership: trusting
  `payload.installation`/`repository` verbatim invites replay + confused-deputy. Dedupe the delivery id and
  cross-check the installation against the stored owner mapping before minting a token.

## Open follow-ups (from Pipeline C scan-and-decide, 2026-06-02)
- **Degraded-mock persistence**: the `#2` fix only skips the in-memory `cacheSet`. When `DATABASE_URL`
  is set, `persistScanReport` still persists a degraded-mock report and `getScanReportByCommit` (tier-2)
  could serve it on a later scan. Future: guard persistence of `engine.provider==='mock'` when LLM was
  requested, or down-key it. (Persistence group — out of scope for the Repository Scanning & Scoring run.)
- **headSha stamping for PR-ref scans**: `report.repo.headSha` is stamped to the resolved commit sha only
  for anonymous cached scans (`ScanOptions.headSha`). PR-gating (`ref`) scans still record `treeRes.sha`.
  Consider always recording the commit sha so report/persistence identity is uniform.

## Open follow-ups (from Pipeline C scan-and-decide, 2026-06-03 — "Reporting, Persistence & Metering" group)
- ~~**D5 client lazy-load**~~ **RESOLVED 2026-06-03** (`c2e8d18`): `/trends` now server-fetches the overall-only
  history (`includeDimensions:false`) and `DimensionTrends` lazy-loads the per-dimension grid client-side via
  `/api/history` on IntersectionObserver, with a skeleton + retry fallback. Verified on a real Postgres seed:
  full `/api/history` → 63 dim rows, `?dims=0` → 0; trends first paint ships 0 dim rows + skeleton, then hydrates.
  (`ReportView`'s history fetch still pulls full dims for its sparklines — intentional, it needs them.)
- ~~**D1 raw-SQL portability**~~ **VERIFIED 2026-06-03**: against Postgres 16, `Scan.scannedAt` is
  `timestamp without time zone` (UTC-stored), so `date_trunc('day', "scannedAt")`+`to_char(…,'YYYY-MM-DD')`
  produces day keys IDENTICAL to the JS `toISOString().slice(0,10)` axis for all rows, including the
  23:30Z→06-02 / 00:30Z→06-03 midnight boundary. Runtime `/api/usage` buckets matched the direct SQL exactly.
  The `catch`→JS-bucketing fallback remains as defense-in-depth.
- **`scans.ts` commit hygiene**: the B4/B5/D3 commit (`2f15b37`) bundles substantial pre-existing working-tree
  WIP in `scans.ts` (~600 lines that predate this run), per an explicit user decision. If you bisect, that
  commit is not a clean single-concern change. (Still open.)

## Open follow-ups (from Pipeline C security_protector, 2026-06-03 — "Identity & GitHub Connectivity" group)
- **Comprehensive authz sweep of the remaining `/api/org/*` mutating endpoints**: this run gated only `watch`,
  `schedule`, `scan`, and `import` (token path). `goals`, `initiatives`, `segments`, `simulate`, `backlog`,
  `active` were NOT audited/gated — apply `requireOrgAccess` (or a Next root middleware) across them. Highest-value
  next security step. `/api/org/repos` is a public-only listing (lower risk; #3 covered its injection vector).
- **Verification coverage**: #2 (deny+funnel), #3 (regex), #5 (replay + bad-sig) were runtime-verified on a live
  instance + Docker Postgres. #1 (cookie Secure) and #4 (import token gate) are verified by source review + build
  only — exercising them needs a real signed session (#1) / observing token-mint suppression (#4). Low residual risk.
- **`auth.ts` / `org/import` commit hygiene**: commits `5de14d8` (#1) and `5475618` (#4) bundle pre-existing
  working-tree WIP (~170 lines in auth.ts), per the user's standing "commit bundled" choice. Not clean to bisect.
- **Webhook replay dedupe is process-local** (in-memory, like the badge/rate-limit caches): collapses same-instance
  replays only. A cross-instance/durable guard (persist delivery ids) would be needed for multi-instance hardening.
