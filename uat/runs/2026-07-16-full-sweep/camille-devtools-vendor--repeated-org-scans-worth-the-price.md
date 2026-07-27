# L1 report — Camille (DevEx-analytics vendor PMM) × "Repeated org scans worth the price"

cert_level: L1 (theoretical, static, code-grounded) · date: 2026-07-16

---

## 1. Surface model (import-chain-traced, file:line cited)

### Reachability check
Camille runs the bypass path (`ASCENT_AUTH_BYPASS=1`, `src/lib/access.ts`) as a synthetic owner `Membership` on a seeded org, so every route in her binding (`uat/characters/camille-devtools-vendor.md:4`: `/org/[slug]` Overview/Trajectory/movers, `/org/[slug]/executive`, `/trends`, `/usage`, `/pricing`, the `.ai` standard adoption loop) is nav-reachable — no plan gate blocks navigation itself. She's doing a competitive teardown, not transacting, so she'd also roam the org side-nav past her literal binding string; `Skills` is a first-class nav item (`src/components/org/shared/OrgNav.tsx:105`) and is the concrete surface behind "the .ai standard adoption loop" phrase in her JTBD, so I fold `/org/[slug]/skills` into her reachable set. **Reachable set = binding ∪ org-nav-linked surfaces she'd naturally click chasing "moat."**

### A. `/org/[slug]` — Overview (repos×time)
- `src/app/org/[slug]/page.tsx:1-134` fetches `getOrgRollup` + `getOrgRepoHistories`, derives `buildTrajectories` (`src/components/org/overview/repoTrajectory.ts:52-86`), renders `RepoCategoryRollup` (per-repo `deltaWindow`/`deltaLast`, muted via `fmtDelta`/`toneFor` when `isWithinNoise`, `src/components/ui/format.ts:33-44`) and `RepoDimensionHeatmap` (snapshot, no delta column). The old page-level org-wide `Trajectory` card is gone from this page (confirmed absent, page.tsx imports).
- **Noise band is a real, shared, tested primitive**: `SCORE_NOISE_BAND = 2` (`src/lib/maturity/noise.ts:16`), documented against a measured live re-scan of the *same commit* moving 0 pts overall / ±1 per-dimension (noise.ts:1-13) — this is the code-level answer to her #1 pet peeve (a mover that's really the LLM breathing in guardband). `isWithinNoise`/`classifyDelta` feed both the Overview rows and the Executive movers, so the same commit can't paint green on one page and muted on another.
- `deltaCrossesEngine` (`repoTrajectory.ts:39-41`, `RepoCategoryRollup.tsx:118-133`) separately mutes a mock→live engine-transition delta — a second, independent honesty layer.

### B. `/org/[slug]/executive` — trajectory, provenance, benchmark
- `src/app/org/[slug]/executive/page.tsx:38` → `buildExecBriefing` (`src/lib/org/briefing.ts:154-295`).
- **Trajectory / R² / anti-plateau**: `forecastHeadline()` (`src/lib/maturity/forecast.ts:332-345`) + `forecastConfidenceNote(briefing.forecastConfidence)` (briefing.ts:36-39, page.tsx:159-161) renders e.g. *"On track to L4 · Managed in ~8 weeks (≈date) · trend confidence 62%"*, or `"· noisy"` under 50%. `forecastConfidence` is **suppressed to null** when the OLS fit is `lowData` (briefing.ts:243-248, forecast.ts:58-63) instead of a fake 100% off a 2-point series — directly satisfies her stable-fleet-floor criterion's demand for honesty over a flat plateau being dressed up.
- **Movement**: top gainers/regressers (page.tsx:214-226, `briefingShared.tsx:50-89` `MoveRow`) — repo, level-from→to, signed delta, same noise/engine muting. **No per-repo R²/fit-quality**, only the binary mock-vs-live flag (confirmed in `repoTrajectory.ts:52-86` — no `fitQuality` field there, unlike the org-level `forecastTrajectory` at `forecast.ts:119-182`). So the org-level move she'd cite to a VP carries a confidence number; a repo-level move in the same list does not.
- **Fleet dimension provenance**: `PriorPeriodGrid` (`briefingShared.tsx:107-152`) — top-6 fleet dimension deltas vs prior equal-length window (briefing.ts:214-224). Answers "what actually changed, fleet-wide, since last period" — the anti-plateau, new-actioned-decision core of her Recurring-value criterion.
- **THE MOAT — cross-org/cohort percentile**: `getOrgBenchmark()` (`src/lib/db/org-insights.ts:590-689`) ranks this org's mean overall/adoption score against **other orgs'** means in the corpus (`orgMeans`, org-vs-org not org-vs-repo, insights.ts:645-659 — an explicit bug-fix comment shows this was previously biased), plus a same-language peer cohort (`COHORT_MIN = 5` peer orgs, insights.ts:571). Rendered on the Executive page: `benchmark.percentile` as the headline corpus percentile (`executive/page.tsx:104-106`) and `benchmark.cohort.overallPercentile`/`adoptionPercentile` as "Peer cohort Nth percentile vs M {lang} repos … Nth on AI adoption" (`executive/page.tsx:135-139`). This is **exactly** the asset Camille's criterion #3 names — a single-repo competitor structurally cannot produce this (it requires Ascent's own cross-tenant scan corpus). It is honesty-gated too: `percentileOf()` returns `null` below `CORPUS_MIN`/`COHORT_MIN` = 5 peer **orgs** (insights.ts:583-585, 570-579) rather than a confidently-wrong 0th/100th percentile off a thin sample.
- **"The move to make next"** (`OrgLeverageMoves.tsx:22-76`): prescriptive, explicitly labeled "current state · not period-scoped" (line 29) — not a diagnosis of *this period's* movement.
- **Copy-for-LLM** (page.tsx:85, briefing.ts:302-385): serializes the whole briefing (including benchmark + confidence) to a paste-ready markdown "Ask."

