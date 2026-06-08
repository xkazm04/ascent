# Org Intelligence — directions for the organization scan

Forward-looking design notes. `ENTERPRISE.md` is the as-built system (watch · bulk-scan ·
dashboard · contributors · autoscan); this doc is **where the org scan goes next**: richer
history, org-level recommendations, contributor patterns, and — the big one — measuring
*how much* and *how systematically* an org actually uses AI, from commit subjects and PRs.

---

## 0. Baseline — what we compute today (so we extend, not duplicate)

**Fetched per repo** (`src/lib/github/source.ts`): metadata, recursive tree, **N recent
commits** (`message`, `authorName`, `authorLogin`, `date`), a handful of key files.

**Derived** (`src/lib/analyze/index.ts`): 9 dimensions, two axes (Adoption / Rigor),
posture, archetype. AI signal today = **co-author trailers + bot logins** in commit
messages (`AI_TRAILER`), conventional-commit fraction, plus the static *presence* of a
PR-template file. `computeContributors` aggregates commits + aiCommits per author.

**Stored** (`src/lib/db`): a `Scan` per run (axes/posture/level/archetype + per-dim scores
+ recommendations), `RepoContributor` rows, `Repository.lastScanAt/nextScanAt`.

**Not touched yet** — the headroom: **Pull Requests, reviews, branch protection,
`/stats/*`, `/search/commits`, and GraphQL batching.** PRs are the single biggest untapped
source for "how systematic is the engineering process around AI."

---

## A. History & progress tracking

> Today: org trend = avg overall per day; per-repo scan history exists.

| # | Direction | Signal / mechanic | Cost |
|---|---|---|---|
| **A1** | **Movers board** — improving vs regressing repos | Δ overall & Δ axis between a repo's two latest scans; rank gainers/losers | stored data, query-only |
| **A2** | **Regression diffs & flags** | per-dimension delta scan-to-scan; flag level drops / dimension craters; amber chips on dashboard | stored, query-only |
| **A3** | **Period comparison** ("this month vs last") | org snapshot at date T vs T-Δ: avg/posture-mix/dim-averages diff | stored, query-only |
| **A4** | **Goals & milestones** | set a target posture/score per org; progress bar; toast when a repo crosses a threshold | small schema add (Goal) |
| **A5** | **Per-dimension org trend small-multiples** | aggregate the existing repo `DimensionTrends` to org level | reuse component |

A1–A3 + A5 are essentially free (all data is already persisted) and immediately turn the
dashboard from "current state" into "tracking progress." **Highest value-to-cost.**

---

## B. Org-level recommendations ("propose adjustments")

> Today: per-repo roadmap, archetype-aware. Missing: a *fleet* view of what to fix.

| # | Direction | Mechanic |
|---|---|---|
| **B1** | **Fleet recommendation rollup** | aggregate every repo's open recs → group by dimension/title → rank by **frequency × weighted impact** → "highest-leverage org moves" |
| **B2** | **Initiatives / playbooks** | turn the rollup into actions scoped to the repos they hit: *"Add AGENTS.md to the 8 repos missing it → est. org Adoption +9"* |
| **B3** | **What-if simulator** | recompute org averages assuming a fix lands on a selected repo set ("+eval harness on these 5 → Rigor 47→55") |
| **B4** | **Benchmarking** | percentile vs the growing **public-scan corpus** (the `public` org) or a declared peer set — *"your D8 is bottom-quartile"* |
| **B5** | **Systemic-gap targeting** | spotlight the lowest org-average dimension and the laggard repos dragging it |

All derived from stored scans/recs — needs an **org-rec engine** (`getOrgRecommendations`)
but no new GitHub calls.

---

## C. Contributor involvement & patterns

> Today: `RepoContributor` (login, commits, aiCommits per repo) + a top-N org table.

