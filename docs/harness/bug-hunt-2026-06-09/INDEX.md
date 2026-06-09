# Bug Hunter Scan — ascent, 2026-06-09

> Reliability/failure audit of the ascent GitHub-maturity scanner (Next.js 16 / React 19 / TS 5 / Prisma / pluggable LLM providers).
> 10 parallel `bug-hunter` subagent runs, batched in 2 waves of 5. ~108 files read across the fleet.
> Scope: all 10 contexts (4 groups), full client + server TS/TSX. Findings target 5–8/context.

---

## Totals

| | Critical | High | Medium | Low | **Total** |
|---|---:|---:|---:|---:|---:|
| Across 10 contexts | 3 | 21 | 33 | 13 | **70** |
| Share | 4% | 30% | 47% | 19% | 100% |

> Severities are counted from the per-finding `**Severity**:` bullets (the authoritative source). Five report headers self-miscounted their own breakdown (e.g. `persistence-layer` and `github-app` headers each claim a Critical that the bullets grade as High; several label a Medium as High). The grand total (70) is consistent two ways (header-sum = bullet-count = 70); only the per-severity split was reconciled down to the bullets.

---

## Per-context breakdown

(Sorted by criticals desc, then total desc.)

| # | Context | Group | C | H | M | L | Total | Report |
|---|---|---|---:|---:|---:|---:|---:|---|
| 1 | Organization Scanning, Watchlist & Rollups | Organization Intelligence | 1 | 2 | 3 | 1 | 7 | `org-scanning-watchlist-rollups.md` |
| 2 | Org Dashboard & Views | Organization Intelligence | 1 | 2 | 3 | 1 | 7 | `org-dashboard-views.md` |
| 3 | GitHub App, Connect & Onboarding | Identity & GitHub Connectivity | 1 | 2 | 3 | 1 | 7 | `github-app-connect-onboarding.md` |
| 4 | Scan Pipeline & Ingestion | Repository Scanning & Scoring | 0 | 2 | 5 | 1 | 8 | `scan-pipeline-ingestion.md` |
| 5 | LLM Provider Abstraction | Repository Scanning & Scoring | 0 | 3 | 3 | 1 | 7 | `llm-provider-abstraction.md` |
| 6 | Persistence Layer (Prisma / Aurora DSQL) | Reporting, Persistence & Metering | 0 | 3 | 3 | 1 | 7 | `persistence-layer.md` |
| 7 | GitHub OAuth & Session | Identity & GitHub Connectivity | 0 | 2 | 3 | 2 | 7 | `github-oauth-session.md` |
| 8 | Report & Trends Visualization | Reporting, Persistence & Metering | 0 | 2 | 4 | 1 | 7 | `report-trends-visualization.md` |
| 9 | Usage Metering & Public Badge | Reporting, Persistence & Metering | 0 | 2 | 3 | 2 | 7 | `usage-metering-public-badge.md` |
| 10 | Maturity Model & Scoring Engine | Repository Scanning & Scoring | 0 | 1 | 3 | 2 | 6 | `maturity-model-scoring-engine.md` |

---

## The 3 critical findings