### C. `/org/[slug]/skills` — the .ai standard adoption loop
- `src/app/org/[slug]/skills/page.tsx` → `SkillsPanel` (`src/components/org/skills/SkillsPanel.tsx:1-36`) — a browsable catalog of reusable `.ai` skills per org, each row tracking `SkillAdoption` (adoption count + downloads, `SkillsPanel.tsx:16,22`, `OrgTable` columns "Name · Category · Adoptions · Downloads"). This is the concrete mechanism behind her "steal the loop" JTBD line — a network-effect-flavored asset (skills get more valuable/legible the more repos adopt them within an org) that, like the benchmark, is not a single-repo-scan feature; it's built from Ascent's own recurring-scan history plus org-wide skill propagation tracking.
- Gated: authoring is Team+ (`planAllowed` prop, SkillsPanel.tsx:26), but **viewing the adoption-count catalog itself is not obviously plan-gated** in this file — worth an L2 check of what a Free/Pro-tier viewer actually sees vs. a Team viewer.

### D. `/usage` — cost↔value legibility
- `src/app/usage/page.tsx` → `UsageDashboard`. Credits balance (`usageDashboard.tsx:77-91`), `AllotmentPanel` (`src/app/usage/AllotmentPanel.tsx:29-37`) computes `monthlyBurn` normalized to 30d vs `includedCredits`, `fit: "under"|"ok"|"over"`, renders "You're at ~N% of your allotment" copy with an "over" ceiling warning at 90%+ (AllotmentPanel.tsx:58-63).
- **Subscription $ is not shown on `/usage`** — only credits/burn/estimated LLM cost. The one in-app hop to `/pricing` (`CreditsControl`'s "See plans →", `src/components/org/shared/CreditsControl.tsx:250-257`) renders **only when `!buyEnabled && !grantsEnabled`** — and the pinned local dev/UAT config sets `ASCENT_ALLOW_CREDIT_GRANTS=1` (env.md:35), which suppresses exactly this link (same gap prior L1 runs on this journey found for Lena/Gabriel).

### E. `/pricing` — the renewal-math anchor
- `src/app/pricing/page.tsx:40-41,79-83` — `planPriceLabel("team").amount` reads `PLAN_FEATURES.team.monthlyPrice` (`src/lib/plans.ts:57-68`) = real numeric Pro ($10)/Team ($20) prices, single-sourced with the entitlement gate so copy can't drift from what's charged. Enterprise stays `"Custom"` (`plans.ts:90`). Public, unauthenticated, always reachable regardless of her org/plan state.
- `retentionCutoff()` (`plans.ts:189-`) is a real read-floor consumed by `src/lib/db/org-rollup.ts:396-397` — Team's 365-day retention window genuinely bounds how far back the trajectory/benchmark can look, not decorative copy. Directly matters to her "history-required trajectory GPS" moat claim: the moat is real only as far as the tier's retention window reaches.

### F. Cadence / alerts (adjacent, reachable from Overview)
- `src/lib/alerts.ts:1-121` `detectRegression()` fires on level demotion / `overallDrop ≥ 5` / `dimensionDrop ≥ 15` — set explicitly above the measured noise band. `digestHasSignal()` (alerts.ts:54-64) suppresses the periodic digest when nothing crossed threshold — a flat cycle stays silent rather than manufacturing a "your fleet changed!" nudge, which is the direct code-level defense against her "re-dated number" churn vector for the *push* channel (not just the pull dashboard).

---

## 2. In-character walkthrough (thought experiment over the model above)

**Scored acceptance criteria, walked identically each run:**

1. **Recurring-value (anti-plateau)** — PASS. The repos×time Overview plus Executive's "vs previous period" + "Movement this period" give a genuine new-actioned-decision surface every cycle — not a re-render. The `digestHasSignal` gate on the push channel is the detail I'd have missed if I only looked at the pull dashboard: it means their *alert* product doesn't cry wolf on a flat week either, which is the harder discipline (a dashboard staying honest is easy; a notification system staying quiet when it has nothing to say is the actual test).
2. **Noise-vs-signal trust** — PASS, and unusually well-evidenced for a competitor's product. `SCORE_NOISE_BAND` isn't a marketing claim, it's a pure function backed by a code comment citing an actual measured re-scan (0pts overall / ±1 dimension, same commit) — that's the kind of self-instrumentation I'd expect from a mature vendor, not a Series-whatever move-fast shop. And it reaches the surface where the move is *shown* (Overview rows + Executive movers), not buried in a methodology page nobody reads. The one seam: `forecastConfidence`/R² lives at the **org-level** trajectory only — a repo-level "mover" in the Executive movement list has no fit-quality number next to it, only a binary mock-vs-live flag. If I cite a specific repo's +8 to a prospect as "look how confidently they show this," I'd have to check whether that repo happens to be the trajectory headline (which has R²) or one of the movers list entries (which doesn't).
3. **Non-replicable moat** — PASS, and this is the one that actually changes my competitive map. The cross-org percentile (`getOrgBenchmark`) is a real moat: it requires Ascent's own cross-tenant scan corpus, ranks org-mean-vs-org-mean (they clearly caught and fixed the population-mismatch bug themselves — that comment at insights.ts:645 is the kind of self-critical engineering note that makes me trust the number more, not less), and is honesty-gated below 5 peer orgs so a thin corpus can't fake a confident rank. A single-repo scanner literally cannot produce "62nd percentile among same-language peer orgs" — that requires the install base. Layer two: the `.ai/` Skills catalog with per-skill adoption counts is a second moat candidate — it's a network-effect loop (skills compound in value the more of an org's repos adopt them), and it's the concrete mechanism behind what I came here suspecting was vaporware "AI-adoption flywheel" positioning. Layer three: retention-gated trajectory history (365d Team) means the GPS moat is *tier-real*, not universal — a downgraded org loses lookback, which is itself a retention lever I'd note for my own pricing memo.
4. **Price-legibility (renewal math)** — CONDITIONAL. The $ figure is real and can't drift (`plans.ts` single-sources `/pricing` and the entitlement gate) — genuinely better than "contact us" vaporware pricing I've seen from two other competitors this cycle. But it's not co-located with the burn number: `/usage` computes the exact "you're at ~N% of your allotment" line and then stops short of the dollar figure, and the one in-app bridge (`CreditsControl`'s "See plans →") is coded to disappear under the exact dev config this journey is seeded with. A customer doing renewal math has to open a second tab and match tier names by hand.
5. **Stable-fleet floor** — PASS. On a low-velocity repo, the `isWithinNoise`-muted "≈" delta IS the signal ("nothing moved, and we're not going to pretend otherwise") — that's actually the harder, more honest thing to ship than a fake sparkle. Combined with the benchmark percentile (which can still drift cycle-to-cycle purely from the *corpus* moving even if this org is dead flat) there's a second axis of "something new" even on a frozen repo: "you're still 62nd percentile, but the corpus average climbed 3pts this quarter" is a legitimately new, actioned read on an unchanged codebase. That's a stickiness mechanic a single-repo competitor structurally cannot offer, because it doesn't have other tenants to move the average.

