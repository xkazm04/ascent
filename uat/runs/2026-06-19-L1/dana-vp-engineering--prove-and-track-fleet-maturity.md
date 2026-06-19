# L1 — Dana (VP Engineering) × prove-and-track-fleet-maturity

**Verdict: L1-conditional** — The fleet read is structurally complete and unusually well-grounded (one headline number, a *sourced* trajectory with R², adoption-vs-rigor cleanly separated, and a fully traceable fleet→repo→dimension→evidence drill). It completes the job. But it does **not** hand Dana "the one move as a decision" on-screen — the highest-leverage section is deliberately framed as "inputs to explore… not a to-do list," and the executive Briefing *outsources* the actual recommended actions to an LLM via "Copy briefing for LLM." That's the one major finding she'd hit, and it's exactly her pet peeve. Carries forward to L2.

## Reachable surface set

Resolved against the canonical env (`uat/env.md`), which pins **both** `ASCENT_AUTH_BYPASS=1` **and** `ASCENT_OPEN_ORG_DASHBOARDS=1` in `.env.local`, DB on (PGlite), seeded org slug **`vercel`** (`node scripts/seed-org.mjs vercel 12`).

Gating trace for `/org/[slug]` (`src/app/org/[slug]/layout.tsx`):
- `isDbConfigured()` true → passes the DB gate (layout.tsx:42).
- `authGateEnabled()` = `supabaseAuthConfigured() && !authBypassEnabled()` → **false** under bypass (`src/lib/access.ts:44-46`), so the Supabase login wall (layout.tsx:52) is skipped.
- `isAuthConfigured()` false (no custom OAuth) → session gate (layout.tsx:61) skipped.
- `canReadOrg("vercel")` (`src/lib/authz.ts:62-70`): not PUBLIC_ORG → `authGateEnabled()` false → `!isAuthConfigured()` true → returns `openOrgDashboardsEnabled()` = **true** (because `ASCENT_OPEN_ORG_DASHBOARDS=1`, `authz.ts:105-108`). **Passes.**
- `getViewer()` returns synthetic `DEV_VIEWER` (`login:"developer"`, `access.ts:48-62`); on a populated org the layout idempotently seeds it as a real owner `Membership` (layout.tsx:142-144) — second visit shows the owner role chip.

> Reachability nuance (strength, not blocker): under **bare** `ASCENT_AUTH_BYPASS=1` *without* `ASCENT_OPEN_ORG_DASHBOARDS=1`, `canReadOrg` returns false and the org dashboard is **blocked** — the IDOR guard (authz.ts:56-70) refuses per-tenant reads on a DB-on/auth-off box unless the deployment *explicitly* opts in. The UAT env sets both, so Dana is in.

**Dana can open:** `/org/vercel` (overview), `/org/vercel/executive` (Briefing), `/org/vercel/repositories` (drill target), `/org/vercel/teams`, `/org/vercel/security|adoption|delivery`, `/report?repo=…` + `/report/[owner]/[repo]` (per-repo evidence), `/usage` (defaults to PUBLIC_ORG; per-org metering visible for `?org=vercel` under bypass), `/pricing` (fully public). All within her `maps_to`. The Briefing *page* is open to her; only PDF white-label/share are owner-gated (executive/page.tsx:42-46) — and she IS owner under the seed.

## Surface model notes (affordance → backing `file:line`)

**Headline read (overview, `src/app/org/[slug]/page.tsx`)**
- Four tiles: **Org maturity** `rollup.avgOverall` + `level.id · level.name` (page.tsx:187-195), **AI Adoption** `avgAdoption` (196-203), **Engineering Rigor** `avgRigor` (204-211), **Repos scanned** `scannedCount/repoCount` (212). Tile = brand `Stat` with value+level+delta+goal-pace (`components/org/ui.tsx:42-67`). Adoption and rigor are **separate tiles with separate deltas/goals** — not conflated.
- `avgAdoption`/`avgRigor` are axis roll-ups computed per repo via `axisScore("adoption"|"rigor", …)` (`src/lib/scoring/engine.ts:168-169`) and averaged across the fleet (`org-rollup.ts:246-247`). Posture quadrant (AI-Native / Fast & Ungoverned / Solid but Manual / Getting Started) = `postureFor(adoption, rigor)` (engine.ts:182), counted in `postureCounts` and rendered as a distribution meter (page.tsx:234-248, labels `ui.tsx:13-19`).

