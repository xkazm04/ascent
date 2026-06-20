# L1 — Camille (DevEx-analytics vendor PMM) × repeated-org-scans-worth-the-price

**Verdict: L1-conditional** — the recurring read *can* compound (history-required trajectory GPS + cross-org percentile + the .ai adoption loop are real moats), but two structural churn vectors land at every cycle: (1) movers carry **no noise-vs-signal defense** at the surface where they're shown, and (2) on a stable fleet the trajectory **plateaus into "no level change projected,"** restating the number. Price-invisibility for paid tiers blocks the renewal math. L2-eligible.

## Reachable surface set (tier-honest)
Camille is a *competitive teardown* observer; under `ASCENT_AUTH_BYPASS=1` on a populated `/org/<slug>` she renders as a synthetic owner and reaches the full `/org/*` set. Judged against the **tiers a real buyer would sit on**:
- **Reachable & tier-agnostic:** Overview `/org/[slug]` (fleet number, **Trajectory** GPS, **movers/PeriodSummary**, gap), `/trends`, `/usage`, `/pricing`. The cross-org **benchmark/percentile** renders for any populated org.
- **Pro+ only (fold into upsell, not free):** scheduled autoscans + alerts + digest (the *between-logins* recurring touch — the habit loop) require Pro (`plans.ts:43`). **>30-day trajectory lookback** is gated: Free 30d / Pro 180d / Team 365d (`plans.ts:31,42,53`) — a Free org's trajectory can't even *see* far enough back to compound. Segments/comparisons are Team (`plans.ts:53`).
- **Camille's read:** the stickiest recurring machinery (alerts/digest = the "we re-engaged you" loop) is *all paywalled*, which is correct positioning but means **the Free tier is structurally un-sticky** — no between-login touch, no long-history trajectory. That's the wedge she'd attack.

## Surface-model notes (recurring-value affordances → file:line; grounding emphasis)
- **Trajectory GPS — sticky, history-REQUIRED.** `forecastTrajectory` returns null with <2 distinct calendar days (`src/lib/maturity/forecast.ts:87,100`), so the feature *only exists because of repetition* — exactly the compounding asset. R²/"trend confidence" is computed (`forecast.ts:123`) and **surfaced** on the org trajectory with a "· noisy" tag below 50% (`src/components/org/Trajectory.tsx:34,94,96`). This is the genuine defense against "is the move real" — but it lives on the *org* trajectory only.
- **Movers — the noise wound.** `getOrgMovers` builds raw `dOverall/dAdoption/dRigor` deltas vs the prior scan (`src/lib/db/org-insights.ts:47-62,138-141`) and `PeriodSummary` renders them as climbed/slipped sentences (`src/components/org/PeriodSummary.tsx:33-41,65-68`) with **zero confidence/noise annotation**. A score that wobbles within the ±25 guardband (`src/lib/scoring/engine.ts:99-102`; `LLM_GUARDBAND=25`, `SCORE_BLEND=0.6` per `src/lib/maturity/model.ts:16,23`) on an *unchanged* repo surfaces as a "mover." The forecast's R² is the only "this is real" signal and it **does not reach the movers panel**. Every-cycle trust erosion.
- **Flat-trajectory plateau.** `FLAT_PER_WEEK=0.5` (`forecast.ts:64`) classifies sub-0.5/wk drift as flat (`forecast.ts:131`); the headline becomes "Holding around X — no level change projected" (`forecast.ts:291-292`). On stable/mature/embedded repos, cycle N restates cycle N-1 — the re-dated number.
- **Cross-org percentile — moat.** `getOrgBenchmark` ranks the org vs corpus + same-language **cohort** with min-sample guards (`org-insights.ts:549,556-627`; `COHORT_MIN=5`, `CORPUS_MIN=5`). A single-repo competitor *cannot* replicate this — it's the asset Camille can't answer to.
- **.ai standard adoption loop — moat.** `buildFoundation` installs the `.ai/` manifest + doctor + memory + context scaffold into the repo (`src/lib/standard/index.ts:28-37`), creating a scan→install→re-scan-to-measure-adoption flywheel. Each cycle measures movement *the tool itself caused* — structural stickiness.
- **Price invisibility.** `plans.ts` carries no dollar amounts (by design — Polar holds the price, `plans.ts:4-5`); paid tiers show only "prepaid credits." Camille cannot model the renewal math.

