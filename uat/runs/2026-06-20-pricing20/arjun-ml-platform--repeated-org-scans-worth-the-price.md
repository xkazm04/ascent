# L1 — Arjun (data/ML platform lead) × repeated-org-scans-worth-the-price

**Verdict: L1-fail** — the recurring read is structurally mis-fit to Arjun's ML/notebook stack: notebooks are invisible end-to-end (ingestion → detectors → LLM prompt), there is no ML archetype lens, and the trend he'd renew on is therefore a *credible-looking* month-over-month line built on a rubric that's measuring the wrong stack. The cadence machinery (movers, trajectory, R²/flat-floor) is genuinely good; it's just being fed a score that doesn't fit ML, so repetition compounds a mismeasurement rather than a maturity.

## Reachable surface set (tier-honest — Team plan)
Under `ASCENT_AUTH_BYPASS=1` on a populated `/org/<slug>`, Arjun reaches the full `/org/*` set as synthetic owner. At **Team** his entitlements (`src/lib/plans.ts:45-54`) are honest-real:
- **Reachable + tier-included:** `/org/[slug]` overview + Trajectory + movers/PeriodSummary; `/org/[slug]/executive` + briefing share; `/trends` (365-day window — Team's `retentionDays:365` is the deepest non-enterprise look-back, so his monthly trend *can* span a real year); `/usage` credit burn; scheduled autoscans + alerts + rescan (Pro+, so included); segments + comparisons + playbooks (Team-only). 500 included credits/mo.
- **His actual recurring cost:** ~40 private repos × monthly = **40 credits/mo against 500** — comfortably inside allotment; credits are *not* his pain. The 365-day retention is plenty for a monthly cadence. Tier/price is fine; **fit** is the problem.
- **Not the constraint here:** unlike a Free/Pro character, nothing Arjun needs is gated away. This is a rare L1-fail that is *not* a reachability or pricing failure — it's a measurement-validity failure.

## Surface-model notes (recurring-value affordances → file:line)
- **Movers have real provenance (strength).** `getOrgMovers` compares each repo's latest in-window scan to its baseline strictly before the window (`src/lib/db/org-insights.ts:70-90`), and `buildMove` carries `dOverall/dAdoption/dRigor`, `levelFrom→levelTo`, `postureFrom→postureTo`, `sinceDays` (`org-insights.ts:47-62`). This genuinely answers "what changed since last month" — the cadence machinery is not the defect.
- **Trajectory has a noise defense (strength).** `forecastTrajectory` needs ≥2 distinct calendar days or returns null (`src/lib/maturity/forecast.ts:87,100`); `FLAT_PER_WEEK=0.5` floors out sub-noise drift to "flat" (`forecast.ts:64,130-131`); `fitQuality` (R²) is surfaced as trend confidence (`forecast.ts:54,123`). So a flat infra repo won't fake a trend, and low-R² wobble is *labelable* — IF the UI shows R² where the move is shown (L2 must confirm placement).
- **The score itself is stack-biased — the root defect.**
  - **No ML archetype.** `RepoArchetype = solo | team | org` only (`src/lib/maturity/model.ts:203-207`); `classifyArchetype` buckets purely by stars + CODEOWNERS + workflow count (`src/lib/analyze/index.ts:727-735`) — **language/stack never enters**. Arjun's 40 notebook repos all land in solo/team/org and are weighted on the *same* 9 dims, with D2 Testing at 15-17% and D3 CI/CD at 11-14% in every lens (`model.ts:204-206`).
  - **Notebooks are invisible three times over.** (1) Ingestion: `pickFilesToFetch` samples "source for texture" matching `ts|tsx|js|jsx|py|go|rs|java|rb|kt|cs|php` — **`.ipynb` is absent** (`src/lib/github/source.ts:617-625`), so the actual notebooks never reach the LLM prompt. (2) Detection: D2's `SOURCE_PATH` regex has no `ipynb` (`analyze/index.ts:188-189`), so notebooks count as neither source nor tests; the test-to-source ratio (`analyze/index.ts:222-226`) is computed over `.py` glue only. (3) `grep -i ipynb|notebook|jupyter` over `src` → **zero matches**. The work product of an ML repo is structurally unseen.
  - **D2 / D6 penalize the ML stack for missing web-dev guardrails.** D2 scores test files, Jest/Vitest/Pytest config, e2e, coverage (`analyze/index.ts:193-264`) — pytest *is* detected, but a research repo with experiment notebooks and few unit tests floors D2. D6 rewards ESLint/Prettier/tsconfig-strict/pre-commit/CODEOWNERS/commitlint (`analyze/index.ts:401-440`) — none typical of training repos. At 15-17% (D2) + 7-9% (D6) weight, these alone can drag an otherwise-mature ML repo toward L1-L2.
  - **D7 misreads experiment churn.** D7 rewards conventional-commit prefixes (35 pts at ≥50%) and AI-trailer commits, and penalizes their absence (`analyze/index.ts:481-521`). Experiment sweeps produce high-volume, irregular, non-conventional commits — so heavy *real* activity earns little, and the "actively maintained" bonus is the only churn-friendly signal.
- **Roadmap is generic-to-web.** Fallback + LLM roadmap surface gaps from the same 9 dims (`src/lib/scoring/engine.ts:171-173`, prompt `src/lib/scoring/prompt.ts:48-57`); for an ML repo the top "explore" items will be testing/CI/conventions — exactly the senior-rejected advice (his bar).
- **Net for the recurring read:** month-over-month the movers/trajectory will faithfully track a *mismeasured* number. A repo that added a model registry or data-versioning (real ML maturity) moves the score 0; a repo where someone added an ESLint config to a Python glue dir moves it up. The trend is precise and trustworthy-looking and pointed at the wrong target.

## Findings
```json
[
  {
    "id": "ARJUN-L1-01",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "arjun-ml-platform",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "blocker",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "dimension": "senior-quality",
    "title": "No ML/notebook archetype — the 9-dim rubric is applied unchanged to research repos",
    "expected": "An ML/notebook-heavy repo is judged against an ML-appropriate lens (model+data+code), not docked on the same D2-testing / D3-CI / D7-conventions weights as a web service.",
    "got": "RepoArchetype is solo|team|org only; classifyArchetype buckets by stars+CODEOWNERS+workflows with language never entering, so all 40 ML repos get a web-shaped rubric.",
    "evidence": ["src/lib/maturity/model.ts:203-207", "src/lib/analyze/index.ts:727-735"],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "l2_priority": "Scan a real notebook-heavy ML repo under claude-cli; confirm the archetype lands solo/team/org and that D2/D6/D7 drag it to L1-L2 despite mature ML practices.",
    "suggested_acceptance": "Add an ml/notebook archetype (or stack-aware lens) that down-weights D2/D3/D7 web-guardrails and surfaces an ML-fit caveat when notebooks dominate."
  },
  {
    "id": "ARJUN-L1-02",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "arjun-ml-platform",
    "cert_level": "L1",
    "type": "trust",
    "severity": "blocker",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "Notebooks are invisible end-to-end — ingestion, detectors, and the LLM prompt all skip .ipynb",
    "expected": "An ML repo's actual work (notebooks) is read and counted; the repo isn't scored as if empty/untested.",
    "got": "pickFilesToFetch's source sample omits .ipynb so notebooks never reach the prompt; D2 SOURCE_PATH has no ipynb; zero references to notebook/jupyter/ipynb anywhere in src.",
    "evidence": ["src/lib/github/source.ts:617-625", "src/lib/analyze/index.ts:188-189", "src/lib/analyze/index.ts:222-226"],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "l2_priority": "Scan a repo whose code lives in .ipynb; confirm the notebooks are absent from sampled files and that test-to-source ratio is computed over .py only — the work product is unseen.",
    "suggested_acceptance": "Recognize .ipynb as source (and parse cell sources) in ingestion + D2 SOURCE_PATH so notebook work is visible to both detectors and the LLM."
  },
  {
    "id": "ARJUN-L1-03",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "arjun-ml-platform",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "med" },
    "dimension": "senior-quality",
    "title": "Roadmap recommends web-dev hygiene (add tests / CI / conventional commits) to research repos",
    "expected": "Top recurring move is an ML-relevant gap (eval gating, data/model versioning, repro), not generic testing/CI advice the stack doesn't use.",
    "got": "Roadmap is generated from the same 9 dims; the highest-weighted gaps on an ML repo are D2/D3/D6/D7 — exactly the senior-rejected 'add more tests / adopt conventional commits' output.",
    "evidence": ["src/lib/scoring/engine.ts:171-173", "src/lib/scoring/prompt.ts:48-57", "src/lib/analyze/index.ts:481-521"],
    "code_check": "by-design",
    "verdict": "confirmed",
    "l2_priority": "Under claude-cli, capture the roadmap on a mature ML repo — does the top 'explore' item read as web-shop hygiene Arjun would reject?"
  },
  {
    "id": "ARJUN-L1-04",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "arjun-ml-platform",
    "cert_level": "L1",
    "type": "trust",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "med", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "Month-over-month trend is precise but pointed at a mismeasured number — repetition compounds the mis-fit",
    "expected": "Each monthly cycle's move reflects real ML-maturity change; a 0-move means nothing changed and a +move means it did.",
    "got": "Movers/trajectory faithfully diff the score, but the score itself doesn't track ML maturity (registry/data-versioning move it 0; an ESLint config in a glue dir moves it up), so the trend is trustworthy machinery over an untrustworthy target.",
    "evidence": ["src/lib/db/org-insights.ts:47-62", "src/lib/maturity/forecast.ts:130-131", "src/lib/maturity/model.ts:204-206"],
    "code_check": "present-but-missed",
    "verdict": "confirmed",
    "l2_priority": "Re-scan an unchanged ML repo twice under claude-cli: is the dOverall move within guardband, and is R²/flat-floor surfaced where the move is shown so Arjun can tell noise from signal?"
  },
  {
    "id": "ARJUN-L1-05",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "arjun-ml-platform",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "minor",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "low" },
    "dimension": "clarity",
    "title": "No 'this rubric is tuned for app repos' caveat — the tool never names its ML blind spot",
    "expected": "When notebooks dominate / Python-only with no web guardrails, surface a 'partial fit for ML' note so the number is read with the right caveat.",
    "got": "Coverage/confidence exists (source.ts:630-642) but it measures fetch success, not stack-fit; nothing tells Arjun the model is web-tuned. A tool that named its blind spot would keep his trust; this stays silent.",
    "evidence": ["src/lib/github/source.ts:630-642", "src/lib/analyze/index.ts:727-735"],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "l2_priority": "Confirm no stack-fit caveat renders on an ML scan."
  },
  {
    "id": "ARJUN-L1-06",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "arjun-ml-platform",
    "cert_level": "L1",
    "type": "trust",
    "severity": "minor",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "low" },
    "dimension": "trust",
    "title": "STRENGTH — movers + trajectory + R²/flat-floor are genuinely good recurring-read machinery",
    "expected": "n/a (strength)",
    "got": "Period-scoped movers with from→to provenance and sinceDays; OLS trajectory that returns null below 2 distinct days, floors sub-0.5/wk drift to flat, and surfaces R² as trend confidence. If aimed at a stack-fit score this would be a renew-grade recurring read.",
    "evidence": ["src/lib/db/org-insights.ts:70-90", "src/lib/maturity/forecast.ts:82-148"],
    "code_check": "by-design",
    "verdict": "confirmed"
  },
  {
    "id": "ARJUN-L1-07",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "arjun-ml-platform",
    "cert_level": "L1",
    "type": "trust",
    "severity": "polish",
    "impact": { "frequency": "low", "reachability": "high", "trust_erosion": "low" },
    "dimension": "time-saved",
    "title": "STRENGTH — at Team, credits & retention are not the constraint (40/500 used, 365-day window)",
    "expected": "n/a (strength)",
    "got": "40 repos monthly = 40 credits vs 500 allotment; 365-day retention covers a full-year monthly trend. Price/tier fit is fine — the fail is measurement validity, not affordability.",
    "evidence": ["src/lib/plans.ts:45-54"],
    "code_check": "by-design",
    "verdict": "confirmed"
  }
]
```

## Character feedback (Arjun's voice)
Would I renew? No — not as it stands. The dashboard is *nice*. The movers tell me what moved since last month, the little trajectory line has an R² on it so I can see when it's just breathing — honestly, that's better cadence machinery than most tools ship. But here's the thing: it's pointed at the wrong stack. I went looking for whether it even knows what a notebook is, and it doesn't. Not in the file sampler, not in the test detector, not anywhere — my `.ipynb` files, where 80% of the actual work lives, are invisible. So my training repos read as half-empty and untested, and the rubric then dings them on automated testing, CI gates, and conventional commits — none of which a research repo uses. There's no "ML" lens; it sorts my repos into solo/team/org by *stars and a CODEOWNERS file* and applies the same JS-shop rubric to all 40.

Is each cycle telling me something new? It'll tell me a number *moved* — but I can't trust the move means what it says. A repo that added a model registry or started versioning its datasets — real ML maturity — moves the score zero. A repo where someone dropped an ESLint config into a glue directory ticks up. So month over month I'd be quoting my VP a trend that's measuring repo hygiene, not ML maturity, and dressing it up as progress. That's worse than no tool — it's a confidently-wrong tool I'd have to mentally re-translate every cycle ("ignore the testing dimension, that's noise for us"). That's not time saved, that's a debunking chore I now own.

Can I see the price? At Team it doesn't matter much — 40 scans against 500 credits, a full year of history, I'm nowhere near a limit. Cost isn't my problem. *Fit* is. And the tool never once admits it — no "this rubric is tuned for app repos" caveat. If it just *said* "ML signals are partial here," I'd respect it and keep using it for the code-hygiene slice it can see. Instead it scores my researchers' work L2 and hands them a roadmap that says "add more tests." They'd laugh me out of the room.

Would I tell a peer? Only as a warning: great for a TypeScript product org, do not point it at your ML platform yet. For my recurring job it's measuring the wrong thing well.

## Grounding score · time-saved · pricing verdict
- **Grounding (recurring-context sources reaching the read): 4/6.** History/trajectory (forecast.ts ✓), movers/period-delta with provenance (org-insights.ts ✓), R²/flat-floor noise defense (forecast.ts ✓), tier-retention gating (plans.ts — Team 365d ✓ reaches). **Misses for THIS character:** the *score being fed in* is stack-invalid (no ML archetype, notebooks unseen) so the "real signal vs noise" source is structurally compromised (✗), and there is no stack-fit/coverage caveat to flag it (✗). The machinery reaches the read; a *valid ML measurement* does not.
- **Per-cycle time-saved (if it fit): ~3.5–4 hrs/month** — replacing his ~4-hr manual eyeball of 40 repos with a ~10-min re-pull. **As actually built for ML: net-negative** — the score requires a manual re-translation/debunk step, so it adds rather than saves time.
- **Verdict: CHURN (would-be-renew, blocked on fit).** One-line reason: the cadence machinery is renew-grade but it's trending a number that doesn't measure ML maturity and never admits it — so each cycle compounds a mismeasurement instead of paying off. Flips to **renew** the moment an ML archetype + notebook visibility + a stack-fit caveat land.

## l2_priority carry-forward
1. **(ARJUN-L1-02)** Scan a `.ipynb`-dominant repo under claude-cli — confirm notebooks are absent from sampled files and the test-to-source ratio is `.py`-only; the work product is unseen.
2. **(ARJUN-L1-01)** Confirm a mature ML repo lands solo/team/org and is dragged to L1-L2 by D2/D6/D7 despite real ML practices.
3. **(ARJUN-L1-04)** Re-scan an unchanged ML repo twice — is dOverall within guardband, and is R²/flat-floor surfaced *where the move is shown* so noise is distinguishable?
4. **(ARJUN-L1-03)** Capture the claude-cli roadmap on an ML repo — does the top move read as web-shop hygiene Arjun would reject?