**Trajectory / ETA (`components/org/Trajectory.tsx` ← `src/lib/maturity/forecast.ts`)**
- OLS fit over per-day fleet trend (`forecast.ts:103-117`); anchors projection on the **latest actual value** (forecast.ts:126), caps ETA at 365 days (forecast.ts:67,171), surfaces **R² as "trend confidence N%"** with a "· noisy" tag below 50% (Trajectory.tsx:92-97). ETA shows kind/level/days/date (Trajectory.tsx:79-86). This directly satisfies her "ETA shows its basis" bar — the basis (slope, fit quality, horizon) is on-screen.
- Period-in-review sentence uses **cohort-matched deltas** — movement measured only over repos on both sides of the window; onboarding reported separately as growth, not fake score movement (`computeWindowDeltas`, `org-rollup.ts:130-145`; banner `components/org/PeriodSummary.tsx:28-68`).

**The "one move" (`components/org/OrgLeverageMoves.tsx` ← `getOrgRecommendations`, `org-insights.ts:157-203`)**
- Dedupes identical per-repo recommendations into systemic moves, ranks by `leverage = repoCount × IMPACT_WEIGHT × (1 + dimWeight)` (org-insights.ts:198-201), shows top 5 with dimension tag, impact, affected-repo list, leverage score.
- **Framed against a decision:** section title "Gaps to explore across the fleet"; description "inputs to explore and apply systematically, **not a to-do list**" (OrgLeverageMoves.tsx:13-15). The CTA is "Browse all repositories," not "open this move's evidence."
- Recommendation *titles/rationales* originate from a deterministic per-dimension catalog parameterized by the real signal score (`src/lib/scoring/recommendations.ts:20-160`, e.g. `"… scored ${signalScore}/100. ${rationale}"`); on a `claude-cli` scan the LLM roadmap is preferred and this is the fallback (engine.ts:171-173).

**Drill to cited evidence (the trust audit — CONFIRMED traceable end-to-end)**
- Overview → `/org/[slug]/repositories` (OrgNav.tsx:21) → `RepoLeaderboard.tsx:129` links `/report?repo=<fullName>` → `ReportView` → `ScoringTab.tsx:62,119` → **`DimensionCard.tsx`**: each dimension renders an **evidence array** (concrete detector signals, `engine.ts:40-42`) and a **`ProvenanceTrack`** micro-viz showing signal score, LLM score, the **±`LLM_GUARDBAND`** band, and the blended result (DimensionCard.tsx:103). Blend math: `score = effectiveBlend·guarded + (1−effectiveBlend)·signalScore`, guardbanded to ±band, coverage-weighted (engine.ts:96-102); `signalScore`/`llmScore`/`score` all persisted per dimension. `ScoreWaterfall` decomposes the headline into per-dimension weighted contributions that sum to the overall (engine.ts:396-419). PR signals (review coverage, merge rate, TTM/TTR, revert rate) in `PrSignalsPanel.tsx:42-67`.
- Gap analysis separates **common org gaps** (weak in ≥50% of repos) from **repo-specific outliers** with explicit thresholds (`org-insights.ts:698-784`); outliers link to `/report?repo=…` (OrgGapsSection).

**Executive Briefing (`/org/[slug]/executive` ← `src/lib/org/briefing.ts`)**
- Pure assembly over existing aggregates: standing, benchmark/percentile + peer cohort, trajectory headline, vs-previous-period, strengths/weakest dims, movement, goals (briefing.ts:88-198). "Copy briefing for LLM" emits markdown ending in an **Ask** that asks an LLM to "propose the 3 highest-leverage actions" (briefing.ts:259-262) — i.e. the decision is generated *off-platform*, not shown on the Briefing.

## Findings

