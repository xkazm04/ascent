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

- **2026-06-07** — The ingestion byte budget is sized for the **deterministic scorer, NOT the LLM
  prompt**. Detectors in analyze/index.ts read the FULL fetched `f.content` with length thresholds
  (`guidance.length>=4000`→D1, `readme.length>=1500`→D5) and pattern-match across whole files;
  `prompt.ts` separately truncates to 2200/file + 22000 total for the model. So `MAX_FILE_BYTES`/
  `MAX_TOTAL_BYTES` (source.ts:35-37) being >> the 22KB prompt window is INTENTIONAL — shrinking
  them to "stop fetching discarded bytes" regresses D1/D5 scores. (Documented inline in prompt.ts.)
- **2026-06-07** — Git refs are encoded **slash-preserving** via `encodeRef` (source.ts): each
  path segment `encodeURIComponent`'d, slashes kept. `encodeURIComponent` on a whole slashed ref
  (`release/1.2`→`release%2F1.2`) makes every tree/raw/contents read 404 → content-less near-mock report.
- **2026-06-07** — `fetchSnapshot` fires the `/repos` metadata call in **parallel** with tree+commits
  when `opts.ref` is pinned (PR head, or the headSha threaded from `scanRepository`/`lookupCachedScan`);
  only the no-ref path is serial (it needs the default branch from metadata first).
- **2026-06-07** — `MockProvider.assess` is **memoized** (bounded LRU, mock.ts) keyed on a fingerprint
  of the drivers — repo identity + `headSha` + archetype + per-signal scores. Keyed on signal scores,
  NOT headSha alone: a tokened scan folds in PR/governance signals, so the same commit can yield
  different signals and must not collide.
- **2026-06-07** — `GET /api/scan?peek=1` now returns the resolved head as `x-ascent-head-sha`/
  `-etag` headers on a 204 miss; the `/report` client forwards them into the stream POST body, which
  passes `preResolved` to `lookupCachedScan` to skip the duplicate conditional head request.

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

- **2026-06-07** — When two pipeline stages need different amounts of the same data (detectors want
  full file content; the LLM prompt wants a 22KB excerpt), keep the budgets DECOUPLED and document
  why. "Align them to save bytes" is a tempting but wrong simplification (it silently moves scores).

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
- **2026-06-07** — `LEVELS.findIndex(l => l.id === report.level.id)` returns **-1** for an unknown level id
  (rubric schema drift / legacy persisted scan). `fromIdx>=0 && …` then conflated -1 with "already at top"
  (reachable:true/target:null → repo shown maxed at L5), and `toIdx > fromIdx` made every projection a false
  level-up. Clamp -1 → L1 (engine.ts: `cheapestPathToNextLevel`, `projectScore`).
- **2026-06-07** — Defaulting an unparseable enum to a real value fabricates confidently-wrong output:
  `validateAssessment` mapped a roadmap item with a bad/missing `dimension` to `"D1"`. Drop/skip it like the
  discrepancies path does (provider.ts) — an omission beats a wrong attribution in the user-facing roadmap.

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

## Open follow-ups (from Pipeline C scan-and-decide, 2026-06-07 — "Repository Scanning & Scoring" group)
- **Idea #5 (2e2fda37) was RESCOPED, not fully done**: the accepted idea proposed shrinking the ingestion
  byte budget to match the prompt window. That regresses deterministic scores (detectors read full content
  with length thresholds — see Structural facts), so only the score-neutral half shipped: prompt.ts now stops
  building excerpts past the 22KB window (byte-identical output). The fetch budget was deliberately left alone.
- **#6 trusts the client-supplied headSha as an OPTIMIZATION only**: it keys a per-commit (self-owned) cache
  entry, so a wrong sha causes a self-inflicted miss/error but can't serve another commit's report or poison
  the shared cache. If a future change ever makes the stream SERVE a cached report based on the client sha
  WITHOUT re-validating the head, that becomes a real correctness/trust surface — re-audit then.
