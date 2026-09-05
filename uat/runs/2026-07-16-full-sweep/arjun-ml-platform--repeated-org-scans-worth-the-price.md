# L1 report — Arjun (data/ML platform lead) × "Repeated org scans — worth the price?"

cert_level: L1 (theoretical, code-grounded). No browser.

## 1. Surface model (import chain, file:line)

### Reachability (resolved first)
Arjun is on **Team**, `ASCENT_AUTH_BYPASS=1` gives him a synthetic owner Membership on his seeded org (`src/app/org/[slug]/layout.tsx`), so every route in `uat/env.md`'s "Authed product" list is reachable: `/org/[slug]` overview, `/org/[slug]/executive`, `/trends` (single-repo, needs `?repo=`), `/usage`, `/pricing`. No plan/entitlement gate blocks any of these for Team. Reachable surface set = full recurring-value set the journey names.

### Fleet overview — `/org/[slug]` (src/app/org/[slug]/page.tsx:37-134)
- Reads `getOrgRollup` + `getOrgRepoHistories` (page.tsx:65-68), joins into `buildTrajectories` (`src/components/org/overview/repoTrajectory.ts:52-86`).
- Renders **`RepoCategoryRollup`** (src/components/org/overview/RepoCategoryRollup.tsx) grouped by Type/Stack/Level, with per-repo `deltaWindow`/`deltaLast` and a fleet masthead (`summarize`, repoTrajectory.ts:188-203).
  - Stack grouping includes a `data_ml` `StackRole` (repoTrajectory.ts:98-106, `rolesPresent`) — Arjun **can** filter the fleet to just his ML repos via the "Stack" dropdown (RepoCategoryRollup.tsx:196, 260).
  - Noise-guard that exists here: `deltaCrossesEngine` mutes a delta that spans a mock→live engine change (repoTrajectory.ts:39-41, 61; rendered muted at RepoCategoryRollup.tsx:120-127). **No equivalent guard for live→live LLM wobble** (two real claude-cli scans, unchanged repo) — any such delta renders with full color confidence.
- Renders **`RepoDimensionHeatmap`** (src/components/org/overview/RepoDimensionHeatmap.tsx) — repo × D1-D9 grid, sortable per column, fleet-avg row. Cells show raw `dims[].score` only — no per-cell indicator that a row's D2/D6 carries a stack-fit caveat.
- The old org-wide `Trajectory` card (R²/`lowData` guardband, Trajectory.tsx:86-103) is **not** rendered on this page anymore (confirmed: only imported by `src/app/trends/page.tsx:5`, `PersonalOverview.tsx`, `goalView.tsx` — not `org/[slug]/page.tsx`).

### Executive briefing — `/org/[slug]/executive` (src/app/org/[slug]/executive/page.tsx:24-80+)
- `buildExecBriefing` (src/lib/org/briefing.ts) assembles maturity/benchmark/trajectory/movement/goals; `forecastConfidenceNote` (briefing.ts:36, called line 248) **does** carry the R²/low-data noise-vs-signal read forward from `forecastTrajectory`, guarding against the ≤2-point-fits-perfectly overconfidence (briefing.ts:243-248, mirrors Trajectory.tsx:86-92).
- `md = briefingMarkdown(briefing)` (page.tsx:53) feeds the "Copy briefing for LLM" button (`CopyForLlm`) — this is the artifact Arjun would paste to his VP.
- `grep` across `src/lib/org/briefing.ts` for `stackFit`/`archetype`/`notebook`: **zero hits**. The board-ready narrative carries no ML stack-fit context at all.

### Per-repo report — `/report/[owner]/[repo]` (only reached by clicking into a heatmap row, RepoDimensionHeatmap.tsx:105-111)
- `getScanReport` in `src/lib/db/scans-read.ts:865-874`: merges persisted warnings with `stackFitFromLanguage(repo.primaryLanguage)` (stack-fit.ts:37-43) — dedup'd, pushed into `warnings`.
- Rendered by `ReportWarnings` (src/components/report/ReportNotices.tsx:4-10), included in `ReportView.tsx:179`.
- **This is the only surface in the whole authed product where the ML/notebook caveat text is ever shown to a human.**