```json
[
  {
    "id": "L1-DANA-001",
    "journey": "prove-and-track-fleet-maturity",
    "character": "Dana (VP Engineering)",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "major",
    "dimension": "senior-quality",
    "title": "The 'one move' is offered as a ranked exploration list, not a decision — and the Briefing outsources the actual recommended actions to an external LLM",
    "expected": "The overview names ONE (or two) highest-leverage fleet moves tied to a dimension/team and the cited evidence — a decision Dana can carry to the board ('do THIS, it lifts D-x across these N repos, +M maturity points').",
    "got": "OrgLeverageMoves ranks up to 5 systemic gaps by a real leverage formula but is explicitly titled 'Gaps to explore across the fleet' and captioned 'inputs to explore… not a to-do list'; its CTA is 'Browse all repositories.' The executive Briefing assembles standing but its recommended-actions step is a 'Copy briefing for LLM' payload whose Ask defers '3 highest-leverage actions' to whatever LLM Dana pastes into — the product won't state the move itself.",
    "evidence": [
      "src/components/org/OrgLeverageMoves.tsx:13-15",
      "src/components/org/OrgLeverageMoves.tsx:42-44",
      "src/lib/db/org-insights.ts:189-201",
      "src/lib/org/briefing.ts:259-262",
      "src/app/org/[slug]/executive/page.tsx:65"
    ],
    "code_check": "present-but-missed",
    "verdict": "confirmed",
    "l2_priority": "Confirm live whether the #1 ranked leverage move (and the LLM-generated Briefing actions on a claude-cli scan) reads as 'a decision' a VP would put on a slide, or as a hedged backlog she'd still have to synthesize herself. Note the ranking math is present and sound — the gap is framing/decisiveness, not capability.",
    "suggested_acceptance": "The overview (or Briefing) surfaces a single named #1 move with its projected fleet-maturity gain and the specific dimension/repos it lifts, on-screen, without requiring a copy-to-LLM round trip."
  },
  {
    "id": "L1-DANA-002",
    "journey": "prove-and-track-fleet-maturity",
    "character": "Dana (VP Engineering)",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "minor",
    "dimension": "trust",
    "title": "Drill is fleet → repo, not fleet → team; Dana's 'why is the platform team yellow?' question routes through a repo leaderboard she must re-aggregate mentally",
    "expected": "Per her acceptance: drill fleet → TEAM → dimension → cited repo evidence, with levels/posture agreeing at the team layer (she thinks in her ~18 teams / 4 product lines, not in repos).",
    "got": "The headline drill from the overview goes to /repositories (a per-repo leaderboard) and on to /report?repo=… A /teams tab and /segments exist, but the overview's leverage moves, gaps, and movers are repo-keyed (repoCount, repo lists, RepoMove), so the team layer isn't the spine of the drill — she'd partly re-average teams herself, which is her 'rollups that don't actually roll up' peeve.",
    "evidence": [
      "src/components/org/OrgNav.tsx:20-31",
      "src/components/org/OrgLeverageMoves.tsx:31-34",
      "src/lib/db/org-insights.ts:147-154",
      "src/lib/db/org-rollup.ts:48-73",
      "src/app/org/[slug]/page.tsx:288"
    ],
    "code_check": "present-but-missed",
    "verdict": "uncertain",
    "l2_priority": "Open /org/vercel/teams and /segments live: does the team/segment view give a per-team maturity + posture + adoption/rigor that reconciles with the fleet number and drills to its repos' evidence? If yes, this is just a navigation-ordering nit; if the team layer is thin, it's a real reconciliation gap for an 18-team org."
  },
  {
    "id": "L1-DANA-003",
    "journey": "prove-and-track-fleet-maturity",
    "character": "Dana (VP Engineering)",
    "cert_level": "L1",
    "type": "trust",
    "severity": "minor",
    "dimension": "trust",
    "title": "Recommendation prose is a deterministic per-dimension catalog under the keyless/fallback path — risk of generic 'add tests / add CI' on a mock-seeded fleet",
    "expected": "The recommended move is the actual highest-leverage one given THIS fleet's cited evidence, not a generic template a senior would reject.",
    "got": "On a claude-cli scan the LLM roadmap is used; but the default seeder is mock, and the fallback roadmap (recommendations.ts) is a fixed catalog of titles/rationales per dimension, parameterized only with the signal score. The leverage RANKING is evidence-true (repoCount × impact × weight), but the move TEXT on a mock fleet is templated — a skeptical VP may read it as boilerplate.",
    "evidence": [
      "src/lib/scoring/recommendations.ts:20-160",
      "src/lib/scoring/engine.ts:171-173",
      "src/lib/db/org-insights.ts:170-187"
    ],
    "code_check": "by-design",
    "verdict": "confirmed",
    "l2_priority": "Re-seed /org/vercel with --live (claude-cli) and verify the recommendation titles read as specific to the repos' real gaps, not catalog boilerplate — the senior-quality bar lives on the LLM path, so L2 must judge live LLM output, not the mock floor."
  },
  {
    "id": "L1-DANA-004",
    "journey": "prove-and-track-fleet-maturity",
    "character": "Dana (VP Engineering)",
    "cert_level": "L1",
    "type": "trust",
    "severity": "minor",
    "dimension": "trust",
    "title": "Corpus benchmark / percentile is null below 5 repos — a small seeded org shows '—' where Dana expects a 'vs peers' number",
    "expected": "A 'where do we stand vs others' read she can cite, or an honest absence — not a confidently-wrong percentile.",
    "got": "getOrgBenchmark suppresses the headline percentile below CORPUS_MIN=5 and the peer cohort below COHORT_MIN=5 (returns null), rendering '—'/'no corpus yet' on the Briefing. This is the RIGHT call statistically, but on a freshly-seeded single-org local corpus Dana sees no peer comparison at all.",
    "evidence": [
      "src/lib/db/org-insights.ts:510-521",
      "src/lib/db/org-insights.ts:588-595",
      "src/app/org/[slug]/executive/page.tsx:80-95"
    ],
    "code_check": "by-design",
    "verdict": "confirmed",
    "l2_priority": "Confirm whether the seeded corpus has ≥5 other-org repos so a percentile renders; if not, the 'vs peers' criterion can't be evaluated live and the absence should be read as a seed limitation, not a product gap."
  },
  {
    "id": "L1-DANA-S1",
    "journey": "prove-and-track-fleet-maturity",
    "character": "Dana (VP Engineering)",
    "cert_level": "L1",
    "type": "trust",
    "severity": "polish",
    "dimension": "trust",
    "title": "STRENGTH: trajectory/ETA shows its basis — OLS slope, R² 'trend confidence', latest-value anchor, 365-day sanity cap",
    "expected": "An ETA with a defensible basis, not 'you'll reach L4 in Q3' from nowhere.",
    "got": "Trajectory renders Now→projected, weekly rate, ETA(level, days, date), and R² as 'trend confidence N% · noisy' (<50%). The fit is a real OLS over the per-day fleet trend, anchored on the latest actual value, capped at a year. This is exactly the provenance a board-skeptic VP needs to defend a forecast.",
    "evidence": [
      "src/lib/maturity/forecast.ts:82-149",
      "src/lib/maturity/forecast.ts:151-182",
      "src/components/org/Trajectory.tsx:50-98"
    ],
    "code_check": "present-but-missed",
    "verdict": "confirmed"
  },
  {
    "id": "L1-DANA-S2",
    "journey": "prove-and-track-fleet-maturity",
    "character": "Dana (VP Engineering)",
    "cert_level": "L1",
    "type": "trust",
    "severity": "polish",
    "dimension": "trust",
    "title": "STRENGTH: the score reconciles and is glass-box — per-dimension signal/LLM/blended provenance with a ±guardband, a waterfall that sums to the headline, and loud partial-coverage warnings",
    "expected": "Numbers that add up and that she can drill to evidence to defend out loud.",
    "got": "Each dimension exposes signalScore, llmScore, and the blended score with the ±LLM_GUARDBAND visualized; the LLM can nuance but cannot contradict the deterministic signal; overall is a renormalized weighted mean decomposed by a waterfall that sums to the headline; the engine emits explicit warnings when the LLM didn't validate all dims (so the headline can't masquerade as fully AI-validated). Reconciliation is structurally enforced.",
    "evidence": [
      "src/lib/scoring/engine.ts:96-146",
      "src/lib/scoring/engine.ts:396-419",
      "src/components/report/DimensionCard.tsx:103"
    ],
    "code_check": "present-but-missed",
    "verdict": "confirmed"
  },
  {
    "id": "L1-DANA-S3",
    "journey": "prove-and-track-fleet-maturity",
    "character": "Dana (VP Engineering)",
    "cert_level": "L1",
    "type": "trust",
    "severity": "polish",
    "dimension": "trust",
    "title": "STRENGTH: adoption is honestly separated from rigor, and onboarding can't fake fleet movement",
    "expected": "DORA-2025 read: 'everyone uses Copilot' must not masquerade as 'we're AI-native'; period movement must be real.",
    "got": "Adoption (D1/D4/D7) and Rigor are distinct axis roll-ups shown as separate tiles/deltas and as the posture quadrant; period deltas are cohort-matched (only repos on both sides of the window) with onboarding reported separately as growth — so a quarter of onboarding strong/weak repos can't manufacture a climb or a slip.",
    "evidence": [
      "src/lib/scoring/engine.ts:168-169,182",
      "src/lib/db/org-rollup.ts:130-145",
      "src/components/org/PeriodSummary.tsx:28-68"
    ],
    "code_check": "present-but-missed",
    "verdict": "confirmed"
  }
]
```