| # | Direction | Signal | New data? |
|---|---|---|---|
| **C1** | **Involvement map** | contributor × repo matrix — breadth (how many repos) vs depth (commits); active vs dormant by recency | have it |
| **C2** | **AI-native profile** | per-person AI-commit share + **trend over time** + by tool | needs time-bucketed commits |
| **C3** | **Champions & spread** | who *introduces* AI artifacts (CLAUDE.md, evals, prompt libs) across repos = culture carriers | commit-path attribution |
| **C4** | **Concentration / bus factor** | top-author commit share per repo (risk); single-maintainer repos | have it |
| **C5** | **Onboarding ramp** | do newer contributors adopt AI faster? first-commit-date cohorts | time-bucketed commits |
| **C6 ✅** | **Team rollups** — *shipped* | CODEOWNERS → team-level Adoption×Rigor, gaps, movers, AI-knowledge + suggested pairing (`getOrgTeamRollup`, `/org/[slug]/teams`). GitHub Teams (GraphQL) attribution still pending. | parse CODEOWNERS at scan time (`RepoTeam`) |

`/stats/contributors` (one cached call/repo → weekly commit buckets per author) makes C2/C5
cheap. `/stats/*` is the efficiency win here.

---

## D. "How much" & "how systematic" — deep commit + PR analysis  ⟵ the meatiest

This is where **Adoption × Rigor** gets real teeth. *How much* = volume/breadth of AI use;
*how systematic* = governance, guardrails, consistency across repos & time.

### D.1 Commit-subject intelligence (extend what exists)
- **AI-tool taxonomy** — not just "AI present" but *which*: Claude Code, Copilot, Cursor,
  Devin, Codex, Gemini, Aider… via co-author trailers + tool footers ("🤖 Generated with…").
  Count by tool / author / repo → an org "AI toolchain" view.
- **Message quality** — conventional-commit adherence %, body presence, issue refs, length
  distribution (AI-assisted commits trend more structured).
- **Cadence & size** — commit frequency, burst patterns, diff size (needs commit detail/stats).
- **Bot vs human** — separate dependabot/renovate from AI-pair-programming so "adoption"
  isn't inflated by automation.

### D.2 PR intelligence (NEW data source — the big unlock)
One **GraphQL** query per repo pulls a page of PRs with everything attached:
`title, body, author{login,__typename}, createdAt, mergedAt, additions, deletions,
changedFiles, labels, reviews(states+count), comments(count)`.

