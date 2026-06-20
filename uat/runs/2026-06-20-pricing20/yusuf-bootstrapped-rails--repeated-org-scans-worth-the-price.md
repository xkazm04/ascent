# L1 — Yusuf (bootstrapped Rails eng lead) × repeated-org-scans-worth-the-price

**Verdict: L1-conditional** — the recurring read is structurally honest about flatness and noise (the monolith's best defense), and credits genuinely persist/roll over, but **the per-cycle price is undecidable in-app** (no subscription $) and **the dashboard is fleet-shaped for a 1-repo shop**, so the cost↔value math Yusuf opened the tab to do can't close. L2-eligible.

## Reachable surface set (tier-honest, Pro)
Under `ASCENT_AUTH_BYPASS=1` on a populated org, Yusuf reaches the full `/org/*` set as a synthetic owner. At **Pro** his entitlements are honest for this journey:
- **Reachable + included:** `/org/[slug]` overview (Trajectory, PeriodSummary, movers, dimension averages), `/trends`, `/usage` (credit balance + burn + reconciliation), `/pricing`, scheduled autoscans + alerts + digest (Pro-tier), **180-day** retention window.
- **By-tier / `unreachable` (fold into price verdict, not free):** Team-only segments/comparisons + playbooks/planning; 365-day/custom retention. None of these are load-bearing for a 1-repo monolith read, so their absence is *not* a churn driver for him — it's the opposite (he's paying for fleet machinery he can't use).
- **Structurally inert for him:** the entire "fleet" vocabulary — movers list, "X repos leveled up", posture *distribution* across repos — degenerates on a 1–3-repo org.

## Surface-model notes (recurring-value affordances → file:line)
- **Flat-trend floor is real and surfaced — the monolith's key defense.** `forecastTrajectory` classifies `|perWeek| < FLAT_PER_WEEK` (=0.5) as `flat` and returns `eta: null` (`src/lib/maturity/forecast.ts:64,130-131,147`); the headline then reads *"Holding around X — no level change projected"* (`forecast.ts:291-292`). `Trajectory.tsx` renders "no level change projected within the year" and a **"trend confidence N% · noisy"** label when R² < 50 (`src/components/org/Trajectory.tsx:88-97`). This is exactly the honesty Yusuf's senior bar demands: a flat monolith reads as flat, and a wobbly near-flat series is labeled noisy rather than dressed as a trend.
- **Forecast needs ≥2 distinct scan days — weekly cadence satisfies it for one repo.** The org trend is avg-overall-per-day across the org's repos (`src/lib/db/org-rollup.ts:219-243`); for a single monolith each weekly scan = one day, so 2+ weekly scans = a fittable line. Repetition is *required* for Trajectory to render (`forecast.ts:87,100` → null under 2 days), and Yusuf's weekly habit clears it.
- **The ±25 guardband / 60-40 blend means an unchanged repo CAN wobble — and nothing at the point-of-display flags it.** A re-scanned monolith with unchanged signals can still move up to `±25 · 0.6 = ±15` per dimension as the LLM breathes within the guardband (`src/lib/scoring/engine.ts:98-102`, constants pinned `LLM_GUARDBAND=25`, `SCORE_BLEND=0.6` in `engine.test.ts:427-428`). The Tile deltas and PeriodSummary ("Fleet maturity climbed +2") present that move with **no noise caveat**; the Trajectory R² is the *only* defense, and it lives in a different card from the headline delta.
- **Movers/PeriodSummary are fleet-shaped — they degrade on 1 repo.** Movers render only when `movers.comparedRepos > 0` AND there are gainers/regressers (`src/app/org/[slug]/page.tsx:278`); on a 1-repo org the gainers/regressers split and "N repos leveled up / slipped" sentence (`src/components/org/PeriodSummary.tsx:25-41`) collapse to one repo's net delta — the "fleet" framing reads as built for someone else.
- **Price legibility: credits ARE shown; the subscription $ is NOT.** `/usage` surfaces the live credit **balance**, a low-balance cutoff warning, and billable-vs-debited reconciliation (`src/app/usage/page.tsx:162,180-194,218,257-264`) — so burn is legible. But `/pricing` shows Pro/Team as **"Prepaid" / "credits — 1 per private scan"** with **no dollar amount** (`src/app/pricing/page.tsx:15-20,56-58`); the real subscription price lives in Polar, off-app. Yusuf cannot compute dollars-per-cycle in-app.
- **Credits persist (roll over) — the overpay fear is half-resolved in the mechanism, hidden in the presentation.** The billing currency is the persisted `org.scanCredits` balance, decremented per scan and topped up via Polar grants (`src/lib/db/credits.ts:58,79,150-186`) — it does **not** reset monthly. So `includedCredits: 100` (`src/lib/plans.ts:40`) is a *plan label*, not a use-it-or-lose-it monthly bucket; unused credits carry. That defangs "90 idle credits burned every month" — but nothing in the UI *says* "your credits roll over", so a frugal buyer reading "100 / month" still assumes monthly waste.

## Findings
```json
[
  {
    "id": "yusuf-price-invisible",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "Yusuf (bootstrapped Rails eng lead)",
    "cert_level": "L1",
    "type": "missing-feature",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "dimension": "clarity",
    "title": "Pro subscription dollar amount is invisible in-app — the cost↔value math can't close",
    "expected": "At /pricing or /usage, see what Pro actually costs in dollars/month, so credits-burned can be weighed against the bill.",
    "got": "Pro/Team render as 'Prepaid' / 'credits — 1 per private scan' with no $ amount; the real price lives in Polar, off-app. A line-item-scrutinizing buyer literally cannot see the price he opened the page to judge.",
    "evidence": ["src/app/pricing/page.tsx:15-20", "src/app/pricing/page.tsx:56-58"],
    "code_check": "by-design",
    "verdict": "confirmed",
    "l2_priority": "Confirm no $ for Pro appears anywhere reachable (/pricing, /usage, the dashboard credits chip) under the bypass.",
    "suggested_acceptance": "Show the per-credit $ (or Pro $/mo) on /pricing, or surface the dollar value of the period's burn on /usage, so cost↔value is computable in-app."
  },
  {
    "id": "yusuf-monolith-fleet-framing",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "Yusuf (bootstrapped Rails eng lead)",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "med" },
    "dimension": "senior-quality",
    "title": "Recurring read is fleet-shaped; on a 1-repo monolith the 'movers / N repos leveled up' machinery degenerates",
    "expected": "For a ~1-repo shop, the weekly read should speak in terms of THIS monolith's dimensions moving, not a fleet of repos climbing/slipping.",
    "got": "Movers render only with comparedRepos>0 and a gainers/regressers split; PeriodSummary narrates 'N repos leveled up / slipped'. On one repo these collapse to a single net delta and read as a dashboard built for a larger company.",
    "evidence": ["src/app/org/[slug]/page.tsx:278", "src/components/org/PeriodSummary.tsx:25-41"],
    "code_check": "present-but-missed",
    "verdict": "confirmed",
    "l2_priority": "Seed a 1-repo monolith org with weekly history; confirm the overview reads as monolith-centric vs fleet-centric and whether movers render anything useful.",
    "suggested_acceptance": "On a 1–2-repo org, swap fleet movers for per-DIMENSION movement on the repo (which dimensions moved since last scan), not a repo-count sentence."
  },
  {
    "id": "yusuf-noise-not-at-point-of-display",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "Yusuf (bootstrapped Rails eng lead)",
    "cert_level": "L1",
    "type": "trust",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "A guardband-sized wobble on an unchanged monolith shows as a delta with no noise caveat where the delta is shown",
    "expected": "When the score moves on a re-scanned repo, the read should say whether that's real change or model breathing (±25·0.6 ≈ ±15/dim is possible with no signal change).",
    "got": "Tile deltas + PeriodSummary ('climbed +N') present the move with no caveat; the only noise defense (Trajectory R²/'noisy') lives in a separate card. A frugal buyer sees +2 and can't tell signal from guardband.",
    "evidence": ["src/lib/scoring/engine.ts:98-102", "src/components/org/PeriodSummary.tsx:33-36", "src/components/org/Trajectory.tsx:92-97"],
    "code_check": "present-but-missed",
    "verdict": "confirmed",
    "l2_priority": "Re-scan an UNCHANGED monolith twice under claude-cli; record whether overall/dimension deltas move within the guardband, and whether any caveat appears beside the delta (not just in Trajectory).",
    "suggested_acceptance": "Annotate a period delta whose magnitude is within the guardband (or whose Trajectory R² is low) as 'within noise — not a confirmed move'."
  },
  {
    "id": "yusuf-credit-rollover-unstated",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "Yusuf (bootstrapped Rails eng lead)",
    "cert_level": "L1",
    "type": "confusion",
    "severity": "minor",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "med" },
    "dimension": "clarity",
    "title": "Credits persist (roll over) but the plan reads '100 / month' — a low-burn shop assumes 90+ idle credits are wasted",
    "expected": "A shop burning ~6 scans/mo against a '100/mo' plan should be told its unused credits carry, or shown a right-size path.",
    "got": "The balance is a persisted pool (org.scanCredits, never reset), so credits DO roll over — but /pricing says '100 private scans / month' with no rollover statement, so the overpay fear stands unrebutted.",
    "evidence": ["src/lib/db/credits.ts:58", "src/lib/plans.ts:40", "src/app/usage/page.tsx:218"],
    "code_check": "present-but-missed",
    "verdict": "confirmed",
    "l2_priority": "Confirm a multi-month seeded org's balance carries unused credits forward (no monthly reset), and that nothing in the UI claims monthly expiry.",
    "suggested_acceptance": "State 'credits roll over' on /pricing or the credits chip; for a low-burn org, surface a downgrade/right-size hint."
  },
  {
    "id": "yusuf-strength-flat-floor-honest",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "Yusuf (bootstrapped Rails eng lead)",
    "cert_level": "L1",
    "type": "trust",
    "severity": "polish",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "low" },
    "dimension": "trust",
    "title": "STRENGTH: a slow monolith reads as flat and labels its own noise — exactly the senior honesty Yusuf demands",
    "expected": "A near-flat one-repo trend should not fabricate a trend or a false-precision ETA.",
    "got": "FLAT_PER_WEEK=0.5 collapses sub-noise drift to 'flat / no level change projected', and Trajectory surfaces R² as 'trend confidence N% · noisy' — so two noisy weekly points don't yield a confident promotion ETA.",
    "evidence": ["src/lib/maturity/forecast.ts:64,130-131,147", "src/components/org/Trajectory.tsx:88-97"],
    "code_check": "by-design",
    "verdict": "confirmed"
  },
  {
    "id": "yusuf-strength-burn-legible",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "Yusuf (bootstrapped Rails eng lead)",
    "cert_level": "L1",
    "type": "trust",
    "severity": "polish",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "low" },
    "dimension": "clarity",
    "title": "STRENGTH: /usage makes per-cycle burn and the credit balance legible (the half of the math that IS shown)",
    "expected": "He can see scans burned vs credits remaining, and reconcile billable scans against debits.",
    "got": "/usage shows billable-vs-free burn, the live balance, a low-balance cutoff warning, and billable-vs-net-debited reconciliation — the credit side of cost↔value is honest and IDOR-guarded.",
    "evidence": ["src/app/usage/page.tsx:162,180-194,218,257-264", "src/components/usage/UsageTrend.tsx:12-29"],
    "code_check": "by-design",
    "verdict": "confirmed"
  }
]
```

## Character feedback (Yusuf, first person)
Would I renew? Honestly — I'd **downgrade if there were a smaller tier, and absent one I'd grind my teeth and keep Pro**, because I can't even see what Pro costs to decide otherwise. That's the thing that gets me: I came to do arithmetic — dollars per actioned move — and the price for my tier isn't in the app. "Prepaid credits." Prepaid *how much*? I'm not booking a Polar call to learn the number I should see on a pricing page.

Is each cycle telling me something new? Sometimes, and — credit where due — when it's *nothing* new it says so. The trajectory holds at my number and calls itself flat, and when the line's wobbly it literally prints "noisy." That I trust. A staff engineer reading my monolith would say "no change this week" most weeks, and this thing isn't too proud to say it. Good.

Do I trust a move is real? Not at the spot where I see it. The tile says "+2," the banner says "climbed +2 to 64," and I happen to know the model can breathe ±15 on a dimension without my repo changing a line. The only thing that tells me a move is real is a confidence percentage parked in a *different card*. Put the caveat next to the number.

Does the cost pencil out at my size? Can't tell — no price. The one relief: I dug into the credit logic and the balance actually *persists*, it doesn't reset monthly, so my 90-odd unused credits aren't torched every month like the "100 / month" line made me fear. But I had to read source to learn that. Tell me on the page.

The fleet framing grates. "Movers." "Repos leveled up." It's one repo, friends. Show me which *dimensions* of my monolith moved, not a roster of repos I don't have.

Would I tell a peer? A fellow bootstrapper running a monolith — I'd say "the maturity read is honest about flat weeks, which is rare, but you can't see the price and the whole thing assumes you have a fleet." Qualified yes.

## Scores
- **Grounding score: 4 / 6** recurring-context sources reach Yusuf's read. Present & reaching: (1) trajectory/flat-floor (`forecast.ts`), (2) R²/noise label (`Trajectory.tsx`), (3) period delta/movers (`PeriodSummary.tsx`, `org-rollup.ts`), (4) credit burn/balance (`usage.ts`, `usage/page.tsx`). Missing/not-reaching: (5) **subscription price** — no $ for Pro anywhere in-app; (6) **noise-at-point-of-display** — the guardband caveat doesn't reach the delta where it's shown (only the separate Trajectory card).
- **Per-cycle time-saved (number): ~25 min/cycle** (≈100 min/month) on the weeks something actually moved — his 30-min manual skim collapses to a ~5-min glance. On flat weeks the honest figure is **~0** (the flat label lets him bail fast, but his gut would've too); netted across a slow monolith's typical 1-in-3 "something moved" week, the realized average is closer to **~8–10 min/cycle**.
- **Renew / downgrade / churn / upgrade: DOWNGRADE** (intent) — *"It's a 7-person monolith shop; Pro's fleet machinery and 100-credit allotment are sized for a company I'm not, and I can't see the price to prove the line item — give me a smaller, priced tier and I'd stay happily; until then it's keep-Pro-grudgingly, drifting toward churn."* Not upgrade (Team adds fleet features he has even less use for); not churn-now (the flat-honest read has real, if intermittent, value).

## l2_priority carry-forward
1. **Noise-at-display:** re-scan an unchanged monolith twice under `claude-cli`; record whether overall/dimension deltas move within the guardband and whether ANY caveat appears beside the delta (not just in Trajectory). *(top priority)*
2. **Weekly-vs-monthly signal:** with weekly vs monthly seeded cadence on one slow repo, does the weekly digest/overview ever say something the monthly wouldn't — or is weekly pure habit?
3. **Price reachability:** confirm under the bypass that no Pro dollar amount is reachable from /pricing, /usage, or the credits chip.
4. **Credit persistence:** confirm a multi-month org carries unused credits forward (no monthly reset) and the UI never claims monthly expiry.
