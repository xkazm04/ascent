# L1 — Theo (PE portfolio engineering lead) × repeated-org-scans-worth-the-price

**Verdict: L1-conditional** — the recurring read is structurally sound *per company* and quarterly cadence is honestly caveated (the `fitQuality`/"noisy" flag is the design's strongest asset for this character), but the **cross-company comparability** Theo is actually buying is only partly delivered: there is **no fleet-of-fleets view** (each `/org/[slug]` is one company, so assembling 15 onto one comparable slide is still his manual work), and the **per-repo archetype lens varies the weights across companies** (`model.ts:203`) without that being surfaced as a comparability caveat. L2-eligible.

## Reachable surface set (tier-honest — Theo is **Enterprise**)
Under `ASCENT_AUTH_BYPASS=1` on a populated org he reaches the full `/org/*` set as a synthetic owner. At **Enterprise** his entitlements are the richest tier — unlimited scans (no credit debit, `plans.ts:58-63`), unlimited members, **custom retention** (`retentionDays: null`, `plans.ts:61`) so the trajectory can look back as far as data exists. So nothing in the recurring set is gated *away* from him by tier. His constraints are not entitlement — they're **structural**:
- **Per company (reachable, his core loop):** `/org/[slug]` overview — fleet number, posture, **Trajectory** (`page.tsx:216`), **PeriodSummary**/movers (`page.tsx:183`); `/org/[slug]/executive` board briefing + read-only **share** (`/share/briefing/[token]`, `briefing.ts`); `/trends` rear-view history; `/usage` (irrelevant to him — Enterprise doesn't burn credits).
- **`/pricing`** — renders his tier as **"Custom — contact us"** (`pricing/page.tsx:19`); no self-serve $ for Enterprise (acceptable to him, see price-legibility below).
- **NOT in the product (the gap):** any *cross-org / portfolio* roll-up. The org dashboards are single-tenant by slug (`org-rollup.ts:147` keys everything to one `org.id`). "Fleet-of-fleets" is the character's framing, not a surface that exists.

## Surface-model notes (recurring-value affordances → file:line; grounding emphasis)

**Trend confidence at quarterly cadence — the facet Theo owns. This is the design's win.**
- The trajectory only renders at all when there are **≥2 distinct calendar days** of scans: `forecastTrajectory` returns null below that (`forecast.ts:87` and the same-day collapse guard `forecast.ts:100`), and the overview only mounts `<Trajectory>` when `rollup.forecast` is non-null (`page.tsx:216`). So **repetition is required** for this feature to exist — exactly the L1 sweet spot.
- Fit quality is computed as R² (`forecast.ts:123`) and **surfaced on-screen** as `trend confidence {confidence}%` with a literal **`· noisy`** suffix when `confidence < 50` (`Trajectory.tsx:96`). For Theo at ~4 quarterly points, a wobbly series will read low-R² and self-label noisy — this is precisely the caveat that keeps him from presenting a phantom trend. Strong.
- The **`FLAT_PER_WEEK = 0.5`** floor (`forecast.ts:64,131`) collapses sub-0.5/wk drift to `trajectory: "flat"`, which **suppresses the ETA** (`forecast.ts:147` → `eta: null`) and the headline says "Holding … no level change projected" (`forecast.ts:291`). So a near-flat mature portco won't be handed a fabricated promotion ETA. Good defense.
- **Caveat Theo will notice:** R²/`fitQuality` lives **only** on the `Trajectory` card. The **movers/period deltas** (`PeriodSummary`, `org-rollup.ts:130` `computeWindowDeltas`) and the **executive briefing** (`briefing.ts:128` prior-period; `:227` forecastHeadline) present movement numbers **without** the confidence flag attached to *that* number. A +6 cohort-matched delta over a quarter is shown with no "is this inside re-scan noise" annotation — the only noise defense is on a different card. For an IC deck, the caveat and the number must travel together; today they don't.

**Cross-company comparability — the other half of his job, partly delivered.**
- The yardstick IS normalized in the important sense: every company's overall is the **same renormalized, 9-dimension, 0–100 weighted mean** (`overallScoreFor`, `model.ts:227`), same 5-level ladder (`model.ts:25`), same posture rule (`model.ts:267`). That's a real, consistent ruler — far better than 15 consultants' bespoke grades.
- **But the weights are not identical across companies.** The archetype lens (`ARCHETYPE_WEIGHTS`, `model.ts:203`) re-weights `solo`/`team`/`org` — a tiny embedded portco scored under the `solo` lens (D1/D2 at 0.20) is **not** on the same weight vector as a 300-eng SaaS org under `org` (D1 0.15). The model's *intent* is fairness (don't drag single-author work to L1 for lacking org infra), but for a PE buyer ranking A vs B that is a **comparability footnote that is never surfaced**. Two companies can have the same 72 computed from different weightings. Theo needs that disclosed or he can't certify "apples-to-apples" to the IC.
- **No portfolio aggregation surface.** `getOrgRollup` is per-`org.id` (`org-rollup.ts:147`); the executive briefing is per-org (`briefing.ts:89`). There is no "book of 15" comparable table or cross-company trend. Theo's headline JTBD — one slide ranking 15 companies — is **his manual assembly**, which is the exact toil he's paying to remove.

**Recurring-value machinery (does this cycle say something new):**
- Cohort-matched period deltas (`org-rollup.ts:130`) correctly measure movement **only over repos present on both sides** of the window — so onboarding a portco mid-quarter doesn't fake a swing. Honest. (`page.tsx:183` PeriodSummary; `briefing.ts:128` prior-period dimension deltas.)
- Movers carry provenance/level transitions into the briefing (`briefing.ts:186-187`), and the briefing names a **recommended next move** on-screen (`briefing.ts:260-266`) — board-shaped, actionable, re-pullable. This is the per-company deliverable he'd drop in a deck.

## Findings

```json
[
  {
    "id": "THEO-L1-01",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "theo-pe-portfolio",
    "cert_level": "L1",
    "type": "missing-feature",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "med" },
    "dimension": "missing",
    "title": "No fleet-of-fleets / cross-company view — assembling 15 portcos onto one comparable slide is still manual",
    "expected": "A PE portfolio buyer's core quarterly job is ONE comparable view ranking all ~15 companies on the same ruler. The recurring value is the cross-company composition, not 15 separate dashboards.",
    "got": "Org dashboards are single-tenant by slug; getOrgRollup and the executive briefing are scoped to one org.id. To brief the IC, Theo opens 15 /org/[slug] tabs and re-assembles the numbers into a deck by hand — the exact toil he is paying to remove.",
    "evidence": ["src/lib/db/org-rollup.ts:147", "src/lib/org/briefing.ts:89", "src/app/org/[slug]/page.tsx:216"],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "l2_priority": "Confirm live there is no /portfolio or cross-org index surface reachable to an Enterprise owner; if only per-slug dashboards exist, the cross-company roll-up is genuinely user-side manual.",
    "suggested_acceptance": "An Enterprise account can list its orgs and see a comparable table (overall, posture, Δ vs prior quarter, trend confidence) across all of them in one view."
  },
  {
    "id": "THEO-L1-02",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "theo-pe-portfolio",
    "cert_level": "L1",
    "type": "trust",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "Archetype lens varies the weights across companies, but cross-company comparability is never caveated",
    "expected": "When ranking company A vs B for the IC, the buyer must be able to certify apples-to-apples. If the weight vector differs by repo archetype, that comparability limit must be disclosed at the point of comparison.",
    "got": "Every company's overall uses the same 9 dims and 0–100 scale (good), but ARCHETYPE_WEIGHTS re-weights solo/team/org (e.g. D1 0.20 solo vs 0.15 org). Two portcos can show the same 72 from different weightings, and nothing surfaces that. The intent (fairness for small/embedded repos) is sound; the disclosure for a comparison buyer is missing.",
    "evidence": ["src/lib/maturity/model.ts:203", "src/lib/maturity/model.ts:227", "src/lib/scoring/engine.ts:107"],
    "code_check": "present-but-missed",
    "verdict": "confirmed",
    "l2_priority": "Scan two portcos of different archetype to identical overalls; confirm the UI shows no note that the weighting lens differed — i.e. the comparison is presented as if identical-rubric when it isn't.",
    "suggested_acceptance": "Where two orgs/repos are compared, the archetype lens used for each is shown, with a one-line note when they differ."
  },
  {
    "id": "THEO-L1-03",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "theo-pe-portfolio",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "minor",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "med" },
    "dimension": "trust",
    "title": "Trend-confidence (R²/noisy) lives on the Trajectory card only — movers, period deltas, and the briefing present movement numbers with no confidence attached",
    "expected": "At ~4 quarterly points, every movement number Theo would put in front of the IC should travel WITH its confidence caveat, so a re-scan/guardband wobble isn't presented as a trend.",
    "got": "fitQuality + the '· noisy' flag render only inside <Trajectory> (Trajectory.tsx:96). The cohort-matched period delta (org-rollup.ts:130 / PeriodSummary) and the executive briefing's prior-period deltas and forecastHeadline (briefing.ts:128,227) show movement with no confidence annotation on that number — the caveat and the figure are on different surfaces.",
    "evidence": ["src/components/org/Trajectory.tsx:96", "src/lib/db/org-rollup.ts:130", "src/lib/org/briefing.ts:128"],
    "code_check": "present-but-missed",
    "verdict": "confirmed",
    "l2_priority": "On a sparse (~4-point) seeded history, check whether the executive briefing / movers annotate any 'low confidence' caveat, or present deltas bare.",
    "suggested_acceptance": "The executive briefing and period-delta tiles carry the same trend-confidence/noisy flag (or suppress the trend claim) when fitQuality is low."
  },
  {
    "id": "THEO-L1-04",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "theo-pe-portfolio",
    "cert_level": "L1",
    "type": "confusion",
    "severity": "minor",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "low" },
    "dimension": "clarity",
    "title": "Enterprise price is 'Custom — contact us' — value↔cost can't be computed self-serve",
    "expected": "A recurring-value buyer maps cost to value each renewal. Even for Enterprise, a starting figure or unit model would let Theo sanity-check.",
    "got": "pricing/page.tsx renders Enterprise as amount 'Custom', note 'contact us' (pricing/page.tsx:19); plans.ts carries no dollar amounts by design (Polar holds the price). Acceptable for Theo specifically — spend is trivial vs deals and Enterprise is committee-negotiated — but the price is structurally invisible in-app, so this is a legibility note, not a blocker for him.",
    "evidence": ["src/app/pricing/page.tsx:19", "src/lib/plans.ts:62"],
    "code_check": "by-design",
    "verdict": "confirmed",
    "l2_priority": "n/a — pricing visibility is a known by-design property; no live confirmation needed."
  },
  {
    "id": "THEO-L1-05",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "theo-pe-portfolio",
    "cert_level": "L1",
    "type": "trust",
    "severity": "polish",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "low" },
    "dimension": "trust",
    "title": "STRENGTH — quarterly cadence is honestly caveated: R² 'noisy' flag + FLAT_PER_WEEK floor stop a confident line through 4 dots",
    "expected": "At ~4 points/year a naive trajectory would draw a confident ETA through noise — the credibility-killer for an IC deck.",
    "got": "fitQuality (R²) is surfaced as 'trend confidence N%' with a '· noisy' suffix under 50% (Trajectory.tsx:96), and FLAT_PER_WEEK=0.5 collapses sub-threshold drift to flat → ETA suppressed (forecast.ts:64,131,147). A near-flat mature portco reads 'Holding … no level change projected' rather than a fabricated promotion. This is exactly the defense Theo needs to NOT over-claim a trend.",
    "evidence": ["src/lib/maturity/forecast.ts:64", "src/lib/maturity/forecast.ts:131", "src/components/org/Trajectory.tsx:96"],
    "code_check": "by-design",
    "verdict": "confirmed",
    "l2_priority": "Seed exactly 4 quarterly points with mild scatter under claude-cli; confirm the card shows low trend-confidence/'noisy' and suppresses a phantom ETA rather than drawing a confident line."
  },
  {
    "id": "THEO-L1-06",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "theo-pe-portfolio",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "polish",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "low" },
    "dimension": "completion",
    "title": "STRENGTH — per-company executive briefing is genuinely IC-deck-grade and shareable",
    "expected": "Each cycle should yield a board-shaped, re-pullable per-company artifact, not a metrics wall to re-interpret.",
    "got": "buildExecBriefing assembles standing + prior-period movement + forecast + named next move (briefing.ts:128,227,260-266); cohort-matched deltas avoid composition artifacts (org-rollup.ts:130); read-only share via /share/briefing/[token]. This is the per-company slide Theo would drop into the deck — the recurring deliverable holds up.",
    "evidence": ["src/lib/org/briefing.ts:89", "src/lib/db/org-rollup.ts:130", "src/lib/org/briefing.ts:260"],
    "code_check": "by-design",
    "verdict": "confirmed",
    "l2_priority": "Confirm the briefing share renders standalone (no auth) and reads board-grade under claude-cli output."
  }
]
```

## Character feedback (Theo, first person)

Would I renew? Yes — but as a *per-company instrument*, not yet as the portfolio tool I want it to be. Here's the honest read.

The thing I was most worried about — drawing a trend through four quarterly dots and embarrassing myself in front of the IC — they actually got right. The trajectory card tells me the R² and literally stamps "noisy" when the fit is weak, and it won't hand me a fake promotion ETA when a mature portco is basically flat. That's the difference between an instrument and a toy. I can trust the *shape* of what it's telling me, and when I can't, it says so. Most dashboards I've bought would have drawn me a confident green arrow through pure scatter. This one doesn't. Credit where due.

Is each cycle telling me something new? Per company, yes — the period deltas are cohort-matched, so onboarding a weak portco mid-quarter doesn't fake a fleet swing, and the executive briefing names the next move instead of making me re-derive it. That's a slide I'd drop in the deck.

But two things stop me from saying "this runs my book." First — there's no book. Every dashboard is one company at a time. My whole job is fifteen companies on *one* comparable slide, ranked, with the two that need an intervention flagged. The product makes me open fifteen tabs and assemble that myself — which is the toil I'm paying to delete. Second — when I *do* put company A next to company B, I can't fully certify apples-to-apples, because the scoring quietly re-weights the dimensions by repo archetype. I get the intent — don't punish a tiny embedded team for not having org-scale CI — but if a 72 on a SaaS shop and a 72 on an embedded portco came from different weight vectors and nothing tells me that, that's a footnote the IC will catch before I do.

Do I trust a move is real? On the trajectory card, yes. In the briefing and the movers panel — less, because the confidence flag lives on a *different* card than the movement number. For a board read, the caveat has to ride with the figure.

Can I see the price? No — Enterprise is "contact us." For me that's fine; the spend is a rounding error against the deals and it's a committee negotiation anyway. I'm not churning over price; I'd churn over a number I can't defend.

What's missing for MY job: a portfolio roll-up — fifteen companies, one comparable table, Δ vs last quarter, trend-confidence per row. Get me that and the trend-confidence riding with every movement number, and this goes from "a good per-company audit I still have to assemble" to "the instrument I run the book on." Would I tell a peer? Yes — "best single-company AI-maturity read I've seen; just budget time to stitch the portfolio yourself for now."

### Scores & verdict
- **Grounding score: 4 / 5** recurring-context sources reach the read. (1) Trajectory **requires** real ≥2-day history and renders R²/"noisy" — yes. (2) Cohort-matched **movers/period deltas** with provenance — yes. (3) **Retention** at Enterprise is custom/unbounded so the trajectory can look back as far as data exists — yes (and at quarterly cadence retention is never his binding constraint). (4) The **noise-is-real defense** (R²/flat-floor) exists but is **not** co-located with the movement numbers in the briefing/movers — **partial**. (5) A **cross-company** comparable read — **absent**, so the portfolio-level recurring context never reaches one view. Counting the four that land: **4/5**.
- **Per-cycle time-saved (number): ~25–30 hours/quarter** (≈3–4 days) vs his manual baseline of stitching ~15 bespoke audits into one comparable deck — **realized only per company today**; the cross-company assembly (~half a day of the saving) is clawed back by THEO-L1-01 until a portfolio view exists. Net realized now: **~20–24 hrs/quarter**; full ~30 hrs unlocks with a fleet-of-fleets surface.
- **Renew / downgrade / churn / upgrade: RENEW (hold Enterprise).** One-line reason: the per-company quarterly read is trustworthy and IC-deck-grade and the trend is honestly caveated — worth far more than the trivial spend — but he renews *wanting the portfolio roll-up*, and that gap (not price) is the only thing that would erode the read into "I stopped opening it."

## l2_priority carry-forward
1. **(THEO-L1-05 / facet core)** Seed exactly **~4 quarterly points with mild scatter** under `LLM_PROVIDER=claude-cli`; confirm the Trajectory shows **low trend-confidence / "noisy"** and **suppresses a phantom ETA** rather than drawing a confident line — the make-or-break for quarterly cadence.
2. **(THEO-L1-03)** On that sparse history, check whether the **executive briefing / movers annotate confidence** or present period deltas **bare** — does the caveat travel with the number for an IC read?
3. **(THEO-L1-02)** Scan two portcos of **different archetype** to near-identical overalls; confirm the UI **never discloses** the differing weighting lens — i.e. the cross-company comparison is presented as identical-rubric when it isn't.
4. **(THEO-L1-01)** Confirm live there is **no cross-org/portfolio index** reachable to an Enterprise owner — only per-slug dashboards — so the fleet-of-fleets assembly is genuinely manual.
