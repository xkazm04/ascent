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

## Bug Hunter Pipeline B — "Unauth endpoints & leaks" wave (2026-06-08, wave 2 — 6 findings closed)

### Structural facts
- **2026-06-08** — All three cron routes (`cron/{rescan,digest,purge}/route.ts`) now FAIL CLOSED:
  `if (!process.env.CRON_SECRET) return 503`, then require the `Bearer`/`?key` unconditionally.
  Deploys MUST set `CRON_SECRET` (Vercel injects the Bearer header only when it's set) — a missing
  secret no longer "works" unauthenticated.
- **2026-06-08** — `ScanOptions.noAmbientToken` (scan.ts) suppresses the `?? process.env.GITHUB_TOKEN`
  fallback. The public badge passes it so a private repo can't be ingested with the operator's PAT.
  `scanRepository`'s token line is now `opts.token ?? (opts.noAmbientToken ? undefined : env)`.
- **2026-06-08** — The badge (`api/badge/[owner]/[repo]/route.ts`) gates on `report.repo.isPrivate`
  and serves a neutral "private" badge — this is the real leak-closer because the shared report
  cache can hold a private repo's report from an AUTHENTICATED scan (token-less scanning alone
  wouldn't catch that path).
- **2026-06-08** — Badge cache is branched by outcome via `respond(svg, {cache})`: `CACHE_RESOLVED`
  (long shared) only for an un-customized real level/gate; `CACHE_CUSTOM` (`private`) for any
  query-customized body; `CACHE_NEUTRAL` (30s) for unknown/private; `CACHE_TRANSIENT` (`no-store`)
  for 429 / upstream blip. `customized = [...searchParams.keys()].length > 0`.
- **2026-06-08** — Webhook `installationMatchesOwner` now confirms an UNKNOWN owner against GitHub
  (`getInstallation(id)`) before allowing a token mint, and the `installation created/unsuspend`
  handler derives the stored login from `getInstallation(id)` rather than trusting the payload.

### Conventions enforced
- **2026-06-08** — Opt-in auth (`if (secret) { check }`) is fail-OPEN; privileged endpoints must
  refuse first when the secret is absent. Fail-open patterns travel in families — grep siblings.
- **2026-06-08** — `mock: true` forces only the LLM provider; it does NOT disable GitHub ingestion
  or the ambient-PAT fallback. Public surfaces must be token-less by construction.
- **2026-06-08** — Don't trust client-settable headers as identity (left-most XFF) or payload-
  claimed identity (webhook installation owner). Use a trusted hop / authoritative confirmation.

### Open follow-ups (from Bug Hunter wave 2)
- **Webhook out-of-order install/uninstall** (github-app #3 secondary): a `deleted` before a late
  `created` leaves a stale "installed" mapping. Needs per-id last-action-timestamp tracking; deferred.
- **Cron requires CRON_SECRET now** — production must set it or all crons 503. Intended posture.
- Cumulative: 4 of 9 criticals closed (github-app #1, org-dashboard #1, org-scanning #1, usage #1)
  + 1 reassessed (github-app #2). Remaining criticals: persistence #1/#2, maturity #1, llm #1.

## Bug Hunter Pipeline B — "Persistence / DSQL durability" wave (2026-06-08, wave 3 — 4 closed, 2 deferred)

### Structural facts
- **2026-06-08** — `persistScanReport` (scans.ts) now runs its whole body inside `withDb(async () => …)`
  so a DSQL IAM-token expiry is recovered (proactive refresh + reconnect-retry-once). The inner code
  still calls `getPrisma()`; that's fine because `reconnectDb`/`refresh` swap the global singleton, so
  the retried run reads the fresh client. `withDb` is INERT in static mode (`readDsqlConfig()` null →
  op runs once) — the default/local-Postgres deployment is behaviorally unchanged.
- **2026-06-08** — `/api/scan` now emits `x-ascent-persisted: false` when `persistScanReport` throws
  (atomic rollback = nothing saved), instead of a silent clean 200. The report still renders.
- **2026-06-08** — `updateRecommendation`'s audit row is now written via `tx.auditLog.create` INSIDE
  its `$transaction` (was a best-effort post-tx `recordAudit`), so status-change + timeline + audit
  are atomic.

### Conventions enforced
- **2026-06-08** — A resilience primitive (`withDb`) must be ON the call path to count — it was dead
  code (exported, zero callers) while every helper used the raw `getPrisma()`. Route writes through it.
- **2026-06-08** — Atomic-but-swallowed = silent data loss: making a write all-or-nothing is only half
  the fix; the caller must propagate the failure (header / 5xx / retry), not return 200.

### Open follow-ups (from Bug Hunter wave 3)
- **DEFERRED #4 (High)** — add `@@unique([repoId, headSha])` (partial, headSha not null) + route the
  scan insert through `upsertRacing`. Needs a Prisma migration (fails if duplicate rows already exist)
  + a live DB to verify — risky blind. Cross-instance dup scans remain possible until then.
- **DEFERRED #5 (High)** — serverless connection-pool storm. Needs a pooler (PgBouncer/`pgbouncer=true`)
  + a `connection_limit` cap reconciled against `max_connections` and the cron's `SCAN_CONCURRENCY=4`
  (connection_limit=1 serializes the cron). Deployment/infra decision; unverifiable here.
- **read-path + secondary-write withDb migration**: only `persistScanReport` was routed through
  `withDb`. The other ~70 `getPrisma()` sites (org.ts/installations.ts/sessions.ts/reads) still 500
  transiently on a DSQL token expiry (recoverable, no data loss). Migrate deliberately (watch for
  nested-`withDb` double-retry) — not a blind sweep.
- **#3 prevention**: the long-tx-outlives-token *recovery* is handled (withDb retry), but the
  *preventive* part (refuse to start a >timeout tx near token end, or shrink it via `createMany`
  contributor upserts) is not done.
- Cumulative after wave 3: 6 of 9 criticals closed (added persistence #1/#2). Remaining: maturity #1
  (Wave 4), llm #1 (Wave 5).

## Bug Hunter Pipeline B — "Scoring correctness" wave (2026-06-08, wave 4 — 5 closed, 2 deferred)

### Structural facts
- **2026-06-08** — `projectScore` (scoring/engine.ts) now reuses `overallScoreFor` over the
  overridden dimension scores — the SAME weighted-mean the headline uses. It previously renormalized
  by `Σ d.weight` (`lensW[id] ?? def.weight`) vs overallScoreFor's `lensW[id] ?? 0`; for a lens-missing
  id those denominators diverged and `projectScore(report,{}) !== report.overallScore`. One mean now.
- **2026-06-08** — `cheapestPathToNextLevel` checks TRUE reachability first: project all dims→100; if
  that's below the band floor it's genuinely unreachable (e.g. zero-weight-dim headroom) → clean
  `reachable:false`. Otherwise the greedy steps are guaranteed to cross.
- **2026-06-08** — `DimensionSignals.failed?: boolean` (types.ts) marks a detector-THREW placeholder
  (signalScore:0 is NOT a measurement). `analyzeSignals` sets it in the catch; `assembleReport` drops
  a failed dim (renormalized out of `overallScoreFor`) + warns, instead of folding a fake 0.
- **2026-06-08** — `assembleReport` now pushes a `report.warnings` entry when the LLM scored only SOME
  of the deterministic dimensions ("AI assessed N of M …"), so a partial assessment can't read as a
  fully AI-validated headline. The blend is unchanged (missing dims already use the signal floor).
- **2026-06-08** — `buildFallbackRoadmap` derives `levelUnlock` via the `LEVELS` index (omit at the
  top band), not `Number(id.slice(1))+1` (which gave "L5->L5" / "...->LNaN" on drifted ids).

### Conventions enforced
- **2026-06-08** — One roll-up, one weight source: every projection routes through `overallScoreFor`.
- **2026-06-08** — "Couldn't measure" ≠ "measured zero": exclude + flag a failed/missing dimension;
  never fold a placeholder 0 (deflates) or silently floor it (false confidence).

### Open follow-ups (from Bug Hunter wave 4)
- **DEFERRED maturity #5 (Medium)** — PR/governance evidence is folded into the signal, fed to the LLM
  as the calibration anchor, AND used as the guardband center (triple-counted; auditor can't discount
  an inflated review rate). Fix = separate capped addend or guardband vs the pre-fold signal —
  **calibration-sensitive**, needs `npm run bench`/gate to confirm no regression. Not run here.
- **DEFERRED maturity #6 (Medium)** — recommendation PATCH read-then-write, no concurrency guard.
  Robust fix = version-conditional update (client version → 409); lighter = read-in-tx + withRetry
  (DSQL-only). Needs a live DB to verify. (Note: W3-7 already moved this function's AUDIT into the tx.)
- **maturity #1 stricter gate (follow-up)**: the partial-coverage WARNING shipped; an axis-aware
  `isAssessmentUsable` (reject a one-axis-only assessment → mock) is a calibration-sensitive follow-up.
- **maturity #4 mock cosmetic**: mock.ts still classifies a failed-detector label as a "strength"
  (keyless demo only). Classify by score/polarity, not a `/^no/i` label regex.
- Cumulative after wave 4: 7 of 9 criticals closed (added maturity #1). Remaining: llm #1 (Wave 5).

## Bug Hunter Pipeline B — "Lifecycle / crashes / input boundaries" wave (2026-06-08, wave 5 — 8 closed; ALL criticals now done)

### Structural facts
- **2026-06-08** — `parseJsonLoose` (llm/json.ts) recovery is now bounded: skip the balanced scan
  above `MAX_RECOVERY_BYTES` (256KB) and cap `balancedParse` to `MAX_START_ATTEMPTS` (512) structural
  starts. The clean fast path (any size) is unaffected. A synchronous loop can't be interrupted by
  the AbortSignal, so the ceiling is the only protection.
- **2026-06-08** — `claude-cli.ts` `runClaude` attaches `child.stdin.on("error", reject)` + guards the
  write with `!destroyed` (an early-dying child's EPIPE was an uncaught exception that crashed the
  whole process), and validates `CLAUDE_MODEL` against `^[A-Za-z0-9][A-Za-z0-9._:-]*$` before the
  `shell:true` spawn. `CLAUDE_CLI_PATH` stays operator-only (paths carry legit special chars).
- **2026-06-08** — `/api/scan/stream` hoists the heartbeat handle and adds a stream `cancel()` to
  clear it on client disconnect (was only cleared in start()'s finally).
- **2026-06-08** — `parseRepositoryHistory(unknown)` (lib/report/validate.ts, sibling of
  parseScanReport) is THE trust boundary for `/api/history`; both ReportView and DimensionTrends
  route through it instead of `as RepositoryHistory`. Never throws — empty `scans` on junk, drops
  unplottable points.
- **2026-06-08** — Chart geometry is clamped/NaN-guarded at the scale boundary: `vScale` (chartScale.ts,
  shared by TrendChart/Sparkline/DimLine) and the `ScoreRing` offset (Charts.tsx). `scoreHex` already
  clamped colour; the geometry didn't.
- **2026-06-08** — `validateAssessment` (llm/provider.ts) now caps every model string via `cap()`
  (`MAX_FIELD_LEN=2000`) — it bounded array count but not string length. Bedrock's string tool-input
  is repair-parsed (`parseJsonLoose`) instead of coerced to a zero-dim assessment.

### Conventions enforced
- **2026-06-08** — Any recovery/parse that scales with hostile input needs an explicit size/iteration
  ceiling (AbortSignal can't interrupt a sync loop).
- **2026-06-08** — Attach a child-process `stdin` 'error' listener before writing — EPIPE is otherwise
  an uncaught exception that takes the server down.
- **2026-06-08** — Every untrusted JSON boundary feeding a render needs its own validator; validating
  one (streamed report) and `as`-casting a sibling (/api/history) is asymmetric trust.

### Open follow-ups (from Bug Hunter wave 5)
- The deferred items from earlier waves stand (persistence #4/#5, read-path withDb migration, maturity
  #5/#6, maturity-#1 stricter axis-aware gate, maturity-#4 mock cosmetic). No NEW deferrals this wave.
- **ALL 9 criticals are closed (8 via code + github-app #2 reassessed).** Remaining scan work is
  High→Low: Wave 6 (LLM cost/billing — llm #2/#3, scan-pipeline #2, org-scanning #4, usage #5/#6),
  Wave 7 (cache/dedup & GitHub App sync), Wave 8 (session/OAuth + aggregate/UI tail). See INDEX.

## Bug Hunter Pipeline B — "LLM cost / billing integrity" wave (2026-06-08, wave 6 — 3 closed, 3 deferred)

### Structural facts
- **2026-06-08** — `scan.ts` attemptAssess now captures each attempt's usage into a LOCAL and assigns
  `capturedUsage` only AFTER the usability gate passes (commit-on-success). Providers call onUsage
  before the parse/usability check, so a failed attempt's tokens used to ride onto report.usage even
  after degrading to mock.
- **2026-06-08** — `gemini.ts` drives the LLM timeout through an `AbortController` (abort on timer)
  combined with the client signal via `AbortSignal.any`, passed as `abortSignal` to generateContent —
  so a timeout CANCELS the request (frees socket, stops billing) instead of a promise-race that left
  it running. The old `withTimeout` helper was removed.
- **2026-06-08** — `db/usage.ts` estimatedCost now requires BOTH `LLM_INPUT/OUTPUT_COST_PER_MTOK`
  parsed from raw env (null when blank, NOT 0 — envNumber(name,0) couldn't tell unset from 0). A
  deliberate "0" is a valid price; a missing rate → null ("rate not set"). envNumber import dropped.

### Conventions enforced
- **2026-06-08** — Meter on commit, not on attempt: fold per-attempt usage into the billable total
  only on the winning attempt.
- **2026-06-08** — A timeout must CANCEL (AbortController), not just abandon (promise race) — else the
  guarded request keeps running and billing.

### Open follow-ups (from Bug Hunter wave 6)
- **DEFERRED usage #5 (Medium)** — mock/keyless private scans counted as billable. "billable=private"
  is woven through priv count + per-day SQL series (fetchDailySeries) + JS fallback + CSV + UsageTrend;
  excluding mock consistently is metering-wide, unverifiable DB-less. Lower impact now (W6-1 zeroed
  mock tokens, W6-4 fixed cost rates) — residual is the private-scan UNIT count.
- **DEFERRED scan-pipeline #2 (High)** — cache-stampede double-bill. Singleflight is clean for the JSON
  route but the primary path is the SSE STREAM route (per-client progress can't share one computation's
  stream). Needs a stream-aware design + load test.
- **DEFERRED org-scanning #4 (Medium)** — cron at-least-once retry re-burn; ties to the deferred
  `@@unique([repoId, headSha])` (persistence #4). DB-concurrency, unverifiable DB-less.
- **OpenAI timeout** — the W6-2 AbortController pattern should also be applied to openai.ts (it wires
  opts.signal but not a timeout-abort).
- All 9 criticals remain closed. Remaining INDEX waves 7–8 are High→Low.

## Bug Hunter Pipeline B — "Cache/dedup & GitHub App sync" wave (2026-06-08, wave 7 — 5 closed, 3 deferred)

### Structural facts
- **2026-06-08** — `removeInstallation` (installations.ts) calls `invalidateInstallationToken` BEFORE
  the DB guard, so the in-memory token cache (github/app.ts) is dropped on uninstall even DB-less.
- **2026-06-08** — Both scan routes skip `cacheSet` when `report.confidence < 0.5` (low coverage):
  silent per-file fetch failures degrade coverage without failing the LLM, so a transient blip would
  otherwise pin a degraded snapshot under the commit key for the full TTL. The cache key encodes
  identity (commit) but not completeness (coverage) — so gate on coverage.
- **2026-06-08** — `ReportClient` peek now verifies the peeked report's `owner/name` matches the
  normalized requested repo before rendering (else falls through to a fresh scan), and a non-timeout
  AbortError now surfaces an error instead of an infinite spinner.
- **2026-06-08** — `listInstallationRepos` warns when listed < total_count (silent MAX_PAGES
  truncation). `githubGraphql` returns partial `data` + logs `errors` instead of throwing on any
  error (one bad PR node no longer fails ingestion).

### Conventions enforced
- **2026-06-08** — A cache key that encodes identity but not completeness will cache incompleteness;
  gate caching on a quality signal (coverage), not just the commit.
- **2026-06-08** — Re-verify a peeked/cached response is for what you asked before rendering it.

### Open follow-ups (from Bug Hunter wave 7)
- **DEFERRED org-scanning #2 (High)** — cross-instance duplicate Scan rows; fix is the DB
  `@@unique([repoId, headSha])` = the deferred **persistence #4** (needs a live DB; fails if dups
  exist). Tracked there.
- **DEFERRED github-app #4 (High)** — installation_repositories selection-narrowing leaves orphaned
  watched repos; robust fix reconciles the watch-set vs a fresh `listInstallationRepos` (needs a new
  "watched repos for installation" query + a GitHub re-list; unverifiable DB-less).
- **DEFERRED scan-pipeline #5 (Medium)** — headSha = tree sha not commit sha on the no-lookup path
  (the carried PR-ref headSha-stamping follow-up). Low priority.
- All 9 criticals remain closed. Remaining: Wave 8 (OAuth/session + aggregate/UI tail) + the deferred
  DB/calibration/concurrency set.

## Bug Hunter Pipeline B — "OAuth/session + UI tail" wave (2026-06-08, wave 8, FINAL — 5 closed)

### Structural facts
- **2026-06-08** — `secureCookieForRequest` (auth.ts) is now EXPORTED and used by the OAuth callback
  so the INITIAL session cookie's Secure flag derives from `x-forwarded-proto` (matching the refresh
  path), not the internal `url.origin`. Behind a TLS-terminating proxy the old check minted a
  non-Secure cookie.
- **2026-06-08** — `PostureQuadrant` (Charts.tsx) defaults `QUAD_TINT[posture.id] ?? "#475569"` — an
  untrusted/drifted posture id no longer renders the marker with no fill.
- **2026-06-08** — `parseRepositoryHistory` (validate.ts) now also drops a point whose `scannedAt`
  is unparseable (`Number.isNaN(Date.parse(...))`) — it blanked the axis + fed forecastTrajectory.
- **2026-06-08** — `OrgScanButton` counts the bulk-scan SSE `repo` events that carry `error` and
  shows "N repos failed" — partial failure no longer reads as 10/10 success.
- **2026-06-08** — `historyToCsv` (api/history) runs EVERY field through `csvField` (was raw for
  scannedAt/overall/dims).

### Conventions enforced
- **2026-06-08** — Cookie security flags match the EDGE connection (x-forwarded-proto), applied on
  every mint (initial + refresh), not one path.
- **2026-06-08** — A render-time `RECORD[untrusted.id]` lookup must `?? fallback` or the element
  silently disappears (same class as the chart-geometry / posture-color misses).

### bug-hunt 2026-06-08 — FINAL cumulative
- **40 findings closed via code** in 34 atomic fix commits across 8 themed waves; 1 reassessed
  (github-app #2). **All 9 criticals closed.** Every wave: tsc 0→0, eslint clean, next build green.
- Branch `vibeman/bug-hunt-wave1-authz` off master; INDEX + 8 FIXES-WAVE-N docs are the record.

### Standing deferred backlog (needs a live DB / calibration bench / design call) — see FIXES-WAVE-8.md
- DB/concurrency: persistence #4 (`@@unique([repoId,headSha])`), #5 (pooler), org-scanning #2/#4,
  maturity #6 (PATCH OCC), the read-path withDb migration.
- Calibration: maturity #5 (guardband anchor — `npm run bench`).
- GitHub-App flow: github-app #2 (OAuth-during-install), #4 (selection-narrowing reconcile); OpenAI
  timeout-abort (mirror llm #2).
- OAuth posture: github-oauth #2 (fail-open revocation is a DELIBERATE access-TTL-backstopped
  tradeoff — owner's call), #3/#4 (session rotation), #6 (Low).
- Polish tail (Low/Medium): org-dashboard #4/#5/#6, org-scanning #5/#6/#7, report-trends #6,
  scan-pipeline #6/#7 (known defense-in-depth, not exploitable).

## Combined Business-Visionary + Bug-Hunter Pipeline B (2026-06-11 scan → 2026-06-12 fixes, 39/39 resolved)

### Structural facts
- **2026-06-12** — The prepaid-credit + free-quota system (landed ~06-10, after the prior audits) was the
  dominant finding cluster: 13 of 39 items sat on its integration seams. Lesson: **scan the newest subsystem's
  seams first** — new code that outran its consumers is where the value concentrates.
- **2026-06-12** — Free-quota policy now mirrors paid credits: **meter on commit, not attempt** —
  `refundPublicScanQuota` (public-scan-quota.ts, fail-open) refunds invalid/failed/aborted/degraded/cache-hit
  scans; consume+refund are one `$transaction` (Serializable on PG, native OCC on DSQL).
- **2026-06-12** — `publicOriginForRequest` (auth.ts) is the OAuth-redirect sibling of `secureCookieForRequest`:
  external origin from x-forwarded-proto/host on BOTH authorize and token-exchange legs.
- **2026-06-12** — `providerByName` contract: keyless → **null** (never a masquerading MockProvider), so
  scan.ts failover accounting stays truthful. Bedrock availability accepts any AWS signal (BEDROCK_REGION/
  keys/profile/role/container); an explicit `LLM_PROVIDER=bedrock` trusts the operator.
- **2026-06-12** — `classifyRepoEvent` (liveWarRoomShared) is the pure boundary for the bulk-scan SSE
  vocabulary (`error|notice|progress|repo×3|result`); both consumers (LiveWarRoom, OrgScanButton) route
  through it — extend it, don't re-inline event parsing.
- **2026-06-12** — Recommendation carry-forward identity is `matchRecommendations` (compare.ts, tiered:
  id → normalized-title-in-dimension → tier-3), shared by scans-persist; never key on raw LLM title.
- **2026-06-12** — `percentileOf(xs, v, min)` (org-insights) is the shared sample-floored percentile for
  corpus (CORPUS_MIN=5) and cohort (COHORT_MIN=5) paths.
- **2026-06-12** — `prisma/init.sql` drift is now pinned by a parity test (21 models + invariants) — schema
  changes fail vitest until init.sql is regenerated via the file's documented offline command.
- **2026-06-12** — Alert routing is org → `ALERT_WEBHOOK_URL` env → no-op, resolved at every sink
  (regression, digest, low-credit). `Organization.alertWebhookUrl` is additive-nullable (deploys must
  migrate); validator requires https + public host; admin-gated `GET/POST /api/org/alerts`.
- **2026-06-12** — LLM pricing: built-in per-model table (llm/config.ts, geo-prefix longest-match) is the
  default; `LLM_INPUT/OUTPUT_COST_PER_MTOK` env rates override. Usage groups by `engineModel`.

### Conventions enforced
- **2026-06-12** — Period-over-period fleet deltas must be cohort-matched (repos present in BOTH windows);
  onboarding shows as an explicit "+N repos onboarded" growth line, never as score "movement".
- **2026-06-12** — Spell regex character classes with escapes (`[\x00-\x1F\x7F\s]`), never raw control
  bytes — two scanners misread the rendered bytes as a broken Annex-B range (OAUTH#1 reassessment).
- **2026-06-12** — Webhook delivery dedupe must `forgetDelivery` on ANY handler failure (sync installation
  handlers included), or a redelivery is deduped and the lifecycle event is permanently lost.

### Anti-patterns to avoid
- **2026-06-12** — A reserve-before-work credit debit without refund-on-dedupe/degrade overcharges exactly
  the paths that deliver nothing (org/scan + import vs cron divergence; ledger `balanceAfter` from a
  pre-decrement read can never reconcile under the 4-lane pool).
- **2026-06-12** — Landing/pricing copy hardcoded apart from the gate that enforces it WILL drift into a
  lie ("Unlimited free" vs 3/week): derive user-facing limits from the gate's own exported constants.

### Open follow-ups (from biz-bug run, 2026-06-12)
- **`x-ascent-unbilled: true`** (UMB#2) is observability, not enforcement — a deliberate soft-fail;
  revisit if revenue leakage shows up in ledger reconciliation.
- **Auth-off deploys keep the ambient PAT on the import funnel** (OSW#2 scoped exception, documented
  open-by-design posture) — re-audit if auth-off ever ships beyond local/demo.
- **Per-org webhook routing has no UI** (OSW#3 shipped API-only: `POST /api/org/alerts`) — a settings
  surface on the org dashboard is a clean follow-up.
- The pre-existing standing deferred backlog (persistence #4/#5, maturity #5/#6, github-app #2/#4,
  OAuth posture set, read-path withDb migration) is UNCHANGED by this run.

## Context map + Feature Scout Pipeline B — "Close the action loop" wave (2026-06-14)

### Structural facts
- **2026-06-14** — The Vibeman context map was fully regenerated (10→38 contexts, 4→9 groups, 100%
  source coverage; committed `context-map.json` + `.claude/CLAUDE.md` pointer). The prior 10-context
  map was ~317 commits stale. Feature/audit scans should scope off the new map.
- **2026-06-14** — `openDraftPr` (github/write.ts) + `buildArtifact` (practice-artifact.ts, keyed on
  the 1:1 `PRACTICES` dimId→practice map) are THE change-delivery primitives; `createInitiative`
  (db/plan.ts) takes `{dimId,targetScore,repos}`. Several surfaces now wire to them — don't re-flag
  these as "dead-end" gaps: backlog rows open PRs (reuse `/api/practices/apply`), the what-if
  Simulator commits a scenario to an Initiative, PlaybookCard opens a PR, PracticeApply has fleet
  rollout, fleet-map stars link to `reportPermalink`.
- **2026-06-14** — New routes: `POST /api/practices/apply-batch {repos[],practiceId}` (fleet rollout
  via `mapPool`/`SCAN_CONCURRENCY`, one shared org gate, ≤25/click) and
  `POST /api/org/playbooks/[id]/apply {repo}` (seeds the playbook as `docs/playbooks/<slug>.md`,
  records the adoption mark + audits `playbook.pr_opened`). Added `getPlaybook(id)` to db/playbooks.

### Conventions enforced
- **2026-06-14** — To batch a single-item write: require all items share ONE org, gate once, mint the
  installation token once, then `mapPool(items, SCAN_CONCURRENCY, worker)` with a never-throwing
  worker that returns a per-item result row. Cap the batch; one failure must not abort the pool.
- **2026-06-14** — Prefer reusing the existing ROUTE (not just the function) from a new surface so the
  App-installed + signed-in + `requireOrgAccess` + audit guarantees come for free (BKLG-1 → practices/apply).

### Open follow-ups (from Feature Scout Wave 1, 2026-06-14)
- **STD-1 (Critical) deferred** — doctor conformance → Ascent adopt/verify/re-score loop. Needs a
  persistence migration (risky blind in this DB-less repo) + report/rollup surfacing. Full low-risk
  plan in `docs/harness/followups-2026-06-14.md`.
- **Waves 2–8 + tail unstarted** — see `docs/harness/feature-scout-2026-06-14/INDEX.md`: expose
  dormant backends (MEM-1/ALRT-1/SEG-1/CONN-1), notifications/email, monetization (CRED-1/QUOTA-1),
  planning completeness, live ops, audit/compliance + CI gate, growth/SEO + onboarding, 49 mediums.
- **Route tests** for `apply-batch` + `playbooks/[id]/apply` not added (thin compositions of tested
  primitives); a reasonable follow-up.

## Feature Scout Pipeline B — "Expose dormant backends" wave (2026-06-14, Wave 2)

### Structural facts
- **2026-06-14** — Several shipped-but-UI-less backends now have surfaces; don't re-flag as gaps:
  member management (`/org/[slug]/members` page + `MembersPanel`, owner-gated), alert routing
  (`AlertsControl` chip in the org header, admin-only), per-segment scan/cadence (`SegmentActions` on
  each segment card), and bulk watch/schedule on Connect.
- **2026-06-14** — New server bits (no schema change): `DELETE /api/org/members?org=&login=` +
  `db.removeMembership()` (refuses the last owner); `POST /api/org/members` now audits
  `org.member.role`/`.removed`; `POST /api/org/alerts {test:true}` dispatches a sample alert;
  `/api/org/watch` accepts a `repos[]` bulk batch (sequential writes); `authz.hasOrgRole(org,min)`
  (boolean `requireOrgRole` for server pages).
- **2026-06-14** — `getRepoSegmentMap(org)` returns repo-fullName → segments[]; invert it for
  segment → repos. `setWatchedSchedule(org, schedule, segmentId?)` (no-fullName `/api/org/schedule`
  body) sets cadence across the whole watched set or a segment; `/api/org/scan {repos:[]}` scopes a
  bulk scan to a repo set (filtered against watched).

### Conventions enforced
- **2026-06-14** — Page gate = boolean (`hasOrgRole`); route gate = Response (`requireOrgRole`). Don't
  duplicate the resolution — derive the boolean from the Response form.
- **2026-06-14** — Bulk endpoint = an array branch on the existing single route, gated once; write
  sequentially when each item lazily upserts a shared parent (the Organization) so writes can't race it.

### Open follow-ups (from Feature Scout Wave 2, 2026-06-14)
- ~~MEM-2 / ALRT-3 deferred~~ **RESOLVED** in the migrations session (below).
- Waves 3–8 + tail still open (notifications/email, monetization, planning, live ops, audit/CI gate,
  growth/onboarding) — see the INDEX.

## Feature Scout — Migrations session (2026-06-14, the 3 deferred schema-change items)

### Structural facts
- **2026-06-14** — Schema grew by additive-nullable columns + one table (all DB-less-safe): on
  `Organization` `alertOverallDrop`/`alertDimensionDrop` (ALRT-3); on `Repository`
  `aiConformance`/`Fails`/`Warns`/`At` (STD-1); new `Invite` model (MEM-2). New routes:
  `POST /api/report/conformance` (CI-token or owner gated), `/api/org/invites` (POST/GET/DELETE),
  `/invite/[token]` accept page. `node .ai/doctor.mjs --json` now prints + auto-POSTs conformance.
- **2026-06-14** — `recordConformance` (org-watch.ts) + `getOrgAlertThresholds`/`setOrgAlertThresholds`
  (org-alerts.ts) + the whole `invites.ts` are no-op-safe without a DB (mirror `recordScanOutcome`).
  Don't re-flag these as gaps.

### Conventions enforced (migration discipline — DB-less repo)
- **2026-06-14** — To change the schema here: edit `schema.prisma` → `npx prisma generate` (offline,
  so tsc sees new fields) → hand-write `prisma/migrations/<ts>_<name>/migration.sql` → mirror
  `prisma/init.sql` (the `init-sql.test.ts` parity test requires a `CREATE TABLE` per model AND
  table-set == model-set) → verify via prisma generate + tsc + the parity test + `next build`. Note
  in the commit that NO live DB migration ran; deploy applies it via `prisma migrate deploy`.

### Open follow-ups (from the migrations session)
- **STD-1 / MEM-2 / ALRT-3 are CLOSED.** No NEW schema deferrals.
- A per-ORG conformance ingest token (vs the single `CONFORMANCE_INGEST_TOKEN`) would be tighter than
  a deployment-wide secret — a reasonable hardening follow-up if conformance reporting sees real use.
- Waves 3–8 of the INDEX remain (notifications/email, monetization, planning, live ops, audit/CI
  gate, growth/onboarding) + 49 mediums / 4 lows.

## Feature Scout — direct-to-master round (2026-06-14): Wave 4 funnel slice + Wave 7

PR #2 (Waves 1–2 + 3 schema items) was merged to master; work then continued DIRECTLY ON MASTER
(per user) skipping notifications/email. 9 findings shipped — see `FIXES-MASTER-ROUND2.md`.

### Structural facts
- **2026-06-14** — Monetization funnel (no Stripe yet): `src/lib/plans.ts` `PLAN_FEATURES` is THE tier
  source of truth (entitlement + /pricing read it); `isUnlimitedPlan` is data-driven from it (re-exported
  from db/credits). `peekPublicScanQuota` + `GET /api/quota` = read-only "scans left" meter. `POST
  /api/org/plan` (owner; paid tiers behind `ASCENT_ALLOW_PLAN_CHANGES`). Public `/pricing`. CRED-1
  (Stripe Checkout) + CRED-3 (auto-recharge) DEFERRED.
- **2026-06-14** — Audit viewer drives badges+filters from ONE ACTIONS list (real action keys:
  recommendation.updated, scan.regression, org.alerts.{webhook,thresholds}, {practice,playbook}.pr_opened,
  org.member.{role,removed,invited}, org.plan, org.gate_policy, retention.purged); `GET /api/audit?format=csv`
  exports; viewer filters by since/until/actor.
- **2026-06-14** — `Organization.gatePolicy` (JSON, additive) persists a `GatePolicy`; getOrgGatePolicy/
  setOrgGatePolicy (org-gate.ts) + sanitizeGatePolicy (gate.ts). runPrGate (App check) AND
  buildGovernanceOverview now resolve it — same bar in dashboard + merge gate. Gate Check Run has a
  "Re-run" action; webhook handles `check_run` rerequested/requested_action; hard failure posts a
  `neutral` check (not silent-absent). Editor on the governance tab.

### Conventions enforced
- **2026-06-14** — A "before you act" read meter is the read-only sibling of the consuming op, sharing
  its identity/window math (peek vs consume) so the two never disagree.
- **2026-06-14** — Paired maps (badge metadata + filter list) derive from ONE source array, or they drift
  (the SEC-3 bug keyed on an action string that's never written).

### Open follow-ups (from this round)
- **CRED-1 (Stripe Checkout) + CRED-3 (auto-recharge)** deferred — the funnel (meter/pricing/tiers/CTA) is
  ready to wire to checkout; build fetch-based + env-gated when wanted.
- Waves 5 (planning), 8 (growth/onboarding) + notifications/email (excluded) + 49 mediums / 4 lows remain.

## Feature Scout — Wave 6 Live ops (2026-06-14, on master) — COMPLETE (6/6)

See `FIXES-WAVE-6.md`. Made the war-room + `/launch` fleet map live/goal-aware/interactive.

### Structural facts
- **2026-06-14** — Live war-room (`live/page.tsx` + LiveWarRoom + LiveWarRoomHeader) is now goal-aware:
  fetches `listGoals` (top un-achieved goal), windows `getOrgRollup` on the goal's createdAt for the
  "+N since kickoff" delta, renders a goal banner (PaceChip + Meter + deadline countdown), has an opt-in
  15-min auto-relaunch (localStorage), a "TV mode" (fullscreen + wakeLock), and a `readOnly` mode.
- **2026-06-14** — Signed live-share: `src/lib/live-share.ts` (`signLiveShareToken`/`verifyLiveShareToken`,
  HMAC over `{org,exp}`, secret = `LIVE_SHARE_SECRET`||`AUTH_SECRET`, inert otherwise). Owner-gated
  `POST /api/org/live-share` mints; `/live/shared/[token]` renders the wall READ-ONLY outside the org
  session gate (token = capability), noindex, no scan trigger.
- **2026-06-14** — `/launch` fleet map: per-org "Scan" button (reuses `/api/org/scan` SSE, patches stars
  in place); `/api/app/repos` now attaches a 30-day per-repo `dOverall` from `getOrgMovers`, rendered as
  a directional ring + tooltip delta + a fleet "movers · 30d" chip. `RepoStar.dOverall` added.

### Conventions enforced
- **2026-06-14** — Make a glanced surface live by folding streamed `repo` SSE events into local state
  (war-room + map both patch in place), and surface movement by consuming the existing
  `getOrgMovers`/rollup-window machinery rather than re-deriving it.
- **2026-06-14** — To expose private data on an unauthenticated screen: a signed + expiring HMAC token
  (capability) + a strictly READ-ONLY render outside the session gate + noindex. No mutation paths.

### Open follow-ups
- Wave 5 (planning), Wave 8 (growth/onboarding), Stripe (CRED-1/CRED-3), notifications/email (excluded),
  49 mediums / 4 lows remain — see the INDEX.

## Feature Scout — Wave 5 Planning (2026-06-14, on master) — COMPLETE (7/7)

See `FIXES-WAVE-5.md`. SIM-3 + BKLG-2 landed first; this sitting closed the tail (GOAL-2/6/3, SIM-2/4).

### Structural facts
- **2026-06-14** — Migration `20260614140000_add_initiative_fields`: `Initiative` gains `assigneeLogin`,
  `targetDate` (TIMESTAMP), `goalId` — all nullable/additive (one migration for the GOAL-2 + GOAL-6
  cluster). `goalId` is a plain column (no FK relation), mirroring the existing `practiceId` pattern;
  `listInitiatives` resolves `goalLabel` from an in-memory goal map (a deleted goal → null = unlinked).
- **2026-06-14** — `updateInitiativeStatus` generalized to `updateInitiative(id, patch)` (status/
  assignee/targetDate/goalId); the `[id]` PATCH route now patches any subset. POST accepts the new fields.
- **2026-06-14** — `InitiativesPanel` got inline owner (`onBlur` PATCH) / due-date / goal-`<select>`
  controls + a "starter shape →" deep-link; `GoalCard` cross-renders `initiativesByGoal[g.id]`. `Card`
  (org/ui) gained an optional `id` (scroll anchor) so `/practices#practice-<id>` lands on the card.
- **2026-06-14** — `simulateFleet(repos, fix | fix[], scope)` — second arg widened to one or many legs,
  normalized internally; `FleetProjection.fix` → `fixes[]`. `simulateOrgFixes` + a `fixes[]` payload on
  `/api/org/simulate`. `goalImpactsForScenario(slug, before, after)` re-anchors active axis/overall goals
  at the simulated value via `projectGoal` (run twice) and returns the ETA shift.

### Conventions enforced
- **2026-06-14** — Bundle findings that share a migration into ONE additive nullable-column change
  (GOAL-2+6), not one migration per finding — same offline discipline, fewer deploys.
- **2026-06-14** — Generalize a signature backward-compatibly (`T | T[]`, normalize inside): every prior
  caller/test stays green while the new path opens. Confirm nothing reads a field before reshaping it
  (`grep '\.fix'`).
- **2026-06-14** — Derive a forecast view by re-running the pure engine with one input re-anchored
  (`projectGoal` at the simulated `current`) rather than threading a parallel trajectory — it can't
  disagree with the live goal pace.

### Open follow-ups
- Wave 8 tail (SHELL-1/2 OG cards, ONB-2 resumability, USE-1 full impression analytics), Stripe
  (CRED-1/CRED-3), notifications/email (excluded), 49 mediums / 4 lows remain — see the INDEX.

## Feature Scout — Wave 8 Growth/onboarding (2026-06-14, on master) — COMPLETE (8/8)

See `FIXES-WAVE-8.md`. ONB-1/4 + USE-2 + the ?ref=badge tag landed first; this sitting closed the
SHELL/ONB/USE tail (ONB-3, SHELL-1, SHELL-2, ONB-2, USE-1 reach).

### Structural facts
- **2026-06-14** — Per-repo report OG (`report/[owner]/[repo]/opengraph-image.tsx`) is now `runtime=nodejs`
  and renders the real score: best-effort `getScanReportByCommit` (under `readableOrgForOwner`) wrapped in
  try/catch → static fallback card. Draws overall score + LEVEL_GLYPH/level name + adoption/rigor + a
  9-dimension strip (colours via LEVEL_HEX/scoreHex).
- **2026-06-14** — Org dashboard SEO: `generateMetadata` on `org/[slug]/page.tsx` + a new
  `org/[slug]/opengraph-image.tsx`, both gated on `canReadOrg(slug)` (false for an unauthenticated
  unfurl → neutral card; private fleet aggregates never leak). `Card` (org/ui) gained an optional `id`
  scroll-anchor (also used by GOAL-3's practice deep-link).
- **2026-06-14** — Onboarding resumability: `OnboardingFlow` persists `{org, sourceLabel, sourceInstallId,
  selected[]}` to `sessionStorage` (key `ascent:onboarding:v1`) and rehydrates on a run-once mount effect
  by re-calling the source loader + re-applying the selection (lands on `select`; transient scanning/done
  resolve cleanly). Cleared on `done`. Server half in `onboarding/page.tsx`: a "welcome back" banner when a
  candidate org (installations + seededOrg) has `getOrgRollup().scannedCount > 0`.
- **2026-06-14** — `BadgeImpression` model (migration `20260614150000`, additive table; init-sql parity
  28). `recordBadgeImpression` upserts a (repoFullName, refererHost) tally, called fire-and-forget
  (`void …catch`) from the badge GET after the private-repo gate. `getBadgeReach(org)` aggregates DB-side
  (aggregate + groupBy take 6 + distinct); public org = all, else owner-prefix (`<slug>/…`). "Badge reach"
  panel on `/usage`.

### Conventions enforced
- **2026-06-14** — A DB-backed public asset (OG image) always wraps its read and ships a static fallback,
  so an unfurl degrades, never 500s.
- **2026-06-14** — Gate a derived public surface (OG/metadata) on the SAME authz the page uses
  (`canReadOrg`), which is false for a cookie-less unfurl — private data degrades to neutral automatically,
  no separate visibility flag to drift.
- **2026-06-14** — Instrument a CDN-fronted public endpoint with a fire-and-forget, error-swallowed tally
  (no await, no throw into the response) and LABEL the metric a lower bound — most views never reach origin.
- **2026-06-14** — Rehydrate a wizard from its minimal INPUTS (re-fetch live), not serialized transient UI
  state; persist before the user is interrupted, clear once the work is saved server-side.

### Open follow-ups
- Stripe (CRED-1/CRED-3), notifications/email (excluded), the SHELL mediums/low (manifest/PWA, JSON-LD,
  sitemap badge route), 49 mediums / 4 lows remain — see the INDEX. Waves 1/2/5/6/7/8 + migrations done.

## Feature Scout — App Shell SEO mediums/low (2026-06-14, on master) — COMPLETE (3/3)

See `FIXES-SHELL-SEO.md`. Closes the App Shell/SEO context (5/5 with SHELL-1/2 from Wave 8).

### Structural facts
- **2026-06-14** — `src/lib/site.ts` `publicBaseUrl()` centralizes the `ASCENT_PUBLIC_URL ||
  NEXT_PUBLIC_APP_URL` origin (was copy-pasted in sitemap/robots/webhook/digest/scan-alerts); now used
  by layout `metadataBase`, the layout/homepage JSON-LD, and the sitemap.
- **2026-06-14** — `src/app/manifest.ts` (MetadataRoute.Manifest) — installable PWA, no SW. Icons reuse
  `/brand/logo-mark-nobg.png` (any) + `/brand/logo-mark.png` (maskable), `sizes:"any"`. `appleWebApp`
  added to layout metadata.
- **2026-06-14** — JSON-LD: Organization + SoftwareApplication in `layout.tsx`, FAQPage in `page.tsx`,
  rendered via `<script type="application/ld+json" dangerouslySetInnerHTML>`; payloads built from
  LEVELS/DIMENSIONS + on-page copy. Sitemap gains `/badge`, `/pricing`, `/connect`, `/onboarding`.

### Conventions enforced
- **2026-06-14** — Resolve the public origin from ONE helper so sitemap / metadataBase / JSON-LD absolute
  URLs can't drift.
- **2026-06-14** — Generate structured data from the canonical rubric + the visible copy, never a parallel
  hand-maintained string, so the search snippet can't disagree with the page.
- **2026-06-14** — Declare manifest icon `sizes` honestly (`"any"` for single source PNGs) rather than
  claiming a 192/512 set that isn't pre-rendered.

### Open follow-ups
- The API/email copies of the base-URL expression (webhook/digest/scan-alerts) could later adopt
  `publicBaseUrl()` too. Stripe (CRED-1/CRED-3), notifications/email (excluded), 49 mediums / 4 lows remain.

## Feature Scout — Mediums Wave A · Segments & fleet slicing (2026-06-14, on master) — COMPLETE (6/6)

See `FIXES-MEDIUMS-A-SEGMENTS.md`. First medium wave: make segments usable at fleet scale + slice
every analytics surface. All reuse the shipped segmentId infra.

### Structural facts
- **2026-06-14** — `setRepoSegmentsBulk(orgSlug, segmentId, fullNames[], member)` (segments.ts):
  org-scoped bulk tag (createMany skipDuplicates) / untag (deleteMany), returns rows changed or -1.
  `POST /api/org/segments/:id/repos/bulk { org, fullNames[], member? }` (batch cap 1000).
- **2026-06-14** — `OrgRepoRow.primaryLanguage` surfaced (org-rollup.ts — the `include` already fetched
  the column; no migration). Powers auto-add-by-language in RepoSegmentsPanel.
- **2026-06-14** — `GET /api/org/segments?org=&membership=1` returns `{ segments, membership }`
  (fullName→segmentIds) for client pickers (the connect screen). `GET /api/org/repositories?org=&format=csv`
  exports the leaderboard (RFC-4180 csvField + safeFilenameSlug pattern).
- **2026-06-14** — `getOrgPrSignals`/`getOrgGovernance`/`getOrgActivity`/`getOrgTeamRollup` all gained
  `segmentId?` + `...segmentScope(segmentId)`; Delivery & Teams pages read `?segment=` + render
  `SegmentSelector` (parity with Contributors). `SegmentSelector` shows a "+ Create a segment →" link
  (to /org/<slug>/repositories) when empty instead of returning null.
- **2026-06-14** — Connect: `RepoRow` gets a segment chip-picker (watched repos only — tagging needs the
  repo row); `InstallationRepos` loads segments+membership and toggles optimistically with rollback.
- **2026-06-14** — Fleet map (`FleetMap`/`ConstellationField`/`fleetMapStars`): a controls bar (search,
  level-band multiselect incl. "unscanned", watched-only, org sort key); filters DIM non-matching stars
  (opacity, preserve shape) via a `matcher` prop; sort reorders org cards. `RepoStar.watched` added.

### Conventions enforced
- **2026-06-14** — One org-scoped bulk primitive serves every "act on many repos" caller; don't add a
  per-feature endpoint.
- **2026-06-14** — To scope an aggregate to a segment, thread the existing `segmentScope(id)` into each
  repo query — never re-aggregate.
- **2026-06-14** — Filter a spatial visualization by dimming non-matches, not removing them, so the
  layout/shape is preserved and matches pop.
- **2026-06-14** — Prefer surfacing an already-fetched stored column (primaryLanguage via the existing
  `include`) over a migration when the data is already in hand.

### Open follow-ups
- Medium waves B–H + 4 lows remain (see INDEX). Stripe + notifications/email excluded.

## Feature Scout — Mediums Wave B · Adaptive org overview (2026-06-14, on master) — COMPLETE (3/3)

See `FIXES-MEDIUMS-B-OVERVIEW.md`. Personalize the dashboard home; no migration.

### Structural facts
- **2026-06-14** — `Tile` (org/ui) gained an optional `goal={ target, label, color }`; the overview
  matches an active goal by metric from the already-fetched `listGoals` (PACE_NOTE maps pace→label/color)
  and passes it to the Overall/Adoption/Rigor tiles (OVR-6).
- **2026-06-14** — OVR-5 "remember my period": `lib/window.ts` gained `PERIOD_COOKIE` +
  `serializePeriodCookie`/`parsePeriodCookie` (isomorphic). `TimeRangeSelector.navigate` writes the
  `ascent_period` cookie; the overview reads it server-side (`cookies()`) as the fallback below an
  explicit `?range=`.
- **2026-06-14** — OVR-4: `CollapsibleSection` (client, native `<details>`, cookie
  `ascent_overview_collapsed`); the overview server-reads the cookie → `defaultOpen` per section (no
  flash). Wrapped the Goals & standing / Posture & dimensions / Movers grids.

### Conventions enforced
- **2026-06-14** — A goal-vs-actual read is a presentational join against data already fetched on the
  page (listGoals), not a new query.
- **2026-06-14** — Persist a UI preference in a cookie read server-side (SSR-consistent, shareable) but
  let an explicit query param always override, so shared URLs stay authoritative.
- **2026-06-14** — Prefer native `<details>` for collapse: works without JS, no hydration flash when the
  server sets `open` from a cookie. NOTE: `react-hooks/immutability` flags `document.cookie =` inside a
  component-scoped handler but NOT a module-scoped helper — keep cookie writers at module scope.

### Open follow-ups
- Medium waves C–H + 4 lows remain (see INDEX). Stripe + notifications/email excluded.

## Feature Scout — Mediums Wave E · Access control & safety (2026-06-14, on master) — COMPLETE (3/3)

See `FIXES-MEDIUMS-E-ACCESS.md`. The RBAC mediums: orphan-guard, role transparency, onboarding invite.

### Structural facts
- **2026-06-14** — `setMembershipRole` return type changed `boolean` → `"ok" | "last_owner" | "error"`
  with a last-owner demotion guard (mirrors removeMembership's removal guard). Callers updated: members
  route POST (maps last_owner→409), invites.ts acceptInvite (`granted !== "ok"`). MembersPanel already
  rolled back + surfaced the error, so no UI change.
- **2026-06-14** — org `layout.tsx` fetches `getMembershipRole(slug, session.login)` in the existing
  rollup/credit Promise.all and renders a role badge in the header (MEM-6). Null for public org / non-members.
- **2026-06-14** — Onboarding done state: `OnboardingScanStep` gained an invite panel + `inviteOrg`/
  `onInvited` props; `OnboardingFlow` passes `inviteOrg={sourceInstallId ? sourceLabel : null}`, tracks
  `invitedCount`, and adds an "Invite your team" checklist step (App path only). Invites POST
  /api/org/members role viewer; `requireOrgRole` auto-seeds the installation-owner so the grant passes.

### Conventions enforced
- **2026-06-14** — Put a safety invariant (last-owner) in the data-layer fn returning a typed outcome,
  not in one route — every caller (route + invite-accept) is then protected.
- **2026-06-14** — Surface a one-value fact (the viewer's role) by reusing the page's existing
  round-trip, not a new endpoint.
- **2026-06-14** — Onboarding can grant org access without a separate ownership step: requireOrgRole
  seeds the installation-owner as owner on first owner-gated call.

### Open follow-ups
- Medium waves C, D, F, G, H + 4 lows remain (see INDEX). Stripe + notifications/email excluded.

## Feature Scout — Mediums Wave C · Planning & goals depth (2026-06-15, on master) — COMPLETE (5/5)

See `FIXES-MEDIUMS-C-PLANNING.md`. Wave-5 follow-on; 2 additive migrations.

### Structural facts
- **2026-06-15** — GOAL-5: plan page computes 2-3 goal suggestions (weakest dim +12, overall→next band
  via LEVELS/levelForScore, adoption floor), passed to GoalsPanel as one-click "+Add" chips.
- **2026-06-15** — SIM-5: Simulator holds a client-only `saved: SavedScenario[]` (snapshot of
  before/after/promotions + a fixes label) + a 2-up compare. No backend.
- **2026-06-15** — GOAL-4: migration `20260614160000` adds `Goal.achievedAt`. listGoals stamps
  status:achieved+achievedAt ONCE when current>=target (idempotent), returns achievedAt; GoalProgress +
  GoalProgressView carry it; GoalCard shows an Achieved badge; GoalsPanel groups met goals (<details>).
- **2026-06-15** — PLAY-5: migration `20260614170000` adds `Initiative.playbookId`. createInitiative +
  POST route accept it; listInitiatives resolves playbookLabel (playbook title map). PlaybookCard gets
  a "Track as initiative" action (needs slug prop); InitiativesPanel shows a "from playbook" back-link.
- **2026-06-15** — PRAC-6: buildGovernanceOverview computes `closestToGreen: GreenPathItem[]` (per
  failing repo: numeric gap + dims-below-floor with dim→practiceId map), ranked fewest-conditions-then-
  smallest-gap. Governance page renders a worklist with practice deep-links (#practice-<id>).

### Conventions enforced
- **2026-06-15** — Derive suggestion/worklist UIs from data already on the page (rollup/governance) — a
  pure computation, no new query, can't drift.
- **2026-06-15** — A read fn may record a one-way idempotent transition (listGoals → achieved) when it's
  the only code that knows current-vs-target; persist once, skip thereafter.
- **2026-06-15** — Bridge two models with a nullable FK column + resolve the display label at read time
  (playbookId on Initiative + a title map), mirroring goalId/practiceId.

### Open follow-ups
- Medium waves D, F, G, H + 4 lows remain (see INDEX). Stripe + notifications/email excluded.

## Feature Scout — Mediums Wave D · Playbooks & practices authoring (2026-06-15, on master) — COMPLETE (3/3)

See `FIXES-MEDIUMS-D-PLAYBOOKS.md`. PRAC-5 was already largely shipped by PLAY-1 (apply→draft-PR).

### Structural facts
- **2026-06-15** — PLAY-4: `src/lib/org/playbook-templates.ts` `PLAYBOOK_TEMPLATES` = PRACTICES.map(...)
  (one per dimension); PlaybooksPanel "Start from a template" select prefills the author form.
- **2026-06-15** — PLAY-6: migration `20260615100000` adds `Playbook.version` (Int default 1) +
  `updatedAt` (@updatedAt) + `PlaybookApplication.appliedVersion` (Int?). `updatePlaybook` bumps version
  on a content edit (title/dim/summary/steps); `applyPlaybook` stamps the current version; the [id]
  PATCH route records a `playbook.updated` audit entry; PlaybookRow carries version/updatedAt; card shows v{N}.
- **2026-06-15** — PRAC-5: `playbookStarterFile()` extracted into playbook-brief.ts (single source for the
  docs/playbooks/<slug>.md artifact); apply route uses it; PlaybookCard gets a "Preview starter file" <details>.

### Conventions enforced
- **2026-06-15** — Derive author templates from the canonical rubric (PRACTICES), not a parallel list.
- **2026-06-15** — Decide "what counts as a content edit" (version bump) in the data fn, so every caller
  versions consistently; the route just audits.
- **2026-06-15** — Single-source a rendered artifact (playbookStarterFile) so preview == what's committed.
- **2026-06-15** — Check whether a flagged finding was already closed by an earlier wave (PRAC-5 by PLAY-1)
  before rebuilding; deliver only the genuine remaining gap (preview parity).

### updatedAt migration note
- **2026-06-15** — Adding `@updatedAt` to an existing table: ALTER with `NOT NULL DEFAULT CURRENT_TIMESTAMP`
  to backfill existing rows; init.sql mirror uses the same default (Prisma still overwrites on every write).

### Open follow-ups
- Medium waves F, G, H + 4 lows remain (see INDEX). Stripe + notifications/email excluded.

## Feature Scout — Mediums Wave G · CI-gate + metering hygiene (2026-06-15, on master) — COMPLETE (4/4 actionable)

See `FIXES-MEDIUMS-G-CIGATE-METERING.md`. CIGATE-5 (gate badge) was already done by GATE-1's ?gate=1 mode.

### Structural facts
- **2026-06-15** — QUOTA-5: badge route drops its bespoke hits/rateLimited/clientIp for the shared
  `rateLimitRequest` + a new `BADGE_RATE_LIMIT` config in rate-limit.ts (perIp 60 / global 600, env-overridable).
- **2026-06-15** — USE-4: `getCreditReconciliation(org, days)` in credits.ts (windows getCreditLedger
  server-side → debited/refunded/granted/net; refund = positive delta with /refund/i reason); /usage
  "Reconciliation" panel for non-public orgs.
- **2026-06-15** — CIGATE-4: buildGateComment appends a "Where the score falls short" table on failure —
  failing dims re-derived from report.dimensions vs the policy floor (max of minDimension + minDimensionFor),
  each with score→floor + top gap.
- **2026-06-15** — QUOTA-6: `QuotaEvent` counter table (migration `20260615110000`) + recordQuotaEvent /
  getQuotaEventTotals (quota-events.ts). Bumped fire-and-forget at the weekly-quota deny (public-scan-quota.ts,
  AFTER the tx) + the badge rate-limit trip. "Abuse & limits" panel on the public /usage view. init-sql parity 29.

### Conventions enforced
- **2026-06-15** — Route a second hand-rolled copy of a primitive (the badge limiter) through the shared one.
- **2026-06-15** — Do date-windowing in the db layer so a server-component page stays pure (react-hooks/purity
  flags Date.now() in render). Mirror of the lib/window pattern.
- **2026-06-15** — Re-derive structured detail (failing dims) from the model + policy, never by parsing
  human-readable failure messages.
- **2026-06-15** — Observability writes go at deny sites (rare, DB-aware), fire-and-forget; the pure
  in-memory burst limiter stays DB-free by design — note the boundary in the UI, don't pretend full coverage.

### Open follow-ups
- Medium waves F, H + 4 lows remain (see INDEX). Stripe + notifications/email excluded.

## Feature Scout — Mediums Wave H · Live-ops & standard polish (2026-06-15, on master) — COMPLETE (5/5)

See `FIXES-MEDIUMS-H-LIVEOPS.md`. The polish tail; 1 additive migration.

### Structural facts
- **2026-06-15** — MAP-6: FleetMap gains a visibility-gated 90s interval refetch + a `mergeStars` helper
  (keeps old identity for unchanged stars so they don't re-animate; appends new repos); yields when a
  manual scan SSE is streaming.
- **2026-06-15** — WARROOM-5: LiveWarRoom `sound` toggle (localStorage `ascent-warroom-sound`, soundRef
  read in pushCelebration) + a synthesized Web Audio "ta-da" (no asset), gated on prefers-reduced-motion;
  LiveWarRoomHeader gains a Sound checkbox.
- **2026-06-15** — ONB-6: OnboardingPickStep footer "See an example org report →" → `/org/<EXAMPLE_ORG>`.
- **2026-06-15** — STD-5: skill.ts runProtocol step 7 prescribes `note failed-approach` / `note decision`.
- **2026-06-15** — STD-6: `SkillGeneration` table (migration `20260615120000`); buildOnboardingSkill returns
  trackIds; skill route records fire-and-forget; report permalink renders a SkillHistorySection (track set
  + diffTrackSets vs prior). skill-history.ts (recordSkillGeneration/getSkillHistory/diffTrackSets). parity 30.

### Conventions enforced
- **2026-06-15** — On a live refresh of a visualization, diff and preserve object identity for unchanged
  items so they don't re-animate (mergeStars).
- **2026-06-15** — Synthesize short UI audio via Web Audio rather than bundling a binary; gate on an opt-in
  toggle + prefers-reduced-motion; rely on an existing user gesture for autoplay.
- **2026-06-15** — A "zero-setup" CTA points a stuck user at real already-computed data, not a blank form.
- **2026-06-15** — Persist a one-off artifact (skill generation) as a lightweight record to make it a
  trackable/diffable program; surface as a SIBLING of the existing view to avoid prop-threading.

### Open follow-ups
- Medium Wave F (exec deltas/sharing/exports) + 4 lows remain (see INDEX). Stripe + notifications/email excluded.

## Feature Scout — Mediums Wave F · Exec briefing, sharing & exports (2026-06-15, on master) — COMPLETE (6/6)

See `FIXES-MEDIUMS-F-EXEC-SHARING.md`. The reporting/sharing wave; 1 additive migration (branding).
This completes ALL eight medium waves (A–H).

### Structural facts
- **2026-06-15** — PPL-6: `GET /api/org/export?org=&kind=contributors|delivery[&segment=][&format=csv]`
  (csvField/safeFilenameSlug); Export CSV links on contributors + delivery pages.
- **2026-06-15** — MAP-5: `launch/opengraph-image.tsx` (decorative constellation via starPosition) +
  generateMetadata. Brand-level (unfurl has no session).
- **2026-06-15** — EXEC-4: buildExecBriefing fetches the prior equal-length window → `priorPeriod`
  (headline + per-dim deltas); rendered on page, BriefingDocument PDF, and briefingMarkdown. test fixture updated.
- **2026-06-15** — SEC-6: `SecurityDocument` PDF + `GET /api/org/security/pdf` (mirrors briefing PDF) +
  Download PDF on the Security tab.
- **2026-06-15** — EXEC-6: `briefing-share.ts` (HMAC `{org,range,from,to,exp}`, secret
  BRIEFING_SHARE_SECRET||AUTH_SECRET, mirrors live-share); owner POST /api/org/briefing/share;
  `/share/briefing/[token]` read-only render (noindex); BriefingShareButton.
- **2026-06-15** — EXEC-5: Organization.brandName/brandColor/logoUrl (migration `20260615130000`);
  getOrgBranding/setOrgBranding (hex+https validated on write); BriefingDocument brands accent/kicker/
  logo with an unbranded-render fallback; owner+enterprise BrandingSettings form. init-sql parity 30 (columns, no new table).

### Conventions enforced
- **2026-06-15** — The WAR-4 signed-capability token generalizes to any read-only/no-account/expiring
  share (token carries {scope,window,exp}, verified at a public noindex route, no table).
- **2026-06-15** — A new CSV/PDF export is the established csvField/safeFilenameSlug or
  renderToBuffer(Document) scaffold pointed at a different build* source.
- **2026-06-15** — "vs previous period" = one extra windowed rollup (prior end = current start); no schema change.
- **2026-06-15** — Validate branding on write (hex/https) + render-with-fallback so a user-supplied value
  can never break the generated artifact.

### Open follow-ups
- All medium waves A–H done. The 4 lows + the Stripe/email-dependent mediums remain (excluded). See INDEX.

## Combined bug+ui scan (Pipeline B, 2026-06-20) — waves 1-3

### Structural facts
- **2026-06-20** — `/api/org/import` now calls `requireOrgAccess(org)` (was the lone ungated mutating
  org route). The long-standing "ungated /api/org/* mutations" follow-up is otherwise CLOSED — re-scan
  confirmed simulate is read-only/`requireOrgRead`, goals/initiatives/backlog mutations gate via
  `requireOrgAccess` (backlog's real mutation is `/api/recommendations/[id]`).
- **2026-06-20** — Invite acceptance is now a same-origin POST `/api/org/invites/accept` (gesture-only);
  the `/invite/[token]` page only `peekInvite`s (read-only). `listPendingInvites` returns NO token
  (`PendingInviteSummary`); the token is shown once in the POST create response. Owner-role invites are
  refused at creation.
- **2026-06-20** — `grantCredits` synthesizes a per-invocation `auto:<uuid>` externalId when the caller
  passes none, so EVERY grant/refund is idempotent under `withRetry`. Any new grant caller is retry-safe
  by default; a P2002 is now always treated as already-applied.
- **2026-06-20** — Scan persistence is now guarded like the cache: `persistScanReport` is SKIPPED for
  degraded-to-mock / low-coverage runs in both scan routes (else the DB tier re-serves the mock floor
  cross-instance for ~7d). `fetchSnapshot` stamps the COMMIT sha (`commitsRes[0].sha`), not `treeRes.sha`.

### Open follow-ups (from the 2026-06-20 combined scan — waves 1-3 done, deferred items)
- **checkout #2** (Med): paid credit pack never calls `setOrgPlan` → Pro/Team feature tiers stay locked.
  Needs a product→plan map + subscription events, or make /pricing honest. Billing-model decision.
- **credits #3** (Med): allowance-vs-credit boundary is a non-transactional pre-check (race). Needs an
  atomic per-month allowance counter (schema).
- **credits #4** (Med): reconciliation classifies refund-vs-grant by `/refund/i` over free-text reason.
  Needs an enumerated ledger `kind` column (migration).
- **scan-persist #4/#5** (Low): sha-less dedup on exact `scannedAt`; head-pointer tear on equal ts.
- **retention #3** (Low): no internal deadline vs maxDuration=300 → large fleet run killed with no partial summary.
- **Waves 4-8** of the 233-finding scan remain open per `bug-ui-scan-2026-06-20/INDEX.md`: silent-failure/
  success-theater (~30, largest reliability cluster), scoring/aggregation, reliability/resilience,
  accessibility+reduced-motion (~34, largest UI cluster), UX/SEO/observability tail.