**Motivation (time-saved / retention framing):** Against her ~3-4hr manual DORA/DevEx quarterly assembly, the Executive tab's copy-paste briefing (trajectory + movement + benchmark + confidence, all pre-composed into a markdown "Ask") plausibly delivers close to her declared ~2-3hr/cycle saving — AND, more importantly for her actual metric, it clears her "≥1 new actioned decision per cycle" bar even on a flat repo, because the benchmark percentile moves independently of this org's own trajectory. That's the detail that would make her revise her churn-prediction model upward for this specific product, not down.

**Senior-quality bar:** The trajectory card (confidence-hedged, honestly-suppressed on thin data) and the benchmark percentile (org-vs-org, corpus-floor-gated) are both artifacts she'd stake her own PMM credibility on citing in a competitive-teardown deck to her VP — "here's a mover I'd trust and a moat I can't clone" is exactly the sentence she needs to write. The one place a senior analyst's fresh look would flag as short of the bar: the repo-level movement list mixes rows that DO carry a trust signal (org-trajectory-adjacent, muted for noise/engine) with the fact that none of them carries the same *fit-quality* number the org-level headline gets — a subtle inconsistency a rigorous reviewer (which she explicitly is) would catch on a close read, even though the muting itself is sound.

---

## 3. Findings