### LLM prompt grounding (the score itself) — src/lib/scan.ts + src/lib/scoring/prompt.ts
- `detectStackFit(snapshot)` (scan.ts:264, stack-fit.ts:51-93) triggers `stack: "ml"` when primary language is Jupyter Notebook, or `.ipynb` count ≥3, or ≥10% of the tree (stack-fit.ts:56-58).
- The caveat is injected directly into the scoring prompt: `STACK-FIT CAVEAT (...) do NOT penalize for conventions this stack legitimately doesn't use, and let the roadmap/discrepancies reflect the stack` (src/lib/scoring/prompt.ts:197).
- Detected tech stack (languages/frameworks/roles) is also injected (prompt.ts:197, second clause) so the model can sanity-check evidence against the actual stack.
- **Archetype weighting is a separate, un-connected lever**: `classifyArchetype` (src/lib/analyze/index.ts:894-902) buckets solely by `stars`/`CODEOWNERS`/workflow-count into `solo`/`team`/`org`; `ARCHETYPE_WEIGHTS` (src/lib/maturity/model.ts:241-266) has exactly those three buckets. There is **no `ml` archetype and no cross-wiring from `detectStackFit` into `weightsFor`** — an ML repo classified `team` gets the same D2=0.17/D6=0.09 weight as any non-ML team repo. The only lever pulling D2/D6 toward a fair read for ML is the LLM being *told* not to penalize — the deterministic weighting never adapts.

### Price legibility — `/usage`, `/pricing` (src/lib/plans.ts:32-93)
- `PLAN_FEATURES.team` = 500 included credits, $20/mo, 365-day retention (plans.ts:57-68) — matches the journey's Team figures exactly.
- `AllotmentPanel` (src/app/usage/AllotmentPanel.tsx:29-37, 45-85) computes `monthlyBurn`/`pct`/`fit` and renders an honest "a smaller tier may fit" nudge when utilization is low (fit `"under"` at <25%, line 35, 62).
- `/pricing`'s dollar figures derive from the same `PLAN_FEATURES`/`planPriceLabel` (plans.ts:88-93) — can't drift from what the entitlement gate reads.
- Arjun's real load: 40 repos × monthly = 40 credits/mo against Team's 500 → `pct` ≈ 8% → `fit = "under"` → the panel will literally tell him "a smaller tier (Pro, 100/mo) may fit."

## 2. In-character walkthrough (Arjun, over the designed model)

I open `/org/<my-org>` first, like every month. The Fleet card groups my repos — I click "Stack" and filter to Data/ML. Good, that dropdown exists, so at least the tool *knows* which of my 40 repos are ML repos as a category. I see per-repo deltas and can sort the heatmap by D2 (Automated Testing) weakest-first. That's where it gets uncomfortable: every one of my notebook-heavy repos is going to cluster at the bottom of that column, and the heatmap gives me *no visual signal* that those low D2 numbers already have — or should have — a stack-fit calibration behind them. I have to remember, or open ten individual `/report/<repo>` pages one at a time, to find out.

I click through to one repo's `/report` page and there it is: "Partial fit: this looks like an ML / notebook project. Automated Testing (D2) and Code Quality & Guardrails (D6) are tuned for application/service code..." — good, that's exactly the honesty I want. And better: I can see in the prompt code that the LLM was explicitly told not to penalize notebook conventions and to let the roadmap reflect the stack. If that holds live, that's the single most important thing this tool could get right for me.

But it only holds *per repo*, one click at a time. My actual monthly ritual is the fleet view and the executive briefing — the two surfaces that exist specifically so I don't have to open 40 individual reports. Neither carries the caveat. If I paste the "Copy briefing for LLM" markdown to my VP, it says nothing about which repos are ML-calibrated — my VP reads a fleet number with no idea ten of my repos got a footnote nobody transferred forward. That's the debunking step my Motivation section warns about: I now have to manually annotate my own briefing before I'd stand behind it.

Then there's the archetype lens. I read the code: `classifyArchetype` buckets purely on stars + CODEOWNERS + CI-workflow count. My training repos absolutely have CODEOWNERS and 2+ workflows (we do reproducibility CI, we just don't unit-test notebooks) — so they land in `team` or `org`, and get exactly the standard D2/D6 weight any web-shop team repo gets. There's no `ml` lens. The stack-fit caveat is a *content* instruction to the LLM, not a *structural* reweighting — so the fleet-level "maturity" number my VP will benchmark against other teams is still computed with the generic weights. That's precisely my scored criterion #1 failing at the deterministic layer, mitigated (maybe) only by LLM compliance I can't verify without a live run.

On noise vs. signal: the org-wide Trajectory card with its R²/low-data guard used to live on this page — it's gone from the Overview now, moved to per-repo `/trends` and folded into the executive briefing's `forecastConfidenceNote`. The executive briefing's confidence note is real and matches the guardband logic I'd want. But the Overview's own rollup only mutes a delta for a mock→live *engine* transition — it says nothing about whether two consecutive *live* claude-cli scans of an unchanged repo just wobbled. That's exactly the "is that a 3-point bump my team's work or your LLM breathing" question, and the fleet view I open first doesn't answer it; I'd have to go to the executive tab or click into `/trends` per-repo.

