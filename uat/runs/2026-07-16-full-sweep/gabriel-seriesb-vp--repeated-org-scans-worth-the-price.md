# L1 — Gabriel (Series-B VP Engineering) × repeated-org-scans-worth-the-price

**Verdict: L1-conditional** — the recurring board read is structurally sound, definition-stable, and now shows its own confidence signal on the surface he actually presents; the burn-vs-allotment ceiling gap from the prior L1 pass (2026-06-20) is **fixed**. What remains is a narrower **Enterprise value-legibility** gap: at his cadence he can now roughly *anchor* the bill (Team's price is public), but there is still no cadence calculator and the chip-level ceiling warning stays depletion-only even though `/usage` now carries the pre-wall signal. Completes; not fully clean.

---

## Reachable surface set (tier-honest, Gabriel on **Team**)

Under `ASCENT_AUTH_BYPASS=1` on a populated `/org/<slug>` he renders as synthetic owner (`src/app/org/[slug]/layout.tsx`), so every route below paints. Judged at **Team** entitlements:

- **Reachable + in-tier:** `/org/[slug]` overview (repos×time Fleet rollup + dimension heatmap — `src/app/org/[slug]/page.tsx:100-133`); `/org/[slug]/executive` board briefing + PDF + Copy-for-LLM (`src/app/org/[slug]/executive/page.tsx`); `/trends`; `/usage` (credit burn, allotment, reconciliation, runway — `src/app/usage/page.tsx`); `/pricing`; the `CreditsControl` chip (`src/components/org/shared/CreditsControl.tsx`); segments/comparisons + playbooks/planning (Team-tier); scheduled autoscans + alerts + digest (`src/app/api/org/schedule`, `src/app/api/cron/digest/route.ts` — Pro+, so Team has them).
- **Reachable by bypass but OUT of his tier (the upsell):** unlimited scans, custom retention — the Enterprise-only allowances (`planAllowsByom` is Enterprise-only, `src/lib/plans.ts:177-180`; white-label is actually Team+ now, `planAllowsWhiteLabel`, `plans.ts:154-157`, so that one is no longer an Enterprise-exclusive carrot).
- **His structural wall, unchanged:** Team includes **500** private scans/mo (`src/lib/plans.ts:60`). His cadence is ~60 private repos × ~20 working days = **~1200/mo**. He is **2.4× over** Team's allotment — no in-tier configuration supports his cadence. The next stop is Enterprise = `"Custom"` / `"contact us"` (`src/lib/plans.ts:90`, `src/app/pricing/page.tsx:25-28`).

## Surface-model notes (recurring-value affordances → file:line)

- **Overview replaced its org-level Trajectory card with a repos×time model — the "what changed" question now reads per-repo.** `buildTrajectories` (`src/components/org/overview/repoTrajectory.ts:52-86`) joins each repo's latest snapshot with its history, computing `deltaWindow`/`deltaLast` per repo and flagging `deltaCrossesEngine` — a delta whose two endpoints span a mock→live engine change is muted in the UI, not dressed as real movement (`RepoCategoryRollup.tsx:118-133`). `movedRepos`/`avgRealMove` (`repoTrajectory.ts:165-173`) exclude those from the fleet's improving/slipping/avg-move counts. **Good — this answers "did anything really move" per repo**, but it carries **no R²/fit-quality per repo** — only the binary mock-vs-live flag, not a noise-vs-signal read on an all-live delta.
- **The org-level trajectory forecast (R²) still exists and now reaches the board surface — the prior gap is fixed.** `forecastTrajectory` (`src/lib/maturity/forecast.ts:119-182`) fits an OLS line and returns `fitQuality` (R², 0-1) plus a `lowData` flag (guards against a 2-point "100% confidence" illusion, `forecast.ts:58-63,176-178`). `buildExecBriefing` carries this through as `forecastConfidence`, explicitly suppressed under `lowData` (`src/lib/org/briefing.ts:243-248`). The **executive page now renders it**: `forecastConfidenceNote(briefing.forecastConfidence)` prints `"trend confidence N% · noisy"` directly under the trajectory headline (`src/app/org/[slug]/executive/page.tsx:159-161`; the note function at `briefing.ts:36-39`). It's also baked into the "Copy for LLM" markdown (`briefing.ts:327-330`) and the PDF export path (`buildExecBriefing` feeds `src/lib/pdf/briefing-document.tsx`). This is the exact fix GAB-L1-03 from the prior run asked for.
- **Definition stability (his consistency check) holds, unchanged.** Overall/adoption/rigor come from the same deterministic blend each run (`src/lib/scoring/engine.ts` guardband + blend, unchanged since prior audit). Same computation quarter-over-quarter → board slides are comparable. **Strength.**
- **Period deltas / movers compute against the prior window with provenance.** `buildExecBriefing`'s `priorPeriod` (equal-length preceding window, `briefing.ts:161-226`) and `movement`/`topGainers`/`topRegressions` (`briefing.ts:254-258,283-284`) — rendered as "vs previous period" + "Movement this period" cards on the executive page (`executive/page.tsx:171-226`). This is the "what changed since the board last saw it" his JTBD requires.
- **Burn-vs-allotment ceiling signal now EXISTS — the prior L1's headline finding is fixed.** `allotmentRead` (`src/app/usage/AllotmentPanel.tsx:29-37`) normalizes observed burn to a monthly rate and compares it to `PLAN_FEATURES[plan].includedCredits`, returning a `fit: "under"|"ok"|"over"` and rendering `"You're at ~N% of your 500/mo allotment — top up or move up a tier before private scans pause"` once burn crosses 90% (`AllotmentPanel.tsx:58-63`), wired into `/usage` at `usageDashboard.tsx:110`. The component's own comment names him: *"Victor couldn't tell if Team was over- or under-provisioned, and Gabriel learned the tier ceiling only by hitting a 402"* (`AllotmentPanel.tsx:3-6`) — this is a direct fix of `GAB-L1-01`. Unit-tested (`AllotmentPanel.test.ts`) including a 95/100 "over" case and a 250/500 "ok" case.
- **But the pre-wall signal still doesn't reach the chip he sees every visit.** `CreditsControl` (the header credits chip) is still purely balance-driven: `paused = balance <= 0 && freeScansLeft <= 0` (`CreditsControl.tsx:143`) — no allotment-aware state. The chip goes from calm to "⚠ paused" with nothing in between; the pre-wall warning only exists on `/usage`, a page he has to navigate to, not the ambient header he glances at on every dashboard load.
- **`retentionDays` is now a REAL read-floor, not display-only metadata — the prior GAB-L1-04 gap is fixed.** `retentionCutoff(plan, nowMs)` (`src/lib/plans.ts:189-192`) is read by `getOrgRollup`'s trend query (`src/lib/db/org-rollup.ts:396-397`, clamping the trajectory's lower bound to the plan's window) and by the personal-workspace history read (`src/lib/db/personal.ts:164`). So Team's advertised "365-day history" now genuinely bounds how far back his board trajectory can look — non-destructive (a read floor, not deletion), but real.
- **Price is now visible for the tiers he actually inhabits.** `/pricing` derives numeric `$10`/`$20` for Pro/Team directly from `plans.ts` (`planPriceLabel`, `plans.ts:88-93`; rendered `pricing/page.tsx:80-82`), and Free now includes 5 scans/mo (`plans.ts:36`, up from the 0 the prior audit found). Enterprise alone stays `"Custom"` (`planPriceLabel`'s `billing === "custom"` branch, `plans.ts:90`) with a `mailto:` CTA when `ASCENT_CONTACT_EMAIL` is configured, else a "Learn more" link to `/about` (`pricing/page.tsx:25-28`) — no dead-end "Get started" ternary anymore.
- **Still no cadence calculator at the Enterprise boundary.** `CreditMatrixLedger` (`src/components/pricing/CreditMatrixLedger.tsx`) is a capability/cost-tag matrix ("what draws a credit"), not a volume calculator — nowhere on `/pricing` can he type "1200/mo" and see a number. He *can* now approximate from Team's own rate (`$20/500 ≈ $0.04/scan` → a naive linear extrapolation to 1200 ≈ $48/mo) since the Team price is finally public, but Enterprise pricing is explicitly custom/volume-negotiated, so that extrapolation is his own guess, not a product-provided anchor — the 2025-benchmark bar ("let the buyer model the bill before committing") is only partly met.
- **The `AllotmentPanel`'s "move up a tier" message doesn't distinguish "you're already on the top paid tier."** For a Team org at 240% of allotment, the copy still reads `"top up or move up a tier before private scans pause"` (`AllotmentPanel.tsx:60`) — generic across all three metered plans, not a Team-specific "you need Enterprise" nudge. He'd have to infer that from already being on Team.

## Findings

```json
[
  {
    "id": "GAB-L1-01b",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "gabriel-seriesb-vp",
    "cert_level": "L1",
    "type": "confusion",
    "severity": "minor",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "low" },
    "dimension": "clarity",
    "title": "The burn-vs-allotment ceiling fix lives on /usage, but the header CreditsControl chip he glances at every visit is still depletion-only",
    "expected": "The ambient signal I see on every dashboard load (the credits chip) should hint 'on pace to exceed your tier' before I have to navigate to /usage to see the allotment panel.",
    "got": "CreditsControl's paused state is purely balance-driven (`balance <= 0 && freeScansLeft <= 0`, CreditsControl.tsx:143) with no allotment-aware amber-before-red state; the 90%-of-allotment warning exists only inside AllotmentPanel on /usage.",
    "evidence": ["src/components/org/shared/CreditsControl.tsx:143", "src/app/usage/AllotmentPanel.tsx:35", "src/app/usage/usageDashboard.tsx:110"],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "l2_priority": "Seed a Team org burning >90% of its monthly allotment; confirm the header chip stays a neutral 'N credits' with no allotment cue, while /usage shows the amber 'over' AllotmentPanel — i.e. the signal exists but isn't ambient.",
    "suggested_acceptance": "CreditsControl reads an allotment-fit prop (reusing allotmentRead) and shows an amber (not paused-red) 'near allotment' state before balance hits 0, mirroring /usage's 90% line."
  },
  {
    "id": "GAB-L1-02b",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "gabriel-seriesb-vp",
    "cert_level": "L1",
    "type": "missing-feature",
    "severity": "minor",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "med" },
    "dimension": "missing",
    "title": "No cadence calculator at the Enterprise boundary — he can approximate from Team's now-public price, but the product still doesn't do the arithmetic",
    "expected": "At my cadence (1200 scans/mo) the product does the math and shows me roughly what the Enterprise step-up costs, or at minimum extrapolates from Team's per-scan rate, rather than leaving me to eyeball it.",
    "got": "/pricing now shows real Pro ($10) / Team ($20) monthly prices (plans.ts:88-93, pricing/page.tsx:80-82), a real improvement over the prior all-'contact us' state — but Enterprise stays a bare 'Custom' with a mailto/about CTA (plans.ts:90, pricing/page.tsx:25-28) and CreditMatrixLedger is a capability matrix, not a volume calculator. He can hand-extrapolate ($20/500 -> ~$0.04/scan -> ~$48/mo at 1200) but the product provides no such number, and Enterprise's real (volume-negotiated) pricing likely doesn't follow that linear rate anyway.",
    "evidence": ["src/lib/plans.ts:90", "src/app/pricing/page.tsx:25", "src/components/pricing/CreditMatrixLedger.tsx:15-24"],
    "code_check": "by-design",
    "verdict": "confirmed",
    "l2_priority": "From a Team org over the cap, confirm the only forward path is still the mailto/about CTA with no in-product cadence calculator, and that a numerate viewer's hand-extrapolation from the Team rate is the only anchor available."
  },
  {
    "id": "GAB-L1-03b",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "gabriel-seriesb-vp",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "polish",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "low" },
    "dimension": "clarity",
    "title": "The AllotmentPanel's 'move up a tier' copy doesn't name Enterprise specifically when he's already on Team (the top paid tier)",
    "expected": "When I'm at 240% of Team's allotment, the nudge should say 'you need Enterprise', not the generic 'move up a tier' that applies equally to a Free org that should go to Pro.",
    "got": "allotmentRead's over-fit message is one string for all three metered plans: 'top up or move up a tier before private scans pause' (AllotmentPanel.tsx:58-63) — doesn't special-case Team -> Enterprise, where 'move up' means a custom sales conversation, not a self-serve tier click.",
    "evidence": ["src/app/usage/AllotmentPanel.tsx:58"],
    "code_check": "confirmed-absent",
    "verdict": "confirmed"
  },
  {
    "id": "GAB-L1-04b",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "gabriel-seriesb-vp",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "polish",
    "impact": { "frequency": "low", "reachability": "high", "trust_erosion": "low" },
    "dimension": "trust",
    "title": "Per-repo deltas in the new repos×time Fleet view carry no R²/noise signal, only a binary mock-vs-live flag",
    "expected": "When I drill into a specific repo's movement in the Fleet rollup, I want the same 'is this real' confidence read the org-level trajectory gives me on the Executive tab.",
    "got": "buildTrajectories computes deltaWindow/deltaLast and deltaCrossesEngine (mock<->live transition) per repo (repoTrajectory.ts:52-86), and the UI mutes engine-transition deltas (RepoCategoryRollup.tsx:118-133) — good provenance for THAT case — but there's no per-repo fitQuality/R² the way forecastTrajectory computes at the org level, so a same-engine repo-level wobble within the LLM's guardband isn't flagged as noise the way the org-wide trajectory now is on the Executive tab.",
    "evidence": ["src/components/org/overview/repoTrajectory.ts:52", "src/components/org/overview/repoTrajectory.ts:79", "src/lib/maturity/forecast.ts:56-63"],
    "code_check": "by-design",
    "verdict": "confirmed",
    "l2_priority": "Re-scan a single unchanged repo twice under claude-cli; confirm the Fleet rollup shows a same-engine delta with no noise/confidence cue, distinct from the Executive tab's org-level R² note."
  },
  {
    "id": "GAB-L1-05b",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "gabriel-seriesb-vp",
    "cert_level": "L1",
    "type": "trust",
    "severity": "polish",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "low" },
    "dimension": "senior-quality",
    "title": "STRENGTH — the board briefing now carries its own trend-confidence caveat, closing the prior run's trust gap",
    "expected": "On the surface I put in front of the board, a flat/noisy trend is flagged so I don't present the model breathing within its guardband as real movement.",
    "got": "forecastConfidenceNote renders 'trend confidence N% · noisy' directly on the Executive page under the trajectory headline (executive/page.tsx:159-161), suppressed under lowData so a 2-point series can't masquerade as '100% confidence' (briefing.ts:243-248, forecast.ts:58-63). Same wording flows into the 'Copy for LLM' markdown and the PDF. This is exactly what the 2026-06-20 L1 pass flagged as missing (GAB-L1-03) and it's now fixed at the source.",
    "evidence": ["src/app/org/[slug]/executive/page.tsx:159", "src/lib/org/briefing.ts:36", "src/lib/org/briefing.ts:243", "src/lib/maturity/forecast.ts:176"],
    "code_check": "by-design",
    "verdict": "confirmed"
  },
  {
    "id": "GAB-L1-06b",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "gabriel-seriesb-vp",
    "cert_level": "L1",
    "type": "trust",
    "severity": "polish",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "low" },
    "dimension": "trust",
    "title": "STRENGTH — advertised tier retention now actually bounds how far the board trajectory can look back",
    "expected": "The retention I'm paying Team for is how far back my trajectory can actually look.",
    "got": "retentionCutoff(plan, nowMs) is now read directly by getOrgRollup's trend/trajectory query (org-rollup.ts:396-397) as a non-destructive read floor, and by the personal-workspace history read (personal.ts:164) — the pricing-page claim (Team = 365 days, plans.ts:65) is now the same number that clamps his actual board trajectory, closing the prior run's GAB-L1-04 gap.",
    "evidence": ["src/lib/plans.ts:189", "src/lib/db/org-rollup.ts:396", "src/lib/plans.ts:65"],
    "code_check": "by-design",
    "verdict": "confirmed"
  },
  {
    "id": "GAB-L1-07b",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "gabriel-seriesb-vp",
    "cert_level": "L1",
    "type": "trust",
    "severity": "polish",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "low" },
    "dimension": "senior-quality",
    "title": "STRENGTH — definition-stable quarterly number + delta-with-provenance still make the board read defensible",
    "expected": "The same maturity computation every quarter, with what-moved-since-last-period, so my board slide is comparable and current.",
    "got": "Overall/adoption/rigor use the same deterministic guardbanded blend each run; the briefing carries vs-previous-period deltas per dimension + movement-this-period with provenance (executive/page.tsx:171-226). Unchanged strength from the prior audit, still holds under the redesigned Overview.",
    "evidence": ["src/lib/org/briefing.ts:203-226", "src/app/org/[slug]/executive/page.tsx:171"],
    "code_check": "by-design",
    "verdict": "confirmed"
  }
]
```

## Character feedback (Gabriel, first person)

Would I renew? Yes, and this time with less hedging than last cycle. The board briefing still gives me the same number computed the same way every quarter, it still tells me what moved since the board last saw it — and now it tells me *how much to trust that move*, right there under the headline, not buried on a different tab. "Trend confidence 38% · noisy" sitting under the trajectory on the page I'm about to screenshot into a deck — that's exactly the discipline I need before I put a slope in front of the board. Last time I flagged that this honesty existed on the overview but vanished on the briefing; that's fixed now. Good.

The bigger fix, though, is the one that actually mattered to my wallet. Last cycle I said I learn about the 500-scan ceiling by hitting the 402 — the meter was silent right up until it screamed. Now `/usage` tells me at 90% of my allotment that I'm about to blow the top before I blow it, with the actual math shown, not a vibe. That's the "show me the meter, let me model the bill" instinct I came in with, finally respected. And Team finally shows a real number — $20/month — instead of a shrug. I can now do rough arithmetic myself even where the product doesn't do it for me.

What's still not right: the chip I glance at on every single dashboard load — the one thing I see whether or not I ever open /usage — still only knows two states, "fine" and "paused." It doesn't know I'm at 240% of my allotment until I click into a page I have to remember to visit. And when I get to the wall itself, Enterprise is still "Custom — contact us" with nothing behind it — no calculator, no "here's what 1200/mo would run you," just a mailto link. I can back into a number myself now that Team's price is public, but that's me doing the vendor's job, and it's a linear guess against pricing I know isn't linear at volume. I still can't walk into my CFO's office with a number I didn't derive myself.

Net: this cycle earns the renewal on the read alone — it's most of an engineer-week back, current instead of stale, and I trust the trend line enough to present it as-is. The forced step-up to Enterprise is still the right call mechanically (1200 > 500, no way around it), and it's less of a blind leap than it was — but it's still a leap. Fix the ambient chip and give me one number at the Enterprise line and I stop having anything left to explain upward.

Would I tell a peer? "The board read finally shows its own confidence number and the ceiling isn't a total surprise anymore — real improvement since I last looked. Still budget for a sales call with no price attached if you're going to blow past Team."

## Scores

- **Grounding score: 5 / 6** recurring-context sources reach the read (updated denominator — the redesigned Overview added a per-repo dimension the prior 5-source count didn't score separately). (1) Org-level trajectory/forecast — real history required, R²/lowData surfaced ✔ **now on the executive board surface**, not just the overview. (2) Movers/period deltas with provenance ✔. (3) Recurring depth gated by tier ✔ (entitlement/credits). (4) Definition-stability ✔. (5) Burn-vs-allotment ceiling signal ✔ **now present on /usage** (was absent last run). (6) Per-repo noise-vs-signal on the new Fleet rollup — **absent** (only the mock-vs-live flag, no R²). **5/6** — up from 4/5 last cycle; the one gap moved from "board trust" to "per-repo drill-down granularity," a materially smaller miss.
- **Per-cycle time-saved (number): ~24–32 engineer-hours per quarter** (replacing the ~1-engineer-week, ~32–40 hr manual maturity deck; he keeps ~1 hr to frame it), unchanged from the character's declared motivation — the design still promises the same saving, now with less trust-verification tax since the confidence caveat travels with the number.
- **Renew / downgrade / churn / upgrade verdict: UPGRADE (still forced, less reluctant).** His cadence still makes Team structurally impossible (1200 > 500) — the mechanical answer is Enterprise. But the manner of that forced upgrade improved: the ceiling is no longer a silent surprise, and Team's now-public price gives him a rough anchor. The remaining friction (chip silence, no calculator at the Enterprise line) is real but is now "budget an unpleasant sales call," not "budget a total blind spot."

## l2_priority carry-forward
1. **(GAB-L1-01b)** Seed a Team org burning >90% of allotment; confirm the header `CreditsControl` chip stays neutral while `/usage`'s `AllotmentPanel` shows the amber "over" state — i.e. the fix is real but not ambient.
2. **(GAB-L1-02b)** From a Team org over the cap, confirm the only forward path from Enterprise's "Custom" is still the mailto/about CTA with zero in-product cadence math.
3. **(GAB-L1-04b)** Re-scan one unchanged repo twice live; confirm the Fleet rollup's per-repo delta shows no noise/confidence cue even though it's a same-engine (not mock-transition) move.
4. Regression-check the two closed gaps live: (a) that `retentionCutoff` genuinely truncates a Team org's trajectory history at 365 days, not silently falling back to an unbounded read; (b) that `forecastConfidence`/`lowData` renders correctly on a real claude-cli-scored org (not just the unit-tested pure function).
