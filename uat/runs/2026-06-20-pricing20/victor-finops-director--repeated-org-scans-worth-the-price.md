# L1 — Victor (FinOps-minded Engineering Director) × repeated-org-scans-worth-the-price

**Verdict: L1-conditional** — the recurring maturity read is structurally sound and reachable at Team, but the *budgeting* job Victor actually owns has a structural hole: `/usage` shows burn but never against the **500 included allotment**, so he can't right-size the tier from inside the product, and Pro/Team show no price so $/scan has a blank denominator. He completes the journey and renews-for-now, but only because rollover quietly favors him — a fact the UI never states.

## Reachable surface set (tier-honest, Team = 500 credits, 365-day retention)
- **Reachable + tier-included:** `/org/[slug]` overview (Trajectory, movers/period), `/org/[slug]/executive`, `/trends` (full 365-day history — Team's retention buys the long look-back), `/usage` (credit burn, token cost, balance, reconciliation), `/pricing`, the credits chip + ledger, scheduled autoscans + alerts (Pro+, so included at Team), segments/comparisons + playbooks (Team-only).
- **Reachable under bypass but judged honestly:** all `/org/*` render as synthetic owner — but at Team everything in this journey is genuinely entitled, so nothing here is an unreachable upsell *for Victor* (his tier is the second-richest). His pressure is the opposite of a Free user's: not "locked out," but "am I paying for headroom I don't use."
- **Structurally absent (not a tier gate — missing for everyone):** burn-vs-allotment utilization, rollover/reset statement, over/under-provisioning nudge, subscription $ for Pro/Team.

## Surface-model notes (recurring-value affordances → file:line, Victor's unit-economics angle)
- **Burn is shown, allotment is not.** `UsageTrend.tsx:14-15,27-29` sums `totalBillable`/`totalFree` and labels "N billable / N free"; the page (`src/app/usage/page.tsx:208`) shows `Billable (private)` as a raw count. **Nowhere** is `PLAN_FEATURES[plan].includedCredits` (the 500) loaded or rendered — `/usage` never imports `plans`/`includedCredits` (grep: no match in `src/app/usage`). So there is **no "X of 500 used (Y%)"** — the one number FinOps right-sizing turns on.
- **Balance without a tank size.** The credits Stat (`usage/page.tsx:216-228`) shows `credit.balance` + a runway (`runwayDays`, line 164) but no denominator. The org credits chip is the same: `CreditsControl.tsx:124,135` renders `{balance} credits` with no "of 500." A fuel gauge, no tank.
- **Credits are a persisted pool — they roll over — but the UI says "/ month."** `Organization.scanCredits Int @default(0)` (`prisma/schema.prisma:34`) is a single integer; `grantCredits`/`consumeScanCredit` only `increment`/`decrement` it (`credits.ts:112-116,162-165`). **No period/reset/billingCycle field exists** and **no monthly-reset cron** touches it (schema grep clean). Yet `/pricing` advertises "500 private scans / month" (`pricing/page.tsx:64-65`, `plans.ts:53`). So unused credits **carry over** — favorable to Victor — but the product never says so, and "/month" actively implies use-it-or-lose-it.
- **Cost panel shows the vendor's COGS, not Victor's price.** `usage/page.tsx:230-243` renders `Est. cost` from **LLM token rates** (`estimateLlmCostFromTable`, `usage.ts:236-247`) — that's Ascent's inference cost, not Victor's subscription $. His actual price lives in Polar, off-app (`pricing/page.tsx:1-6,15-20` shows `"Prepaid"`, no $). So $/scan = (subscription $) / (scans) has a **blank numerator he can't see**.
- **No right-size guidance.** Runway exists (`usage/page.tsx:164`) but nothing compares burn to allotment to say "you're at 12% — consider Pro" or "98% — Team's ceiling is near." The tool has both numbers (`privateScans` and, via `plan`, the 500) and still makes Victor do the arithmetic.
- **Reconciliation is strong** (`usage/page.tsx:247-269`, `getCreditReconciliation` `credits.ts:227-241`): debited / refunded / granted / net against the ledger — genuinely the kind of audit row Victor respects. It's just scoped to "what was debited," never "what was *committed*."

## Grounding score (recurring-context sources reaching the budgeting read): **2 / 5**
Counting the sources Victor's right-size decision needs:
1. **Period billable burn** → ✅ reaches him (`usage.privateScans`, `usage/page.tsx:208`).
2. **The 500 allotment denominator** → ❌ never rendered (no `includedCredits` import anywhere in the usage surface).
3. **Rollover/reset semantics** → ❌ pool in code (`schema.prisma:34`), "/month" in copy (`plans.ts:53`) — contradictory, never reconciled for the user.
4. **$/scan price basis** → ❌ subscription $ not in app (`pricing/page.tsx:15-20`); only LLM COGS shown.
5. **Over/under-provision nudge** → ❌ absent. (Runway is a partial proxy, but it's balance/burn, not committed/used — doesn't answer "wrong tier.")
The maturity *read itself* (trajectory/movers, Team's 365-day window) grounds well — but that's a different journey; for the **unit-economics** facet this journey scores 2/5.

## Findings

```json
[
  {
    "id": "VIC-L1-01",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "victor-finops-director",
    "cert_level": "L1",
    "type": "missing-feature",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "med" },
    "dimension": "missing",
    "title": "/usage shows credit burn but never against the 500 included allotment — no utilization, so the tier can't be right-sized in-product",
    "expected": "Burn-vs-commitment: 'X of 500 used this period (Y%)' — the one number FinOps right-sizing turns on, so I can downgrade/hold/upgrade with evidence.",
    "got": "A raw 'Billable (private)' count + a balance + a runway, with no allotment denominator. /usage never loads PLAN_FEATURES.includedCredits.",
    "evidence": ["src/app/usage/page.tsx:208", "src/app/usage/page.tsx:216-228", "src/components/usage/UsageTrend.tsx:14-15", "src/components/usage/UsageTrend.tsx:27-29", "src/lib/plans.ts:52-53"],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "l2_priority": "On a Team org with seeded weekly scans, load /usage and confirm no surface renders 'X of 500' or a utilization %; verify the only proximity to a denominator is the balance/runway (balance ÷ burn), not used ÷ committed.",
    "suggested_acceptance": "/usage renders period billable scans against includedCredits as 'X of 500 (Y%)' with a downgrade/upgrade hint when sustained utilization is <25% or >90%."
  },
  {
    "id": "VIC-L1-02",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "victor-finops-director",
    "cert_level": "L1",
    "type": "trust",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "'500 / month' copy over a persisted, rolling-over credit pool — the meter contradicts the marketing, in the vendor's favor but silently",
    "expected": "The app states plainly whether credits roll over (a paid pool) or reset monthly (use-it-or-lose-it) — it flips my budgeting math and is a favorable fact I'd cite to finance.",
    "got": "Organization.scanCredits is one persisted Int with no reset/period field and no monthly-reset cron, so unused credits carry over — yet /pricing advertises '500 private scans / month', implying they expire.",
    "evidence": ["prisma/schema.prisma:34", "src/lib/db/credits.ts:112-116", "src/lib/db/credits.ts:162-165", "src/lib/plans.ts:53", "src/app/pricing/page.tsx:64-65"],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "l2_priority": "Grant 500, consume 50, advance the clock a month (or re-seed), and confirm the balance does NOT reset to 500 — i.e. credits are a rolling pool — then confirm no UI string says so while /pricing says '/month'.",
    "suggested_acceptance": "Either /usage and /pricing state 'credits roll over (prepaid pool)', or a monthly reset is implemented to match the '/month' copy — the field behavior and the label must agree."
  },
  {
    "id": "VIC-L1-03",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "victor-finops-director",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "med" },
    "dimension": "clarity",
    "title": "Pro/Team show no subscription price, so $/scan has a blank denominator — 'worth the price' is literally uncomputable for the tier I'm on",
    "expected": "A dollar figure (or a clear pointer to where it lives) so I can compute $/scan = subscription $ ÷ scans and defend the renewal as a number.",
    "got": "/pricing shows 'Prepaid — credits, 1 per private scan' for Pro/Team and 'Custom' for Enterprise; the only $ on /usage is the LLM token COGS, not my subscription cost.",
    "evidence": ["src/app/pricing/page.tsx:15-20", "src/app/pricing/page.tsx:56-57", "src/app/usage/page.tsx:230-243", "src/lib/db/usage.ts:236-247"],
    "code_check": "by-design",
    "verdict": "confirmed",
    "l2_priority": "Confirm /pricing renders no numeric subscription $ for Pro/Team and that the /usage 'Est. cost' stat is sourced from LLM token rates (COGS), not the plan price — so $/scan stays uncomputable from inside the app.",
    "suggested_acceptance": "Either show a per-credit / subscription $ on /pricing, or deep-link the Polar price into /usage so $/scan can be computed in-product."
  },
  {
    "id": "VIC-L1-04",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "victor-finops-director",
    "cert_level": "L1",
    "type": "missing-feature",
    "severity": "minor",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "low" },
    "dimension": "missing",
    "title": "No over/under-provisioning ('wrong tier') nudge despite the app holding both burn and allotment",
    "expected": "A directional read — 'you used 12% of your allotment 3 periods running → consider Pro' or 'you're at 98% → Team's ceiling is close' — so right-sizing is a glance, not a spreadsheet.",
    "got": "A runway figure (balance ÷ daily burn) only; nothing compares committed (500) to used to flag over/under-provisioning.",
    "evidence": ["src/app/usage/page.tsx:163-166", "src/lib/plans.ts:52-53"],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "l2_priority": "Confirm the only forward-looking figure on /usage is runwayDays (balance/burn) and that no tier-fit/right-size hint is rendered for a low- or high-utilization org.",
    "suggested_acceptance": "When sustained utilization is <25% or >90% of includedCredits, /usage surfaces a downgrade/upgrade suggestion with the supporting %."
  },
  {
    "id": "VIC-L1-05",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "victor-finops-director",
    "cert_level": "L1",
    "type": "trust",
    "severity": "polish",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "low" },
    "dimension": "trust",
    "title": "STRENGTH: credit reconciliation (debited / refunded / granted / net vs ledger) is exactly the audit row a FinOps owner trusts",
    "expected": "Metered scans reconcile against the credit ledger so I can trust the burn number I'm budgeting from.",
    "got": "/usage renders a per-period reconciliation panel — billable scans vs credits debited, refunds for failed/deduped scans, grants, net — sourced from an append-only ledger that stamps balanceAfter per row.",
    "evidence": ["src/app/usage/page.tsx:247-269", "src/lib/db/credits.ts:227-241", "src/lib/db/credits.ts:175-186", "prisma/schema.prisma:72-82"],
    "code_check": "present-but-missed",
    "verdict": "confirmed",
    "l2_priority": "Verify the reconciliation panel renders with real debits/refunds on a seeded Team org and that net ties to billable scans within the window-edge caveat already noted in the UI.",
    "suggested_acceptance": "Reconciliation panel shows debited/refunded/granted/net and the difference note when billable != net debited."
  },
  {
    "id": "VIC-L1-06",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "victor-finops-director",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "polish",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "med" },
    "dimension": "trust",
    "title": "Per-credit value depends on each cycle surfacing something new — the noise/guardband defense (R²/flat-floor) isn't co-located with the move",
    "expected": "A weekly scan that re-renders last week's number isn't worth the credit it burned; I need to know a move is real (repo changed) vs the LLM breathing within its guardband.",
    "got": "The forecast's R²/flat-floor (forecast.ts) is the only 'is this real' signal, but it lives on the trajectory, not beside the movers/period deltas where the cycle's change is read — so per-cycle 'new + actionable' is not guaranteed for a stable fleet.",
    "evidence": ["src/lib/maturity/forecast.ts", "src/lib/scoring/engine.ts", "src/components/org/PeriodSummary.tsx"],
    "code_check": "uncertain",
    "verdict": "uncertain",
    "l2_priority": "Under claude-cli, re-scan an UNCHANGED Team repo twice a week apart; confirm whether the score wobbles within the ±25 guardband and whether /usage-adjacent movers flag it as noise vs real — i.e. does the credit buy a decision or a re-render."
  }
]
```

## Character feedback (Victor, first person)

Would I renew? For now, yes — but not because the page told me to. I renew because a peer tipped me that `scanCredits` is one persisted integer with no reset (`schema.prisma:34`), so my unused credits actually **roll over**. That's the single best fact about this product's pricing and the app never says it — `/pricing` literally tells me "500 / month" like they expire (`plans.ts:53`). A vendor whose meter is *more* generous than its marketing is rare, but I had to read the schema to find out.

Here's my problem. I open `/usage` every cycle and it shows me "47 billable this period," a balance, a runway. **Forty-seven of what?** There's no "of 500." That's a fuel gauge with no tank size — useless for the only decision I'm there to make: am I right-sized, or am I paying for headroom I never touch (`usage/page.tsx:208,216-228`)? FinOps 101 is utilization-vs-commitment, and ~half of bought SaaS goes unused; the tool has both my burn and my allotment and still makes *me* divide them in a spreadsheet. So the 30 minutes a cycle I hoped to save, I don't — the spreadsheet survives.

Can I see the price? No. "Prepaid" (`pricing/page.tsx:15-20`). The only dollar figure on `/usage` is the **LLM token cost** — that's *their* cost of goods, not mine (`usage/page.tsx:230-243`). So $/scan, the number my CFO asks for, has a blank denominator. I can't compute it from inside the product I'm paying for.

Is each cycle telling me something new? The maturity read is good and the 365-day window my tier buys is real — but for a stable fleet I can't yet tell a real move from the model breathing, and the one defense (the forecast R²/flat-floor) isn't sitting next to the movers where I'd read the change. That's an L2 question.

Do I trust the numbers? The **reconciliation panel I do trust** (`usage/page.tsx:247-269`) — debited/refunded/net against an append-only ledger is exactly the audit row I'd build. Credit where due.

Would I tell a peer? I'd tell them "good maturity tool, but do your own right-sizing math — the usage page won't, and check the schema, your credits actually roll over." That's a backhanded recommendation, and it's the product's fault, not mine.

## Per-cycle time-saved: **~30 minutes/cycle on the budgeting job — but only ~0 of it is realized today**
If `/usage` showed burn-vs-500 + rollover + a right-size nudge, my monthly 30–45-min reconciliation spreadsheet collapses to a 2–3-min glance → **~30 min saved/cycle**, plus the quarterly CFO review becomes a screenshot. As built, the missing denominator means the spreadsheet survives, so the realized budgeting time-saved is **~0 min/cycle** today. (The maturity *read* saves time on a different line item; this number is scoped to the unit-economics job Victor owns.)

## Verdict: **renew (for now) — leaning downgrade-curious**
One-line reason: I renew because rollover quietly favors me and the maturity read is genuinely Team-grade — but I'm **downgrade-curious to Pro** and the product gives me nothing to settle it, because it won't show me my utilization against the 500. The day I confirm I'm using <100 scans/month, I drop to Pro and the app will have *helped me leave Team* by refusing to prove I belonged on it.

## l2_priority carry-forward (ranked)
1. **VIC-L1-01** — On a seeded Team org, confirm no surface renders "X of 500" / a utilization %; the budgeting job is structurally unservable in-product.
2. **VIC-L1-02** — Empirically confirm credits roll over (consume, advance a month, balance does NOT reset to 500) while "/month" copy stands — the meter-vs-marketing contradiction.
3. **VIC-L1-06** — Under claude-cli, re-scan an unchanged Team repo twice a week apart: does the score wobble within ±25 guardband, and is the move flagged as real vs noise — does the per-cycle credit buy a decision or a re-render?
4. **VIC-L1-03** — Confirm $/scan stays uncomputable in-app (no subscription $ on /pricing; /usage cost = LLM COGS).