## Findings
```json
[
  {
    "id": "CAM-L1-01",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "camille-devtools-vendor",
    "cert_level": "L1",
    "type": "trust",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "Movers panel shows raw deltas with no noise-vs-signal defense — the R²/confidence guard never reaches where the move is shown",
    "expected": "A surfaced score move on a repo is annotated with whether it's real signal or re-scan wobble within the ±25 guardband — so a leader can trust 'this moved' before acting/renewing.",
    "got": "getOrgMovers emits raw dOverall and PeriodSummary renders 'climbed/slipped' sentences with no confidence, R², or noise tag. The forecast's 'trend confidence · noisy' guard exists but only on the ORG trajectory, not the per-repo movers.",
    "evidence": ["src/lib/db/org-insights.ts:47-62", "src/lib/db/org-insights.ts:138-141", "src/components/org/PeriodSummary.tsx:33-41", "src/components/org/PeriodSummary.tsx:65-68", "src/lib/scoring/engine.ts:99-102", "src/lib/maturity/model.ts:16", "src/lib/maturity/model.ts:23", "src/components/org/Trajectory.tsx:96"],
    "code_check": "present-but-missed",
    "verdict": "confirmed",
    "l2_priority": "Under claude-cli, re-scan an UNCHANGED repo twice. Does dOverall move within ±25, does it appear as a 'mover' in PeriodSummary, and is there ANY noise annotation on that mover? If the wobble surfaces as signal, this is the churn vector.",
    "suggested_acceptance": "Movers within the guardband band (|dOverall| small relative to ±25 and low fit confidence) are tagged 'within noise' or carry the repo's R²/confidence at the panel, not only on the org trajectory."
  },
  {
    "id": "CAM-L1-02",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "camille-devtools-vendor",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "med" },
    "dimension": "missing",
    "title": "Stable-fleet plateau — trajectory flatlines to 'no level change projected' and movers go empty; cycle N re-dates cycle N-1",
    "expected": "Even on a low-velocity/mature fleet, repetition surfaces SOMETHING new per cycle (percentile drift, a new gap, a confidence shift) — the recurring payload stays heavy enough to clear the renewal bar.",
    "got": "FLAT_PER_WEEK=0.5 classifies sub-0.5/wk drift as flat → 'Holding around X — no level change projected'; movers filter on dOverall != 0 so a stable repo contributes nothing. On a mature org the recurring read collapses to a re-dated number — the 'we stopped opening it' churn signal.",
    "evidence": ["src/lib/maturity/forecast.ts:64", "src/lib/maturity/forecast.ts:131", "src/lib/maturity/forecast.ts:291-292", "src/lib/db/org-insights.ts:138-141", "src/components/org/PeriodSummary.tsx:41"],
    "code_check": "by-design",
    "verdict": "confirmed",
    "l2_priority": "On a stable seeded org (no real movement), does cycle 2's Overview/digest say anything new, or is it byte-for-byte last cycle re-dated? Check whether percentile/cohort drift fills the gap when movement is flat.",
    "suggested_acceptance": "When movement is flat fleet-wide, the recurring read leads with a still-changing axis (cohort percentile shift, a newly-crossed practice gap, confidence change) rather than 'no change.'"
  },
  {
    "id": "CAM-L1-03",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "camille-devtools-vendor",
    "cert_level": "L1",
    "type": "confusion",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "med" },
    "dimension": "clarity",
    "title": "No subscription price for paid tiers — the renewal math can't be modeled at all",
    "expected": "A buyer judging 'is the repetition worth what I pay' can see the per-cycle cost↔value: credit burn (P repos × C cycles) vs allotment AND the subscription $.",
    "got": "plans.ts deliberately holds no dollar amounts (Polar owns the price); paid tiers show only 'prepaid credits.' Retention windows (30/180/365) ARE legible and credit-per-scan IS legible, but the subscription cost is invisible — the renewal decision is undecidable on price.",
    "evidence": ["src/lib/plans.ts:4-5", "src/lib/plans.ts:31", "src/lib/plans.ts:42", "src/lib/plans.ts:53"],
    "code_check": "by-design",
    "verdict": "confirmed",
    "l2_priority": "Confirm /pricing renders no $ for Pro/Team and 'contact us' for Enterprise — and whether /usage's credit-burn trend is enough to back into value without the price.",
    "suggested_acceptance": "At least an anchor price or starting-at $ for Pro/Team is reachable from the dashboard so a renewing customer can compute value-per-dollar."
  },
  {
    "id": "CAM-L1-04",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "camille-devtools-vendor",
    "cert_level": "L1",
    "type": "missing-feature",
    "severity": "minor",
    "impact": { "frequency": "med", "reachability": "med", "trust_erosion": "low" },
    "dimension": "missing",
    "title": "Free tier is structurally un-sticky — no between-login touch and a 30-day trajectory that can't compound",
    "expected": "The recurring habit loop (alerts/digest) and enough history for a trajectory to mean something exist at the entry tier so the cadence habit can form before the upsell.",
    "got": "Scheduled autoscans/alerts/digest are Pro+; Free retention is 30 days, often too short for a multi-cycle trajectory to look back. Correct monetization, but it means Free never forms the recurring habit — a wedge a competitor can exploit on the free cohort.",
    "evidence": ["src/lib/plans.ts:31", "src/lib/plans.ts:43", "src/app/api/cron/digest/route.ts"],
    "code_check": "by-design",
    "verdict": "confirmed",
    "l2_priority": "Confirm a Free-tier org gets no digest/alert and that >30d trajectory lookback is gated — i.e. the habit loop is entirely behind the paywall."
  },
  {
    "id": "CAM-L1-05",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "camille-devtools-vendor",
    "cert_level": "L1",
    "type": "trust",
    "severity": "polish",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "low" },
    "dimension": "trust",
    "title": "STRENGTH — Trajectory GPS is history-required and surfaces its own R² with a 'noisy' flag (the sticky asset done right)",
    "expected": "A forward-looking read that can't exist without repetition and tells the user how much to trust the straight line.",
    "got": "forecastTrajectory returns null below 2 distinct days (so repetition is REQUIRED to render), and Trajectory.tsx surfaces 'trend confidence N%' with a '· noisy' tag below 50%. This is the model the movers panel should copy — the compounding asset done correctly.",
    "evidence": ["src/lib/maturity/forecast.ts:87", "src/lib/maturity/forecast.ts:100", "src/lib/maturity/forecast.ts:123", "src/components/org/Trajectory.tsx:34", "src/components/org/Trajectory.tsx:94", "src/components/org/Trajectory.tsx:96"],
    "code_check": "by-design",
    "verdict": "confirmed"
  },
  {
    "id": "CAM-L1-06",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "camille-devtools-vendor",
    "cert_level": "L1",
    "type": "missing-feature",
    "severity": "polish",
    "impact": { "frequency": "med", "reachability": "med", "trust_erosion": "low" },
    "dimension": "missing",
    "title": "STRENGTH (the moats Camille can't replicate) — cross-org/cohort percentile + the .ai standard adoption loop",
    "expected": "At least one recurring asset a single-repo competitor cannot clone, that keeps earning the subscription.",
    "got": "getOrgBenchmark ranks the org vs the whole Ascent corpus AND a same-language peer cohort (min-sample guarded) — an aggregate a single-tenant competitor has no data to build. buildFoundation installs .ai scaffolding into the repo, so each re-scan measures adoption the tool itself drove — a self-reinforcing flywheel. These are the genuine retention moats.",
    "evidence": ["src/lib/db/org-insights.ts:556-627", "src/lib/db/org-insights.ts:549", "src/lib/standard/index.ts:28-37"],
    "code_check": "by-design",
    "verdict": "confirmed"
  }
]
```