```json
[
  {
    "id": "L1-CAMILLE-01",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "camille-devtools-vendor",
    "cert_level": "L1",
    "type": "trust",
    "severity": "minor",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "med" },
    "dimension": "trust",
    "title": "STRENGTH — cross-org percentile is a genuine, corpus-floor-gated, org-vs-org moat competitors can't replicate",
    "expected": "A non-replicable sticky asset that requires Ascent's own install base, not a single-repo feature.",
    "got": "getOrgBenchmark (src/lib/db/org-insights.ts:590-689) computes org-mean-vs-org-mean percentiles (a self-corrected bug per the insights.ts:645-659 comment) with an explicit CORPUS_MIN/COHORT_MIN=5-peer-org floor before showing a rank (percentileOf, insights.ts:583-585), rendered on the executive page (executive/page.tsx:104-139) as both a whole-corpus and same-language-peer-cohort percentile, including an 'Nth on AI adoption' cohort figure.",
    "evidence": ["src/lib/db/org-insights.ts:570-689", "src/app/org/[slug]/executive/page.tsx:104-139"],
    "code_check": "by-design",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Confirm live that a thin-corpus seed (fewer than 5 peer orgs, which is likely true of most local/UAT seeds that only import one org) correctly renders '—'/null rather than a confidently-wrong percentile, and that a multi-org seed produces a plausible, non-identical percentile per org."
  },
  {
    "id": "L1-CAMILLE-02",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "camille-devtools-vendor",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "minor",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "med" },
    "dimension": "trust",
    "title": "Repo-level movers in the Executive 'Movement this period' list carry no fit-quality/R² — only the org-level trajectory headline does",
    "expected": "The same noise-vs-signal confidence read (R²/trend confidence) she gets on the org-level trajectory should extend to the specific repo she'd cite as 'the mover' in a competitive teardown.",
    "got": "buildTrajectories/repoTrajectory.ts (52-86) computes deltaWindow/deltaLast/deltaCrossesEngine per repo (noise-muted, engine-muted) but has no fitQuality field, unlike forecastTrajectory at the org level (forecast.ts:119-182) which does. MoveRow (briefingShared.tsx:50-89) renders only name/level/delta for each mover, no confidence number.",
    "evidence": ["src/components/org/overview/repoTrajectory.ts:52-86", "src/lib/maturity/forecast.ts:119-182", "src/components/org/executive/briefingShared.tsx:50-89"],
    "code_check": "present-but-missed",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Confirm live whether the muted-noise/muted-engine treatment alone is enough to make a repo-level mover feel trustworthy without an explicit confidence number next to it, or whether a rigorous reviewer still asks 'how sure are you' per-repo."
  },
  {
    "id": "L1-CAMILLE-03",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "camille-devtools-vendor",
    "cert_level": "L1",
    "type": "confusion",
    "severity": "minor",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "low" },
    "dimension": "missing",
    "title": "The one in-app link from /usage's burn number to /pricing's $ figure is hidden in exactly the seeded dev/UAT config",
    "expected": "From /usage (where the allotment-fit read lives), a visible path to the $ figure needed to close her renewal-math criterion.",
    "got": "CreditsControl's 'See plans →' link only renders when !buyEnabled && !grantsEnabled (CreditsControl.tsx:250-257); env.md pins ASCENT_ALLOW_CREDIT_GRANTS=1, which sets grantsEnabled=true and suppresses exactly this link. /usage has no other route to /pricing. (Same gap independently confirmed in the Lena and Gabriel L1 runs on this journey.)",
    "evidence": ["src/components/org/shared/CreditsControl.tsx:250-257", "uat/env.md:35"],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Drive /usage live under the pinned env config; confirm no path to /pricing exists from the credits chip, and note whether AllotmentPanel could carry the $ figure directly."
  },
  {
    "id": "L1-CAMILLE-04",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "camille-devtools-vendor",
    "cert_level": "L1",
    "type": "confusion",
    "severity": "polish",
    "impact": { "frequency": "low", "reachability": "med", "trust_erosion": "low" },
    "dimension": "missing",
    "title": "Skills-catalog (.ai standard adoption loop) plan-gating unclear from the viewing surface — only authoring is explicitly gated",
    "expected": "As a competitor mapping the moat, she'd want to know at which tier the adoption-loop asset actually activates (is it a Free-tier teaser or a Team+ retention lever?).",
    "got": "SkillsPanel.tsx:26 threads a planAllowed prop but it's only referenced for the author form in the file excerpt read; the adoption-count catalog view itself isn't obviously gated in the component signature. Not independently confirmed against the page.tsx server component that supplies planAllowed's value.",
    "evidence": ["src/components/org/skills/SkillsPanel.tsx:18-36", "src/app/org/[slug]/skills/page.tsx"],
    "code_check": "present-but-missed",
    "verdict": "uncertain",
    "resolution": "open",
    "l2_priority": "Check /org/[slug]/skills live at Free vs Team tier; confirm whether the adoption-count catalog view (not just authoring) is gated, and record which tier the moat asset requires to matter competitively."
  }
]
```