## Character feedback (first person, in Dana's voice)

Okay — first reaction: this is the first one of these that doesn't insult me. The landing read is right: one maturity number with a level, adoption and rigor split into their own tiles, a posture distribution, and a trajectory. That's the DX-Core-4 shape — a number and a direction, not twelve charts. I can do that in two minutes. Good.

And the trajectory actually *shows its work*. "Trend confidence 64%" with a "noisy" flag under 50%, an ETA with a real date, projected off the last actual value — that's an OLS fit, not a horoscope. A board member asks "based on what?" and I point at the R². I'd defend that. Same with the period banner: it only counts repos that existed on both sides of the window and calls out onboarding separately. Whoever wrote that has been burned by a "fleet slipped 25 points" chart that was really just five new repos — same scar I have. That buys trust fast.

The drill is the part I came to poke at, and it holds. Fleet number → repositories → a repo's report → a dimension that shows the deterministic signal, the LLM's take, the ±25 guardband between them, and the blended result, with a waterfall that sums back to the headline. The LLM can nuance but can't overrule the evidence. That's the difference between Jellyfish-counting-Jira-tickets and something I'd actually stake a slide on. "Says who?" → I can answer.

Two things stop me short of "yes, ship it to the board as-is."

One — and this is the one that matters — it won't *make the call*. The leverage section literally says "inputs to explore… not a to-do list," and the Briefing's idea of recommended actions is a "Copy for LLM" button that asks *me* to paste it into Claude to get the three moves. I didn't come here for homework. I came for "do THIS one thing, it lifts D2 across these nine repos, +M points." The ranking math is sitting right there — repos × impact × weight — so the product *knows* what #1 is. It just won't say it out loud. That's the gap between a dashboard and a decision, and I live on the decision side.