On price: this part is genuinely good. `/usage` tells me straight — 40 of 500 credits, ~8%, "a smaller tier may fit." That's an honest downgrade nudge on a Team-priced product, which is exactly the kind of unsentimental credibility that makes me trust a tool more, not less. `/pricing` shows real Team $/mo derived from the same source the gate reads. I can build my renewal case on this part without translation.

## 3. Findings

```json
[
  {
    "id": "L1-ARJ-01",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "arjun-ml-platform",
    "cert_level": "L1",
    "type": "missing-feature",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "Archetype lens (solo/team/org) has no ML/notebook branch — deterministic weighting never adapts",
    "expected": "Arjun's scored criterion #1: 'the archetype lens adapts... not just solo/team/org by stars+CODEOWNERS'",
    "got": "classifyArchetype buckets purely on stars/CODEOWNERS/workflow-count (src/lib/analyze/index.ts:894-902); ARCHETYPE_WEIGHTS has exactly solo/team/org (src/lib/maturity/model.ts:241-266), no ml lens; detectStackFit's output never feeds weightsFor.",
    "evidence": ["src/lib/analyze/index.ts:894-902", "src/lib/maturity/model.ts:241-266", "src/lib/analyze/stack-fit.ts:51-93"],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Seed an ML/notebook fixture repo with CODEOWNERS + CI (classifies as team/org), live-scan it with claude-cli, and check whether the actual D2/D6 numbers read as fair — i.e. whether the LLM-only mitigation (prompt.ts:197) compensates for the missing structural weight in practice."
  },
  {
    "id": "L1-ARJ-02",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "arjun-ml-platform",
    "cert_level": "L1",
    "type": "confusion",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "dimension": "clarity",
    "title": "Stack-fit caveat invisible on every fleet-level surface (heatmap, rollup, executive briefing) — only attached to the single-repo report",
    "expected": "Arjun's scored criterion #6 ('quote the fleet number + top move to his VP without first having to debunk a stack-mismatched finding') and his Motivation note that a caveat he has to mentally re-apply saves him nothing.",
    "got": "The caveat is computed and merged into `warnings` only inside getScanReport (src/lib/db/scans-read.ts:865-874) and rendered only by ReportWarnings on /report/[owner]/[repo] (src/components/report/ReportNotices.tsx:4-10, ReportView.tsx:179). RepoDimensionHeatmap.tsx and RepoCategoryRollup.tsx render raw scores with no caveat indicator; src/lib/org/briefing.ts (the executive briefing + its 'Copy briefing for LLM' markdown) has zero references to stackFit/archetype/notebook.",
    "evidence": ["src/lib/db/scans-read.ts:865-874", "src/components/report/ReportNotices.tsx:4-10", "src/components/org/overview/RepoDimensionHeatmap.tsx:99-134", "src/lib/org/briefing.ts (no stackFit reference)"],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Confirm live whether Arjun can tell, from /org/[slug] overview or /org/[slug]/executive alone, which of his 40 repos carry a stack-fit caveat — or whether he must open each /report page individually."
  },
  {
    "id": "L1-ARJ-03",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "arjun-ml-platform",
    "cert_level": "L1",
    "type": "trust",
    "severity": "minor",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "med" },
    "dimension": "trust",
    "title": "Fleet rollup mutes only mock→live engine-transition deltas, not live-to-live LLM wobble",
    "expected": "Arjun's scored criterion #4: a score move is labeled real vs. re-scan wobble.",
    "got": "repoTrajectory.ts's deltaCrossesEngine (lines 39-41, 61) only flags an engine change; the R²/lowData guardband that does exist (Trajectory.tsx:86-103) is not rendered on /org/[slug] overview (superseded by the heatmap/rollup per the journey notes) and only surfaces via forecastConfidenceNote on the executive briefing (src/lib/org/briefing.ts:243-248) or per-repo /trends.",
    "evidence": ["src/components/org/overview/repoTrajectory.ts:39-41,61", "src/components/org/overview/Trajectory.tsx:86-103", "src/lib/org/briefing.ts:243-248"],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Two consecutive live claude-cli scans of an unchanged ML repo — does the fleet rollup delta render with full confident color, or is there any guard against LLM guardband noise at that surface?"
  },
  {
    "id": "L1-ARJ-04",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "arjun-ml-platform",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "polish",
    "impact": { "frequency": "low", "reachability": "high", "trust_erosion": "low" },
    "dimension": "missing",
    "title": "Data/ML StackRole exists for filtering but heatmap cells don't visually flag which rows are stack-fit-calibrated",
    "expected": "Having a 'Data / ML' stack filter (repoTrajectory.ts:98-106) sets an expectation that ML repos are a first-class, visible category, not just a filter bucket.",
    "got": "Filtering to Data/ML in RepoCategoryRollup narrows the list but the heatmap (RepoDimensionHeatmap.tsx) shows the same undecorated D1-D9 cells for every repo regardless of stack-fit status.",
    "evidence": ["src/components/org/overview/repoTrajectory.ts:98-106", "src/components/org/overview/RepoDimensionHeatmap.tsx:99-134"],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "n/a — cosmetic; only worth confirming if L1-ARJ-02 is fixed with a badge/marker, this finding would then check its rendering."
  },
  {
    "id": "L1-ARJ-05-STRENGTH",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "arjun-ml-platform",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "polish",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "low" },
    "dimension": "trust",
    "title": "STRENGTH — price-legibility is solid and honestly unsentimental",
    "expected": "Arjun's scored criterion #5: map 40 credits/mo to the 500 allotment + 365-day window, judge cost↔value.",
    "got": "plans.ts's Team tier (500 credits, $20/mo, 365-day retention) matches the journey's figures exactly (src/lib/plans.ts:57-68); AllotmentPanel computes his real ~8% utilization and would honestly nudge him toward Pro (src/app/usage/AllotmentPanel.tsx:29-37,58-63) — a downgrade-honest signal that fits his 'renewal-minded but not sentimental' profile and his contempt for tools that hide 'contact us' pricing.",
    "evidence": ["src/lib/plans.ts:57-68", "src/app/usage/AllotmentPanel.tsx:29-37,58-63"],
    "code_check": "present",
    "verdict": "confirmed",
    "resolution": "by-design",
    "ceiling": "still no subscription $ figure inside the app beyond /pricing's derived label; the $ story is Pro/Team only, Enterprise stays 'Custom'."
  },
  {
    "id": "L1-ARJ-06-STRENGTH",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "arjun-ml-platform",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "polish",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "low" },
    "dimension": "senior-quality",
    "title": "STRENGTH — the scoring prompt itself carries the stack-fit caveat and an explicit non-penalize instruction",
    "expected": "Senior-quality bar: a notebook-heavy repo with no unit tests must not be scored/recommended as if it were failing web-dev hygiene.",
    "got": "src/lib/scoring/prompt.ts:197 injects 'STACK-FIT CAVEAT ... do NOT penalize for conventions this stack legitimately doesn't use, and let the roadmap/discrepancies reflect the stack' directly ahead of scoring, sourced from a real file-tree notebook detector (stack-fit.ts:56-58, ≥3 .ipynb or ≥10% share).",
    "evidence": ["src/lib/scoring/prompt.ts:197", "src/lib/analyze/stack-fit.ts:56-58", "src/lib/scan.ts:260-264,538-541"],
    "code_check": "present",
    "verdict": "confirmed",
    "resolution": "open",
    "ceiling": "unverified live — L2 must confirm the LLM actually complies (doesn't recommend 'add unit tests' to a notebook repo) rather than just receiving the instruction."
  }
]
```