## 4. Camille's voice — first-person reaction

"Okay. I came in assuming the recurring read would be a re-dated fleet number with a shinier chart around it — that's the pattern every DevEx dashboard I've competed against eventually falls into. It isn't, mostly.

Start with the thing that actually changes my competitive map: the cross-org percentile. That's not a feature, that's an install-base tax on any competitor who wants to match it — you need the corpus, and they've gated the number below 5 peer orgs instead of confidently telling some poor two-org tenant they're '100th percentile.' That self-correction comment in the benchmark code — fixing an org-mean-vs-repo-distribution bias they'd shipped and caught themselves — is exactly the kind of engineering discipline that makes me believe the rest of the number. Annoyingly, that would retain. I can't clone it without years of scan volume I don't have, and neither can any other single-repo scanner. That's the line in my teardown deck.

Second: the noise band isn't decorative. `SCORE_NOISE_BAND = 2`, backed by an actual measured re-scan citation in the code comment — that's a vendor who instrumented their own wobble instead of hand-waving 'AI is noisy, trust us.' It reaches the surface where the delta is shown, not just a methodology footnote. That directly kills my #1 pet peeve before I could even write it down.

Where it's still soft: the repo-level movers — the ones I'd actually screenshot to say 'look, this specific repo jumped 8 points' — don't carry the same confidence number the org-level trajectory headline gets. Noise-muted and engine-muted, sure, but no R² next to it. If I'm citing a *specific* repo as proof of movement rather than the fleet trend, I'm one level less protected than the trajectory card implies I should be.

And the renewal math still has a seam I've seen in half my own competitors' products: the burn number and the dollar figure live on two different pages, and the one bridge link between them is coded to vanish in exactly the config this whole eval is running under. That's not damning, but it's the kind of thing that shows up in a churn cohort analysis eighteen months from now as 'renewal decision took two extra clicks nobody logged.'

Second moat candidate worth flagging: the `.ai/` skills catalog with adoption counts. If that's genuinely a network-effect loop — skills get stickier the more repos in an org adopt them — that's the flywheel positioning I was suspicious was vapor. It's real code, not a slide. I couldn't fully confirm the tier gating on the *viewing* surface from static read alone, which is exactly the kind of thing I'd want L2 to nail down before I put it in a deck as 'they've built a real adoption loop, here's the tier it activates at.'

Verdict for my VP: this is not a churn-vector product on the recurring axis — the org-percentile and the noise-honesty are things I'd have to answer to, not laugh off. The renewal-math seam and the repo-level confidence gap are real but second-tier; I'd rank them 'watch, don't lead with.' Would I tell a peer? 'Their benchmark percentile is the one thing you can't out-execute without their tenant count — go look at that before you pitch against them.'"
