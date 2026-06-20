# L1 — Klaus (embedded firmware lead) × repeated-org-scans-worth-the-price

**Verdict: L1-conditional** — the low-velocity recurring read is structurally *better* than expected (flatness is framed as a verdict, an unchanged-commit rescan dedups and refunds, the noise floor + R² are surfaced on the trajectory), so repetition genuinely pays off for a slow repo. It drops to *conditional* on two recurring-value/legibility gaps: (a) the trend-confidence/flat-floor lives on the **Trajectory** card but the **PeriodSummary** "movers" line restates deltas with no noise guard, and (b) at Pro he renews against a **price he literally cannot see** (only "prepaid credits," no subscription $). Neither blocks the job; both shape the renew decision.

## Reachable surface set (tier-honest, Pro)
Under `ASCENT_AUTH_BYPASS=1` on a populated `/org/<slug>` he renders as a synthetic owner, but judged at **Pro** entitlements:
- **Reachable + included at Pro:** `/org/[slug]` overview (Trajectory + PeriodSummary movers), `/org/[slug]/executive`, `/trends` + `/api/history`, `/usage` (credit burn), `/pricing`, **scheduled autoscans + alerts** (`ScheduleSelect`, `AlertsControl`, `/api/cron/rescan`), **180-day** retention window.
- **Reachable via bypass but NOT his tier (fold into upsell, not free value):** Team-only **segments + comparisons**, **playbooks + planning**, **365-day** history; Enterprise unlimited/custom retention. His trajectory can look back **180 days** — for a repo that changes a few times a quarter that is ~2-3 distinct data points per fit, which is the binding constraint on his whole journey.
- **Cost of his cadence:** P private repos × monthly = **P credits/month** against Pro's 100 included — but an *unchanged* repo dedups and **refunds**, so a flat fleet's true burn is ≈ (repos that actually changed)/month, not P. This is the single best fact for his price verdict.

## Surface-model notes (recurring-value affordances → file:line)

**The flat-trajectory experience is handled well (his owned facet).**
- `forecastTrajectory` returns `null` below 2 distinct calendar days (`src/lib/maturity/forecast.ts:87,100`) — so for a repo scanned monthly, the trajectory only renders after **2+ months of history**; cycle 1 has no GPS. Once it renders, `FLAT_PER_WEEK=0.5` (`forecast.ts:64,130-131`) classifies sub-noise drift as `flat`, and `forecastHeadline` emits **"Holding around N (L-x) — no level change projected."** (`forecast.ts:291-292`) rather than a blank or a fake trend. This is exactly the "flatness as verdict" Klaus wants.
- `Trajectory.tsx` renders that headline plus **"no level change projected within the year"** and **"trend confidence {R²}% · noisy"** when R²<50 (`src/components/org/Trajectory.tsx:50,88-97`). The noise guard *is* surfaced — on this card.

**The noise/signal guard is surfaced on Trajectory but NOT on the movers banner.**
- `PeriodSummary` ("Quarter in review") handles no-change explicitly: **"Fleet maturity held at N."** + **"No level changes across the fleet."** (`src/components/org/PeriodSummary.tsx:33-41`). Good — it doesn't restate a number as if it were news. But it prints `deltas.overall` (`signedDelta`) with **no R²/noise context** (`PeriodSummary.tsx:34-36,60-64`): a ±1-2 blended-score wobble between two scans of an unchanged repo would render as "Fleet maturity climbed +2" with no "this is within noise" flag. The defense (R²/flat-floor) exists one card away but isn't bound to where the move is *stated*.

**Score-move trust = the guardband, fed by claude-cli.**
- `LLM_GUARDBAND=25`, `SCORE_BLEND=0.6` (`src/lib/maturity/model.ts:16,23`): the LLM nuance is clamped ±25 of the deterministic signal and blended 60/40. On an unchanged repo the deterministic half is identical scan-to-scan, so any wobble is the LLM half breathing within its band — small, but nonzero, and exactly what Klaus distrusts. Whether it actually wobbles under `claude-cli` is an L2 question.