Two — I think in teams, and the spine of the drill is repos. There's a Teams tab, so maybe it reconciles, but the moves and gaps on the overview are repo-keyed. My platform team is my best; if I can't see *the platform team* read strong without re-averaging its repos in my head, I'm back to my spreadsheet for that last mile.

Time-saved: enormous on paper. This is an afternoon, re-pullable next quarter, versus my 4–6-week hand-rolled audit that's stale on delivery. If L2 shows the live claude-cli recommendations are specific (not the templated "agent guidance is thin" boilerplate I saw in the fallback catalog), I adopt it — with the caveat that I'd still write the "so we should do X" sentence myself until the product is willing to.

## l2_priority (carry-forward)

- **Decision vs backlog:** On a live claude-cli–seeded `/org/vercel`, judge whether the #1 leverage move and the LLM-generated Briefing actions read as *a single defensible decision* a VP puts on a slide — or a hedged exploration list she still has to synthesize. (Finding 001 — the major.)
- **Team-layer reconciliation:** Open `/org/vercel/teams` and `/segments`; verify a per-team maturity + posture + adoption/rigor that reconciles with the fleet number and drills to that team's repos' evidence (Dana's fleet→team→evidence path). (Finding 002.)
- **Senior-quality of recommendation prose:** Re-seed `--live` and confirm recommendation titles/rationales are specific to each repo's real gaps, not the deterministic catalog floor. (Finding 003.)
- **Benchmark presence:** Confirm the local corpus has ≥5 other-org repos so the percentile / peer cohort actually renders (else the "vs peers" criterion is unevaluable live). (Finding 004.)
- **Render + latency:** Confirm the overview's stacked collapsible sections, trajectory meter, and provenance micro-viz render correctly and that the live drill to a per-repo report is fast enough that "in minutes" holds.