## Character feedback (Camille, first person)
Would I renew, if I were the customer? **At Pro/Team, conditionally yes — and that "conditionally" is exactly where I'd attack.** Here's the teardown.

The trajectory GPS is the real thing. It literally *can't render* until you've scanned twice — so the product is structurally betting on repetition, which is the right bet, and it tells me the R² with a "noisy" flag so I know when not to believe the line. Annoyingly, that would retain. The cross-org percentile is worse news for me: I can't fake that. A single-repo competitor has no corpus to rank you against, and the `.ai` standard the tool installs into your repo means every re-scan is measuring movement *it caused* — that's a flywheel, that's a moat, I'd have to answer to both in a deck.

But here's where it bleeds. **The movers panel shows me a number went from 61 to 64 and stakes nothing on whether that's real.** The LLM rides ±25 inside its guardband; re-scan an unchanged repo under claude-cli and the headline can twitch — and that twitch shows up as a "mover" with a green arrow and zero "this is the model breathing" tag. The confidence machinery EXISTS — it's right there on the org trajectory — it just doesn't reach the panel where the move is shown. So by cycle 6 my customer's lead has been burned once by a "mover" that wasn't, and now they don't trust the green arrows, and a dashboard you don't trust is a dashboard you stop opening. That's a twelve-week churn clock.