**The cost↔value machinery for a slow repo is genuinely good.**
- Unchanged-commit dedup: `persistScanReport` keys on `headSha`, finds the existing scan, returns **`deduped:true`** and writes NO new metered row (`src/lib/db/scans-persist.ts:144-148`). The cron rescan **refunds the credit** on dedup and **suppresses the regression alert** (`src/app/api/cron/rescan/route.ts:136,138`). So a monthly autoscan of a repo that didn't change is **free and silent** — cost tracks new information, not the calendar. This is the answer to "am I paying for a flatline": *no, you're not charged for the unchanged scans.*
- Low-credits push fires on the way down (`scan-alerts.ts:110-131`, cron `:113`) so a slow drain still reaches a human.

**The lens-fit problem is real and unmitigated.**
- The 9-dimension model (`src/lib/maturity/model.ts:68-157`) and the L1→L5 ladder (`:25-66`) frame **L5 Autonomous** ("agents propose, test, document, and ship... humans supervising at the policy level") as the top. For safety-critical firmware under ISO 26262 / DO-178C, autonomous ship is *prohibited*, not aspirational — so Klaus's repos may correctly cap at L1-L2 forever. The `solo`/`team` archetype lenses down-weight org-scale infra (`model.ts:203-207`) but there is **no embedded/safety-critical archetype** and nothing in the level descriptions says "L1 can be the correct posture." The roadmap will keep recommending moves up a ladder his domain shouldn't climb.

**Retention is the quiet constraint.** Pro = **180 days** (`src/lib/plans.ts:41`). A monthly cadence yields ~6 points in-window; a quarterly-changing repo yields ~2 *distinct* score values to fit — barely above `forecast.ts`'s 2-day floor. His trajectory is structurally thin not because the machinery is weak but because his velocity starves it.

## Findings