## 4. Character voice — would I adopt it?

"Okay, some of this is real. The prompt engineer who wrote that stack-fit caveat clearly sat down and thought about my exact case — 'do NOT penalize for conventions this stack legitimately doesn't use' is the sentence I've been waiting to read from a maturity tool. If that instruction actually holds when the model runs, D2 and D6 on my training repos won't read as failing grades for the wrong reason. That's the single thing that decides whether I keep paying.

But I don't live on the report page — I live on the fleet view and the executive tab, because that's the whole point of paying for Team: I don't want to open 40 individual pages every month. And on *those* two surfaces, my ML repos are invisible as a caveat-carrying category. The heatmap sorts my notebook repos to the bottom of the D2 column with zero indication anything was calibrated for them, and the 'Copy briefing for LLM' markdown I'd hand my VP says nothing about it either. I'd have to manually remember which ten of my forty repos need the asterisk and add it myself before I present. That's the debunking step my own math says erases the time saved — it doesn't erase all of it, since the underlying repo scores may in fact be fair, but it erases my *confidence* in defending the fleet number without homework.

And the archetype lens — solo/team/org by stars and CODEOWNERS — that's the same mistake every DORA dashboard made on me before. My training repos have CODEOWNERS and two CI workflows (repro checks, not unit tests), so they'll get bucketed 'team' and weighted like any SaaS team repo. The caveat text might save the actual score, but the *lens* itself never adapted. That's not okay-it-didn't-penalize-me, that's 'it got lucky because the LLM was told to.'

Price story: genuinely good, no complaints. Told me straight I'm using 8% of my Team allotment and might fit Pro better. I trust a tool more for saying that, not less.

Verdict for now: I'd keep the subscription through this renewal on the strength of the per-repo caveat and the honest pricing — but I'd flag to the team that I don't yet trust the *fleet* number enough to put it in a slide without checking every repo by hand first, which is most of the four hours I was trying to save. Fix the fleet-level visibility of the caveat and give the archetype lens an actual ML branch, and this earns the 'okay, it didn't penalize me for the wrong things' line for real, at the surface I actually open."