- **Adoption (how much):** % PRs with AI markers (auto-filled tool templates, "generated
  by", co-author), **bot/agent-authored PRs** (Copilot/Devin open PRs → `author.__typename`),
  AI labels.
- **Rigor (how systematic):** review coverage (% merged *with* approval), reviewers/PR,
  time-to-first-review, time-to-merge, **PR size health** (small PRs = good), CI checks
  green before merge, **revert rate**, PR-template completion (not just presence).
- **Governance:** branch protection (`require review` / `require checks`) via REST →
  flags the "merged straight to main, no review" anti-pattern.

These feed **D7** (commit/PR signals), **D8** (AI process & harness), and both axes. The
key reframe: *systematic* ≠ *frequent* — an org with 90% AI commits but zero reviews is
**ungoverned**, not **ai-native**. PR data is what separates those postures.

### D.3 Efficiency (the user's "analyze efficiently") — cross-cutting
- **GraphQL batching** — one query for PRs+reviews+labels+stats instead of N REST round-trips.
  Essential once we mass-scan fleets. (`src/lib/github/graphql.ts`, new.)
- **`/stats/contributors` + `/stats/commit_activity`** — cached weekly aggregates, one call each.
- **`/search/commits?q=co-authored-by:claude+repo:…`** — quantify AI commits across *full*
  history cheaply (rate-limited 30/min → use sparingly, cache hard).
- **Incremental scans** — fetch only commits/PRs `since lastScanAt`; ETag/conditional
  requests. Makes autoscans cheap and ties into the existing schedule.
- **Transparent sampling** — if we cap (top-N PRs, recent window), `log()`/warn what was
  sampled so scores never silently over-claim coverage.

---

## Proposed build sequence (F-series)

Ordered by value-to-cost; F3 is the data backbone the deepest features depend on.

| F | Slice | Builds on | Cost |
|---|---|---|---|
| **F1** | **History intelligence** — movers board, regression diffs, period compare, org dim-trends (A1–A3, A5) | stored scans | low — query+UI |
| **F1 v1 ✅** | **Shipped** — `getOrgMovers` (per-repo Δ between the two latest scans: overall/adoption/rigor + level change + sinceDays) → dashboard "Top gainers / Regressions" panels. Verified: next.js 60→65 (L3→L4), vercel L3→L4. (Trajectory demo uses backdated weekly snapshots; live history accrues via autoscans.) | stored scans | low |
| **F2** | **Org recommendations** — fleet rollup + highest-leverage moves + systemic-gap (B1, B2, B5) | stored recs | low — derived |
| **F2 v1 ✅** | **Shipped** — `getOrgRecommendations` aggregates open recs across latest scans, groups by dimId+title, ranks by `repoCount × impactWeight × (1+dimWeight)` → dashboard "Highest-leverage moves". Verified on Vercel: D8 "Establish an AI process & harness" affects **18/20 repos** (the systemic gap), D4 agent-in-loop 17, D1 guidance 15. | stored recs | low |
| **F3** | **PR + stats ingestion via GraphQL** + incremental fetch (D.2 data, D.3 efficiency) | new source layer | medium — the backbone |
| **F3 v1 ✅** | **Shipped** — `src/lib/github/graphql.ts` (`fetchPullRequests`, one batched query) + `src/lib/analyze/pulls.ts` (`summarizePullRequests` → `PrStats`). Wired into `scanRepository` (runs in parallel with the LLM, token-gated, graceful skip), persisted as `Scan.prStats` (JSON), surfaced as a **"Pull request signals" panel** on the report and a **fleet aggregate** on `/org/[slug]` (`getOrgPrSignals`). Verified on Vercel's 20 repos: 68% review coverage, 80% merge rate, 13.6h typical time-to-merge, tools = Claude/Cursor/Copilot/Codex. | new source layer | medium |
| **F3+ deepen ✅** | **Shipped — branch governance + commit activity.** `src/lib/github/governance.ts`: `fetchBranchGovernance` (branch `protected` flag + the read-only **rulesets API** → requires-PR / required-approvals / code-owner / status-checks / signatures / linear-history / ruleCount) and `fetchCommitActivity` (last 12 weekly commit totals; `/stats` 202-on-cold-cache → one retry, warm+backfill for the demo). `applyGovernanceSignals` folds governance into **D6** (required reviews), **D3** (required checks), **D8** (branch protected/signatures) — additive rigor. Persisted as `Scan.governance` + `Scan.commitActivity`. Org aggregates `getOrgGovernance` (% protect-main / require-review / require-checks / signed + risk-first per-repo table) and `getOrgActivity` (fleet weekly commit trend, **real**). **Deferred:** `/stats/contributors` per-person time-series, incremental `since lastScanAt` + ETags. | F3 | medium |
| **Onboarding ✅** | `/onboarding` (`OnboardingFlow.tsx`): pick an org → `GET /api/org/repos` (shared `listOrgRepos`) → multi-select **≤10** (cap enforced) → **one-shot scan** via `POST /api/org/import {repos}` (SSE) → "View cross-repo analysis →". Header CTA "Get started". | — | low |
| **Cross-repo gap analysis ✅** | `getOrgGapAnalysis` → Overview **"Where the gaps live"**: **common organization gaps** (weak in ≥50% of repos → fix once, links to a Practice exemplar) vs **repo-specific outliers** (a repo lagging the org avg on a dimension the rest handle). Vercel: common = Agentic 18/20 · AI-Process 14/20 · Docs 11/20. | stored scans | low |
| **UX hierarchy ✅** | Org experience refactored into a **nested layout + tab bar** (`org/[slug]/layout.tsx` + `OrgNav`): persistent org header (name · maturity chip · Scan-all) and centralized DB/auth/empty guards, with four tabs — **Overview** (tiles · goal · posture · trend · movers · leverage), **Repositories** (leaderboard · heatmap), **Contributors** (involvement · champions · bus-factor), **Delivery** (PR signals · branch governance · commit activity). Shared primitives in `components/org/ui.tsx`. | — | — |
| **F4** | **Systematic-use scoring** — tool taxonomy, PR review/size/governance signals into D7/D8 + axes (D.1, D.2) | F3 | medium |
| **F4 v1 ✅** | **Shipped** — `applyPrSignals` (in `analyze/pulls.ts`) folds PR signals into the deterministic dimension scores *before* the LLM blend, so axes/posture reflect PR reality: **D6 (Rigor)** = base tooling blended w/ review coverage + small-PR + low-revert (bidirectional); **D7 (Adoption)** = additive AI-in-PR boost + tool taxonomy; **D8 (Rigor)** = new `aiGovernedRate` (are AI PRs reviewed?) — governed lifts, ungoverned drags, gated on ≥3 AI PRs. Review coverage made **bot-fair** (human-authored merged PRs only). Wired into `scanRepository` (PR fetch parallel to snapshot, awaited before analysis). Evidence strings surface on each dimension. **Proven on Vercel:** `sandbox` D6 +23 (100% review), `turborepo` D6 −15 (8% review, shown explicitly); `shop` = 70% AI PRs but 46% reviewed → "AI work largely unreviewed" → D8 31 (the *ungoverned* story). | F3 | medium |
| **F5** | **Contributor intelligence** — involvement map, champions, bus factor, team rollups (C1–C6) | F3 (`/stats`) | medium |
| **F5 v1 ✅** | **Shipped** — `getContributorInsights` + `/org/[slug]/contributors`: involvement table (commits × repo breadth × AI-share), AI-champions ranking, per-repo concentration & bus-factor with key-person flags, summary tiles. All from stored `RepoContributor` — no new GitHub calls. **Deferred to F3:** per-person trend over time (C2), "who introduced CLAUDE.md/evals" attribution (C3), onboarding ramp (C5). **C6 (team rollups) now shipped** — see below. | stored data | low |
| **C6 ✅** | **Shipped** — `getOrgTeamRollup`/`rollupTeams` + `/org/[slug]/teams`: per-team (CODEOWNERS) Adoption×Rigor, per-dimension strongest/weakest, merged human AI-commit knowledge + champions, since-last-scan movers, the org's AI-knowledge leader, and one suggested strong→weak cross-team pairing. Attribution parsed from CODEOWNERS at scan time and persisted as `RepoTeam` (latest scan authoritative); pure aggregation is unit-tested. **Deferred:** GitHub Teams (GraphQL) as a second attribution source. | `RepoTeam` (CODEOWNERS) | low |
| **F6** | **Goals · benchmarks · alerts** — targets, what-if, percentile, regression notifications (A4, B3, B4) | F1, F2 | low–medium |
| **F6 v1 ✅** | **Shipped** — dashboard "Goal · reach AI-Native" (adoption/rigor progress bars vs the 50 posture threshold, exported `POSTURE_THRESHOLD`) + "Standing" panel (`getOrgBenchmark`: org avg-overall percentile vs the Ascent corpus of other orgs' repos + corpus averages) + in-dashboard regression alert chip (from F1 movers). **Deferred:** user-set/persisted goals, what-if simulator, email/push alerts. | stored scans | low |

**Dependencies:** F1 & F2 are independent quick wins on data we already have. **F3 unlocks
F4 and enriches F5.** F6 layers on F1/F2.

**Recommended start:** F1 (makes "tracking progress" real on the existing dashboard, zero new
GitHub cost), then F3→F4 (the differentiated "how systematic is their AI use" insight the
pitch hangs on).