1. **[org-scan #1] Cron rescan has no run-level lock** — `listDueRescans()` selects on `nextScanAt <= now()` and only advances each repo's schedule *after* its scan finishes, so two overlapping cron invocations (long batch near the 300s ceiling, a manual `?key=` retry, a re-fired cron) both see the same repos as due → **double-scan + double-debit credits + 2× GitHub rate-limit pressure**. `src/app/api/cron/rescan/route.ts:48-122`
2. **[org-dash #1] No error boundary anywhere under `src/app/`** — there is no `error.tsx`/`not-found.tsx`/`global-error.tsx`, so any transient DB rejection in a `force-dynamic` org server component 500s the **entire** route (header, nav, all tabs vanish to an unstyled error, no retry). `src/app/org/[slug]/page.tsx:70` + every sibling page + `layout.tsx:75`
3. **[gh-app #1] Forged-but-signed `installation.deleted` webhook tears down a victim org** — the `created` branch was hardened to confirm the account via App-JWT, but the destructive `deleted`/`suspend` branch trusts `payload.installation.id` blindly: unwatches every repo, nulls the install id, revokes live sessions — with no ownership check. `src/app/api/app/webhook/route.ts:242`

---

## The 21 high findings — one-line summaries, grouped by theme

### A. Concurrency, dedup & billing integrity
- **[scan-pipeline #1]** No in-flight de-duplication — cache fills only *after* the full LLM scan, so concurrent same-commit requests each pay a full ingest + LLM completion. `scan/stream/route.ts:85`
- **[org-scan #2]** Upfront credit slice not enforced at debit time — a swallowed atomic-debit failure lets concurrent batches over-scan past the paid balance for free. `org/scan/route.ts:55-63,113-115`
- **[org-scan #3]** Deduped autoscan still consumes a credit — refund only fires for `provider==='mock'`, not for `persisted.deduped`, so an unchanged-commit rescan is billed. `cron/rescan/route.ts:72-99`

### B. Auth, webhook & session integrity
- **[oauth #1]** Callback ignores GitHub's `error`/`error_description` params — a denied/expired auth shows the same generic `error=oauth` as a forged-state CSRF failure (indistinguishable, unactionable). `auth/callback/route.ts:34-47`
- **[oauth #2]** Silent-refresh re-mint failure swallowed during read-only RSC renders — abruptly expires an active user with no signal. `lib/auth.ts:251-259`
- **[gh-app #2]** `fetchPullRequests` GraphQL has no pagination — every PR past 100 is silently dropped, biasing scores on exactly the large, mature repos where it matters. `github/graphql.ts:81`
- **[gh-app #3]** `installation_repositories` handler only processes `removed` — ignores `added` repos and the `selected→all` flip, so watched-set drifts from reality. `app/webhook/route.ts:246`

### C. LLM provider resilience & degradation
- **[llm #1]** LLM timeout is per-`assess()`, not per-scan — primary + retry + `LLM_FALLBACK_PROVIDER` runs ~3× `LLM_TIMEOUT_MS` (~181s) serially, blowing the serverless ceiling before the mock degrade. `scan.ts:228`
- **[llm #3]** claude-cli buffers child stdout/stderr unbounded (`out += d`) — a runaway/looping CLI OOMs the Node process; no `MAX_RECOVERY_BYTES`-style cap. `llm/claude-cli.ts:84,103`
- **[llm #5]** `LLM_PROVIDER=claude-cli`/`bedrock`/`openai` never degrades to mock on missing prerequisites — first real failure is a hard throw out of the picker, no keyless safety net. `llm/index.ts:41-58`

### D. Scoring / maturity math correctness
- **[maturity #1]** Non-finite `snap.coverage` poisons the blend — `clamp()` passes `NaN` through, collapsing *every* dimension score, overall, axes, level, and posture to NaN with no warning. `scoring/engine.ts:65`

### E. Cache staleness / correctness
- **[scan-pipeline #5]** "Don't cache degraded scan" guard reads `report.confidence`, but degradation lives in `snapshot.coverage`; `estimateCoverage` hard-codes 0.95 for small repos — a transient blip gets cached and served full-TTL. `scan/stream/route.ts:116`

### F. Resilient rendering & empty-data UX
- **[org-dash #2]** Overview renders a silent blank body (`if(!rollup) return null`) instead of an empty state when the page's `getOrgRollup` disagrees with the layout's. `org/[slug]/page.tsx:71`
- **[org-dash #7]** "AI champions / 100% AI-active / #1 ★" computed over a denominator of 1 — a solo dev who used Copilot twice reads as a fully AI-native fleet (success theater). `contributors/page.tsx:65-88`
- **[report #1]** Radar chart divides by `n` — an empty `dimensions: []` makes every point `[NaN,NaN]`, collapsing the polygon to nothing with no fallback (component has no self-guard). `report/RadarChart.tsx:16`
- **[report #2]** `currentStored` exact-string ISO timestamp match double-counts the live scan when serialized forms differ by one char — phantom extra trend point contradicting the headline delta. `report/ReportView.tsx:62`

### G. Public-surface input validation
- **[usage #1]** Unbounded `?label=`/`?logo=` on the public badge inflates the SVG with no length cap — response amplification / broken giant badge. `badge/[owner]/[repo]/route.ts:233-241`
- **[usage #7]** Per-IP rate limiter collapses to a single global `"unknown"` bucket when proxy headers are absent — cluster-wide 60/min self-DoS *or* a per-IP bypass. `badge/[owner]/[repo]/route.ts:45-74`

### H. Persistence integrity & DSQL token lifecycle
- **[persistence #1]** `recommendation.updated` audit rows written with `orgId: null` + `actorId: null` — the only reader filters `where:{orgId}`, so backlog-mutation audits are durable but permanently unreadable, and actor attribution is lost. `db/scans-recommendations.ts:97`
- **[persistence #2]** DSQL cold-start trusts a deploy-time IAM token for a full fresh TTL — an already-aged token leaves `tokenIsStale` blind and skips proactive refresh. `db/client.ts:315`
- **[persistence #3]** A failed background token refresh pins a stale client with a far-future `expiresAt` — silences all further proactive refreshes; read-path callers then 500 with no self-heal. `db/client.ts:258`

---

## Triage themes

| Theme | Approx count | Why it's a wave, not isolated fixes |
|---|---:|---|
| A. Concurrency, dedup & billing integrity | 7 | All share one model: work/credits double-execute because guards fill *after* the expensive step or lack run-level locking. Fix the dedup/lock primitive once, apply across cron + scan + persist. |
| B. Auth, webhook & session integrity | 7 | One trust-boundary mental model — confirm ownership, validate provider error params, fail *closed*. Includes the forged-webhook Critical. |
| C. Resilient rendering & empty-data UX | 7 | "What does this render when the data is empty/partial/degenerate?" — error boundaries, empty states, NaN-safe charts, honest denominators. Includes the no-error-boundary Critical. |
| D. LLM provider resilience & degradation | 7 | Timeouts, unbounded buffers, and missing keyless fallback all about graceful degradation of the provider layer. |
| E. Scoring / maturity math correctness | 7 | Trust-boundary NaN, small-sample thresholds, and verbatim-LLM passthrough — correctness of the numbers users act on. |
| F. SSE lifecycle & cache staleness | 8 | Stream controller/heartbeat lifecycle + cache-key/field correctness — one warm mental model of the scan request lifecycle. |
| G. Public-surface input validation & data completeness | 9 | Untrusted path/query params, URL parsing, pagination truncation — all "validate/bound what crosses the public boundary." |
| H. Persistence & DSQL token lifecycle | 6 | Audit visibility + IAM token refresh + query clamps — integrity of the optional DB layer. |

---

## Suggested next-phase split (7 + cleanup waves)

Each wave ≈ 6–7 fixes, one shared mental model, sessionable in isolation.

- **Wave 1 — Concurrency, dedup & billing integrity** (7): org-scan#1 **[C]**, org-scan#2 [H], org-scan#3 [H], scan-pipeline#1 [H], persistence#4 [M], persistence#6 [M], gh-app#5 [M]
- **Wave 2 — Auth, webhook & session integrity** (7): gh-app#1 **[C]**, gh-app#6 [M], gh-app#4 [M], oauth#1 [H], oauth#2 [H], oauth#3 [M], oauth#5 [M]
- **Wave 3 — Resilient rendering & empty-data UX** (7): org-dash#1 **[C]**, org-dash#2 [H], report#1 [H], report#2 [H], org-dash#3 [M], org-dash#6 [M], report#5 [M]
- **Wave 4 — LLM provider resilience & degradation** (7): llm#1 [H], llm#3 [H], llm#5 [H], llm#7 [M], llm#2 [M], llm#4 [M], llm#6 [L]
- **Wave 5 — Scoring / maturity math correctness** (7): maturity#1 [H], org-dash#7 [H], maturity#2 [M], maturity#3 [M], maturity#4 [M], maturity#5 [L], maturity#6 [L]
- **Wave 6 — SSE lifecycle & cache staleness** (8): scan-pipeline#5 [H], scan-pipeline#2 [M], scan-pipeline#6 [M], scan-pipeline#7 [M], scan-pipeline#8 [M], usage#3 [M], report#6 [M], scan-pipeline#3 [L]
- **Wave 7 — Public-surface input validation & data completeness** (8): usage#1 [H], usage#7 [H], gh-app#2 [H], gh-app#3 [H], usage#2 [M], usage#6 [M], scan-pipeline#4 [M], org-scan#5 [M]
- **Wave 8 — Persistence, DSQL & residual polish** (cleanup): persistence#1 [H], persistence#2 [H], persistence#3 [H], persistence#5 [M], persistence#7 [L], oauth#4 [M], oauth#6 [L], oauth#7 [L], org-dash#4 [M], org-dash#5 [L], report#3 [M], report#4 [M], report#7 [L], gh-app#7 [L]

> Recommended order: Waves 1–3 first (they carry the 3 Criticals and the highest-blast-radius Highs). Waves 4–5 harden the scoring core. Waves 6–8 are reliability polish.

---

## How this scan was run

- **Scanner**: `bug-hunter` (🐛 elite systems-failure analyst) from Vibeman's prompt registry (`src/lib/prompts/registry/agents/bug-hunter.ts`, scanType `bug_hunter`).
- **Date**: 2026-06-09. **Project**: ascent (`C:\Users\kazda\kiro\ascent`), Next.js 16.2.6 / React 19.2.4 / TS 5 / Vitest 4 / Prisma 6.
- **Scope**: all 10 contexts across 4 groups; full client + server (no Rust/`src-tauri`). Per-context target 5–8 findings.
- **Method**: one `general-purpose` subagent per context, each given the bug-hunter role prompt + that context's `filePaths`, writing one structured report and replying with terse stats only (orchestrator never read full reports during scanning). 2 waves of 5 parallel subagents.
- **Health baseline (pre-scan)**: `tsc --noEmit` 0 errors · `vitest run` 257/257 passing (37 files) · `eslint` 0 errors, 3 warnings.
- **Verification**: findings counted two ways — sum of `> Total:` headers (70) == count of `**Severity**:` bullets (70). Per-severity split reconciled to the bullets (see Totals note); 5 headers had internally-miscounted breakdowns.
- **One report file per context** lives alongside this INDEX in `docs/harness/bug-hunt-2026-06-09/`.