```json
[
  {
    "id": "klaus-flat-verdict-strength",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "klaus-embedded-firmware",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "polish",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "low" },
    "dimension": "clarity",
    "title": "STRENGTH: flat trajectory is framed as a verdict ('Holding around N — no level change projected'), not a blank",
    "expected": "On a slow repo, the recurring read should say 'stable, no regression' rather than render nothing.",
    "got": "forecastHeadline emits 'Holding around N (L-x) — no level change projected.' and PeriodSummary emits 'Fleet maturity held at N. No level changes across the fleet.' — flatness IS the message.",
    "evidence": ["src/lib/maturity/forecast.ts:291-292", "src/components/org/PeriodSummary.tsx:33-41", "src/components/org/Trajectory.tsx:50,88"],
    "code_check": "present-but-missed",
    "verdict": "confirmed",
    "l2_priority": "Confirm live: on a seeded unchanged repo, does the overview render the 'held at N / no level changes' framing and a populated Trajectory card (not a blank)?"
  },
  {
    "id": "klaus-dedup-refund-strength",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "klaus-embedded-firmware",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "polish",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "low" },
    "dimension": "trust",
    "title": "STRENGTH: an unchanged-commit autoscan dedups, refunds the credit, and suppresses the regression alert — cost tracks new info, not the calendar",
    "expected": "A monthly rescan of a repo that didn't change should not bill me and should not spam a 'regression' alert.",
    "got": "persistScanReport returns deduped:true with no new metered row; cron rescan refunds the credit and only alerts when !deduped.",
    "evidence": ["src/lib/db/scans-persist.ts:144-148", "src/app/api/cron/rescan/route.ts:136", "src/app/api/cron/rescan/route.ts:138"],
    "code_check": "present-but-missed",
    "verdict": "confirmed",
    "l2_priority": "Confirm live: rescan an unchanged repo via /api/org/scan twice — second run returns deduped (x-ascent-dedup: hit) and the credit balance is unchanged."
  },
  {
    "id": "klaus-movers-no-noise-guard",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "klaus-embedded-firmware",
    "cert_level": "L1",
    "type": "trust",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "The 'movers' banner states a score delta with no noise/confidence guard — a guardband wobble reads as a real climb",
    "expected": "Where a score move is STATED ('Fleet maturity climbed +2'), the noise floor / trend-confidence should be co-located so I can tell signal from the model breathing on an unchanged repo.",
    "got": "PeriodSummary prints deltas.overall via signedDelta with no R²/flat-floor context; the only noise guard (trend confidence %, FLAT_PER_WEEK) lives on the separate Trajectory card. The defense exists one component away from where the move is asserted.",
    "evidence": ["src/components/org/PeriodSummary.tsx:34-36", "src/components/org/PeriodSummary.tsx:60-64", "src/components/org/Trajectory.tsx:92-97", "src/lib/maturity/model.ts:16,23"],
    "code_check": "present-but-missed",
    "verdict": "uncertain",
    "l2_priority": "Re-scan an unchanged repo twice under claude-cli — does the blended overall actually move within the guardband, and if so does ANY surface near the mover banner flag it as within-noise? If it moves and nothing flags it, this is confirmed.",
    "suggested_acceptance": "When |deltas.overall| is within the blend's guardband-implied noise (or trend confidence < 50%), the period summary annotates the delta as 'within noise' rather than asserting a climb/slip."
  },
  {
    "id": "klaus-lens-fit-embedded",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "klaus-embedded-firmware",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "major",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "high" },
    "dimension": "senior-quality",
    "title": "No embedded/safety-critical archetype; L5-Autonomous framed as the goal for code that legitimately can't ship autonomously",
    "expected": "For ISO 26262 / DO-178C firmware, 'L1 Manual / human-in-the-loop' can be the CORRECT permanent posture; the recurring roadmap should not nag toward autonomy.",
    "got": "Archetype lenses are solo/team/org only — no embedded/safety-critical lens — and the level ladder presents L5 (agents ship with humans supervising 'at the policy level') as the apex with no 'L1 may be correct here' framing. Every cycle the roadmap re-recommends moves up a ladder his domain shouldn't climb.",
    "evidence": ["src/lib/maturity/model.ts:25-66", "src/lib/maturity/model.ts:203-207"],
    "code_check": "by-design",
    "verdict": "confirmed",
    "l2_priority": "Scan a real embedded C/C++ repo under claude-cli — does the roadmap recommend agentic auto-merge/autonomy, and does the level read frame low maturity as a deficiency rather than a defensible posture?"
  },
  {
    "id": "klaus-price-invisible-pro",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "klaus-embedded-firmware",
    "cert_level": "L1",
    "type": "confusion",
    "severity": "major",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "high" },
    "dimension": "clarity",
    "title": "Renewing Pro against an invisible price — only 'prepaid credits', no subscription $ in-app",
    "expected": "At a credit/renewal decision I should see what Pro actually costs.",
    "got": "PLAN_FEATURES carries allotments/retention but no dollars (by design — price lives in Polar); /pricing shows 'Prepaid — credits, 1 per private scan' for Pro/Team. He can price his CREDIT burn but not the subscription line item he's renewing.",
    "evidence": ["src/lib/plans.ts:1-5", "src/lib/plans.ts:35-44"],
    "code_check": "by-design",
    "verdict": "confirmed",
    "l2_priority": "On /pricing, confirm whether ANY subscription dollar figure or Polar link is reachable for Pro, or whether the price is entirely out-of-app."
  },
  {
    "id": "klaus-trajectory-starved-by-velocity",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "klaus-embedded-firmware",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "minor",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "med" },
    "dimension": "missing",
    "title": "Trajectory needs 2+ distinct calendar days; a repo that changes a few times a quarter starves the fit",
    "expected": "The GPS should still read for a deliberately slow repo.",
    "got": "forecastTrajectory returns null below 2 distinct days; a monthly cadence gives no trajectory until cycle 2, and a quarterly-changing repo yields ~2 distinct score values within Pro's 180-day window — a low-R² fit at best. The flat-floor/null is honest, but the feature he'd renew for is thin by his own velocity.",
    "evidence": ["src/lib/maturity/forecast.ts:87", "src/lib/maturity/forecast.ts:100", "src/lib/plans.ts:41"],
    "code_check": "by-design",
    "verdict": "confirmed",
    "l2_priority": "Seed an org with only 2 monthly scans and confirm the Trajectory card renders something useful (low-confidence flat) rather than nothing."
  }
]
```

## Character feedback (Klaus, first person)