- **PR-ref headSha stamping still open** (carried from 2026-06-02): #7 restructured `fetchSnapshot` but left
  `repoMeta.headSha = treeRes.sha` (the tree object's sha) for PR-`ref` scans; anonymous cached scans still
  override it via `ScanOptions.headSha`. Recording the commit sha uniformly remains a follow-up.
- **No unit tests exist** (only Playwright e2e, which needs a live server — not run this session). The engine
  math (guardband/rollup/level-path, `encodeRef`, the mock memo key) is pure and high-value to unit-test;
  none were added. `next build` + `tsc` + eslint were the gates. Adding a Vitest harness is a good future goal.

## UI design system (from UI Perfectionist Pipeline B, 2026-06-07)

### Structural facts
- **2026-06-07** — Design tokens live in `src/app/globals.css` `@theme`: `--color-accent`/`-soft`,
  `--color-ink` (#080d1a canvas), `--color-on-accent` (#04070e), `--color-danger`/`-soft`, `--color-warn`.
  Tailwind v4 generates the full utility families (`bg-`/`text-`/`border-`/`via-`/`to-` + `/opacity`). For
  inline `style`/SVG that can't take a class, use `var(--color-*)`.
- **2026-06-07** — `EmptyState` (`components/EmptyState.tsx`) is THE notice primitive: `variant` page|section,
  optional `icon`, `alert` slot, `children` action slot. `OrgEmpty` + `SectionEmpty` (org/ui.tsx) and
  `SignInNotice` delegate to it; the trends/repo-picker empties use it too. Don't hand-roll notices.
- **2026-06-07** — `OrgTable` (org/ui.tsx) is the shared fleet-table chrome (scroll wrapper, header, dividers,
  built-in row hover); `TILE_GRID` is the canonical summary-tile grid. The 4 org data tables route through OrgTable.
- **2026-06-07** — Chart visual language is single-sourced: `chartScale.ts` (`LEVEL_BANDS`/`BAND_EDGES`/`vScale`/
  `xScale`) for bands+scale; line color = `scoreHex(last)` across TrendChart/DimLine/Sparkline; `heatCell`
  (lib/ui.ts) gives heatmap cells an alpha-on-fill intensity + contrast-picked numeral.

### Conventions enforced
- **2026-06-07** — Token-over-hex: never hand-write `red-500`/`#04070e`/`#080d1a`/`#3b9eff`/`#f97316`; use the token.
- **2026-06-07** — Text on a data-driven fill (level hex / badge / heatmap) must be contrast-picked, not hardcoded white.
- **2026-06-07** — User-facing counts derive from the source array (`DIMENSIONS.length`), never a hardcoded word.

### Open follow-ups (from UI Perfectionist Pipeline B, 2026-06-07 — 36/40 closed)
- ~~**OD#4 + OD#7** (carried)~~ **RESOLVED 2026-06-08** (`8eed6cc`): OD#7 — org tab section rhythm
  standardized to `space-y-6` (the 4-tab plurality); delivery + segments brought down from `space-y-8`.
  Contributors keeps its intentional mixed `mt-*` (tight footnotes). OD#4 — verified already-consistent:
  the filter `SegmentSelector` is top-right in both tabs that use it (overview, contributors); repositories'
  `RepoSegmentsPanel` is a distinct *tagging* control, not the same filter. Full detail in
  `docs/harness/ui-perfectionist-2026-06-07/FIXES-WAVE-8-org-tab-shell.md`.
- **UB#6** (deferred): usage `Notice` docs affordance is blocked on a docs route that doesn't exist; the
  `Stat`/`Bar` dedup in `usage/page.tsx` is purely local cosmetic.
- **SP#7** (skipped, not a bug): adding a "no public scans yet" notice to the marketing landing hero would
  clutter it — silent omission of the empty Live-discovery rail is correct.
- **Section-stagger scroll-reveal** (SP#8 partial): the landing's below-fold section headings still lack the
  staggered `reveal-pre` entrance — it needs an IntersectionObserver client wrapper (only the hero got
  `animate-fade-up`, which is mount-safe).

## Feature Scout Pipeline B — "Expose the dormant backend" wave (2026-06-08)

### Structural facts
- **2026-06-08** — `reportPermalink(fullName, headSha?)` now lives in `@/lib/ui` (a client-safe module) and is
  re-exported from `@/lib/db/scans`. Client charts (TrendChart/DimensionTrends) build the same `/report/{owner}/
  {repo}@{sha}` link as the server callers; don't re-inline the template.
- **2026-06-08** — The trajectory GPS (`forecastTrajectory` in `maturity/forecast.ts` + the `<Trajectory>` card in
  `components/org/Trajectory.tsx`) is **server-safe** and now rendered by BOTH the org rollup AND `/trends`. Feed it
  `SeriesPoint[] {date,value}` (value = overall score); returns null with <2 distinct scan days.
- **2026-06-08** — Session revocation is single-sourced on `bumpSessionVersion(login)` (sessions.ts) — called by
  logout (one browser), uninstall, and now `POST /api/auth/revoke-sessions` ("sign out everywhere else", which
  re-mints THIS cookie at the bumped version). The same-origin CSRF guard for POST handlers is `auth.isSameOrigin`.
- **2026-06-08** — `/api/cron/purge` (retention) is now registered in `vercel.json` (daily 04:00 UTC). It self-no-ops
  with no retention window configured, so it's inert until a policy is set. `vercel.json` is the ONLY place crons
  are wired — a built cron route does nothing until it's listed there.
- **2026-06-08** — `HistoryPoint` now carries `headSha` (added to the selects in BOTH `getRepositoryHistory` and
  `getScanComparison` — they build HistoryPoint independently, so a new field must be added in both places + their
  mappers, or tsc flags only the second one).

### Conventions enforced
- **2026-06-08** — A pure helper needed by both server and a client component goes in a client-safe module
  (`@/lib/ui`) and is re-exported from the server module — never duplicated (see `reportPermalink`).
- **2026-06-08** — Org-view mutation controls follow the optimistic-with-rollback pattern: POST, optimistic set,
  roll back + surface error on non-2xx, `router.refresh()` on success (ScheduleSelect mirrors connect's toggleWatch).

### Anti-patterns to avoid
- **2026-06-08** — **Two Vibeman/agent runs sharing one working tree interleave commits on the same branch.** This
  run (Feature Scout wave 2) ran concurrently with a UI-Perfectionist Pipeline-B run; both committed to
  `vibeman/feature-scout-wave2`, and `TrendChart.tsx` was edited by both (the other's `6b675df` landed mid-flight).
  It worked out (tsc + next build green) because edits hit different regions and were rebuilt on the latest version,
  but it's fragile. Future: give each concurrent run its own branch/worktree, or serialize runs on a repo.

## Open follow-ups (from Feature Scout Pipeline B, 2026-06-08 — wave 2 of the 60-finding scan)
- **Trend point external links**: RPT-2 wired the in-app report permalink (click a dot → its pinned report) but
  deferred the external GitHub-commit link and per-dimension `DimLine` deep-links. `headSha` is now on `HistoryPoint`,
  so the commit URL is `https://github.com/{fullName}/commit/{headSha}` when wanted.
- **Remaining Feature Scout waves**: only wave 2 (expose-backend, 6 findings) shipped. The INDEX
  (`docs/harness/feature-scout-2026-06-08/INDEX.md`) lays out waves 1 (usage→billing), 3 (fleet reliability incl. the
  one Critical **ORGS-1** cron starvation), 4 (GitHub App sync), 5 (scoring depth), 6 (scan reach), 7 (export/alerts/
  compliance), plus the mediums/lows.

## Feature Scout Pipeline B — "Fleet reliability" wave (2026-06-08, wave 3)

### Structural facts
- **2026-06-08** — `src/lib/pool.ts` `mapPool(items, concurrency, fn)` is the shared bounded-concurrency
  fan-out for the fleet scan paths (`org/scan`, `org/import`, `cron/rescan`), default `SCAN_CONCURRENCY=4`.
  `fn` owns its errors (callers try/catch + emit per repo); counters mutate race-free in single-threaded lanes.
- **2026-06-08** — The cron rescan (`cron/rescan/route.ts`) now: pre-resolves ONE installation token per
  distinct org (concurrent lanes would otherwise race to mint the same), scans with `mapPool`, and ALWAYS
  advances `nextScanAt` — `advanceSchedule` (cadence) on success, `advanceScheduleAfterFailure` (6h backoff)
  on failure. `listDueRescans` round-robins across orgs over a `limit*4` candidate set for fairness.
- **2026-06-08** — The LLM call in `scan.ts` is resilient: an ordered plan (primary → 1 retry@500ms →
  `LLM_FALLBACK_PROVIDER` via `providerByName()` → mock). The provider that actually scored becomes
  `report.engine`; `llmFailed` is only set when EVERY real attempt failed. `getProvider({forceMock})` only
  takes forceMock — use `providerByName(name)` to build a specific provider.
- **2026-06-08** — `Repository` gained `lastScanStatus`/`lastScanError`/`lastScanAttemptAt` (additive nullable;
  schema.prisma + init.sql). `recordScanOutcome(orgSlug, fullName, {ok,error})` writes them from the 3 scan
  paths; surfaced on `OrgRepoRow`/`getOrgRollup` and as a "⚠ scan failed" chip on the repositories leaderboard.
- **2026-06-08** — `POST /api/org/scan` accepts optional `repos:[]` (explicit set) and `staleOnlyDays:N`
  (skip repos scanned within N days); `listWatchedRepos` now selects `lastScanAt` to support the stale filter.

### Conventions enforced
- **2026-06-08** — Fleet loops use `mapPool`, never bare `for ... await` over network/LLM-bound work.
- **2026-06-08** — A scheduled-queue cursor (`nextScanAt`) must advance on FAILURE too (with backoff), or one
  broken item blocks the whole oldest-first queue.

### Notes / caveats
- **2026-06-08** — ORGS-3's schema columns were verified by `prisma generate` + `tsc` + `next build` only — NO
  live DB migration was run (DB-less here). Deploy must `prisma migrate deploy` / `db push`. Columns are
  additive + nullable so this is safe; `recordScanOutcome` no-ops without a DB.

## Open follow-ups (from Feature Scout Pipeline B, 2026-06-08 — wave 3)
- **Per-row "Rescan" on the leaderboard**: ORGD-3 shipped the `repos:[fullName]` API path but not a per-row UI
  trigger — wiring a small client control into the repositories table is a clean follow-up.
- **Outcome on the public-funnel import**: `recordScanOutcome` is wired into `org/import` only when `watch=true`
  (the row exists); the anonymous public funnel (watch=false) is skipped.
- **Waves 1, 4–7 of the scan remain** (see INDEX): usage→billing, GitHub App sync, scoring depth, scan reach,
  export/alerts/compliance.

## Feature Scout Pipeline B — "GitHub App sync" wave (2026-06-08, wave 4 — 3 of 6 shipped)

### Structural facts
- **2026-06-08** — The App webhook (`app/webhook/route.ts`) now handles `installation_repositories`
  (added/removed selected-access repos). On "removed" it calls `unwatchReposForInstallation(installId,
  fullNames)` (installations.ts) to clear watch + pause schedule for those repos under the orgs the
  install backs — else a de-selected repo's rescan 401s forever. **Requires the App to subscribe to the
  "Repository" event** in its GitHub config; the handler is inert otherwise.
- **2026-06-08** — `listInstallationRepos` (github/app.ts) now drops `fork`+`archived` repos, matching
  `listOrgRepos` + `fetchUserRepos`. When adding repo fields to filter on, add them to the `GhRepo`
  interface so the REST response is typed (the API already returns them).
- **2026-06-08** — `POST /api/org/schedule` is now dual-shape: `{org,fullName,schedule}` = one repo;
  `{org,schedule,segmentId?}` (no fullName) = the whole watched set via `setWatchedSchedule` (db/org.ts),
  reusing `segmentScope`. Returns `{updated}` count for the bulk path.

### Anti-patterns to avoid
- **2026-06-08** — A barrel re-export (`db/index.ts`) whose two new lines belong to two different
  definition modules can't be split across two commits with a plain `git add <file>` and stay buildable
  (`git add -p` is unavailable here). Either bundle the findings, or temporarily delete one export line,
  commit, then re-add it for the second commit (what this run did for APP-1 vs ORGS-6).

### Notes — deferred (NOT done) this wave, with cause
- **AUTH-2 (org member session revocation)** needs NEW infra, not a wire-up: `removeInstallation` bumps
  only the owner-login session version, a documented no-op for ORG accounts (members are keyed by their
  own login + carry a baked-in `installations` array). A real fix = persist member logins per install and
  bump each, OR an org-access epoch that `verifySessionVersion` checks per embedded installation. Security-
  sensitive cross-tenant change; left for a focused session.
- **APP-2 (bulk watch) + APP-3 (suspension state)** live in `InstallationRepos.tsx`/`connect` — the files
  the concurrent UI run was editing all session. Deferred to avoid an edit war; the backends are clean to
  add later (`POST /api/org/watch/bulk`; `fetchUserInstallations` keeping `suspended_at`/`repository_selection`).

## Open follow-ups (from Feature Scout Pipeline B, 2026-06-08 — wave 4)
- **AUTH-2 / APP-2 / APP-3** deferred (see causes above) — a good focused "GitHub App UX + session
  completeness" session once the connect UI isn't being concurrently churned.

## Feature Scout Pipeline B — "Scoring depth" wave (2026-06-08, wave 5 — 2 of 6 shipped)

### Structural facts
- **2026-06-08** — `LlmScoreInput` (llm/provider.ts) now carries optional `prStats`/`governance`; the LLM
  prompt (scoring/prompt.ts `processBlock`) renders a "PROCESS SIGNALS" section from them. The data is
  ALREADY fetched in scan.ts (`const [prStats, governance] = await Promise.all(...)`) and folded into the
  deterministic D3/D6/D7/D8 scores — threading it to the prompt is free (no new GitHub calls).
- **2026-06-08** — The dimension blend in `assembleReport` (scoring/engine.ts) is now coverage-weighted:
  `effectiveBlend = SCORE_BLEND * clamp(snap.coverage,0,1)`. At coverage=1 it equals SCORE_BLEND (full-scan
  path unchanged — no calibration-bench regression); below 1 the LLM's pull shrinks toward the
  coverage-robust deterministic signal. `clamp(v,min,max)` in maturity/model.ts defaults to 0..100.

### Conventions enforced
- **2026-06-08** — A derived confidence value (e.g. `coverage`) should modulate the math it describes,
  not merely be displayed next to it. When one stage fetches rich data for ONE consumer (the scorer),
  check the OTHER consumer (the LLM prompt) isn't being starved of the same evidence.

### Notes — deferred this wave, with cause
- **MAT-3** (discrepancies aggregator): a `GET /api/discrepancies` with no consumer view yet — defer with
  the view. **SCAN-2** (files-inspected) + **LLM-6** (per-dim confidence): touch `ReportView` (concurrent
  UI churn). **SCAN-4** (lockfile ingestion): the valuable half is new D9/D6 detector logic whose effect
  needs a real scan to verify (none runnable here).

## Open follow-ups (from Feature Scout Pipeline B, 2026-06-08 — wave 5)
- **MAT-3 / SCAN-2 / SCAN-4 / LLM-6** deferred (causes above). SCAN-4 especially wants a session that can
  run a live scan against a lockfile-bearing repo to confirm the D9/D6 signal moves.

## Feature Scout Pipeline B — "Scan reach" wave (2026-06-08, wave 6 — 2 of 6 shipped)

### Structural facts
- **2026-06-08** — LLM provider tuning is env-driven via `llm/config.ts` `envNumber(name, fallback)`:
  `LLM_TEMPERATURE` (gemini + bedrock), `BEDROCK_MAX_TOKENS` (bedrock). Defaults = the prior literals.
- **2026-06-08** — `ProviderName` now includes `"openai"`. The fetch-based `OpenAiProvider`
  (llm/openai.ts) uses JSON mode (`response_format: json_object`) + `buildAssessmentPrompt` +
  `validateAssessment` — NO SDK dep. Config: `OPENAI_API_KEY` / `OPENAI_MODEL` / `OPENAI_BASE_URL`
  (Azure/self-hosted). A new provider must be wired in 4 seams: `ProviderName` (types.ts),
  `resolveProviderChoice` allow-list, `getProvider` switch, AND `providerByName` (for LLM-2 failover).

### Conventions enforced
- **2026-06-08** — Add a new LLM provider as a fetch-based `LLMProvider` over the existing contract
  (prompt + validateAssessment), not a new SDK dependency, so it inherits the abort/timeout/resilience
  contract for free and stays portable across OpenAI-compatible endpoints.

## Open follow-ups (from Feature Scout Pipeline B, 2026-06-08 — wave 6)
- **SCAN-1 / SCAN-3** (branch selector + token field): clean backends, but the UI half is on `ScanForm`
  (concurrent UI churn). **SCAN-6** (ingestion budget/subpath): larger, threads options through
  FetchOptions→ScanOptions→cache key. **LLM-4** (health check): needs per-provider network calls + has no
  admin UI consumer yet.

## Feature Scout Pipeline B — "Usage → billing" wave (2026-06-08, wave 1 — 4 of 6 shipped)

### Structural facts
- **2026-06-08** — LLM token usage flows: providers call `opts.onUsage?(TokenUsage)` (an optional hook on
  `AssessOptions`) when their response carries usage (Gemini `usageMetadata.{promptTokenCount,
  candidatesTokenCount}`, Bedrock `res.usage.{inputTokens,outputTokens}`, OpenAI
  `data.usage.{prompt_tokens,completion_tokens}`). `scan.ts` captures the winning provider's usage + the
  LLM-stage latency onto `report.usage` (`{inputTokens,outputTokens,latencyMs}`); mock reports nothing.
- **2026-06-08** — `Scan` gained `inputTokens`/`outputTokens`/`llmLatencyMs` (additive nullable;
  schema.prisma + init.sql). `persistScanReport` writes `report.usage`. `getUsageSummary` exposes period
  token sums, `estimatedCostUsd` (from `LLM_INPUT_COST_PER_MTOK`/`LLM_OUTPUT_COST_PER_MTOK`; null when
  unset), and a `byRepo` top-10. The `/usage` page renders cost/tokens + a Top-repositories panel.
- **2026-06-08** — `envNumber` (llm/config.ts) is now reused beyond the providers (db/usage.ts cost rates).

### Conventions enforced
- **2026-06-08** — Surface call metadata (token usage) via an OPTIONAL options callback (`onUsage`), not a
  changed return shape — non-breaking, and providers that lack it simply don't call it.
- **2026-06-08** — Show a derived figure (estimated cost) only when its rate is configured; render an
  explicit "set the rate" affordance rather than a fake $0.

## Open follow-ups (from Feature Scout Pipeline B, 2026-06-08 — wave 1)
- **USE-6** (period-over-period + range picker, Low, usage UI) and **PERS-2** (Subscription + plan-quota +
  Stripe webhook — the revenue plumbing; the now-persisted token cost is its input) deferred.

## Feature Scout Pipeline B — "Export + alerts + compliance" wave (2026-06-08, wave 7 — 2 of 6 shipped)

### Structural facts
- **2026-06-08** — `/api/history?format=csv` exports a repo's per-scan history (scannedAt, overall, level,
  levelName, engine, D1..D9, oldest→newest) as a download; an "Export CSV ↓" link sits on /trends. The
  /usage CSV (api/usage/route.ts `toCsv`) is the sibling export pattern (safe-filename + content-disposition).
- **2026-06-08** — `GET /api/cron/digest` (vercel.json weekly, Mon 13:00 UTC, CRON_SECRET-guarded) pushes a
  weekly fleet digest per org via the pure `buildFleetDigestMessage` (alerts.ts, sibling of
  buildRegressionMessage) + the existing `dispatchAlert` sink. `listOrgsWithWatchedRepos` (db/org.ts) lists
  the fleets. No-op without a DB or ALERT_WEBHOOK_URL. There are now THREE crons in vercel.json:
  rescan (06:00), purge (04:00), digest (Mon 13:00).

### Conventions enforced
- **2026-06-08** — A push channel (digest) reuses the SAME aggregate queries the dashboard pulls + an
  existing alert sink, with a PURE message builder gated on the sink being configured (clean no-op default).

## Open follow-ups (from Feature Scout Pipeline B, 2026-06-08 — wave 7)
- **ORGD-2 / PERS-4** (CSV export across fleet/audit UI surfaces), **ORGD-4** (in-dashboard regressions
  view), **PERS-3** (actor-attributed audit trail — needs db/users.ts ensureUser/ensureMembership wired
  into the auth path) deferred. This was the last untouched scan wave.

## Bug Hunter Pipeline B — "Multi-tenant authz / IDOR" wave (2026-06-08, wave 1 of a 68-finding scan)

### Structural facts
- **2026-06-08** — `canReadOrg(org)` (authz.ts) is the READ-side tenant gate, sibling to the
  mutation gate `requireOrgAccess`: PUBLIC_ORG open; private org needs a session that owns it when
  auth is on; NO non-public org served when auth is OFF (a DB-on + auth-off deploy must not expose
  per-tenant data). Used by `/org/[slug]/layout.tsx`, `/api/usage`, `/usage`.
- **2026-06-08** — `/org/[slug]/layout.tsx` is the single authorization choke point for the WHOLE
  org dashboard: it wraps every sub-page (page, contributors, delivery, practices, repositories,
  **plus** audit, backlog, live, plan, segments, teams). One `canReadOrg` gate there protects all
  of them — sub-pages "assume valid data" per the layout's own doc-comment.
- **2026-06-08** — `/api/app/repos` now authorizes on the EFFECTIVE installation id via
  `sessionHasInstallation` (not the `?org=` param — a caller could pair their own org with a
  victim's `?installation_id=`). Consequence: a just-installed org (carried in the setup redirect's
  query, not yet in the session) must re-sync before its repos list — the connect page shows a
  "Re-sync to load repositories" prompt for that pending org instead of a panel that would 403.

### Conventions enforced
- **2026-06-08** — "Auth off = open" applies ONLY to the shared `public` tenant. Any per-tenant
  read surface (dashboard, usage) must refuse non-public slugs when auth is unconfigured — decouple
  "is this multi-tenant data" from "is auth turned on". (Closed org-dashboard #2 + usage #7.)
- **2026-06-08** — Gate on the resource actually USED, not a friendlier sibling param: authorizing
  `?org=` while the handler resolves and uses `?installation_id=` is bypassable.

### Anti-patterns to avoid
- **2026-06-08** — A verified report finding can still mis-state the mechanism. github-app #2
  ("/api/app/setup installation hijack", reported Critical) is NOT exploitable as a hijack: setup
  derives `login` from `getInstallation(id)` (GitHub-authoritative), so `upsertInstallation` always
  writes a truthful `(login, id)` pair. Residual is only unauth enumeration + org-row write-amp
  (~Medium). Always confirm the mechanism in live source before fixing — and before trusting a
  severity.

### Open follow-ups (from Bug Hunter wave 1)
- **github-app #2 (`/api/app/setup`)** proper fix = enable GitHub-App "Request user authorization
  (OAuth) during installation" so the redirect carries a `code` to confirm the installer via
  `GET /user/installations`. Code-only can't verify the installer (the user's GitHub token isn't
  persisted). Deferred to a focused session; residual is Medium (enumeration + DB write-amp).
- **Behavior change shipped**: DB-on + auth-off deployments can now only view `/org/public` and
  public `/api/usage`; per-org dashboards/usage require OAuth configured. Intended security posture
  (user-approved), but it narrows the local/demo experience for non-public orgs.
- **Mutating org-API authz sweep still owed** (reinforces the prior security_protector follow-up):
  `/api/org/{goals,initiatives,segments,simulate,backlog,active}` were not audited for
  `requireOrgAccess`. The `/org/[slug]/*` *read* sub-pages are now covered by the layout gate; the
  *mutating* APIs are the remaining gap.
- **Remaining bug-hunt waves 2–8** (see `docs/harness/bug-hunt-2026-06-08/INDEX.md`): 6 criticals
  remain (Waves 2–5) across unauth endpoints/leaks, persistence/DSQL token expiry, scoring
  correctness, and resource lifecycle.