And on a stable fleet it gets quiet fast. `FLAT_PER_WEEK=0.5` means a mature repo's trajectory says "Holding around 72 — no level change projected" every single cycle, and the movers list is empty because nothing crossed zero. That's the re-dated number. The percentile *could* fill that gap, but nothing routes it to the front when movement is flat — so cycle N reads like cycle N-1 with a new date. B2B churn baseline is ~4.9%; a flat recurring payload pushes a stable-fleet logo right over that line, and usage-based pricing only saves you ~46% of the churn if the usage stays valuable.

Can I even see the price? **No.** Pro and Team show "prepaid credits" and nothing else — the subscription dollar lives in Polar, not the app. I can compute credit burn (P repos × C cycles vs allotment) and I can see the retention window I'm buying, but I cannot model value-per-dollar because the dollar isn't there. For a renewal conversation that's a wound: my CFO asks "what are we paying," and the tool's answer is "log into the billing provider."

Is each cycle telling me something new? On a *moving* fleet, yes — movers, level changes, a fresh highest-leverage move. On a *stable* one, no. Do I trust a move is real? Only on the org trajectory, not on the repo movers. Does the cost pencil out? I can't tell, because the price is invisible. Would I tell a peer? "Sticky bones — trajectory and percentile are a real moat — but they let re-scan noise wear the same badge as signal, and they hide the price. Position on 'trustworthy movement' and 'see what you pay,' and watch their stable-fleet cohort for the usage-decay churn."

## Scores & verdicts
- **Grounding score: 4/6** recurring-context sources reach a *trustworthy* read. History/trajectory ✅ (needs repetition, surfaces R²). Movers/period-delta ✅ compute vs prior scan with provenance — but ❌ fail the "is the move real" test (no noise defense at the panel). Tier-gated retention ✅ legible. Cross-org percentile ✅. The two that don't fully reach: **noise-vs-signal on movers** (the guard exists but is mis-routed) and **price-to-value** (subscription $ absent). The machinery is good; two feeds are thin exactly where renewal is decided.
- **Per-cycle value (number): ~2–3 hrs saved/cycle vs a hand-rolled DORA review, BUT new-actioned-decisions per cycle = ~1 on a moving fleet, ~0 on a stable one.** Her real metric is the decision count: 1 retains, 0 churns. Time-saved is necessary, not sufficient.
- **Renew / downgrade / churn / upgrade: RENEW (Pro/Team, conditional) — would tip to CHURN on a stable/mature fleet within ~1 quarter.** One-line reason: the moats (trajectory GPS, cross-org percentile, .ai loop) earn the subscription on a *moving* fleet, but the movers-noise trust wound + the stable-fleet plateau + invisible price are a live churn clock for any low-velocity customer.

## l2_priority carry-forward
1. **(top)** Under claude-cli, re-scan an unchanged repo twice — does dOverall move within ±25, surface as a "mover" in PeriodSummary, and carry NO noise annotation? (CAM-L1-01 — the sharpest churn vector.)
2. On a stable seeded org, does cycle 2's Overview/digest say anything new, or is it last cycle re-dated — and does percentile/cohort drift fill the gap? (CAM-L1-02)
3. Confirm /pricing shows no $ for Pro/Team and whether /usage's credit-burn trend lets a customer back into value without the price. (CAM-L1-03)