"Right — I set up monthly autoscans on repos that change three times a quarter, and the honest question is whether I'm paying for a flatline. First the good news, and it surprised me: the tool doesn't pretend nothing-happened is something. The trajectory card says *'Holding around 41 — no level change projected,'* and the quarter banner says *'Fleet maturity held at 41. No level changes across the fleet.'* That's a verdict, not a blank — that's the one thing every velocity tool I've been pitched gets wrong, and this one gets right. And when I dug into the billing path, an unchanged-commit rescan **dedups and refunds the credit** — so my flat fleet isn't burning my 100/month on scans that found nothing. Cost tracks new information. I can keep that.

What I don't trust yet: the *movers* banner will happily tell me 'fleet maturity climbed +2' with no flag for whether +2 is real or the model breathing within its guardband. The noise floor and the trend-confidence percentage exist — but they're on the *trajectory* card, not next to the number that's making a claim. On an unchanged repo, a +2 I can't trust is worse than no number. Put the confidence where the move is.

And the lens still doesn't understand my world. The ladder treats *L5 Autonomous — agents ship code* as the summit. For firmware that flies things, autonomous ship is illegal, not aspirational. There's no embedded archetype, and nothing tells me 'L1 Manual is the correct answer here.' So every cycle the roadmap nags me toward an autonomy I'm certified *not* to have. That's not a maturity read of my domain, that's a web-dev rubric pointed at a pacemaker.

Can I see the price? No. I'm renewing Pro and the app shows me 'prepaid credits, 1 per scan' — never the subscription dollar. I can price my scan burn; I can't price the line item I'm signing. I'll forgive it because the credit math is in the open, but it's a bad look at renewal.

Would I tell a peer? A firmware peer — yes, with the caveat: it *won't* nag you... actually it will, ignore the roadmap, read the 'held steady' line and the dedup-refund and you've got a cheap, honest regression watch. Would I renew? Yes — but downgrade-adjacent: I keep Pro only because the unchanged scans are free; the day they bill me for a flatline or a noise-move I can't debunk, I'm out to a manual quarterly check."

## Scores & verdict

- **Grounding score: 4 / 6** recurring-context sources reach Klaus's read.
  - ✅ Trajectory needs real history (`forecast.ts:87,100`) — renders for him at cycle 2+, flat-floor honest.
  - ✅ Flatness framed as verdict, not blank (`forecast.ts:291-292`, `PeriodSummary.tsx:33-41`).
  - ✅ Cost↔value: dedup + refund on unchanged commit (`scans-persist.ts:144-148`, `rescan/route.ts:136`).
  - ✅ Retention/tier gating legible (`plans.ts:41` = 180d) — though thin for his velocity.
  - ❌ Noise guard NOT co-located with the stated move (`PeriodSummary.tsx:34-36` has no R²) — the one defense isn't where the claim is.
  - ❌ Subscription price not reachable in-app for Pro (`plans.ts:1-5`) — can't fully price the renewal.
- **Per-cycle time-saved (number): ~20-30 min/month** when it works — the time to hand-confirm "nothing regressed, still stable, still safe" across the slow fleet in one glance with evidence, vs. ~60-80 min/month amortized for his full manual maturity check. At low velocity the upside is *confirmation of stability*, not discovery; the value is real but bounded, and goes **negative** any cycle the movers banner shows an unguarded noise-move he has to debunk.
- **Renew / downgrade / churn / upgrade: RENEW (conditionally, downgrade-watch).** One-line reason: the unchanged-commit dedup-and-refund means he is genuinely *not* paying for the flatline, and flatness is framed as a verdict — so Pro pays for itself as a cheap honest regression watch; but the unguarded movers delta and the embedded-hostile lens keep him one bad noise-move from dropping to a manual quarterly cadence.

## l2_priority carry-forward
1. **(sharpest)** Re-scan an unchanged firmware-style repo twice under `claude-cli`: does the blended overall actually move within the guardband, and does *anything near the movers banner* flag it as within-noise? If it moves and nothing flags it → `klaus-movers-no-noise-guard` confirmed major.
2. Confirm the unchanged-commit path live: second `/api/org/scan` returns dedup (`x-ascent-dedup: hit`) and the credit balance is unchanged — the load-bearing fact behind the renew verdict.
3. Scan a real embedded C/C++ repo: does the roadmap push agentic autonomy onto certified code and frame low maturity as a deficiency? (lens-fit).
4. Seed 2 monthly scans only and confirm the Trajectory card renders a useful low-confidence flat read rather than nothing.
